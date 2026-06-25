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
