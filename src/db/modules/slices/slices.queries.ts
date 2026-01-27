import pg = require('pg');

async function getUserPortfolio(client: pg.PoolClient, userId: string): Promise<any[]> {
    const { rows } = await client.query(
        `
        SELECT 
            sp.campaign_id,
            c.title AS campaign_title,
            c.status AS campaign_status,
            SUM(sp.percent_owned) AS total_percent,
            SUM(sp.amount_paid) AS total_invested,
            COUNT(sp.id) AS purchase_count
        FROM slice_purchases sp
        JOIN campaigns c ON c.id = sp.campaign_id
        WHERE sp.user_id = $1
        GROUP BY sp.campaign_id, c.title, c.status
        ORDER BY total_percent DESC
        `,
        [userId]
    );

    return rows;
}

async function getCampaignSliceHolders(client: pg.PoolClient, campaignId: string): Promise<any[]> {
    const { rows } = await client.query(
        `
        SELECT 
            sp.user_id,
            SUM(sp.percent_owned) AS total_percent,
            SUM(sp.amount_paid) AS total_invested,
            COUNT(sp.id) AS purchase_count
        FROM slice_purchases sp
        WHERE sp.campaign_id = $1
        GROUP BY sp.user_id
        ORDER BY total_percent DESC
        `,
        [campaignId]
    );

    return rows;
}

async function getSlicePurchasesByUser(
    client: pg.PoolClient,
    userId: string,
    params?: { limit?: number; offset?: number }
): Promise<any[]> {
    const limit = params?.limit || 50;
    const offset = params?.offset || 0;

    const { rows } = await client.query(
        `
        SELECT 
            sp.id,
            sp.campaign_id,
            sp.percent_owned,
            sp.amount_paid,
            sp.created_at,
            c.title AS campaign_title,
            c.status AS campaign_status
        FROM slice_purchases sp
        JOIN campaigns c ON c.id = sp.campaign_id
        WHERE sp.user_id = $1
        ORDER BY sp.created_at DESC
        LIMIT $2 OFFSET $3
        `,
        [userId, limit, offset]
    );

    return rows;
}

async function getCampaignSliceStats(client: pg.PoolClient, campaignId: string): Promise<any | null> {
    const { rows } = await client.query(
        `
        SELECT 
            cs.campaign_id,
            cs.total_percent_cap,
            cs.allocated_percent,
            cs.total_percent_cap - cs.allocated_percent AS available_percent,
            COUNT(DISTINCT sp.user_id) AS holder_count,
            COUNT(sp.id) AS purchase_count
        FROM campaign_slices cs
        LEFT JOIN slice_purchases sp ON sp.campaign_id = cs.campaign_id
        WHERE cs.campaign_id = $1
        GROUP BY cs.campaign_id, cs.total_percent_cap, cs.allocated_percent
        `,
        [campaignId]
    );

    if (rows.length === 0) {
        return null;
    }

    return rows[0];
}

async function getUserCampaignOwnership(
    client: pg.PoolClient,
    userId: string,
    campaignId: string
): Promise<any | null> {
    const { rows } = await client.query(
        `
        SELECT 
            sp.campaign_id,
            c.title as campaign_title,
            c.status as campaign_status,
            c.min_goal as goal_amount,
            SUM(sp.percent_owned) as total_percent_owned,
            SUM(sp.amount_paid) as total_invested,
            COUNT(sp.id) as contribution_count
        FROM slice_purchases sp
        JOIN campaigns c ON c.id = sp.campaign_id
        WHERE sp.user_id = $1 AND sp.campaign_id = $2
        GROUP BY sp.campaign_id, c.title, c.status, c.min_goal
        `,
        [userId, campaignId]
    );

    return rows.length > 0 ? rows[0] : null;
}

export = {
    getUserPortfolio,
    getCampaignSliceHolders,
    getSlicePurchasesByUser,
    getCampaignSliceStats,
    getUserCampaignOwnership
};
