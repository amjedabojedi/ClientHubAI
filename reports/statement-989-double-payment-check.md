# Statement #989 Double-Payment Audit Report

**Generated:** 2026-08-15  
**Statement:** #989 — `Dr_Jamal_May_Statement_Completed.xlsx`  
**Statement #661:** `Dr_Jamal_May_Statement_Built.xlsx` (same payer, same therapist)

---

## Executive Summary

**No cross-statement double-payment found.** Statement #989 did not re-pay any session that statement #661 had already covered. The duplicate-guard worked correctly for all 58 sessions shared between the two statements.

However, **statement #989 over-collected on 5 sessions** for client **Donald Stephen Sallows (Steve)**: it posted $160.00 on each session whose net bill is only $104.73, inflating the collected insurance by **$55.27 per session × 5 = $276.35 total**.

---

## Finding 1 — Cross-Statement Double Payment: NONE

Statement #661 is still posted (not voided; 58 active posted lines, total $8,030.33). Statement #989 covered many of the same sessions:

- For all **58 sessions** where #661 had already posted money, #989's lines correctly posted **$0.00** — the insurance-vs-insurance dedup guard fired and added nothing.
- No payment transaction was created twice for the same billing from two different statements.

**Verdict: No duplicate payment between statements #661 and #989.**

---

## Finding 2 — Over-Collection on 5 Donald Sallows Sessions

Statement #989 posted **$160.00** per session on these 5 billings. The net bill (total − discount) on each is **$104.73** ($149.61 − $44.88). The posting code did not cap at the net bill, so each billing now shows `insurancePaidAmount = $160.00` — **$55.27 above the billed amount**.

| Session Date | Billing ID | Session ID | Net Bill | Posted (stmt 989) | Over-Collected |
|---|---|---|---|---|---|
| 2026-05-01 | 2447 | 11521 | $104.73 | $160.00 | **+$55.27** |
| 2026-05-08 | 2540 | 11628 | $104.73 | $160.00 | **+$55.27** |
| 2026-05-15 | 2594 | 11696 | $104.73 | $160.00 | **+$55.27** |
| 2026-05-22 | 2681 | 11769 | $104.73 | $160.00 | **+$55.27** |
| 2026-05-29 | 2761 | 11866 | $104.73 | $160.00 | **+$55.27** |
| **Total** | | | | | **+$276.35** |

All 5 sessions are currently marked **payment_status = 'paid'** with $160.00 collected — more than the bill.

No other statement lines or manual payments exist on these 5 billings. The full $160.00 on each comes entirely from statement #989.

---

## Finding 3 — Two Correctly Paid Sessions

The remaining 2 non-zero posts from statement #989 are clean:

| Client | Session Date | Billing ID | Net Bill | Posted | Status |
|---|---|---|---|---|---|
| Moustafa Alkurd | 2026-05-15 | 2599 | $700.00 | $700.00 | ✓ Correct |
| Noureddine Ibrahim Mohammad Almahmoud | 2026-05-24 | 3074 | $700.00 | $700.00 | ✓ Correct |

---

## Clarification on Statement #661

The task context described statement #661 as "voided," but the database shows it is **still posted** (`status = 'posted'`, `voided_at = null`) with 58 active posted lines. The previously identified issue ("a void didn't clear the invoice") appears to have been resolved or was on a different session.

---

## Proposed Remediation Steps (STAFF DECISION REQUIRED — do not apply automatically)

**Question to confirm first:** Did the insurer actually remit $160.00 per session for Donald Sallows, or was the statement line amount incorrect?

### Option A — The $160.00 is correct (insurer paid more than the discounted rate)
The billing setup needs correcting, not the statement. For each of the 5 sessions:
1. Update the billing's `total_amount` (or remove/adjust `discount_amount`) to reflect a $160.00 billed amount.
2. No change to statement #989 or the payment transactions is needed.
3. Reconcile therapist earnings if the pay rule is percentage-based (earnings should be recalculated on the higher collected amount).

### Option B — The $160.00 is wrong (should have been $104.73 per session)
Per the void re-balance rules, individual lines cannot be voided — the whole statement must be voided:
1. **Void statement #989** via the existing void flow. This will:
   - Reverse the 5 Sallows lines (–$160.00 each → `insurancePaidAmount` drops back to $0 on those billings).
   - Reverse the 2 correct $700 sessions (billing 2599 and 3074) as well — collateral, since voiding is statement-wide.
   - Leave all 58 zero-posted lines unchanged (they contributed $0.00).
   - Leave statement #661 and its payments untouched.
2. **Re-upload a corrected statement** for the 5 Sallows sessions at $104.73 each, and re-post the 2 $700 sessions.
3. Confirm therapist earnings re-synced after re-posting (earnings are computed on the collected basis).

**Do not apply either option without owner sign-off.** The over-collection is $276.35, and voiding #989 also rolls back $1,400 in legitimately-correct payments (the two $700 sessions) which must be re-posted from a new upload.

---

## Data Sources

- `insurance_statements` — IDs 661 and 989
- `insurance_statement_lines` — match_status IN ('posted', 'confirmed'), statement_id = 989
- `session_billing` — billings 2447, 2540, 2594, 2681, 2761, 2599, 3074
- `payment_transactions` — source = 'insurance', filtered by billing_id and voided_at IS NULL
