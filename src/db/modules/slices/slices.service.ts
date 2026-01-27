import pg = require('pg');

async function createCampaignSlices(
    client: pg.PoolClient,
    campaignId: string,
    totalPercentCap: number
): Promise<any> {
    if (!Number.isSafeInteger(totalPercentCap) || totalPercentCap <= 0 || totalPercentCap > 100) {
        throw new Error('INVALID_PERCENT_CAP');
    }

    const { rows, rowCount } = await client.query(
        `
        INSERT INTO campaign_slices (campaign_id, total_percent_cap, allocated_percent)
        VALUES ($1, $2, 0)
        ON CONFLICT (campaign_id) DO NOTHING
        RETURNING *
        `,
        [campaignId, totalPercentCap]
    );

    if (rowCount === 0) {
        throw new Error('CAMPAIGN_SLICES_ALREADY_EXIST');
    }

    return rows[0];
}

async function getCampaignSlices(client: pg.PoolClient, campaignId: string): Promise<any | null> {
    const { rows } = await client.query(
        `SELECT * FROM campaign_slices WHERE campaign_id = $1`,
        [campaignId]
    );
    return rows[0] || null;
}

async function calculateSlicePercent(
    client: pg.PoolClient,
    campaignId: string,
    amountPaid: number
): Promise<number> {
    const campaignRes = await client.query(
        `
        SELECT c.min_goal, cs.total_percent_cap, cs.allocated_percent
        FROM campaigns c
        JOIN campaign_slices cs ON cs.campaign_id = c.id
        WHERE c.id = $1
        `,
        [campaignId]
    );

    if (campaignRes.rows.length === 0) {
        throw new Error('CAMPAIGN_OR_SLICES_NOT_FOUND');
    }

    const { min_goal, total_percent_cap, allocated_percent } = campaignRes.rows[0];
    const minGoalPaise = min_goal * 100;
    
    const percentOfGoal = Math.floor((amountPaid * total_percent_cap) / minGoalPaise);
    const availablePercent = total_percent_cap - allocated_percent;
    
    return Math.min(percentOfGoal, availablePercent);
}

async function recordSlicePurchase(
    client: pg.PoolClient,
    params: {
        campaignId: string;
        userId: string;
        contributionId: string;
        percentOwned: number;
        amountPaid: number;
    }
): Promise<any> {
    const { campaignId, userId, contributionId, percentOwned, amountPaid } = params;

    if (percentOwned <= 0) {
        return null;
    }

    const { rows } = await client.query(
        `
        INSERT INTO slice_purchases (campaign_id, user_id, contribution_id, percent_owned, amount_paid)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING *
        `,
        [campaignId, userId, contributionId, percentOwned, amountPaid]
    );

    return rows[0];
}

async function getUserSlicesForCampaign(
    client: pg.PoolClient,
    userId: string,
    campaignId: string
): Promise<number> {
    const { rows } = await client.query(
        `
        SELECT COALESCE(SUM(percent_owned), 0) AS total_percent
        FROM slice_purchases
        WHERE user_id = $1 AND campaign_id = $2
        `,
        [userId, campaignId]
    );

    return parseInt(rows[0].total_percent, 10);
}

export = {
    createCampaignSlices,
    getCampaignSlices,
    calculateSlicePercent,
    recordSlicePurchase,
    getUserSlicesForCampaign
};
