/**
 * Idempotently apply the therapist manual-adjustments schema.
 *
 * Background: the "bonuses & deductions" feature adds one table
 * (`therapist_adjustments`) — non-session ledger items the practice owner adds
 * by hand. The project rule is to avoid relying on `db:push` because of known
 * practice_configuration drift, so this script applies the DDL additively and
 * idempotently instead. It is safe to run on every deploy / post-merge:
 * `CREATE TABLE IF NOT EXISTS` and `CREATE INDEX IF NOT EXISTS` are no-ops when
 * the objects already exist.
 *
 * The column set mirrors the Drizzle definition in shared/schema.ts
 * (therapistAdjustments). Keep them in sync when the schema changes.
 *
 * Run with: npx tsx scripts/ensure-therapist-adjustments.ts
 */
import { db } from "../server/db";
import { sql } from "drizzle-orm";

async function main() {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS therapist_adjustments (
      id SERIAL PRIMARY KEY,
      therapist_id INTEGER NOT NULL REFERENCES users(id),
      adjustment_type VARCHAR(20) NOT NULL,
      amount DECIMAL(10,2) NOT NULL,
      description TEXT NOT NULL,
      effective_date DATE NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'active',
      voided_at TIMESTAMP,
      voided_by INTEGER REFERENCES users(id),
      void_reason TEXT,
      created_by INTEGER REFERENCES users(id),
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);

  await db.execute(
    sql`CREATE INDEX IF NOT EXISTS therapist_adjustments_therapist_idx ON therapist_adjustments(therapist_id)`,
  );

  console.log("[therapist-adjustments] Schema ensured.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[therapist-adjustments] Failed to ensure schema:", err);
    process.exit(1);
  });
