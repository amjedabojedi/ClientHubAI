---
name: Insurance statement upload numeric overflow
description: Why parsed insurance-statement amounts must be range-checked before insert, and how to fail clearly instead of a generic 500.
---

Insurance statement uploads (POST /api/insurance/statements) write parsed amounts
straight into money columns: line amounts (billed/allowed/insurancePaid/patientResp)
are `decimal(10,2)` → max **99,999,999.99**; statement `totalPaid` is `decimal(12,2)`
→ max **9,999,999,999.99**.

**Failure mode:** the parser (xlsx header heuristics, or AI for PDFs) can misread a
column — e.g. an account/claim/phone number read as a dollar amount — producing a
value bigger than the column. Postgres then throws "numeric field overflow", which
the route's catch-all turns into a generic 500 / red "Could not upload" toast with
no actionable detail. The user sees it "keep happening" with no clue which file/value.

**Fix / rule:** range-check every parsed money field BEFORE insert (in the route,
right after parse, before duplicate check + createInsuranceStatement). On overflow
return a **422** naming the offending client/row and which amount(s) are too large.

**Why never clamp:** this is financial/HIPAA data — silently shrinking a payment
to fit the column would corrupt the record. Reject and let the user fix the source
file instead.

**Note:** numOrNull in server/insurance/parse.ts already maps NaN/Infinity → null,
so only finite-but-too-large values reach the guard.
