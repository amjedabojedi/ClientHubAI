/**
 * Verify (and optionally reconcile) the Postgres audit ENUM types against the
 * value sets the application actually writes.
 *
 * Background: `audit_logs.action` and `audit_logs.result` are backed by
 * Postgres ENUM types (`audit_action`, `audit_result`) created by an early
 * migration, but the Drizzle schema models both columns as plain `varchar`.
 * Because Drizzle doesn't manage these pg ENUMs, `db:push` never adds new
 * values to them, so the DB enums can drift behind the code. Any audit write
 * using a value missing from the enum fails — and previously failed silently.
 *
 * `AUDIT_ACTIONS` and `AUDIT_RESULTS` in shared/schema.ts are the single source
 * of truth. This module compares those sets against what the database actually
 * has so drift is surfaced loudly (startup check + standalone guard script)
 * instead of being discovered the next time an audit row silently vanishes.
 */
import { db } from "./db";
import { sql } from "drizzle-orm";
import { AUDIT_ACTIONS, AUDIT_RESULTS } from "@shared/schema";

type EnumName = "audit_action" | "audit_result";

const REQUIRED: Record<EnumName, readonly string[]> = {
  audit_action: AUDIT_ACTIONS,
  audit_result: AUDIT_RESULTS,
};

export interface EnumDrift {
  /** The enum type name. */
  type: EnumName;
  /** Required values not present in the DB enum. */
  missing: string[];
}

export interface AuditEnumVerifyResult {
  ok: boolean;
  /** Per-enum drift (only enums that exist in the DB and are missing values). */
  drift: EnumDrift[];
}

function extractRows(res: unknown): any[] {
  return ((res as any)?.rows ?? res ?? []) as any[];
}

/**
 * Read the labels currently defined for a Postgres enum type. Returns `null`
 * when the type does not exist (e.g. the column was migrated to plain varchar),
 * in which case there is no enum constraint and therefore no drift to check.
 */
async function getEnumLabels(typeName: string): Promise<string[] | null> {
  const res = await db.execute(sql`
    SELECT e.enumlabel AS label
    FROM pg_type t
    JOIN pg_enum e ON e.enumtypid = t.oid
    WHERE t.typname = ${typeName}
  `);
  const rows = extractRows(res);
  if (rows.length === 0) {
    // Could be a missing type OR an empty enum. Distinguish via pg_type.
    const typeRes = await db.execute(
      sql`SELECT 1 FROM pg_type WHERE typname = ${typeName}`,
    );
    if (extractRows(typeRes).length === 0) return null;
    return [];
  }
  return rows.map((r) => String(r.label));
}

/**
 * Verify that every required value exists in the corresponding DB enum.
 * Enums that don't exist as pg types are skipped (no constraint => no drift).
 */
export async function verifyAuditEnums(): Promise<AuditEnumVerifyResult> {
  const drift: EnumDrift[] = [];

  for (const type of Object.keys(REQUIRED) as EnumName[]) {
    const required = REQUIRED[type];
    const labels = await getEnumLabels(type);
    if (labels === null) continue; // type absent; column is plain varchar
    const present = new Set(labels);
    const missing = required.filter((v) => !present.has(v));
    if (missing.length > 0) {
      drift.push({ type, missing });
    }
  }

  return { ok: drift.length === 0, drift };
}

/**
 * Non-fatal startup guard. Logs a loud, structured alert if the DB audit enums
 * have drifted behind the code so the gap is visible instead of silently
 * dropping audit rows. Does not throw — the app still starts, but the operator
 * is warned to run scripts/ensure-audit-enums.ts.
 */
export async function assertAuditEnumsAtStartup(): Promise<void> {
  try {
    const { ok, drift } = await verifyAuditEnums();
    if (ok) return;
    for (const d of drift) {
      console.error(
        `CRITICAL: audit enum '${d.type}' is missing value(s) [${d.missing.join(
          ", ",
        )}] — audit writes using these will FAIL. Run: npx tsx scripts/ensure-audit-enums.ts`,
      );
    }
  } catch (error) {
    // A failed verification check must not block startup, but it should be loud.
    console.error("CRITICAL: audit enum verification check failed:", error);
  }
}
