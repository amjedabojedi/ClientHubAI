---
name: Insurance statement double-count guard
description: Why posting an insurance statement line must dedup against the billing's cumulative insurance, not just unadopted manual rows.
---

# Insurance statement double-count guard

When `postInsuranceStatement` posts a confirmed line, the amount it adds to the
billing's insurance must be the SHORTFALL above the insurance **already counted on
that billing** — i.e. `additional = max(0, lineAmount - billing.insurancePaidAmount)`
— NOT `lineAmount - (sum of unadopted manual rows)`.

**Why:** The original guard only deduped against MANUAL payment_transactions rows it
could still adopt (`adoptedByLineId IS NULL`). That stops a *manual* payment being
re-counted, but a SECOND statement posted for the same billing/payment finds nothing
left to adopt (the manual is already stamped, or the first money came from another
statement), so it posted its full line as brand-new money and inflated collected
(e.g. two $100 statements → 200). Collected insurance drives therapist pay, so this
over-pays.

**How to apply:** Read `billing.insurancePaidAmount` first; that number already
includes every live manual row and every prior statement's posted shortfall. Still
adopt unadopted manual rows (stamp `adoptedByLineId`) so the void path can release
them and existing tests pass, but compute the amount-to-add from the cumulative
billing figure. `postedAmount` stays the net-new added so void reverses exactly that.
This is a deliberate **dedup** decision: a second statement on the same billing is
treated as the same claim (a higher line adds only the increment; an equal/lower one
adds nothing). It would not separately bank a genuinely-independent second insurer
payment of the same amount — accepted tradeoff, consistent with the manual-adoption
design that already assumes same-billing insurance = same payment.

Covered by `test/insurance-statement-double-payment.test.ts` (Scenario C: two posted
statements, full-cover duplicate + incremental).
