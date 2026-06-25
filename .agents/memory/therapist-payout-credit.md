---
name: Therapist payout credit reconciliation
description: How over-payment credit, allocations and the owed list stay reconciled with the running statement for therapist payouts.
---

# Therapist payout ledger reconciliation

The Owed list, the running statement, and payout creation must all agree. The
invariant that ties them together:

`sum(payout.totalAmount over non-voided payouts) = sum(allocations) + sum(legacy payout_items) + sum(payout.unappliedAmount)`

Therefore `owed = totalEarned - totalPaid = statement net`.

**Rule:** `getTherapistOwed` must subtract BOTH per-session paid amounts
(allocations + legacy items) AND the over-payment credit pool
(`sum(unappliedAmount)` across non-voided payouts), applying the credit
oldest-first to rule-resolved sessions and dropping any that hit 0.

**Why:** A lump over-payment stores the excess as `unappliedAmount` (a credit),
NOT as per-session allocations. If the owed calc ignores that credit, newly
collected sessions reappear as payable while the statement still shows a credit —
so the therapist can be paid twice for money already advanced. The credit must
virtually offset new earnings before they become cash-payable. The credit pool is
never decremented in the DB; it is re-applied virtually on every read, which stays
correct because allocations zero out the sessions it already covered.

**How to apply:** Any new payout path (itemized or lump) must consume
`getTherapistOwed`'s credit-adjusted `amountRemaining`, never raw `amountEarned`.
Both `createTherapistPayout` and `createTherapistLumpPayment` recompute owed
INSIDE a `db.transaction` after taking `pg_advisory_xact_lock(hashtext('therapist_payout'), therapistId)`
so concurrent payouts for the same therapist can't allocate against a stale
remaining snapshot and over-pay. Voiding a payout flips status to 'voided', which
removes both its allocations AND its credit from these sums (legacy itemized
payout_items are deleted on void instead).
