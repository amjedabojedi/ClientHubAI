---
name: Insurance spreadsheet amount-column fallback
description: How the insurance-reconciliation spreadsheet reader maps the paid amount, incl. invoice/summary files with no explicit "paid" column.
---

The insurance-reconciliation upload page reads spreadsheets (.xlsx/.csv) directly
via header-needle mapping in `parseInsuranceSpreadsheet` (server/insurance/parse.ts);
PDFs go through AI. The matcher keys lines to sessions by client name + service date
(+ optional serviceCode), and records the line's `insurancePaidAmount` on Post.

**Rule:** EOBs have an explicit paid column (`paid/payment/insurancepaid/...`). But
practice-side *invoice/billing summaries* (e.g. a "Summary of Invoices" with a
"Total Due" column, paid in a batch) have NO paid column. So when no paid column
matches, fall back to an amount column (`totaldue/amountdue/balancedue/totalpaid/
amount/total/due`) and use it as the paid amount.

**Why / safety:** the fallback is gated (`!colFor.insurancePaidAmount`) so it never
touches normal EOB parsing, and it only considers columns NOT already claimed by
another mapped field — so "Billed Amount"/"Allowed"/"Patient Responsibility" can't be
mistaken for a payment. Needles are ordered most-specific-first (iterate needle→header,
break outer) so "Total Due" beats a bare "Total"; any header containing "date" is
skipped so "Due Date" is never read as money.

**Date safety:** `toIsoDate` formats Date cells and the `new Date(s)` string fallback
via local calendar parts (`fmtLocalDate`), never `toISOString()`, so a date-only value
("Jan 10, 2026") doesn't shift a day in a non-UTC zone — important because matching is
by exact service date.

**Header-row detection (don't assume row 1 / sheet 0):** real exported reports put a
title/summary banner above the headers, trailing totals/variance rows below, and extra
sheets ("Summary", "Source Notes"). `locateTable` reads each sheet as an array-of-arrays
(`sheet_to_json {header:1}`), collects EVERY row where `looksLikeHeaderRow` (has a client
col AND a date-or-amount col), and picks the strongest candidate by sort: `hasDate` first
(a service-date col actually mapped), then most mapped fields, then earliest sheet, then
earliest row. **Why hasDate first:** a "Summary" tab (client + Total Due, no date) must
NOT beat the detail/claim-lines tab. `buildColumnMap(headers)` is the single source of
truth for column mapping, shared by both the scoring and the final parse so selection and
extraction can't drift.

**Totals/banner row drop:** the final line filter requires a non-empty `clientName`. A
line with no client can never match a session anyway, and this cleanly drops "Grand
Total"/"Calculated Total Due"/"Variance"/blank rows (which have an amount but no client).
Legit dateless lines (client + amount, blank service date) are still kept.
