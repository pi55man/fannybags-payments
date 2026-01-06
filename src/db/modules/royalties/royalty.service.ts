import pg = require('pg');
import nodeCrypto = require('node:crypto');
import walletService = require('../wallet/wallet.service');
import ledgerService = require('../ledger/ledger.service');

async function createRoyaltyReport(
    client: pg.PoolClient,
    campaignId: string,
    totalRevenue: number
): Promise<any> {
    if (!Number.isSafeInteger(totalRevenue) || totalRevenue <= 0) {
        throw new Error('INVALID_REVENUE_AMOUNT');
    }

    const campaignRes = await client.query(
        `SELECT id, status, escrow_id FROM campaigns WHERE id = $1`,
        [campaignId]
    );

    if (campaignRes.rows.length === 0) {
        throw new Error('CAMPAIGN_NOT_FOUND');
    }

    if (campaignRes.rows[0].status !== 'FUNDED' && campaignRes.rows[0].status !== 'COMPLETED') {
        throw new Error('CAMPAIGN_NOT_FUNDED');
    }

    const { rows } = await client.query(
        `
        INSERT INTO royalty_reports (campaign_id, total_revenue, status)
        VALUES ($1, $2, 'PENDING')
        RETURNING *
        `,
        [campaignId, totalRevenue]
    );

    return rows[0];
}

async function calculatePayoutsForReport(
    client: pg.PoolClient,
    reportId: string
): Promise<any[]> {
    const reportRes = await client.query(
        `SELECT * FROM royalty_reports WHERE id = $1`,
        [reportId]
    );

    if (reportRes.rows.length === 0) {
        throw new Error('REPORT_NOT_FOUND');
    }

    const report = reportRes.rows[0];

    const holdersRes = await client.query(
        `
        SELECT 
            user_id,
            SUM(percent_owned) AS total_percent
        FROM slice_purchases
        WHERE campaign_id = $1
        GROUP BY user_id
        `,
        [report.campaign_id]
    );

    const payouts = [];
    for (const holder of holdersRes.rows) {
        const amount = Math.floor((report.total_revenue * holder.total_percent) / 100);
        if (amount > 0) {
            payouts.push({
                user_id: holder.user_id,
                slice_percent: parseInt(holder.total_percent, 10),
                amount: amount
            });
        }
    }

    return payouts;
}

async function payoutRoyalties(
    client: pg.PoolClient,
    reportId: string
): Promise<void> {
    await client.query('BEGIN');
    try {
        const reportRes = await client.query(
            `
            SELECT rr.*, c.escrow_id
            FROM royalty_reports rr
            JOIN campaigns c ON c.id = rr.campaign_id
            WHERE rr.id = $1
            FOR UPDATE
            `,
            [reportId]
        );

        if (reportRes.rows.length === 0) {
            throw new Error('REPORT_NOT_FOUND');
        }

        const report = reportRes.rows[0];

        if (report.status !== 'PENDING') {
            throw new Error('REPORT_ALREADY_PROCESSED');
        }

        const existingPayouts = await client.query(
            `SELECT id FROM royalty_payouts WHERE report_id = $1`,
            [reportId]
        );

        if (existingPayouts.rows.length > 0) {
            throw new Error('PAYOUTS_ALREADY_EXIST');
        }

        const payouts = await calculatePayoutsForReport(client, reportId);

        for (const payout of payouts) {
            const payoutId = nodeCrypto.randomUUID();

            await client.query(
                `
                INSERT INTO royalty_payouts (id, report_id, user_id, slice_percent, amount, status)
                VALUES ($1, $2, $3, $4, $5, 'PAID')
                `,
                [payoutId, reportId, payout.user_id, payout.slice_percent, payout.amount]
            );

            await walletService.creditWalletNoTx(client, payout.user_id, payout.amount, {
                type: 'royalty',
                id: payoutId
            });

            await client.query(
                `UPDATE royalty_payouts SET paid_at = now() WHERE id = $1`,
                [payoutId]
            );
        }

        const updateRes = await client.query(
            `
            UPDATE royalty_reports
            SET status = 'COMPLETED',
                processed_at = now()
            WHERE id = $1
              AND status = 'PENDING'
            `,
            [reportId]
        );

        if (updateRes.rowCount !== 1) {
            throw new Error('REPORT_STATUS_UPDATE_FAILED');
        }

        await client.query('COMMIT');
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    }
}

export = {
    createRoyaltyReport,
    calculatePayoutsForReport,
    payoutRoyalties
};
