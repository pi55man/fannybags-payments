import fastify = require('fastify');
import pg = require('pg');
import pool = require('../db/pgpool');
import supabaseClient = require('../db/pool');
import campaignService = require('../db/modules/campaigns/campaign.service');
import campaignQueries = require('../db/modules/campaigns/campaign.queries');
import paymentService = require('../db/modules/payments/payment.service');
import walletService = require('../db/modules/wallet/wallet.service');
import slicesQueries = require('../db/modules/slices/slices.queries');
import royaltyService = require('../db/modules/royalties/royalty.service');
import royaltyQueries = require('../db/modules/royalties/royalty.queries');

async function routes(server: fastify.FastifyInstance) {

    // get all campaigns (public)
    server.get('/campaigns', async (req: any, res) => {
        try {
            const params: any = {};
            if (req.query.status) params.status = req.query.status;
            if (req.query.releaseId) params.releaseId = req.query.releaseId;
            if (req.query.limit) params.limit = parseInt(req.query.limit, 10);
            if (req.query.offset) params.offset = parseInt(req.query.offset, 10);
            
            const campaigns = await campaignQueries.getCampaigns(supabaseClient, params);
            return { campaigns };
        } catch (error: any) {
            res.status(500);
            return { error: error.message };
        }
    });

    // get campaigns by artist (public)
    server.get('/artists/:artistId/campaigns', async (req: any, res) => {
        try {
            const params: any = {};
            if (req.query.status) params.status = req.query.status;
            if (req.query.limit) params.limit = parseInt(req.query.limit, 10);
            if (req.query.offset) params.offset = parseInt(req.query.offset, 10);
            
            const campaigns = await campaignQueries.getCampaignsByArtist(supabaseClient, req.params.artistId, params);
            return { campaigns };
        } catch (error: any) {
            res.status(500);
            return { error: error.message };
        }
    });

    // get campaign by id (public)
    server.get('/campaigns/:id', async (req: any, res) => {
        try {
            const campaign = await campaignQueries.getCampaignById(supabaseClient, req.params.id);
            if (!campaign) {
                res.status(404);
                return { error: 'CAMPAIGN_NOT_FOUND' };
            }
            return { campaign };
        } catch (error: any) {
            res.status(500);
            return { error: error.message };
        }
    });

    // get campaign with full details (public)
    server.get('/campaigns/:id/details', async (req: any, res) => {
        try {
            const campaign = await campaignQueries.getCampaignWithDetails(supabaseClient, req.params.id);
            if (!campaign) {
                res.status(404);
                return { error: 'CAMPAIGN_NOT_FOUND' };
            }
            return { campaign };
        } catch (error: any) {
            res.status(500);
            return { error: error.message };
        }
    });

    // get user contributions (authenticated)
    server.get('/users/:userId/contributions', async (req: any, res) => {
        const client = await pool.connect();
        try {
            const params: any = {};
            if (req.query.status) params.status = req.query.status;
            if (req.query.limit) params.limit = parseInt(req.query.limit, 10);
            if (req.query.offset) params.offset = parseInt(req.query.offset, 10);
            
            const contributions = await campaignQueries.getUserContributions(client, req.params.userId, params);
            return { contributions };
        } finally {
            client.release();
        }
    });

    // create campaign (artist only)
    server.post('/campaigns', async (req: any, res) => {
        try {
            const campaign = await campaignService.createCampaign(supabaseClient, {
                release_id: req.body.release_id,
                release_data: req.body.release_data,
                goal_amount: req.body.goal_amount,
                story: req.body.story,
                creative_vision: req.body.creative_vision,
                start_date: new Date(req.body.start_date),
                end_date: new Date(req.body.end_date),
                tracks: req.body.tracks || []
            });
            res.status(201);
            return { campaign };
        } catch (error: any) {
            res.status(400);
            return { error: error.message };
        }
    });

    // publish campaign (artist only)
    server.post('/campaigns/:id/publish', async (req: any, res) => {
        try {
            await campaignService.publishCampaign(supabaseClient, req.params.id);
            return { success: true };
        } catch (error: any) {
            res.status(400);
            return { error: error.message };
        }
    });

    // delete campaign (artist only, draft only)
    server.delete('/campaigns/:id', async (req: any, res) => {
        const client = await pool.connect();
        try {
            await campaignService.deleteCampaign(client, req.params.id);
            return { success: true };
        } catch (error: any) {
            if (error.message === 'CAMPAIGN_CANNOT_DELETE') {
                res.status(403);
            } else if (error.message === 'CAMPAIGN_NOT_FOUND') {
                res.status(404);
            } else {
                res.status(400);
            }
            return { error: error.message };
        } finally {
            client.release();
        }
    });

    // get wallet balance (authenticated)
    server.get('/users/:userId/wallet', async (req: any, res) => {
        const client = await pool.connect();
        try {
            const balance = await walletService.getWalletBalance(client, req.params.userId);
            return { balance };
        } catch (error: any) {
            if (error.message === 'WALLET_NOT_FOUND') {
                res.status(404);
            } else {
                res.status(400);
            }
            return { error: error.message };
        } finally {
            client.release();
        }
    });

    // create razorpay order for campaign contribution (authenticated)
    server.post('/campaigns/:id/pay', async (req: any, res) => {
        const campaignId = req.params.id;
        const { userId, amount } = req.body;

        if (!userId || typeof userId !== 'string') {
            res.status(400);
            return { error: 'INVALID_USER_ID' };
        }
        if (!Number.isSafeInteger(amount) || amount <= 0) {
            res.status(400);
            return { error: 'INVALID_AMOUNT' };
        }

        const client = await pool.connect();
        try {
            const campaign = await campaignQueries.getCampaignById(client, campaignId);
            if (!campaign) {
                res.status(404);
                return { error: 'CAMPAIGN_NOT_FOUND' };
            }
            if (campaign.status !== 'LIVE') {
                res.status(400);
                return { error: 'CAMPAIGN_NOT_LIVE' };
            }
            if (new Date(campaign.deadline) <= new Date()) {
                res.status(400);
                return { error: 'CAMPAIGN_DEADLINE_PASSED' };
            }
        } finally {
            client.release();
        }

        try {
            const order = await paymentService.createRazorpayOrder({
                amount: amount,
                campaignId: campaignId,
                userId: userId,
                type: 'campaign',
            });

            return {
                order_id: order.id,
                amount: order.amount,
                currency: order.currency,
                key: process.env.RAZORPAY_KEY_ID,
            };
        } catch (error: any) {
            console.error('razorpay order creation failed:', error);
            res.status(500);
            return { error: 'ORDER_CREATION_FAILED' };
        }
    });

    // create razorpay order for wallet topup (authenticated)
    server.post('/wallet/topup', async (req: any, res) => {
        const { userId, amount } = req.body;

        if (!userId || typeof userId !== 'string') {
            res.status(400);
            return { error: 'INVALID_USER_ID' };
        }
        if (!Number.isSafeInteger(amount) || amount <= 0) {
            res.status(400);
            return { error: 'INVALID_AMOUNT' };
        }

        try {
            const order = await paymentService.createRazorpayOrder({
                amount: amount,
                userId: userId,
                type: 'topup',
            });

            return {
                order_id: order.id,
                amount: order.amount,
                currency: order.currency,
                key: process.env.RAZORPAY_KEY_ID,
            };
        } catch (error: any) {
            console.error('razorpay topup order creation failed:', error);
            res.status(500);
            return { error: 'ORDER_CREATION_FAILED' };
        }
    });

    // verify payment after frontend checkout (authenticated)
    server.post('/payments/verify', async (req: any, res) => {
        const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

        if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
            res.status(400);
            return { error: 'MISSING_PARAMETERS' };
        }

        const valid = paymentService.verifyRazorpaySignature({
            orderId: razorpay_order_id,
            paymentId: razorpay_payment_id,
            signature: razorpay_signature,
        });

        if (!valid) {
            res.status(400);
            return { error: 'INVALID_SIGNATURE', verified: false };
        }

        return { verified: true };
    });

    // get campaign slice stats (public)
    server.get('/campaigns/:id/slices', async (req: any, res) => {
        const client = await pool.connect();
        try {
            const stats = await slicesQueries.getCampaignSliceStats(client, req.params.id);
            if (!stats) {
                res.status(404);
                return { error: 'SLICES_NOT_FOUND' };
            }
            return { slices: stats };
        } finally {
            client.release();
        }
    });

    // get user portfolio (authenticated)
    server.get('/users/:userId/portfolio', async (req: any, res) => {
        const client = await pool.connect();
        try {
            const portfolio = await slicesQueries.getUserPortfolio(client, req.params.userId);
            return { portfolio };        } finally {
            client.release();
        }
    });

    // get user slice purchases (authenticated)
    server.get('/users/:userId/slices', async (req: any, res) => {
        const client = await pool.connect();
        try {
            const params: any = {};
            if (req.query.limit) params.limit = parseInt(req.query.limit, 10);
            if (req.query.offset) params.offset = parseInt(req.query.offset, 10);
            
            const slices = await slicesQueries.getSlicePurchasesByUser(client, req.params.userId, params);
            return { slices };
        } finally {
            client.release();
        }
    });

    // get user ownership in specific campaign (authenticated)
    server.get('/campaigns/:id/ownership', async (req: any, res) => {
        const campaignId = req.params.id;
        const userId = req.query.userId;

        if (!userId) {
            res.status(400);
            return { error: 'user_id required' };
        }

        const client = await pool.connect();
        try {
            const ownership = await slicesQueries.getUserCampaignOwnership(client, userId, campaignId);
            if (!ownership) {
                return {
                    campaign_id: campaignId,
                    total_percent_owned: 0,
                    total_invested: 0,
                    contribution_count: 0
                };
            }
            return { ownership };
        } finally {
            client.release();
        }
    });

    // get user royalty history (authenticated)
    server.get('/users/:userId/royalties', async (req: any, res) => {
        const client = await pool.connect();
        try {
            const params: any = {};
            if (req.query.limit) params.limit = parseInt(req.query.limit, 10);
            if (req.query.offset) params.offset = parseInt(req.query.offset, 10);
            
            const royalties = await royaltyQueries.getUserRoyaltyHistory(client, req.params.userId, params);
            const total = await royaltyQueries.getUserTotalRoyalties(client, req.params.userId);
            return { royalties, total };
        } finally {
            client.release();
        }
    });

    // admin: create royalty report
    server.post('/admin/campaigns/:id/royalty-report', async (req: any, res) => {
        const client = await pool.connect();
        try {
            const report = await royaltyService.createRoyaltyReport(
                client,
                req.params.id,
                req.body.total_revenue
            );
            res.status(201);
            return { report };
        } catch (error: any) {
            res.status(400);
            return { error: error.message };
        } finally {
            client.release();
        }
    });

    // admin: get royalty reports for campaign
    server.get('/admin/campaigns/:id/royalty-reports', async (req: any, res) => {
        const client = await pool.connect();
        try {
            const params: any = {};
            if (req.query.limit) params.limit = parseInt(req.query.limit, 10);
            if (req.query.offset) params.offset = parseInt(req.query.offset, 10);
            
            const reports = await royaltyQueries.getRoyaltyReports(client, req.params.id, params);
            return { reports };
        } finally {
            client.release();
        }
    });

    // admin: get royalty report details
    server.get('/admin/royalty-reports/:id', async (req: any, res) => {
        const client = await pool.connect();
        try {
            const report = await royaltyQueries.getRoyaltyReportById(client, req.params.id);
            if (!report) {
                res.status(404);
                return { error: 'REPORT_NOT_FOUND' };
            }
            const payouts = await royaltyQueries.getPayoutsForReport(client, req.params.id);
            return { report, payouts };
        } finally {
            client.release();
        }
    });

    // admin: process royalty payouts
    server.post('/admin/royalty-reports/:id/payout', async (req: any, res) => {
        const client = await pool.connect();
        try {
            await royaltyService.payoutRoyalties(client, req.params.id);
            return { success: true };
        } catch (error: any) {
            res.status(400);
            return { error: error.message };
        } finally {
            client.release();
        }
    });
}

export = routes;
