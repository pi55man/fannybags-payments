import fastify = require('fastify');
import pool = require('../db/pool');
import paymentService = require('../db/modules/payments/payment.service');

async function webhookRoutes(server: fastify.FastifyInstance) {

    // razorpay webhook handler
    server.post('/webhooks/razorpay', async (req: any, res) => {
        const signature = req.headers['x-razorpay-signature'];

        if (!signature) {
            res.status(401);
            return { error: 'MISSING_SIGNATURE' };
        }

        const rawBody = JSON.stringify(req.body);

        try {
            const valid = paymentService.verifyWebhookSignature(rawBody, signature);
            if (!valid) {
                res.status(401);
                return { error: 'INVALID_SIGNATURE' };
            }
        } catch (error: any) {
            console.error('webhook signature verification failed:', error);
            res.status(500);
            return { error: error.message };
        }

        const event = req.body;

        if (event.event === 'payment.captured') {
            const payment = event.payload.payment.entity;
            const notes = payment.notes || {};

            if (!notes.user_id) {
                console.error('webhook missing user_id in notes:', notes);
                return { success: true, ignored: true, reason: 'missing_user_id' };
            }

            const client = await pool.connect();
            try {
                if (notes.type === 'topup') {
                    await paymentService.handleTopupSuccess(client, {
                        paymentId: payment.id,
                        userId: notes.user_id,
                        amount: payment.amount,
                        provider: 'razorpay',
                    });
                } else if (notes.type === 'campaign' && notes.campaign_id) {
                    await paymentService.handlePaymentSuccess(client, {
                        paymentId: payment.id,
                        campaignId: notes.campaign_id,
                        userId: notes.user_id,
                        amount: payment.amount,
                        provider: 'razorpay',
                    });
                } else {
                    console.error('webhook unknown payment type:', notes);
                    return { success: true, ignored: true, reason: 'unknown_type' };
                }

                return { success: true };
            } catch (error: any) {
                console.error('payment webhook failed:', error);
                if (error.message === 'PAYMENT_ALREADY_PROCESSED') {
                    return { success: true, duplicate: true };
                }
                res.status(500);
                return { error: error.message };
            } finally {
                client.release();
            }
        }

        return { success: true, ignored: true };
    });
}

export = webhookRoutes;
