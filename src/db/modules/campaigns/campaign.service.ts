import pg  =require('pg');
import decimal = require('decimal.js');
import ledgerService = require('../ledger/ledger.service');
import walletService = require('../wallet/wallet.service');
import escrowService = require('../escrow/escrow.service');
import slicesService = require('../slices/slices.service');
import nodeCrypto = require('node:crypto');

async function createCampaign(
    client: pg.PoolClient,
    params: {
        title: string;
        description: string;
        min_goal: number;
        artist_id: string;
        deadline: Date;
        slicePercentCap?: number;
    }) {
        await client.query('BEGIN');
        try{
    const campaignId = nodeCrypto.randomUUID();
    const { rows } = await client.query(
        `
        INSERT INTO campaigns (id, artist_id, title, description, min_goal,deadline,  status)
        VALUES ($1, $2, $3, $4, $5, $6, 'DRAFT')
        RETURNING *
        `,
        [campaignId, params.artist_id, params.title, params.description, params.min_goal, params.deadline]
    );
    const escrow = await escrowService.createEscrow(client, {purpose: "campaign", purposeId: campaignId});
    await client.query(`UPDATE campaigns SET escrow_id = $1 WHERE id = $2`, [escrow.id, campaignId]);
    
    if (params.slicePercentCap && params.slicePercentCap > 0) {
        await slicesService.createCampaignSlices(client, campaignId, params.slicePercentCap);
    }
    await client.query('COMMIT');
    return rows[0];
} catch (error) {
    await client.query('ROLLBACK');
    throw error;
    }
}

async function publishCampaign(client: pg.PoolClient, campaignId: string): Promise<void> {
    await client.query('BEGIN');
    try{
        const res = await client.query(
            `
            UPDATE campaigns
            SET status = 'LIVE',
                published_at = now(),
                updated_at = now()
            WHERE id = $1
            AND status = 'DRAFT'
            AND deadline > now()
            AND escrow_id IS NOT NULL
            `,
            [campaignId]
        );
        if (res.rowCount !== 1) {
            throw new Error('CAMPAIGN_CANNOT_PUBLISH');
        }
        await client.query('COMMIT');
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    }
}

async function payCampaign(client: pg.PoolClient, campaignId: string, userId: string, amountdecimal: decimal.Decimal): Promise<void> {
    const amount = amountdecimal.toNumber();
    const res = (await client.query('SELECT escrow_id FROM campaigns WHERE id = $1',[campaignId]));
    const escrow_id = res.rows[0].escrow_id;

    await client.query('BEGIN');
    try {
    await walletService.walletToEscrow(client, userId, amount, escrow_id, {type: "campaign", id: campaignId})
    await client.query(
        `
        INSERT INTO campaign_contributions (
        campaign_id,
        contributor_id,
        amount,
        status
        )
        VALUES ($1, $2, $3, 'PENDING')
        `,
        [campaignId, userId, amount]
    );
    await client.query('COMMIT');
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    }
}

async function payCampaignNoTx(client: pg.PoolClient, campaignId: string, userId: string, amountdecimal: decimal.Decimal): Promise<void> {
    const amount = amountdecimal.toNumber();
    if (!Number.isSafeInteger(amount) || amount <= 0) {
        throw new Error('INVALID_AMOUNT');
    }
    const res = await client.query('SELECT escrow_id, status FROM campaigns WHERE id = $1', [campaignId]);
    if (res.rows.length === 0) {
        throw new Error('CAMPAIGN_NOT_FOUND');
    }
    if (res.rows[0].status !== 'LIVE') {
        throw new Error('CAMPAIGN_NOT_LIVE');
    }
    const escrow_id = res.rows[0].escrow_id;

    await walletService.walletToEscrowNoTx(client, userId, amount, escrow_id, { type: "campaign", id: campaignId });

    const contributionId = nodeCrypto.randomUUID();
    const { rowCount } = await client.query(
        `
        INSERT INTO campaign_contributions (
            id,
            campaign_id,
            contributor_id,
            amount,
            status
        )
        VALUES ($1, $2, $3, $4, 'PENDING')
        `,
        [contributionId, campaignId, userId, amount]
    );

    if (rowCount !== 1) {
        throw new Error('CONTRIBUTION_INSERT_FAILED');
    }

    const slicesExist = await slicesService.getCampaignSlices(client, campaignId);
    if (slicesExist) {
        await slicesService.recordSlicePurchaseNoTx(client, {
            campaignId: campaignId,
            userId: userId,
            contributionId: contributionId,
            amountPaid: amount
        });
    }
}



async function checkAndLockCampaignFunding(client: pg.PoolClient, campaignId: string): Promise<void> {
    await client.query('BEGIN');
    try {
        const res = await client.query(
            `
            SELECT c.id, c.status, c.min_goal, c.escrow_id, e.amount AS escrow_amount, e.state AS escrow_state
            FROM campaigns c
            JOIN escrows e ON c.escrow_id = e.id
            WHERE c.id = $1
            FOR UPDATE
            `,
            [campaignId]
        );

        if (res.rows.length === 0) {
            throw new Error('CAMPAIGN_NOT_FOUND');
        }

        const campaign = res.rows[0];

        if (campaign.status === 'FUNDED') {
            await client.query('COMMIT');
            return;
        }

        if (campaign.status !== 'LIVE') {
            throw new Error('CAMPAIGN_NOT_LIVE');
        }

        if (campaign.escrow_state !== 'PENDING') {
            throw new Error('ESCROW_NOT_PENDING');
        }

        const minGoalPaise = campaign.min_goal * 100;
        if (campaign.escrow_amount < minGoalPaise) {
            throw new Error('GOAL_NOT_REACHED');
        }

        await escrowService.lockEscrow(client, campaign.escrow_id);

        const campaignUpdate = await client.query(
            `
            UPDATE campaigns
            SET status = 'FUNDED',
                updated_at = now()
            WHERE id = $1
              AND status = 'LIVE'
            `,
            [campaignId]
        );

        if (campaignUpdate.rowCount !== 1) {
            throw new Error('CAMPAIGN_STATUS_UPDATE_FAILED');
        }

        const contribUpdate = await client.query(
            `
            UPDATE campaign_contributions
            SET status = 'LOCKED',
                updated_at = now()
            WHERE campaign_id = $1
              AND status = 'PENDING'
            `,
            [campaignId]
        );

        await client.query('COMMIT');
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    }
}

