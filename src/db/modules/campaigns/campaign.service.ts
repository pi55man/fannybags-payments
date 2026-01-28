import pg = require('pg');
import decimal = require('decimal.js');
import ledgerService = require('../ledger/ledger.service');
import walletService = require('../wallet/wallet.service');
import escrowService = require('../escrow/escrow.service');
import slicesService = require('../slices/slices.service');
import nodeCrypto = require('node:crypto');

type SupabaseClient = any;

interface BudgetItem {
    category: string;
    amount: number;
    khapeetar_mode: string;
    khapeetar_id?: string;
}

interface TrackContributor {
    name?: string;
    role: string;
}

interface TrackData {
    track_title: string;
    track_number?: number;
    audio_file_url?: string;
    isrc_code?: string;
    duration_seconds?: number;
    explicit?: boolean;
    audio_language: string;
    title_language: string;
    contributors?: TrackContributor[];
}

interface CampaignTrackData {
    track_id?: string; // Optional - if provided, use existing track
    track_data?: TrackData; // Optional - if provided, create new track
    royalty_share_percent: number;
    budget_items: BudgetItem[];
}

interface ReleaseData {
    title: string;
    release_type: string;
    primary_artist_id: string;
    primary_genre: string;
    secondary_genre?: string;
    is_already_distributed?: boolean;
    current_distributor?: string;
    preferred_distributor?: string;
    upc?: string;
    original_release_date?: Date;
    current_release_date?: Date;
    public_release_link?: string;
    copyright_year?: number;
    copyright_owner?: string;
    publishing_year?: number;
    publishing_owner?: string;
    status?: string;
}

interface CreateCampaignParams {
    release_id?: string; // Optional - use existing release
    release_data?: ReleaseData; // Optional - create new release
    goal_amount: number;
    story?: string;
    creative_vision?: string;
    start_date: Date;
    end_date: Date;
    tracks: CampaignTrackData[];
}

