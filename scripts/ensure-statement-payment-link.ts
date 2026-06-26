/**
 * Idempotent, additive DDL for payment-transaction provenance.
 *
 * Adds source_statement_id / source_statement_line_id to payment_transactions so
 * a recorded payment can be traced back to the uploaded insurance statement (and
 * line) it was posted from. Both columns are nullable and purely additive.
 *
 * Run via post-merge.sh BEFORE db:push (this repo has known practice_configuration
 * drift that can make an unguarded db:push prompt or abort).
 */
import { db } from "../server/db";
import { sql } from "drizzle-orm";

async function main() {
  await db.execute(sql`
    ALTER TABLE payment_transactions
      ADD COLUMN IF NOT EXISTS source_statement_id integer,
      ADD COLUMN IF NOT EXISTS source_statement_line_id integer,
      ADD COLUMN IF NOT EXISTS adopted_by_line_id integer
  `);

  // FKs (added only if missing). Wrapped so re-runs are safe.
  await db.execute(sql`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'payment_transactions_source_statement_id_fk'
          AND conrelid = 'payment_transactions'::regclass
      ) THEN
        ALTER TABLE payment_transactions
          ADD CONSTRAINT payment_transactions_source_statement_id_fk
          FOREIGN KEY (source_statement_id) REFERENCES insurance_statements(id);
      END IF;
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'payment_transactions_source_statement_line_id_fk'
          AND conrelid = 'payment_transactions'::regclass
      ) THEN
        ALTER TABLE payment_transactions
          ADD CONSTRAINT payment_transactions_source_statement_line_id_fk
          FOREIGN KEY (source_statement_line_id) REFERENCES insurance_statement_lines(id);
      END IF;
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'payment_transactions_adopted_by_line_id_fk'
          AND conrelid = 'payment_transactions'::regclass
      ) THEN
        ALTER TABLE payment_transactions
          ADD CONSTRAINT payment_transactions_adopted_by_line_id_fk
          FOREIGN KEY (adopted_by_line_id) REFERENCES insurance_statement_lines(id);
      END IF;
    END $$
  `);

  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS payment_transactions_source_statement_idx
      ON payment_transactions (source_statement_id)
  `);

  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS payment_transactions_adopted_by_line_idx
      ON payment_transactions (adopted_by_line_id)
  `);

  console.log("ensure-statement-payment-link: payment_transactions provenance columns ensured.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("ensure-statement-payment-link failed:", err);
    process.exit(1);
  });
