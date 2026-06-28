---
name: Insurance void re-balance across siblings
description: Voiding one of two posted statements on the same billing must let the survivor re-absorb the payment.
---

# Voiding one statement must not orphan a sibling's payment

Two statements can document the SAME real-world insurer payment for one billing
(re-uploaded EOB, or manual entry then statement). The FIRST to post records the
money (`postedAmount > 0`); a later duplicate posts a `$0` shortfall because the
billing already covers it (`additional = max(0, lineAmount - currentInsurance)`).

**Bug (fixed):** `voidInsuranceStatement` reversed a line by blindly subtracting
its `postedAmount` from the billing's cumulative insurance. Voiding the statement
that actually held the money dropped collected to `$0` even though a still-posted
sibling documented the same payment.

**Fix:** after reversing the voided statement's lines, re-derive each affected
billing's insurance from live manual rows + whatever statement lines REMAIN
posted (parent statement not voided), re-distributing the shortfall across the
survivors in post order (`asc(line id)`) exactly like the original post, then
adjust the billing to the recomputed total via `recordPayment` attributed to the
surviving owner line (so it dodges the manual-insurance duplicate guard and a
future void of the survivor reverses the right amount).

**Why:** `billing.insurancePaidAmount = liveManualSum + sum(postedAmount over
posted lines)`. The survivor's `postedAmount` was 0, so removing the real poster
left no one holding the money. Re-distribution restores the invariant.

**How to apply:** any change to post/void shortfall math must keep
`billing.insurancePaid == ledger sum (non-voided insurance payment_transactions)`
AND `== max(manualSum, max remaining posted lineAmount)`. Covered by Scenario E
in `test/insurance-statement-double-payment.test.ts`.
