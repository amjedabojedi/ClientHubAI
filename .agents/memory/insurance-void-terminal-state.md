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
- A voided statement is HARD-BLOCKED at the top of both edit paths (not just per-line
  skipping): `autoMatchStatementLines` throws "Cannot rematch a voided statement." and
  `updateStatementLineMatch` throws "Cannot change a line on a voided statement." when the
  parent `status = 'voided'`. Both surface as HTTP 400 via their routes. The per-line
  `'reversed'` skip inside `autoMatchStatementLines` is now belt-and-suspenders behind the
  early throw. **Gotcha:** the early throw means you can no longer call
  `autoMatchStatementLines` on a voided statement expecting it to no-op — it throws. A test
  written before the throw (double-payment Scenario D) silently broke on this.
- The client (`insurance-reconciliation.tsx`) renders `'reversed'` as a red outline badge;
  `canEdit` already disables actions when the parent statement is voided.
- Double-payment guard behavior is unchanged: void still reverses exactly the posted
  shortfall (`postedAmount`) and releases adopted manual rows (`adoptedByLineId = null`).
