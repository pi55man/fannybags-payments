/*
PENDING → LOCKED → RELEASED → SETTLED
PENDING: Collecting funds
LOCKED: 	Goal met
RELEASED:	Paid out
SETTLED:	Closed

*/
import pg = require("pg");

async function createEscrow(
  client: pg.PoolClient,
  params: {
    purpose: string;
    purposeId: string;
  }
) {
  const { rows } = await client.query(
    `
    INSERT INTO escrows (purpose, purpose_id, amount, state)
    VALUES ($1, $2, 0, 'PENDING')
    RETURNING *
    `,
    [params.purpose, params.purposeId]
  );

  return rows[0];
}
async function incrementEscrowAmount(
  client: pg.PoolClient,
  escrowId: string,
  amount: number
) {
  const { rowCount } = await client.query(
    `
    UPDATE escrows
    SET amount = amount + $1,
        updated_at = now()
    WHERE id = $2
      AND state IN ('PENDING', 'LOCKED')
    `,
    [amount, escrowId]
  );

  if (rowCount === 0) {
    throw new Error("ESCROW_NOT_ACCEPTING_FUNDS");
  }
}

async function lockEscrow(
  client: pg.PoolClient,
  escrowId: string
) {
  const { rowCount } = await client.query(
    `
    UPDATE escrows
    SET state = 'LOCKED',
        updated_at = now()
    WHERE id = $1
      AND state = 'PENDING'
    `,
    [escrowId]
  );

  if (rowCount === 0) {
    throw new Error("ESCROW_CANNOT_LOCK");
  }
}
async function EscrowReleasable(
  client: pg.PoolClient,
  escrowId: string,
  releaseAmount: number
) {
  const { rows } = await client.query(
    `
    SELECT amount, state
    FROM escrows
    WHERE id = $1
    FOR UPDATE
    `,
    [escrowId]
  );

  const escrow = rows[0];

  if (!escrow) {
    throw new Error("ESCROW_NOT_FOUND");
  }

  if (escrow.state !== "LOCKED") {
    throw new Error("ESCROW_NOT_LOCKED");
  }

  if (escrow.amount < releaseAmount) {
    throw new Error("INSUFFICIENT_ESCROW");
  }
}

async function markEscrowReleased(
  client: pg.PoolClient,
  escrowId: string
) {
  const { rowCount } = await client.query(
    `
    UPDATE escrows
    SET state = 'RELEASED',
        updated_at = now()
    WHERE id = $1
      AND state = 'LOCKED'
    `,
    [escrowId]
  );

  if (rowCount === 0) {
    throw new Error("ESCROW_RELEASE_FAILED");
  }
}

 async function settleEscrow(
  client: pg.PoolClient,
  escrowId: string
) {
  const { rowCount } = await client.query(
    `
    UPDATE escrows
    SET state = 'SETTLED',
        updated_at = now()
    WHERE id = $1
      AND state = 'RELEASED'
    `,
    [escrowId]
  );

  if (rowCount === 0) {
    throw new Error("ESCROW_CANNOT_SETTLE");
  }
}

async function decrementEscrowAmount(
  client: pg.PoolClient,
  escrowId: string,
  amount: number
) {
  const { rowCount } = await client.query(
    `
    UPDATE escrows
    SET amount = amount - $1,
        updated_at = now()
    WHERE id = $2
      AND state IN ('PENDING', 'LOCKED')
      AND amount >= $1
    `,
    [amount, escrowId]
  );

  if (rowCount === 0) {
    throw new Error("ESCROW_NOT_ACCEPTING_FUNDS");
  }
}

async function settleEscrowAfterRefund(
  client: pg.PoolClient,
  escrowId: string
) {
  const { rowCount } = await client.query(
    `
    UPDATE escrows
    SET state = 'SETTLED',
        updated_at = now()
    WHERE id = $1
      AND state = 'PENDING'
      AND amount = 0
    `,
    [escrowId]
  );

  if (rowCount !== 1) {
    throw new Error("ESCROW_REFUND_SETTLE_FAILED");
  }
}

export = {incrementEscrowAmount, decrementEscrowAmount, createEscrow, lockEscrow, EscrowReleasable, markEscrowReleased, settleEscrow, settleEscrowAfterRefund};