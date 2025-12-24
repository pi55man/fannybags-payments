import Razorpay = require("razorpay");
import ledgerService = require("../ledger/ledger.service");
import pg = require("pg");
import decimal = require("decimal.js");
import walletService = require("../wallet/wallet.service");

// interface checkoutOptions {
//     key: string,
//     amount: number,
//     currency: string | "INR",
//     name: string,
//     description?: string,
//     image?: string,
//     order_id: string,
// }

async function createRazorpayOrder(amount: number, currency = "INR", key: string, name: string): Promise<Razorpay.Orders.Order> {
    const options = {
        key: key,
        amount: amount, // amount in the smallest currency unit
        currency: currency,
        name: name
    };
const razorpay: Razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID || '',
    key_secret: process.env.RAZORPAY_KEY_SECRET || '',
});
    const order = await razorpay.orders.create(options);
    console.log(razorpay.webhooks.all());
}

async function payCampaign(client: pg.PoolClient, campaignId: string, userId: string, amountdecimal: decimal.Decimal): Promise<void> {
    const amount = amountdecimal.toNumber();
    const res = (await client.query('SELECT escrow_id FROM campaigns WHERE id = $1',[campaignId]));
    const escrow_id = res.rows[0].escrow_id;

    await client.query('BEGIN');
    try {
    await walletService.walletToEscrow(client, userId, amount, escrow_id, {type: "campaign", id: campaignId})
    await client.query(
        `
        INSERT INTO campaign_contributions (
        campaign_id,
        contributor_id,
        amount,
        status
        )
        VALUES ($1, $2, $3, 'PENDING')
        `,
        [campaignId, userId, amount]
    );
    await client.query('COMMIT');
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    }
}

async function campaign_failed(client: pg.PoolClient, escrowId: string): Promise<void> {

    ledgerService.createLedgerEntry(client, {
    debit: "escrow:"+escrowId,
    credit: "fan"+userId,
    amount: ,
    referenceType:"refund",
    referenceId:"refund:{campaignId}",
    metadata: {},
    })
}