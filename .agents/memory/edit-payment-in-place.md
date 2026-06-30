---
name: Edit payment in place
description: How "edit a payment amount" must behave vs. the old add/void-only model.
---

# Editing a recorded payment

Staff expect "update a payment" to REPLACE that one transaction's amount in place
(e.g. $170 → $20 means paid is now $20, client owes the difference). The app
historically only had ADD (recordPayment, cumulative-per-source) and VOID — there
was no true edit, so users worked around it by recording cumulative corrections
that left dangling negative "adjustment" rows and produced fake overpayments.

`editPaymentTransaction(transactionId, newAmount, editedBy, reason?)` in
server/storage.ts is the real edit: it updates the single row's `amount`, then
recomputes `client_paid_amount`/`insurance_paid_amount`/`payment_amount`/
`payment_status` by SUMming the non-voided transactions per source (same authoritative
basis as void). Route: `PATCH /api/payment-transactions/:id` `{ amount, reason? }`.

**Why / rules to keep consistent:**
- Replace-in-place; NEVER write a new row or a negative adjustment row for an edit.
- Block statement-sourced rows (throw `STATEMENT_SOURCED_PAYMENT` → 409); change
  those via the Insurance Statements page so statement & invoice stay in agreement.
- Block negative rows (existing adjustment entries) and require amount > 0; to fully
  remove a payment, use Void.
- Mirror the void path's locking (tx row `FOR UPDATE`, then billing row) so totals
  can't be corrupted by concurrent edits.
- payment_transactions has no edit-tracking columns, so the original amount is
  appended to the row's `notes` as a small trace.

**How to apply:** Edit button + dialog live next to Void in the Record Payment
drawer history (client-detail.tsx) and the billing-dashboard PaymentDialog history.
Both surfaces' transactions query MUST use an explicit queryFn hitting
`/api/billing/${id}/transactions` — the default fetcher drops the numeric id segment
(key→URL trap) and the history (hence Void/Edit buttons) silently never renders.
