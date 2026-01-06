import pg = require('pg');

async function getCampaigns(client: pg.PoolClient, params?: {
    status?: string;
    artistId?: string;
    limit?: number;
    offset?: number;
}): Promise<any[]> {
    const conditions: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    if (params?.status) {
        conditions.push(`c.status = $${paramIndex}`);
        values.push(params.status);
        paramIndex++;
    }

    if (params?.artistId) {
        conditions.push(`c.artist_id = $${paramIndex}`);
        values.push(params.artistId);
        paramIndex++;
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = params?.limit || 50;
    const offset = params?.offset || 0;

    const { rows } = await client.query(
        `
        SELECT 
            c.id,
            c.artist_id,
            c.title,
            c.description,
            c.min_goal,
            c.deadline,
            c.status,
            c.published_at,
            c.created_at,
            c.updated_at
        FROM campaigns c
        ${whereClause}
        ORDER BY c.created_at DESC
        LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
        `,
        [...values, limit, offset]
    );

    return rows;
}

async function getCampaignById(client: pg.PoolClient, campaignId: string): Promise<any | null> {
    const { rows } = await client.query(
        `
        SELECT 
            c.id,
            c.artist_id,
            c.title,
            c.description,
            c.min_goal,
            c.deadline,
            c.status,
            c.published_at,
            c.created_at,
            c.updated_at,
            e.amount AS funded_amount,
            e.state AS escrow_state,
            cs.total_percent_cap,
            cs.allocated_percent
        FROM campaigns c
        LEFT JOIN escrows e ON c.escrow_id = e.id
        LEFT JOIN campaign_slices cs ON cs.campaign_id = c.id
        WHERE c.id = $1
        `,
        [campaignId]
    );

    if (rows.length === 0) {
        return null;
    }

    return rows[0];
}

async function getCampaignContributors(client: pg.PoolClient, campaignId: string): Promise<any[]> {
    const { rows } = await client.query(
        `
        SELECT 
            cc.contributor_id,
            SUM(cc.amount) AS total_amount,
            COUNT(*) AS contribution_count
        FROM campaign_contributions cc
        WHERE cc.campaign_id = $1
          AND cc.status IN ('PENDING', 'LOCKED')
        GROUP BY cc.contributor_id
        ORDER BY total_amount DESC
        `,
        [campaignId]
    );

    return rows;
}

async function getUserContributions(client: pg.PoolClient, userId: string, params?: {
    status?: string;
    limit?: number;
    offset?: number;
}): Promise<any[]> {
    const conditions: string[] = ['cc.contributor_id = $1'];
    const values: any[] = [userId];
    let paramIndex = 2;

    if (params?.status) {
        conditions.push(`cc.status = $${paramIndex}`);
        values.push(params.status);
        paramIndex++;
    }

    const whereClause = `WHERE ${conditions.join(' AND ')}`;
    const limit = params?.limit || 50;
    const offset = params?.offset || 0;

    const { rows } = await client.query(
        `
        SELECT 
            cc.id,
            cc.campaign_id,
            cc.amount,
            cc.status,
            cc.created_at,
            cc.updated_at,
            c.title AS campaign_title,
            c.status AS campaign_status
        FROM campaign_contributions cc
        JOIN campaigns c ON cc.campaign_id = c.id
        ${whereClause}
        ORDER BY cc.created_at DESC
        LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
        `,
        [...values, limit, offset]
    );

    return rows;
}

async function getUserContributionTotal(client: pg.PoolClient, userId: string, campaignId: string): Promise<number> {
    const { rows } = await client.query(
        `
        SELECT COALESCE(SUM(amount), 0) AS total
        FROM campaign_contributions
        WHERE contributor_id = $1
          AND campaign_id = $2
          AND status IN ('PENDING', 'LOCKED')
        `,
        [userId, campaignId]
    );

    return parseInt(rows[0].total, 10);
}

async function getCampaignStats(client: pg.PoolClient, campaignId: string): Promise<any | null> {
    const { rows } = await client.query(
        `
        SELECT 
            c.id,
            c.min_goal,
            e.amount AS funded_amount,
            COUNT(DISTINCT cc.contributor_id) AS contributor_count,
            COUNT(cc.id) AS contribution_count
        FROM campaigns c
        LEFT JOIN escrows e ON c.escrow_id = e.id
        LEFT JOIN campaign_contributions cc ON cc.campaign_id = c.id AND cc.status IN ('PENDING', 'LOCKED')
        WHERE c.id = $1
        GROUP BY c.id, c.min_goal, e.amount
        `,
        [campaignId]
    );

    if (rows.length === 0) {
        return null;
    }

    return rows[0];
}

export = {
    getCampaigns,
    getCampaignById,
    getCampaignContributors,
    getUserContributions,
    getUserContributionTotal,
    getCampaignStats
};
