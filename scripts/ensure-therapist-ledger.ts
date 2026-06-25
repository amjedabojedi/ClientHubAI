/**
 * Idempotently apply the therapist running-statement / lump-payment schema.
 *
 * Background: the therapist running statement feature adds one table
 * (`therapist_payment_allocations`) and two columns on `therapist_payouts`
 * (`payment_type`, `unapplied_amount`). The project rule is to avoid relying on
 * `db:push` because of known practice_configuration drift, so this script
 * applies the DDL additively and idempotently instead. It is safe to run on
 * every deploy / post-merge: `CREATE TABLE IF NOT EXISTS` and
 * `ADD COLUMN IF NOT EXISTS` are no-ops when the objects already exist.
 *
 * The column set mirrors the Drizzle definitions in shared/schema.ts
 * (therapistPayouts, therapistPaymentAllocations). Keep them in sync when the
 * schema changes.
 *
 * Run with: npx tsx scripts/ensure-therapist-ledger.ts
 */
import { db } from "../server/db";
import { sql } from "drizzle-orm";

async function main() {
  // ----- therapist_payouts additive columns -----
  await db.execute(
    sql`ALTER TABLE therapist_payouts ADD COLUMN IF NOT EXISTS payment_type VARCHAR(20) NOT NULL DEFAULT 'itemized'`,
  );
  await db.execute(
    sql`ALTER TABLE therapist_payouts ADD COLUMN IF NOT EXISTS unapplied_amount DECIMAL(10,2) NOT NULL DEFAULT '0'`,
  );

  // ----- therapist_payment_allocations -----
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS therapist_payment_allocations (
      id SERIAL PRIMARY KEY,
      payout_id INTEGER NOT NULL REFERENCES therapist_payouts(id) ON DELETE CASCADE,
      session_billing_id INTEGER NOT NULL REFERENCES session_billing(id),
      session_id INTEGER NOT NULL REFERENCES sessions(id),
      service_id INTEGER REFERENCES services(id),
      basis_amount DECIMAL(10,2) NOT NULL,
      pay_type VARCHAR(20) NOT NULL,
      pay_value DECIMAL(10,2) NOT NULL,
      amount_earned DECIMAL(10,2) NOT NULL,
      amount_allocated DECIMAL(10,2) NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);

  await db.execute(
    sql`CREATE INDEX IF NOT EXISTS therapist_payment_allocations_payout_idx ON therapist_payment_allocations(payout_id)`,
  );
  await db.execute(
    sql`CREATE INDEX IF NOT EXISTS therapist_payment_allocations_billing_idx ON therapist_payment_allocations(session_billing_id)`,
  );

  // ----- therapist_earnings (persistent, append-only earning ledger) -----
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS therapist_earnings (
      id SERIAL PRIMARY KEY,
      therapist_id INTEGER NOT NULL REFERENCES users(id),
      session_billing_id INTEGER NOT NULL REFERENCES session_billing(id),
      session_id INTEGER REFERENCES sessions(id),
      client_id INTEGER REFERENCES clients(id),
      client_name TEXT,
      service_code VARCHAR(50),
      service_name VARCHAR(255),
      entry_type VARCHAR(16) NOT NULL DEFAULT 'earning',
      amount_earned DECIMAL(10,2) NOT NULL,
      collected_snapshot DECIMAL(10,2) NOT NULL DEFAULT '0',
      earned_date DATE,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);
  await db.execute(
    sql`CREATE INDEX IF NOT EXISTS therapist_earnings_therapist_idx ON therapist_earnings(therapist_id)`,
  );
  await db.execute(
    sql`CREATE INDEX IF NOT EXISTS therapist_earnings_billing_idx ON therapist_earnings(session_billing_id)`,
  );

  console.log(
    "[therapist-ledger] Ensured therapist_payment_allocations, therapist_earnings tables and therapist_payouts ledger columns.",
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[therapist-ledger] Failed to ensure therapist ledger schema:", err);
    process.exit(1);
  });
