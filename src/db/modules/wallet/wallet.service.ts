import nodeDomain = require("node:domain");
import pg = require("pg");
import fastify = require("fastify");
import ledgerService = require("../ledger/ledger.service");
import Decimal = require("decimal.js");
import escrowService = require("../escrow/escrow.service");

const {createLedgerEntry} = require("../ledger/ledger.service");

const pool = new pg.Pool({
    user: 'postgres',
    password: 'peer',
    host: 'localhost',
    port: 5432,
    database: 'fannybags-payments'
});


async function getWalletBalance(userId: string): Promise<number> {
    const client = await pool.connect();
    try {
        const res = await client.query('SELECT available_balance FROM wallets WHERE user_id = $1', [userId]);
        if (res.rows.length > 0) {
            return res.rows[0].balance;
        } else {
            throw new Error('Wallet not found');
        }
    } finally {
        client.release();
    }
}
async function creditWallet(client: pg.PoolClient, userId: string, amount: number, ref: any): Promise<void> {
    try {
        await client.query('BEGIN');

        await client.query('UPDATE wallets SET available_balance = available_balance + $1 WHERE user_id = $2', 
            [amount, userId]);
        await client.query('COMMIT');
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    }
}

async function walletToEscrow(client: pg.PoolClient, userId: string, amount: number, escrowId: string,  ref: any): Promise<void> {
    try {
        await client.query('BEGIN');
        await ledgerService.createLedgerEntry(client, {
            debit: "wallet:"+userId,
            credit: "escrow:"+escrowId,
            amount: amount,
            referenceType:ref.type,
            referenceId:ref.id,
            metadata: {},
    });
        const wallet = await client.query('UPDATE wallets SET available_balance = available_balance - $1 WHERE user_id = $2 AND available_balance >= $1', [amount, userId]);
        if (wallet.rowCount !== 1) {
            throw new Error('0 or multiple rows affected');
        }
        await escrowService.incrementEscrowAmount(client, escrowId, amount);

        // const escrow = await client.query(`UPDATE escrows SET amount = amount + $1 WHERE id = $2 AND state IN ('PENDING','LOCKED')`, [amount, escrowId]);
        // if (escrow.rowCount !== 1) {
        //     throw new Error('0 or multiple rows affected');
        // }

        await client.query('COMMIT');
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    }
}

export = { getWalletBalance, creditWallet, walletToEscrow };