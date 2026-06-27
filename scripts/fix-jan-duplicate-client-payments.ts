/**
 * One-off correction: 15 January sessions had the SAME money recorded twice —
 * a client bank-transfer keyed in Feb 22-28 AND an insurance payment posted from
 * the uploaded "Summary of January 2026 Invoices" (statement #460). The insurance
 * statement is the intended record (it is the sole payment on 12 other January
 * sessions and matches how Feb-Apr are recorded), so the duplicate Feb CLIENT
 * payments are removed here.
 *
 * Reversible: voidPaymentTransaction SOFT-voids (sets voided_at/voided_by/
 * void_reason) and recomputes the billing's client/insurance totals + status
 * from the remaining non-voided transactions. Earnings are then resynced for the
 * affected therapists so collected-based pay reflects the corrected totals.
 */
import { storage } from "../server/storage";

const SYSTEM_USER_ID = 6; // admin / system actor
const REASON =
  "Duplicate of insurance payment from statement #460 (Summary of Jan 2026 Invoices). " +
  "Same money was recorded twice (client bank-transfer + insurance); removing the client duplicate.";

// txn_id -> billing (for logging only)
const CLIENT_DUP_TXN_IDS = [103, 116, 9, 36, 96, 80, 97, 117, 37, 112, 92, 91, 118, 98, 95];
const AFFECTED_THERAPISTS = [23, 24, 28];

async function main() {
  console.log(`Voiding ${CLIENT_DUP_TXN_IDS.length} duplicate client payment transactions...`);
  let ok = 0;
  const voided = new Set<number>();
  for (const txId of CLIENT_DUP_TXN_IDS) {
    try {
      const { billingId } = await storage.voidPaymentTransaction(txId, REASON, SYSTEM_USER_ID);
      ok += 1;
      voided.add(txId);
      console.log(`  ✓ voided txn ${txId} (billing ${billingId})`);
    } catch (e: any) {
      console.log(`  ✗ txn ${txId}: ${e?.message || e}`);
    }
  }
  console.log(`Voided ${ok}/${CLIENT_DUP_TXN_IDS.length}.`);
  if (ok !== CLIENT_DUP_TXN_IDS.length) {
    const failed = CLIENT_DUP_TXN_IDS.filter((id) => !voided.has(id));
    console.error(`✗ Partial remediation — failed txn ids: ${failed.join(", ")}. Aborting before earnings resync.`);
    process.exit(1);
  }

  console.log("Resyncing therapist earnings...");
  for (const t of AFFECTED_THERAPISTS) {
    const r = await (storage as any).syncTherapistEarnings(t);
    console.log(`  therapist ${t}: synced (unresolved=${r?.unresolvedCount ?? 0})`);
  }
  console.log("Done.");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
