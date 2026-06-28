---
name: Therapist adjustments + needs-attention panel
description: How non-session manual bonuses/deductions reconcile, and the seeding rule for the needs-attention aggregator.
---

# Non-session adjustments (therapist_adjustments)

Manual bonuses (+) and deductions (−) are **net-balance ledger items, NOT per-session allocatable**. Only `status='active'` counts anywhere; void is audited. bonus = +amount (raises owed), deduction = −amount.

`getTherapistOwed` keeps `total` **session-only** and returns `adjustmentsNet` (active bonuses − deductions) as a **separate** field. Every user-facing surface must FOLD them together itself:
- Lump payment: `netOwed = max(0, total + adjustmentsNet)`; `unapplied = max(0, amount − netOwed)`. Session allocation loop unchanged — paying a bonus settles via the net, not a session row.
- Owed tab headline ("all months"): must display `total + adjustmentsNet`, not `total`, or it won't reconcile with the running statement's net.
- Statement adds adjustment lines (bonus→earned, deduction→paid, carrying `adjustmentId`); monthly buckets by `effectiveDate`.

**Why:** same lesson as the cancelled-session fix — if any one consumer forgets to fold `adjustmentsNet`, the owed number silently disagrees across owed/statement/monthly/lump. The split-field design is fine ONLY if every surface folds it.

# Needs-attention aggregator (getTherapistPayAttention)

Seed the therapist id set from `getTherapists()` (all current therapists), THEN union ledger ids (earnings/payouts/adjustments).

**Why:** the "unresolved" flag targets therapists with collected sessions but NO pay rule. Earnings are persisted lazily (only on read/payout), so a brand-new no-rule therapist has zero rows in therapist_earnings/payouts/adjustments and would be invisible if you seed only from those tables — exactly the case the panel exists to catch. Unioning ledger ids still covers a departed therapist who has owed money but is no longer in the active list.

# Audit convention for this section

therapist-pay **read** endpoints (owed/statement/monthly/rules/attention/list-adjustments) are NOT audited; only state-changing POST/void routes write audit_logs. Follow that pattern — don't audit GET reads here.
