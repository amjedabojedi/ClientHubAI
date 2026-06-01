/**
 * Idempotently reconcile the Postgres audit enums with the values the
 * application actually writes.
 *
 * Background: `audit_logs.action` and `audit_logs.result` are backed by
 * Postgres ENUM types (`audit_action`, `audit_result`) created by an early
 * migration, but the Drizzle schema models both columns as plain `varchar`.
 * Because Drizzle doesn't manage these pg ENUMs, `db:push` never adds new
 * values to them, so the DB enums drifted behind the code. Any
 * AuditLogger.logAction() call using a value missing from the enum silently
 * failed to record (logged as "CRITICAL: Audit log failed to record") — a
 * HIPAA audit-trail gap.
 *
 * This script adds every required value with `ADD VALUE IF NOT EXISTS`, which
 * is additive, idempotent and safe to run on every deploy / post-merge. If a
 * column was ever migrated to a plain varchar (no enum type present) the
 * corresponding step is a no-op.
 *
 * - audit_action values come from the AUDIT_ACTIONS source of truth in
 *   shared/schema.ts.
 * - audit_result values come from the AUDIT_RESULTS source of truth in
 *   shared/schema.ts.
 *
 * Both sets live in shared/schema.ts so the schema is the single source of
 * truth: add a value there and this script reconciles it automatically — no
 * separate list to keep in sync.
 *
 * Run with: npx tsx scripts/ensure-audit-enums.ts
 */
import { db } from "../server/db";
import { sql } from "drizzle-orm";
import { AUDIT_ACTIONS, AUDIT_RESULTS } from "../shared/schema";

async function enumExists(typeName: string): Promise<boolean> {
  const res = await db.execute(
    sql`SELECT 1 FROM pg_type WHERE typname = ${typeName}`,
  );
  const rows = (res as any).rows ?? res;
  return !!rows && rows.length > 0;
}

async function reconcileEnum(typeName: string, values: readonly string[]) {
  if (!(await enumExists(typeName))) {
    console.log(`[audit-enums] '${typeName}' enum type not present; skipping.`);
    return;
  }
  // ADD VALUE cannot run inside a transaction/DO block, so each ALTER is its
  // own statement. The values below are static, compile-time string literals
  // (no user input), so raw interpolation is safe.
  for (const value of values) {
    await db.execute(
      sql.raw(`ALTER TYPE ${typeName} ADD VALUE IF NOT EXISTS '${value}'`),
    );
  }
  console.log(
    `[audit-enums] Reconciled '${typeName}' with ${values.length} values.`,
  );
}

async function main() {
  await reconcileEnum("audit_action", AUDIT_ACTIONS as readonly string[]);
  await reconcileEnum("audit_result", AUDIT_RESULTS);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[audit-enums] Failed to reconcile audit enums:", err);
    process.exit(1);
  });
