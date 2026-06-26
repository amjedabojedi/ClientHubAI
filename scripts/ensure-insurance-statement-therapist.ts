/**
 * Idempotent, additive DDL for the per-statement therapist tag.
 *
 * Each uploaded insurance statement belongs to ONE therapist. This adds a
 * nullable therapist_id column (FK -> users) so the statement — and all of its
 * lines — can be attributed to that therapist for display and filtering.
 *
 * Run via post-merge.sh BEFORE db:push (this repo has known
 * practice_configuration drift that can make an unguarded db:push prompt/abort).
 */
import { db } from "../server/db";
import { sql } from "drizzle-orm";

async function main() {
  await db.execute(sql`
    ALTER TABLE insurance_statements
      ADD COLUMN IF NOT EXISTS therapist_id integer
  `);

  // FK (added only if missing). Wrapped so re-runs are safe.
  await db.execute(sql`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'insurance_statements_therapist_id_fk'
          AND conrelid = 'insurance_statements'::regclass
      ) THEN
        ALTER TABLE insurance_statements
          ADD CONSTRAINT insurance_statements_therapist_id_fk
          FOREIGN KEY (therapist_id) REFERENCES users(id);
      END IF;
    END $$
  `);

  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS insurance_statements_therapist_idx
      ON insurance_statements (therapist_id)
  `);

  console.log("ensure-insurance-statement-therapist: therapist_id column ensured.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("ensure-insurance-statement-therapist failed:", err);
    process.exit(1);
  });
