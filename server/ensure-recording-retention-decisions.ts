import { sql } from "drizzle-orm";
import { db } from "./db";

/**
 * Ensure the append-only recording-retention decision ledger exists before
 * routes that read it are registered. This is safe to run repeatedly.
 */
export async function ensureRecordingRetentionDecisionsTable(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS recording_retention_decisions (
      id SERIAL PRIMARY KEY,
      attempt_id INTEGER NOT NULL,
      session_id INTEGER NOT NULL,
      client_id INTEGER NOT NULL,
      decision VARCHAR(32) NOT NULL,
      rationale TEXT NOT NULL,
      decided_by_id INTEGER NOT NULL,
      decided_by_name VARCHAR(255) NOT NULL,
      decided_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS recording_retention_decisions_attempt_idx
      ON recording_retention_decisions(attempt_id)
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS recording_retention_decisions_session_idx
      ON recording_retention_decisions(session_id)
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS recording_retention_decisions_decided_at_idx
      ON recording_retention_decisions(decided_at)
  `);
}