async function refundCampaign(client: pg.PoolClient, campaignId: string): Promise<void> {
    await client.query('BEGIN');
    try {
        const campaignRes = await client.query(
            `
            SELECT c.id, c.status, c.deadline, c.escrow_id, e.amount AS escrow_amount, e.state AS escrow_state
            FROM campaigns c
            JOIN escrows e ON c.escrow_id = e.id
            WHERE c.id = $1
            FOR UPDATE
            `,
            [campaignId]
        );

        if (campaignRes.rows.length === 0) {
            throw new Error('CAMPAIGN_NOT_FOUND');
        }

        const campaign = campaignRes.rows[0];

        if (campaign.status !== 'LIVE') {
            throw new Error('CAMPAIGN_NOT_LIVE');
        }

        if (new Date(campaign.deadline) >= new Date()) {
            throw new Error('CAMPAIGN_DEADLINE_NOT_PASSED');
        }

        const contribRes = await client.query(
            `
            SELECT id, contributor_id, amount
            FROM campaign_contributions
            WHERE campaign_id = $1
              AND status = 'PENDING'
            FOR UPDATE
            `,
            [campaignId]
        );

        for (const contrib of contribRes.rows) {
            await walletService.escrowToWalletNoTx(
                client,
                contrib.contributor_id,
                contrib.amount,
                campaign.escrow_id,
                { type: 'refund', id: contrib.id }
            );

            const updateRes = await client.query(
                `
                UPDATE campaign_contributions
                SET status = 'REFUNDED',
                    updated_at = now()
                WHERE id = $1
                  AND status = 'PENDING'
                `,
                [contrib.id]
            );

            if (updateRes.rowCount !== 1) {
                throw new Error('CONTRIBUTION_REFUND_UPDATE_FAILED');
            }
        }

        const escrowCheck = await client.query(
            `SELECT amount FROM escrows WHERE id = $1`,
            [campaign.escrow_id]
        );

        if (escrowCheck.rows[0].amount !== 0) {
            throw new Error('ESCROW_NOT_EMPTY_AFTER_REFUNDS');
        }

        await escrowService.settleEscrowAfterRefund(client, campaign.escrow_id);

        const campaignUpdate = await client.query(
            `
            UPDATE campaigns
            SET status = 'FAILED',
                updated_at = now()
            WHERE id = $1
              AND status = 'LIVE'
            `,
            [campaignId]
        );

        if (campaignUpdate.rowCount !== 1) {
            throw new Error('CAMPAIGN_FAIL_UPDATE_FAILED');
        }

        await client.query('COMMIT');
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    }
}

async function deadlineWorker(pool: pg.Pool): Promise<void> {
    const campaignsRes = await pool.query(
        `
        SELECT c.id, c.min_goal, e.amount AS escrow_amount
        FROM campaigns c
        JOIN escrows e ON c.escrow_id = e.id
        WHERE c.status = 'LIVE'
          AND c.deadline < now()
        `
    );

    for (const campaign of campaignsRes.rows) {
        const client = await pool.connect();
        try {
            const minGoalPaise = campaign.min_goal * 100;
            if (campaign.escrow_amount < minGoalPaise) {
                await refundCampaign(client, campaign.id);
            } else {
                await checkAndLockCampaignFunding(client, campaign.id);
            }
        } catch (error) {
            console.error(`deadline worker failed for campaign ${campaign.id}:`, error);
        } finally {
            client.release();
        }
    }
}

async function canDeleteCampaign(client: pg.PoolClient, campaignId: string): Promise<boolean> {
    const res = await client.query(
        `
        SELECT c.status, e.amount AS escrow_amount
        FROM campaigns c
        LEFT JOIN escrows e ON c.escrow_id = e.id
        WHERE c.id = $1
        `,
        [campaignId]
    );

    if (res.rows.length === 0) {
        throw new Error('CAMPAIGN_NOT_FOUND');
    }

    const campaign = res.rows[0];

    if (campaign.status !== 'DRAFT') {
        return false;
    }

    if (campaign.escrow_amount && campaign.escrow_amount > 0) {
        return false;
    }

    return true;
}

async function deleteCampaign(client: pg.PoolClient, campaignId: string): Promise<void> {
    const canDelete = await canDeleteCampaign(client, campaignId);
    if (!canDelete) {
        throw new Error('CAMPAIGN_CANNOT_DELETE');
    }

    await client.query('BEGIN');
    try {
        const res = await client.query(
            `DELETE FROM campaigns WHERE id = $1 AND status = 'DRAFT'`,
            [campaignId]
        );

        if (res.rowCount !== 1) {
            throw new Error('CAMPAIGN_DELETE_FAILED');
        }

        await client.query('COMMIT');
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    }
}

export = {
    createCampaign,
    publishCampaign,
    payCampaign,
    payCampaignNoTx,
    checkAndLockCampaignFunding,
    refundCampaign,
    deadlineWorker,
    canDeleteCampaign,
    deleteCampaign
};



