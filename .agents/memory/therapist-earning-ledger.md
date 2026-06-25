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
against them. Reviewer required Step 1 "stored, not only computed" + Step 5
"audit-log entries for earning creation".

**How it stays correct (append-only, no drift):**
- Table `therapist_earnings` is append-only. Per billing, summed `amountEarned`
  across its rows == the live computed earning.
- First row for a billing = entryType 'earning'; if more is later collected, a
  new 'adjustment' row is appended for the DELTA (never mutate history).
- sync computes per-billing persisted sum, inserts only `delta = computed - persisted`
  when non-zero → idempotent, safe to call repeatedly.
- One audit row per inserted row, in the SAME tx (system user id 6).

**Locking:** sync uses advisory lock key `hashtext('therapist_earning')`; payouts
use `hashtext('therapist_payout')`. Payout methods call sync BEFORE opening their
own transaction/lock → distinct keys, no lock-order inversion / deadlock.

**Reconciliation:** statement earning lines come from persisted rows; monthly
opening/earnedInMonth bucket persisted rows by `earnedDate` (= session date), so
monthly and running statement agree and don't shift if billing later changes.
