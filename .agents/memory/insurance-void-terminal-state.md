---
name: Insurance voided-line terminal state
description: Why voided insurance statement lines move to 'reversed', not 'confirmed'
---

# Voided insurance statement lines are 'reversed' (terminal), not 'confirmed'

When `voidInsuranceStatement` reverses a posted line it sets `matchStatus = 'reversed'`
(a terminal status) and clears `postedAmount`.

**Why:** A voided statement can NEVER be re-posted — `postInsuranceStatement` hard-blocks
any statement with `status = 'voided'` ("Cannot post a voided statement."). The only real
re-post path is uploading a NEW statement. Previously void reset lines to `'confirmed'`,
which made the dead lines look re-postable and could mislead staff and future code.

**How to apply:**
- `matchStatus` is a free `varchar(20)`; valid values are documented in
  `shared/schema.ts` on `insuranceStatementLines` (unmatched / suggested / confirmed /
  posted / skipped / reversed). No DB migration is needed to add a value.
- `autoMatchStatementLines` must skip `'reversed'` lines (alongside confirmed/posted/skipped)
  so the `/rematch` route can't resurrect the re-postable appearance.
- The client (`insurance-reconciliation.tsx`) renders `'reversed'` as a red outline badge;
  `canEdit` already disables actions when the parent statement is voided.
- Double-payment guard behavior is unchanged: void still reverses exactly the posted
  shortfall (`postedAmount`) and releases adopted manual rows (`adoptedByLineId = null`).
