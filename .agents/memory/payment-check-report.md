---
name: Payment Check integrity report
description: Read-only cross-check that flags sessions whose payment status disagrees with recorded money; two durable rules to reuse for any billing-report endpoint.
---

# Payment Check (payment integrity) report

A read-only report that flags sessions where the payment **status** doesn't match the
money actually recorded, or an uploaded insurer amount. Buckets: `denied_but_paid`
(status=paid but a posted statement line shows insurer denied $0 and recorded < billed),
`paid_but_short` (status=paid but client+insurance recorded < total−discount),
`insurer_paid_more` (a posted/confirmed statement line's insurer amount exceeds recorded).

## Rule 1 — aggregating insurance_statement_lines for a cross-check
When comparing uploaded insurer amounts against recorded money, filter lines to
`match_status IN ('posted','confirmed')` and take **MAX per billing, not SUM**.

**Why:** a single session routinely has the SAME claim reported across 2–3 statements
(original + corrected), and `suggested`/`skipped`/`reversed` lines are not applied money.
Summing all matched lines produced ~137 false "insurer paid more" alarms ($5.4k of
phantom money); filtering + MAX collapsed it to 0 genuine cases. On this live DB the real
problems are the paid-but-short/denied rows, not insurer overpayment.

**How to apply:** any new report that reconciles statement lines vs billing must not
naively SUM `insurance_paid_amount` across `matched_session_billing_id`.

## Rule 2 — accountant redaction is mandatory on any client-identity billing endpoint
`/api/billing/reports` redacts client identity for role `accountant` via
`redactBillingClient`. Any NEW endpoint returning client names/codes across therapists
must do the same or it silently over-exposes PHI to accountants.

**Why:** a new billing endpoint that only uses `requireAuth` leaks full client_name/code
to accountants — a real privacy regression caught in review.

**How to apply:** for flat report rows (no nested `client` object), redact inline:
`clientName -> formatClientInitial({fullName})`, and null out `clientCode` + `clientId`
(so the drill-through link can't reveal identity).
