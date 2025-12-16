import pg = require("pg");
import decimal = require("decimal.js");

interface LedgerEntryParams {
    debit: string | null; //account losing money
    credit: string | null; //account gaining money
    amount: decimal.Decimal; //always positive
    referenceType: string; // deposit, withdrawal,campaign, refund, escrow_release, royalty, platform_fee
    referenceId: string;
    metadata: any; //razorpay id, etc
}

async function createLedgerEntry(client: pg.PoolClient, {
    debit,
    credit,
    amount,
    referenceType,
    referenceId,
    metadata
}: LedgerEntryParams): Promise<void> {
    await client.query(
`CREATE TABLE ledger_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  debit_account TEXT NOT NULL,
  credit_account TEXT NOT NULL,

  amount BIGINT NOT NULL CHECK (amount > 0),
  currency CHAR(3) NOT NULL DEFAULT 'INR',

  reference_type TEXT NOT NULL,
  reference_id UUID NOT NULL,

  metadata JSONB,

  created_at TIMESTAMP NOT NULL DEFAULT now()
);
`)
}
export = { createLedgerEntry };