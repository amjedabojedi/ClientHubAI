---
name: Therapist statement earning de-dup
description: Why the running statement must sum earnings per billing, and how to clean up over-collection that doubled them.
---

# Duplicated earning rows on the therapist running statement

**Symptom:** the therapist running statement shows two (or more) "Earning" lines
for the same client + same session date.

**Root cause (it is NOT two sessions):** therapist pay is a percentage of what was
*collected* on a billing. `therapist_earnings` is an append-only ledger — the first
row is `entryType='earning'`, and any later change in collected appends an
`entryType='adjustment'` delta row. So when collected is wrong/inflated (e.g. a
manual insurance payment AND an insurance-statement post stacked on the same
billing — the same double-count that inflates collections), the ledger grows an
extra adjustment row and the session shows multiple earning lines.

## Rule: the running statement must CONSOLIDATE per billing
`getTherapistStatement` must group all `therapist_earnings` rows by
`sessionBillingId` and emit ONE `earning` line with the **net** summed amount
(drop net-zero groups). Rendering one ledger row = one displayed line is wrong:
correcting/adjustment rows then surface as confusing extra lines.
**Why:** the ledger is intentionally append-only (audit); de-dup is a *display*
concern, never delete ledger rows. Totals/running balance are unaffected because
grouped earnings are additive and all rows for a billing share the session date.
**Note:** the per-period/monthly statement already computes one row per session
(live compute), so this only applies to the running statement.

## Cleaning up an over-collection that already doubled earnings
Fix the *collected* amount, and earnings self-correct on the next statement read
(sync appends a negative adjustment so each session nets correctly):
- For each affected insurance statement: void it, then **reset its status to
  `'confirmed'` (clear void fields) before re-posting** — `postInsuranceStatement`
  refuses to post a `voided` statement, and `voidInsuranceStatement` already
  returns the lines to `confirmed`.
- Re-post goes through the adoption path (adopts the unconsumed manual insurance
  payment via `adoptedByLineId`, posts only the shortfall), so collected lands on
  the correct single amount instead of re-stacking.
- Then call `getTherapistStatement` (or payout) for each affected therapist to
  trigger `syncTherapistEarnings`, which appends the correcting negative adjustment.
- Insurance void/post audit rows live in the ROUTE, not storage — a script that
  calls storage directly must insert those audit rows itself (SYSTEM_USER_ID=6).
