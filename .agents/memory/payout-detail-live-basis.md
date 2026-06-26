---
name: Payout History detail reflects collection corrections
description: getTherapistPayoutById overlays live collected basis but keeps the historical pay-rule snapshot
---

# Payout History detail is NOT a pure frozen receipt

`getTherapistPayoutById` (server/storage.ts) builds rows from frozen snapshots
(payout_items + therapist_payment_allocations), then overlays them:

- `basisAmount` ← current collected for that sessionBillingId (from
  `computeTherapistEarnings`, keyed by billingId).
- `amountEarned` ← recomputed from the row's OWN stored rule snapshot
  (`payType`/`payValue`) applied to the live collected basis — percentage:
  `Math.round(collected*payValue)/100`; fixed: `payValue` unchanged.
- `payType`/`payValue` ← left as the historical snapshot (NOT current rule).
- `amountAllocated` ← never touched (real money paid).

**Why:** A later COLLECTION correction (e.g. fixing a double-counted insurance
payment) must surface in the history (user explicitly wanted this), shown as
over/under payment when amountAllocated != recomputed earned. But a later
PAY-RULE edit must NOT mutate a historical receipt — so the rule stays frozen
and earned is derived from the frozen rule, not the current one.

**How to apply:** If you ever repoint earned/rule to `computeTherapistEarnings`'s
current-rule output, you reintroduce the receipt-integrity bug (architect
flagged it). Only the collected basis is live. Frontend
(client/src/pages/therapist-payments.tsx) flags `amountAllocated > amountEarned`
as "X over (earned Y)" and `< ` as "of Y earned".
