---
name: Therapist payout ledger reconciliation
description: Durable invariants for therapist payouts — over-payment credit, voids, and how the owed list, running statement, and monthly report must agree.
---

# Therapist payout ledger reconciliation

The owed list, the running statement, and the monthly report are three views of
ONE ledger and must always agree. Net owed = total earned − total paid.

## Over-payment credit must offset new earnings
A lump payment that exceeds everything owed stores the excess as a credit, NOT as
per-session payment. The owed calculation must subtract that credit pool
(oldest-first) on top of per-session payments.

**Why:** if the credit is ignored, newly collected sessions reappear as payable
while the ledger still shows a credit, so the therapist gets paid twice for money
already advanced.

**How to apply:** every payout path must pay the credit-adjusted *remaining*
amount, never raw earned. Both payout paths recompute owed inside one transaction
behind a per-therapist advisory lock so concurrent payouts can't allocate against
a stale snapshot.

## Credit has TWO sources, not just unapplied lump money
The owed credit pool must include BOTH (1) unapplied lump money (paid but never
allocated to a session) AND (2) retroactive per-session overpayments — a session
whose paid amount now exceeds its earned amount because its collected amount was
reduced *after* it was already paid in full (e.g. fixing a double-counted insurance
payment lowers earned on an already-settled session).

**Why:** the owed list clamps each session's remaining at `max(0, earned − paid)`,
which silently discards the excess on an over-paid session. The running statement
nets it (currentOwed = max(0, totalEarned − totalPaid)), so the two views diverge
— owed shows money still owed while the statement shows the therapist fully paid
(with a credit). Symptom seen in the wild: owed screen says $1,692 owed but the
statement says $0 owed / $80.50 credit for the same therapist.

**How to apply:** in getTherapistOwed, accumulate `−remaining` for every billing
where paid > earned into a retro-overpay credit, add it to the unapplied-lump
credit, and apply the combined pool oldest-first. The two sources are disjoint
buckets (unallocated excess vs allocated-over-earning excess), so summing them is
correct and never double-counts.

## Voids are reversals, never deletions
A voided payout must stay visible everywhere as the original payment plus an equal
and opposite reversal dated at the void time — the two net to zero. The running
statement and the monthly report both bucket each payment/reversal by its OWN
event date.

**Why:** a payment made in one period and voided in a later one must add the money
back in the period it was voided. Filtering to status='paid' silently drops the
original payment from earlier totals, so opening/closing balances diverge from the
running ledger and the audit can't reconcile.

**How to apply:** never compute payment totals from a status='paid' snapshot. Walk
all payouts as signed events. (Legacy itemized payout_items are the exception —
they are deleted on void because their mere existence means "fully paid".)

## Every allocation is independently auditable
Recording a payout must write one audit row per session allocation (stable ids:
payoutId, sessionBillingId, amount), not just a single summary row — financial/HIPAA
traceability requires per-allocation events.
