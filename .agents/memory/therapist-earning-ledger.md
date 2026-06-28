---
name: Therapist earning ledger persistence
description: Why therapist earnings are persisted lazily (at read/payout time) into an append-only audited ledger instead of at payment-collection time.
---

Therapist "earnings" (money the practice owes a therapist per collected session)
must be STORED + audited, not only computed live from session_billing.

**Decision: lazy materialization.** A private `syncTherapistEarnings(therapistId)`
in `server/storage.ts` is called at statement read, monthly read, and at the
start of both payout paths (itemized + lump) — NOT inside the
payment-collection / recordPayment path.

**Why:** keeps the money-collection hot path untouched (lowest risk for a
risk-averse user) while still guaranteeing earnings are persisted and
audit-logged (action `therapist_earning_recorded`) before any payout allocates
against them — the audit requires earnings be stored (not only computed live)
and that earning creation itself produce an audit-log entry.

**How it stays correct (append-only, no drift):**
- Table `therapist_earnings` is append-only. Per billing, summed `amountEarned`
  across its rows == the live computed earning.
- First row for a billing = entryType 'earning'; if more is later collected, a
  new 'adjustment' row is appended for the DELTA (never mutate history).
- sync computes per-billing persisted sum, inserts only `delta = computed - persisted`
  when non-zero → idempotent, safe to call repeatedly.
- One audit row per inserted row, in the SAME tx (system user id 6).

**Reversal to net 0 when collected drops to 0 (don't early-skip).** sync must NOT
guard with `if (collectedAmount <= 0) continue` before computing the delta — that
strands a previously-recorded earning when a session's collected money later falls
to exactly 0 (refund / payment removal after a status change), so Statement +
Monthly Report keep overstating pay. Instead compute `earnedNow = collected > 0 ?
amountEarned : 0`; skip only when `earnedNow <= 0 && !had` (nothing recorded);
otherwise append the (negative) delta so the billing nets back to 0. Re-earning
works automatically: if collected later rises, persisted is 0 so a positive
adjustment is appended.
**Why:** earnings follow collected money; the running statement collapses ledger
rows to net per billing and drops net-0 lines, and monthly sums the ledger
(including negatives) by earnedDate — both rely on the reversal row actually
being written.
**No vanished-billing path needed:** `therapist_earnings.sessionBillingId` is a
notNull FK and `computeTherapistEarnings` INNER-JOINs billing/session/client with
NO status filter, so a billing with persisted earnings can never disappear from
the computed set.

**Locking:** sync uses advisory lock key `hashtext('therapist_earning')`; payouts
use `hashtext('therapist_payout')`. Payout methods call sync BEFORE opening their
own transaction/lock → distinct keys, no lock-order inversion / deadlock.

**Reconciliation:** statement earning lines come from persisted rows; monthly
opening/earnedInMonth bucket persisted rows by `earnedDate` (= session date), so
monthly and running statement agree and don't shift if billing later changes.

**Billed vs not-billed gap:** session_billing rows are created ONLY when a
session is marked completed (`createBillingRecord`, which also swallows errors
silently), so earnings/statement/monthly-audit — all sourced from session_billing
— never show scheduled or completed-but-unbilled sessions. The monthly report
therefore also queries ALL sessions in the month and appends not-billed ones
(billed=false, status, zeroed money, excluded from billed-money totals) plus
`unbilledCount`/`unbilledCompletedCount`. NOTE the function has a local `sessions`
array that shadows the `sessions` table import — use the `sessionsTable` alias to
query the table inside it.

**Frontend cache rule:** because earnings recompute lazily server-side, ANY
therapist pay-rule mutation (save/delete, default OR per-service override) must
invalidate the `statement` and `monthly-statement` query caches, not just
`rules`/`owed` — otherwise the Statement tab + Monthly Report keep showing the
old numbers until a manual reload (this was a real "it doesn't always update"
bug). Prefix-invalidate monthly with `[..., therapistId]` to catch all dates.
