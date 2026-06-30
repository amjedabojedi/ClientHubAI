---
name: Payment recording is cumulative-per-source
description: How recordPayment interprets amount, why statement-sourced voids are blocked, and the optimistic-concurrency basis both billing screens must use.
---

# Payment recording: cumulative-per-source

`recordPayment(billingId, {amount, source, ...})` treats `amount` as the **cumulative total collected for THAT source** (client vs insurance), not the single new payment. It computes `delta = amount - previousForSource`, where `previousForSource` is the stored `session_billing.client_paid_amount` / `insurance_paid_amount` column (read under `FOR UPDATE`).

**How to apply (UI record path):** any screen recording a payment must send `amount = alreadyPaidForSource + newlyEnteredAmount` with an explicit `source`. Sending the raw new amount with no source mis-buckets and a 2nd same-source payment OVERWRITES the first (the bug client-detail had).

**Authoritative basis = the stored per-source columns**, NOT a sum of non-voided transactions. They match in steady state, but legacy/manually-corrected rows can diverge; using the txn sum then yields a wrong delta or a false stale-state conflict. Derive `alreadyPaidForSource` from `billingRecord.clientPaidAmount/insurancePaidAmount` (fall back to txn sums only if the columns are absent). Both billing-dashboard and client-detail now do this.

## Optimistic-concurrency guard
recordPayment accepts optional `expectedPreviousForSource`. Under the row lock, if it != null and differs from the locked `previousForSource` by > 0.005, it throws code `STALE_PAYMENT_STATE` → route returns 409. UI sends what it believed was already paid for the source; this stops a near-simultaneous second submit from silently overwriting the first.
**Why:** two staff recording on the same bill+source compute cumulative from a stale read; without this the later write clobbers the earlier payment.
**How to apply:** internal statement callers (post/void/reverse) compute cumulative inside their own lock and MUST NOT pass `expectedPreviousForSource`.

## Statement-sourced payments can't be voided directly
A `payment_transactions` row with `source_statement_id` OR `source_statement_line_id` set must be reversed via the Insurance Statements page (void/reverse the statement), not via the generic void path. `voidPaymentTransaction` throws code `STATEMENT_SOURCED_PAYMENT` → 409; direct void would zero the invoice money while leaving the statement's posted total/line state and cross-statement rebalance untouched, so the two silently disagree.
**How to apply:** both billing UIs hide the Void button and show a "Reverse via statement" hint when EITHER source field is set.
