import pg = require('pg');

type SupabaseClient = any;

async function getCampaigns(supabase: SupabaseClient, params?: {
    status?: string;
    releaseId?: string;
    limit?: number;
    offset?: number;
}): Promise<any[]> {
    let query = supabase
        .from('campaigns')
        .select(`
            *,
            releases:release_id (
                title,
                primary_artist_id
            )
        `)
        .order('created_at', { ascending: false });

    if (params?.status) {
        query = query.eq('status', params.status);
    }

    if (params?.releaseId) {
        query = query.eq('release_id', params.releaseId);
    }

    const limit = params?.limit || 50;
    const offset = params?.offset || 0;

    query = query.range(offset, offset + limit - 1);

    const { data, error } = await query;

    if (error) {
        throw error;
    }

    return data || [];
}

async function getCampaignsByArtist(supabase: SupabaseClient, artistId: string, params?: {
    status?: string;
    limit?: number;
    offset?: number;
}): Promise<any[]> {
    // Get all releases by this artist
    const { data: releases, error: releaseError } = await supabase
        .from('releases')
        .select('id')
        .eq('primary_artist_id', artistId);

    if (releaseError) {
        throw releaseError;
    }

    if (!releases || releases.length === 0) {
        return [];
    }

    const releaseIds = releases.map((r: any) => r.id);

    // Get campaigns for these releases
    let query = supabase
        .from('campaigns')
        .select(`
            *,
            releases:release_id (
                title,
                primary_artist_id,
                primary_genre
            )
        `)
        .in('release_id', releaseIds)
        .order('created_at', { ascending: false });

    if (params?.status) {
        query = query.eq('status', params.status);
    }

    const limit = params?.limit || 50;
    const offset = params?.offset || 0;

    query = query.range(offset, offset + limit - 1);

    const { data, error } = await query;

    if (error) {
        throw error;
    }

    return data || [];
}

async function getCampaignById(supabase: SupabaseClient, campaignId: string): Promise<any | null> {
    const { data, error } = await supabase
        .from('campaigns')
        .select(`
            *,
            releases:release_id (
                title,
                primary_artist_id,
                release_type,
                primary_genre
            )
        `)
        .eq('id', campaignId)
        .single();

    if (error) {
        if (error.code === 'PGRST116') {
            return null;
        }
        throw error;
    }

    return data;
}

async function getCampaignTracks(supabase: SupabaseClient, campaignId: string): Promise<any[]> {
    const { data, error } = await supabase
        .from('campaign_tracks')
        .select(`
            id,
            track_id,
            royalty_share_percent,
            tracks:track_id (
                track_title,
                track_number,
                duration_seconds,
                isrc_code
            )
        `)
        .eq('campaign_id', campaignId)
        .order('tracks(track_number)', { ascending: true });

    if (error) {
        throw error;
    }

    return data || [];
}

async function getCampaignTrackBudgetItems(supabase: SupabaseClient, campaignTrackId: string): Promise<any[]> {
    const { data, error } = await supabase
        .from('campaign_track_budget_items')
        .select('*')
        .eq('campaign_track_id', campaignTrackId)
        .order('created_at', { ascending: true });

    if (error) {
        throw error;
    }

    return data || [];
}

async function getTrackContributors(supabase: SupabaseClient, trackId: string): Promise<any[]> {
    const { data, error } = await supabase
        .from('track_contributors')
        .select('*')
        .eq('track_id', trackId)
        .order('created_at', { ascending: true });

    if (error) {
        throw error;
    }

    return data || [];
}

async function getCampaignWithDetails(supabase: SupabaseClient, campaignId: string): Promise<any | null> {
    const campaign = await getCampaignById(supabase, campaignId);
    
    if (!campaign) {
        return null;
    }

    // Get tracks
    const tracks = await getCampaignTracks(supabase, campaignId);
    
    // Get budget items and contributors for each track
    for (const track of tracks) {
        track.budget_items = await getCampaignTrackBudgetItems(supabase, track.id);
        track.contributors = await getTrackContributors(supabase, track.track_id);
    }

    campaign.tracks = tracks;
    
    return campaign;
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
    getCampaignsByArtist,
    getCampaignById,
    getCampaignTracks,
    getCampaignTrackBudgetItems,
    getTrackContributors,
    getCampaignWithDetails,
    getCampaignContributors,
    getUserContributions,
    getUserContributionTotal,
    getCampaignStats
};
