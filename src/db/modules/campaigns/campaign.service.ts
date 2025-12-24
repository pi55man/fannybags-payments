import pg  =require('pg');
import decimal = require('decimal.js');
import ledgerService = require('../ledger/ledger.service');
import walletService = require('../wallet/wallet.service');
import escrowService = require('../escrow/escrow.service');
import nodeCrypto = require('node:crypto');
import ca = require('zod/v4/locales/ca.js');

async function createCampaign(
    client: pg.PoolClient,
    params: {
        title: string;
        description: string;
        min_goal: number;
        artist_id: string;
        deadline: Date;
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
    await client.query('COMMIT');
    return rows[0];
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
