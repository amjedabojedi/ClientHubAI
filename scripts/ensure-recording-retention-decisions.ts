/**
 * Deployment helper for the append-only recording-retention decision ledger.
 * The same idempotent setup also runs during application startup.
 */
import { ensureRecordingRetentionDecisionsTable } from "../server/ensure-recording-retention-decisions";

async function main() {
  await ensureRecordingRetentionDecisionsTable();
  console.log("[recording-retention] Decision ledger is ready.");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("[recording-retention] Failed to ensure decision ledger:", error);
    process.exit(1);
  });