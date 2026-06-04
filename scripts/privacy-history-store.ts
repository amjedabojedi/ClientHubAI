/**
 * Cross-run persistence for the privacy-suite slow-down detector history.
 *
 * Background: the rolling runtime history lives in
 * `.local/privacy-test-durations.json`, which is gitignored working state. On
 * ephemeral CI checkouts that file starts empty every run, so the slow-down
 * detector's rolling-median baseline never accumulates across runs and a
 * *newly introduced* sustained slow-down is never caught (the "previous run"
 * needed to confirm a sustained regression is always missing).
 *
 * This helper persists that history in Replit Object Storage under a single
 * fixed key, so each CI run can restore the previous run's history before
 * classifying and save the updated history afterwards. Combined with the
 * committed cold-start baseline (scripts/privacy-test-baseline.json), this lets
 * the `test-privacy` CI workflow actually FAIL on a sustained slow-down even on
 * fresh checkouts:
 *   - run 1 (empty store): seed from committed baseline, record the slow run as
 *     the new "previous run", save it  -> WARN
 *   - run 2 (store has slow prev): slow now + slow prev -> FAIL
 *
 * Usage:
 *   tsx scripts/privacy-history-store.ts pull <localPath>
 *   tsx scripts/privacy-history-store.ts push <localPath>
 *
 * Exit codes (the bash runner treats any non-zero as "fall back to the
 * committed baseline", so this never aborts the suite):
 *   0  success
 *   2  bad usage
 *   3  no-op (object not found on pull, or local file missing on push)
 *   4  object storage upload/download error
 *   5  unexpected error (e.g. object storage not configured in this env)
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { Client } from "@replit/object-storage";

const OBJECT_KEY = "ci/privacy-test-durations.json";

async function main(): Promise<number> {
  const [cmd, localPath] = process.argv.slice(2);
  if (!cmd || !localPath) {
    console.error("usage: privacy-history-store.ts <pull|push> <localPath>");
    return 2;
  }

  const client = new Client();

  if (cmd === "pull") {
    const res = await client.downloadAsText(OBJECT_KEY);
    if (!res.ok) {
      // Most commonly: the object does not exist yet (first ever run). Treat as
      // a no-op so the caller seeds from the committed baseline instead.
      return 3;
    }
    if (!res.value || res.value.trim() === "") {
      return 3;
    }
    writeFileSync(localPath, res.value);
    return 0;
  }

  if (cmd === "push") {
    if (!existsSync(localPath)) {
      return 3;
    }
    const text = readFileSync(localPath, "utf8");
    const res = await client.uploadFromText(OBJECT_KEY, text);
    return res.ok ? 0 : 4;
  }

  console.error(`unknown command: ${cmd}`);
  return 2;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(String(err));
    process.exit(5);
  });