async function createCampaign(
    supabase: SupabaseClient,
    params: CreateCampaignParams
) {
    try {
        let releaseId: string;

        // Determine if we need to create a new release or use existing one
        if (params.release_id) {
            // Use existing release
            const { data: existingRelease, error } = await supabase
                .from('releases')
                .select('id')
                .eq('id', params.release_id)
                .single();
            
            if (error || !existingRelease) {
                throw new Error('RELEASE_NOT_FOUND');
            }
            releaseId = params.release_id;
        } else if (params.release_data) {
            // Create new release
            releaseId = nodeCrypto.randomUUID();
            const rd = params.release_data;
            
            const { error: releaseError } = await supabase
                .from('releases')
                .insert({
                    id: releaseId,
                    title: rd.title,
                    release_type: rd.release_type,
                    primary_artist_id: rd.primary_artist_id,
                    primary_genre: rd.primary_genre,
                    secondary_genre: rd.secondary_genre,
                    is_already_distributed: rd.is_already_distributed || false,
                    current_distributor: rd.current_distributor,
                    preferred_distributor: rd.preferred_distributor,
                    upc: rd.upc,
                    original_release_date: rd.original_release_date,
                    current_release_date: rd.current_release_date,
                    public_release_link: rd.public_release_link,
                    copyright_year: rd.copyright_year,
                    copyright_owner: rd.copyright_owner,
                    publishing_year: rd.publishing_year,
                    publishing_owner: rd.publishing_owner,
                    status: rd.status || 'draft'
                });
            
            if (releaseError) {
                throw releaseError;
            }
        } else {
            throw new Error('MUST_PROVIDE_RELEASE_ID_OR_RELEASE_DATA');
        }

        // Create campaign
        const campaignId = nodeCrypto.randomUUID();
        const { data: campaign, error: campaignError } = await supabase
            .from('campaigns')
            .insert({
                id: campaignId,
                release_id: releaseId,
                goal_amount: params.goal_amount,
                story: params.story,
                creative_vision: params.creative_vision,
                start_date: params.start_date,
                end_date: params.end_date,
                status: 'draft'
            })
            .select()
            .single();

        if (campaignError) {
            throw campaignError;
        }

        // Process tracks
        if (params.tracks && params.tracks.length > 0) {
            for (const trackData of params.tracks) {
                let trackId: string;

                // Determine if we use existing track or create new one
                if (trackData.track_id) {
                    // Use existing track
                    const { data: existingTrack, error: trackCheckError } = await supabase
                        .from('tracks')
                        .select('id')
                        .eq('id', trackData.track_id)
                        .eq('release_id', releaseId)
                        .single();
                    
                    if (trackCheckError || !existingTrack) {
                        throw new Error(`TRACK_NOT_FOUND_OR_NOT_IN_RELEASE: ${trackData.track_id}`);
                    }
                    trackId = trackData.track_id;
                } else if (trackData.track_data) {
                    // Create new track
                    trackId = nodeCrypto.randomUUID();
                    const td = trackData.track_data;
                    
                    const { error: trackError } = await supabase
                        .from('tracks')
                        .insert({
                            id: trackId,
                            release_id: releaseId,
                            track_title: td.track_title,
                            track_number: td.track_number,
                            audio_file_url: td.audio_file_url,
                            isrc_code: td.isrc_code,
                            duration_seconds: td.duration_seconds,
                            explicit: td.explicit || false,
                            audio_language: td.audio_language,
                            title_language: td.title_language
                        });

                    if (trackError) {
                        throw trackError;
                    }

                    // Insert track contributors if provided
                    if (td.contributors && td.contributors.length > 0) {
                        const contributorsToInsert = td.contributors.map(contributor => ({
                            id: nodeCrypto.randomUUID(),
                            track_id: trackId,
                            name: contributor.name,
                            role: contributor.role
                        }));

                        const { error: contributorsError } = await supabase
                            .from('track_contributors')
                            .insert(contributorsToInsert);

                        if (contributorsError) {
                            throw contributorsError;
                        }
                    }
                } else {
                    throw new Error('TRACK_MUST_HAVE_TRACK_ID_OR_TRACK_DATA');
                }

                // Insert campaign_track
                const campaignTrackId = nodeCrypto.randomUUID();
                const { error: campaignTrackError } = await supabase
                    .from('campaign_tracks')
                    .insert({
                        id: campaignTrackId,
                        campaign_id: campaignId,
                        track_id: trackId,
                        royalty_share_percent: trackData.royalty_share_percent
                    });

                if (campaignTrackError) {
                    throw campaignTrackError;
                }

                // Insert budget items for this track
                if (trackData.budget_items && trackData.budget_items.length > 0) {
                    const budgetItemsToInsert = trackData.budget_items.map(budgetItem => ({
                        id: nodeCrypto.randomUUID(),
                        campaign_track_id: campaignTrackId,
                        category: budgetItem.category,
                        amount: budgetItem.amount,
                        khapeetar_mode: budgetItem.khapeetar_mode,
                        khapeetar_id: budgetItem.khapeetar_id || null,
                        status: 'draft'
                    }));

                    const { error: budgetError } = await supabase
                        .from('campaign_track_budget_items')
                        .insert(budgetItemsToInsert);

                    if (budgetError) {
                        throw budgetError;
                    }
                }
            }
        }

        return campaign;
    } catch (error) {
        throw error;
    }
}

async function publishCampaign(supabase: SupabaseClient, campaignId: string): Promise<void> {
    const { error } = await supabase
        .from('campaigns')
        .update({ 
            status: 'live',
            updated_at: new Date()
        })
        .eq('id', campaignId)
        .eq('status', 'draft')
        .gt('end_date', new Date().toISOString());
    
    if (error) {
        throw new Error('CAMPAIGN_CANNOT_PUBLISH');
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

    const campaignGoal = await client.query('SELECT min_goal FROM campaigns WHERE id = $1', [campaignId]);
    const goalAmount = campaignGoal.rows[0].min_goal * 100;
    const percentOwned = (amount / goalAmount) * 100;

    await slicesService.recordSlicePurchase(client, {
        campaignId: campaignId,
        userId: userId,
        contributionId: contributionId,
        percentOwned: percentOwned,
        amountPaid: amount
    });
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
    payCampaignNoTx,
    checkAndLockCampaignFunding,
    refundCampaign,
    deadlineWorker,
    canDeleteCampaign,
    deleteCampaign
};



