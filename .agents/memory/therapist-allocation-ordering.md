---
name: Therapist lump payout allocation ordering
description: Why a therapist's Statement and a payout's session breakdown can disagree, and the safe rematch.
---

# Lump payout allocations are pinned at creation time, not by payment date

When a lump payout is created, it allocates oldest-first against whatever is
*outstanding at that moment* (`getTherapistOwed`). So allocations follow the
ORDER payouts were entered into the system, not the order of their payment
dates. If payments are entered out of payment-date order (e.g. backdated lumps
typed in after later ones), an earlier-dated payment can get "assigned" to
sessions that happened months AFTER its payment date — impossible in reality.

**Symptom:** the Statement (a pure chronological earned−paid running balance)
shows a payment settling the oldest earnings, while that same payout's detail
(stored `therapist_payment_allocations`) lists a totally different, later set of
sessions. Totals and net balance are still correct; only the per-session
attribution disagrees.

**Why the net still reconciles:** owed/credit nets ALL payouts and sessions
globally, so a single payout's per-session over/under can never equal the global
net credit on its own. Don't "fix" by flagging per-session overpayment as if it
were the global number.

**Safe fix:** `scripts/rematch-therapist-allocations.ts <therapistId> [--apply]`
re-spreads each payment oldest-payment-first / oldest-session-first.
- Rewrites ONLY allocation rows + each payout's `unapplied_amount`; never totals,
  dates, refs, status, or net owed/credit (the leftover credit lands on the last
  payment by date).
- LUMP payouts only — aborts if any paid *itemized* payout exists, because
  itemized coverage lives in `therapist_payout_items` and counting both
  double-counts paid money.
- Earnings come from CURRENT rules (`computeTherapistEarnings`), NOT the frozen
  allocation snapshots. **Why:** a rematch is usually needed precisely because the
  old snapshots held wrong (e.g. doubled) amounts that were later corrected; the
  corrected ledger/statement use current rules, so allocations must too.
- Reads happen inside the write txn after `pg_advisory_xact_lock('therapist_payout', id)`
  (same lock the app's payout path uses) with a fingerprint drift-check, so the
  plan can't go stale before writing. Idempotent / re-runnable.
