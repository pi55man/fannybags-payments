import nodeDomain = require("node:domain");
import pg = require("pg");
// import { createLedgerEntry } = require("../ledger/ledger.service");

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

        //ledger entry
        createLedgerEntry (client, {
            debit: null,
            credit: userId,
            amount: amount,
            referenceType: ref.type,
            referenceId: ref.id,
            metadata: ref.metadata
        });

        //update wallet balance
        await client.query('UPDATE wallets SET available_balance = available_balance + $1 WHERE user_id = $2', 
            [amount, userId]);
        await client.query('COMMIT');
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    }
}



export = { getWalletBalance, creditWallet };