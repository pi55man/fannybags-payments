import Razorpay = require("razorpay");
import crypto = require("crypto");
import pg = require("pg");
import decimal = require("decimal.js");
import campaignService = require("../campaigns/campaign.service");
import walletService = require("../wallet/wallet.service");
import idempotency = require("./idempotency");

const razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID || '',
    key_secret: process.env.RAZORPAY_KEY_SECRET || '',
});

interface RazorpayOrder {
    id: string;
    amount: number;
    currency: string;
    status: string;
    notes: Record<string, string>;
}

async function createRazorpayOrder(params: {
    amount: number;
    campaignId?: string;
    userId: string;
    type: 'campaign' | 'topup';
    currency?: string;
}): Promise<RazorpayOrder> {
    const { amount, campaignId, userId, type, currency = 'INR' } = params;

    if (!Number.isSafeInteger(amount) || amount <= 0) {
        throw new Error('INVALID_AMOUNT');
    }
    if (type === 'campaign' && !campaignId) {
        throw new Error('INVALID_CAMPAIGN_ID');
    }
    if (!userId) {
        throw new Error('INVALID_USER_ID');
    }

    const notes: Record<string, string> = {
        user_id: userId,
        type: type,
    };
    if (campaignId) {
        notes.campaign_id = campaignId;
    }

    const order = await razorpay.orders.create({
        amount: amount,
        currency: currency,
        notes: notes,
    });

    return {
        id: order.id,
        amount: order.amount as number,
        currency: order.currency,
        status: order.status,
        notes: order.notes as Record<string, string>,
    };
}

function verifyRazorpaySignature(params: {
    orderId: string;
    paymentId: string;
    signature: string;
}): boolean {
    const { orderId, paymentId, signature } = params;
    const secret = process.env.RAZORPAY_KEY_SECRET;

    if (!secret) {
        throw new Error('RAZORPAY_KEY_SECRET_NOT_CONFIGURED');
    }

    const expectedSignature = crypto
        .createHmac('sha256', secret)
        .update(`${orderId}|${paymentId}`)
        .digest('hex');

    return expectedSignature === signature;
}

function verifyWebhookSignature(body: string, signature: string): boolean {
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET;

    if (!secret) {
        throw new Error('RAZORPAY_WEBHOOK_SECRET_NOT_CONFIGURED');
    }

    const expectedSignature = crypto
        .createHmac('sha256', secret)
        .update(body)
        .digest('hex');

    return expectedSignature === signature;
}

async function isPaymentProcessed(client: pg.PoolClient, paymentId: string): Promise<boolean> {
    const { rows } = await client.query(
        `SELECT 1 FROM processed_payments WHERE payment_id = $1`,
        [paymentId]
    );
    return rows.length > 0;
}

async function insertProcessedPayment(
    client: pg.PoolClient,
    paymentId: string,
    campaignId: string | null,
    userId: string,
    amount: number,
    provider: string
): Promise<void> {
    const { rowCount } = await client.query(
        `
        INSERT INTO processed_payments (payment_id, campaign_id, user_id, amount, provider)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (payment_id) DO NOTHING
        `,
        [paymentId, campaignId, userId, amount, provider]
    );

    if (rowCount !== 1) {
        throw new Error('PAYMENT_ALREADY_PROCESSED');
    }
}

async function handlePaymentSuccess(
    client: pg.PoolClient,
    params: {
        paymentId: string;
        campaignId: string;
        userId: string;
        amount: number;
        provider: string;
    }
): Promise<void> {
    const { paymentId, campaignId, userId, amount, provider } = params;

    if (!paymentId || typeof paymentId !== 'string') {
        throw new Error('INVALID_PAYMENT_ID');
    }
    if (!campaignId || typeof campaignId !== 'string') {
        throw new Error('INVALID_CAMPAIGN_ID');
    }
    if (!userId || typeof userId !== 'string') {
        throw new Error('INVALID_USER_ID');
    }
    if (!Number.isSafeInteger(amount) || amount <= 0) {
        throw new Error('INVALID_AMOUNT');
    }
    if (!provider || typeof provider !== 'string') {
        throw new Error('INVALID_PROVIDER');
    }

    const idemKey = `payment:${paymentId}`;
    const acquired = await idempotency.getIdemLock(idemKey);
    if (!acquired) {
        return;
    }

    await client.query('BEGIN');
    try {
        await insertProcessedPayment(client, paymentId, campaignId, userId, amount, provider);
        await campaignService.payCampaignNoTx(client, campaignId, userId, new decimal.Decimal(amount));

        await client.query('COMMIT');
    } catch (error) {
        await client.query('ROLLBACK');
        await idempotency.releaseIdemLock(idemKey);
        throw error;
    }
}

async function handleTopupSuccess(
    client: pg.PoolClient,
    params: {
        paymentId: string;
        userId: string;
        amount: number;
        provider: string;
    }
): Promise<void> {
    const { paymentId, userId, amount, provider } = params;

    if (!paymentId || typeof paymentId !== 'string') {
        throw new Error('INVALID_PAYMENT_ID');
    }
    if (!userId || typeof userId !== 'string') {
        throw new Error('INVALID_USER_ID');
    }
    if (!Number.isSafeInteger(amount) || amount <= 0) {
        throw new Error('INVALID_AMOUNT');
    }
    if (!provider || typeof provider !== 'string') {
        throw new Error('INVALID_PROVIDER');
    }

    const idemKey = `topup:${paymentId}`;
    const acquired = await idempotency.getIdemLock(idemKey);
    if (!acquired) {
        return;
    }

    await client.query('BEGIN');
    try {
        await insertProcessedPayment(client, paymentId, null, userId, amount, provider);
        await walletService.creditWalletNoTx(client, userId, amount, { type: 'topup', id: paymentId });

        await client.query('COMMIT');
    } catch (error) {
        await client.query('ROLLBACK');
        await idempotency.releaseIdemLock(idemKey);
        throw error;
    }
}

export = {
    createRazorpayOrder,
    verifyRazorpaySignature,
    verifyWebhookSignature,
    isPaymentProcessed,
    handlePaymentSuccess,
    handleTopupSuccess
};



