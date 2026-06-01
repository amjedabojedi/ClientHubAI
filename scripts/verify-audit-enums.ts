/**
 * Guard: verify that the Postgres audit ENUM types (`audit_action`,
 * `audit_result`) contain every value the application can write
 * (`AUDIT_ACTIONS` + `AUDIT_RESULTS` in shared/schema.ts).
 *
 * Exits 0 when the DB enums are in sync (or the enum types don't exist, i.e. the
 * columns are plain varchar with no constraint). Exits 1 and prints the missing
 * values when drift is detected, so this can be wired into CI / validation to
 * catch the "audit row silently dropped" failure mode before it ships.
 *
 * To fix detected drift, run: npx tsx scripts/ensure-audit-enums.ts
 *
 * Run with: npx tsx scripts/verify-audit-enums.ts
 */
import { verifyAuditEnums } from "../server/audit-enum-check";

async function main() {
  const { ok, drift } = await verifyAuditEnums();
  if (ok) {
    console.log("[verify-audit-enums] OK: audit enums cover all code values.");
    return;
  }
  for (const d of drift) {
    console.error(
      `[verify-audit-enums] DRIFT: enum '${d.type}' is missing value(s): ${d.missing.join(
        ", ",
      )}`,
    );
  }
  console.error(
    "[verify-audit-enums] Fix with: npx tsx scripts/ensure-audit-enums.ts",
  );
  process.exitCode = 1;
}

main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((err) => {
    console.error("[verify-audit-enums] Verification failed to run:", err);
    process.exit(1);
  });
