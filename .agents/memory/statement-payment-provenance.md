---
name: Statement → payment provenance
description: How a posted insurance-statement line links to the client payment it created, and the reconciliation gaps that remain.
---

The uploaded-insurance-statement (EOB/ERA) flow records money against a session
by calling the same `recordPayment` path that manual payments use. To make a
client payment traceable back to the statement it came from, `payment_transactions`
carries two nullable provenance columns pointing at the originating statement and
line. They are stamped on BOTH the post and the void-reversal so cash movement is
traceable in both directions; manual payments leave them null.

**Why:** otherwise the link only ran one way (statement line → matched billing).
From a client's payment history there was no way to answer "which uploaded
statement produced this payment?", and you couldn't prove a statement's claimed
total actually landed as payments. Provenance closes that round-trip.

**How to apply:** any new code that records an insurance payment from a statement
must pass `sourceStatementId` + `sourceStatementLineId` into `recordPayment`, or
the audit trail silently loses the link. Columns are additive — applied via the
idempotent `scripts/ensure-statement-payment-link.ts`, wired into post-merge.sh
BEFORE db:push (repo has practice_configuration drift that can abort db:push).

**Known gap / next steps (reconciliation, not yet built):**
- A statement line whose session was never billed stays `unmatched` and CANNOT be
  posted — the insurer's money has nowhere to land and silently sits unposted.
  This is the "completed-but-not-billed by error" leak the owner cares about.
- Planned: a three-way tie-out (statement header total = sum of posted lines =
  sum of payment_transactions for that statement) + a "needs attention" view with
  filters (not-posted-yet, not-billed-but-completed, denied/remark codes, payer,
  date range) and a one-click "create the missing billing record, then post".
