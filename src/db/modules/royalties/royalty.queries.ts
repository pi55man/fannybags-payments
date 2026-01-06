import pg = require('pg');

async function getRoyaltyReports(
    client: pg.PoolClient,
    campaignId?: string,
    params?: { limit?: number; offset?: number }
): Promise<any[]> {
    const limit = params?.limit || 50;
    const offset = params?.offset || 0;

    if (campaignId) {
        const { rows } = await client.query(
            `
            SELECT 
                rr.id,
                rr.campaign_id,
                rr.total_revenue,
                rr.status,
                rr.created_at,
                rr.processed_at,
                c.title AS campaign_title
            FROM royalty_reports rr
            JOIN campaigns c ON c.id = rr.campaign_id
            WHERE rr.campaign_id = $1
            ORDER BY rr.created_at DESC
            LIMIT $2 OFFSET $3
            `,
            [campaignId, limit, offset]
        );
        return rows;
    }

    const { rows } = await client.query(
        `
        SELECT 
            rr.id,
            rr.campaign_id,
            rr.total_revenue,
            rr.status,
            rr.created_at,
            rr.processed_at,
            c.title AS campaign_title
        FROM royalty_reports rr
        JOIN campaigns c ON c.id = rr.campaign_id
        ORDER BY rr.created_at DESC
        LIMIT $1 OFFSET $2
        `,
        [limit, offset]
    );

    return rows;
}

async function getRoyaltyReportById(client: pg.PoolClient, reportId: string): Promise<any | null> {
    const { rows } = await client.query(
        `
        SELECT 
            rr.id,
            rr.campaign_id,
            rr.total_revenue,
            rr.status,
            rr.created_at,
            rr.processed_at,
            c.title AS campaign_title
        FROM royalty_reports rr
        JOIN campaigns c ON c.id = rr.campaign_id
        WHERE rr.id = $1
        `,
        [reportId]
    );

    if (rows.length === 0) {
        return null;
    }

    return rows[0];
}

async function getPayoutsForReport(client: pg.PoolClient, reportId: string): Promise<any[]> {
    const { rows } = await client.query(
        `
        SELECT 
            rp.id,
            rp.user_id,
            rp.slice_percent,
            rp.amount,
            rp.status,
            rp.created_at,
            rp.paid_at
        FROM royalty_payouts rp
        WHERE rp.report_id = $1
        ORDER BY rp.amount DESC
        `,
        [reportId]
    );

    return rows;
}

async function getUserRoyaltyHistory(
    client: pg.PoolClient,
    userId: string,
    params?: { limit?: number; offset?: number }
): Promise<any[]> {
    const limit = params?.limit || 50;
    const offset = params?.offset || 0;

    const { rows } = await client.query(
        `
        SELECT 
            rp.id,
            rp.report_id,
            rp.slice_percent,
            rp.amount,
            rp.status,
            rp.created_at,
            rp.paid_at,
            rr.campaign_id,
            rr.total_revenue AS report_total_revenue,
            c.title AS campaign_title
        FROM royalty_payouts rp
        JOIN royalty_reports rr ON rr.id = rp.report_id
        JOIN campaigns c ON c.id = rr.campaign_id
        WHERE rp.user_id = $1
        ORDER BY rp.created_at DESC
        LIMIT $2 OFFSET $3
        `,
        [userId, limit, offset]
    );

    return rows;
}

async function getUserTotalRoyalties(client: pg.PoolClient, userId: string): Promise<number> {
    const { rows } = await client.query(
        `
        SELECT COALESCE(SUM(amount), 0) AS total
        FROM royalty_payouts
        WHERE user_id = $1 AND status = 'PAID'
        `,
        [userId]
    );

    return parseInt(rows[0].total, 10);
}

export = {
    getRoyaltyReports,
    getRoyaltyReportById,
    getPayoutsForReport,
    getUserRoyaltyHistory,
    getUserTotalRoyalties
};
