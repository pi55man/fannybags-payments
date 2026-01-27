import pg = require("pg");
import ledgerService = require("../ledger/ledger.service");
import escrowService = require("../escrow/escrow.service");


async function getWalletBalance(client: pg.PoolClient, userId: string): Promise<number> {
    const res = await client.query('SELECT available_balance FROM wallets WHERE user_id = $1', [userId]);
    if (res.rows.length > 0) {
        return res.rows[0].available_balance;
    } else {
        throw new Error('WALLET_NOT_FOUND');
    }
}
async function creditWalletNoTx(client: pg.PoolClient, userId: string, amount: number, ref: any): Promise<void> {
    await ledgerService.createLedgerEntry(client, {
        debit: "system:topup",
        credit: "wallet:" + userId,
        amount: amount,
        referenceType: ref.type,
        referenceId: ref.id,
        metadata: {},
    });
    const { rowCount } = await client.query(
        'UPDATE wallets SET available_balance = available_balance + $1 WHERE user_id = $2',
        [amount, userId]
    );
    if (rowCount !== 1) {
        throw new Error('WALLET_CREDIT_FAILED');
    }
}


async function walletToEscrowNoTx(client: pg.PoolClient, userId: string, amount: number, escrowId: string, ref: any): Promise<void> {
    await ledgerService.createLedgerEntry(client, {
        debit: "wallet:"+userId,
        credit: "escrow:"+escrowId,
        amount: amount,
        referenceType: ref.type,
        referenceId: ref.id,
        metadata: {},
    });
    const wallet = await client.query(
        'UPDATE wallets SET available_balance = available_balance - $1 WHERE user_id = $2 AND available_balance >= $1',
        [amount, userId]
    );
    if (wallet.rowCount !== 1) {
        throw new Error('INSUFFICIENT_WALLET_BALANCE');
    }
    await escrowService.incrementEscrowAmount(client, escrowId, amount);
}

async function escrowToWalletNoTx(client: pg.PoolClient, userId: string, amount: number, escrowId: string, ref: any): Promise<void> {
    await ledgerService.createLedgerEntry(client, {
        debit: "escrow:"+escrowId,
        credit: "wallet:"+userId,
        amount: amount,
        referenceType: ref.type,
        referenceId: ref.id,
        metadata: {},
    });
    await escrowService.decrementEscrowAmount(client, escrowId, amount);
    const { rowCount } = await client.query(
        'UPDATE wallets SET available_balance = available_balance + $1 WHERE user_id = $2',
        [amount, userId]
    );
    if (rowCount !== 1) {
        throw new Error('WALLET_CREDIT_FAILED');
    }
}

export = { getWalletBalance, creditWalletNoTx, walletToEscrowNoTx, escrowToWalletNoTx };