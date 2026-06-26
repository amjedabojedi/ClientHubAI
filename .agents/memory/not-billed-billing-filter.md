---
name: Not-billed billing report filter
description: Semantics of the "Not billed" view on the billing dashboard and the scheduled-session exclusion rule.
---

A session is "not billed" when it has NO row in `session_billing`. The billing
dashboard exposes this via `getBillingReports({ status: 'not_billed' })`
(server/storage.ts) which LEFT JOINs session_billing and keeps rows where
billing.id IS NULL, returning each row with `billing: null`.

**Rule: exclude only FUTURE scheduled sessions.**
`NOT (status = 'scheduled' AND session_date >= now())`.

**Why:** A future scheduled appointment hasn't happened yet and can still be
billed when it's completed, so it is not a gap — including all of them buried the
list under hundreds of upcoming appointments. A *past* scheduled session (date
passed, never progressed to completed/cancelled) genuinely fell through the
cracks, so it stays. completed / cancelled / rescheduled / no-show are always
kept.

**How to apply:** Don't "simplify" this to a blanket `status <> 'scheduled'` —
that silently hides real past-scheduled gaps. The frontend renders unbilled rows
with dashes for money + an amber "Not billed" badge and shows an amber banner
explaining the $0 summary cards (the cards are money-centric and don't apply).
Role scoping + accountant redaction still run on this path.
