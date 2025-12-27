import pg = require("pg");

interface LedgerEntryParams {
    debit: string | null; //account losing money
    credit: string | null; //account gaining money
    amount: number; //always positive
    referenceType: string; // deposit, withdrawal,campaign, refund, escrow_release, royalty, platform_fee
    referenceId: string;
    metadata?: any; //razorpay id, etc
}

async function createLedgerEntry(client: pg.PoolClient, {
    debit,
    credit,
    amount,
    referenceType,
    referenceId,
    metadata
}: LedgerEntryParams): Promise<void> {
        amount = amount * 100; //convert to paise
    await client.query(
            `INSERT INTO ledger_entries
            (debit_account, credit_account, amount, reference_type, reference_id, metadata, created_at) 
        VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
        [debit, credit, amount, referenceType, referenceId, metadata]
    );
}
export = { createLedgerEntry };
