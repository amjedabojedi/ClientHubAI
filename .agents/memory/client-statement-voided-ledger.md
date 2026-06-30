---
name: Client statement payment-history excludes voided
description: getClientStatement's payment-history ledger must filter voided transactions, or corrected payments look like duplicates.
---

# Client statement payment history must exclude voided transactions

`getClientStatement` builds two independent things:
- **Totals** (Total billed / paid / outstanding / credit) from the billing-level stored columns (`session_billing.payment_amount`, `client_paid_amount`, `insurance_paid_amount`). These already net out voids.
- **Payment history list** from the `payment_transactions` ledger, grouped by (billing, source, method) with a +/- netting pass.

**Rule:** the ledger query MUST filter `isNull(paymentTransactions.voidedAt)`. A voided transaction has already been reversed out of the stored paid columns, so including it in the list makes a single corrected payment appear as several duplicate green payments and inflates the visible ledger above the real "Total paid" — even though the totals stay correct.
**Why:** non-technical staff fumbling record/void/re-record created chains like +170, voided +170, voided +170, live +170, +170/-150 adjustment; the list showed all of them and looked like the client paid 3x.
**How to apply:** the per-transaction void UI (record-payment drawer mini-history in client-detail) is the ONE place voided rows should still render — there they are explicitly struck-through + badged. The clean statement ledger (client-statements page) must hide them.
