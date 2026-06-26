---
name: Monthly vs running therapist statement reconciliation
description: The two therapist-statement paths must reconcile; how to seed a test so syncTherapistEarnings stays a no-op.
---
The running statement (`getTherapistStatement`) and the per-period statement
(`getTherapistPeriodStatement`/`getTherapistMonthlyStatement`) read the SAME
append-only `therapist_earnings` ledger but compute independently. They must agree:

- a month's `earnedInMonth` == the running statement's NET earning line for a session in that month;
- `openingBalance + earnedInMonth − paidInMonth == closingBalance`;
- the latest period's `closingBalance` == running `currentOwed` (no later activity).

**Why:** nothing else verifies it, so a change to either path can silently make a
therapist's monthly numbers diverge from their running balance.

**How to apply / seeding gotcha:** both readers call `syncTherapistEarnings`
first, which appends a delta row when a billing's computed earning
(collected * pay-rule) != the billing's ledger NET. To keep hand-seeded ledger
rows untouched, make each billing's ledger net EXACTLY equal collected*rate
(e.g. collected 100 @ 50% rule => seed rows summing to 50). Payouts do NOT affect
sync. Test: `test/therapist-statement-monthly-running-agree.test.ts`.
