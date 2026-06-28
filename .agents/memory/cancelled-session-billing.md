---
name: Cancelled session keeps its billing row
description: Why therapist reports must zero owed money for cancelled sessions
---

Cancelling a session NEVER touches its `session_billing` row. Billing is created
only when a session is marked `completed`/`no_show` (server/routes.ts PUT
`/api/sessions/:id`), and there is no removal on cancel. So a session that was
completed (billed) and later set to `cancelled` keeps a live billing row with its
original `total_amount`.

**Consequence:** `computeTherapistEarnings` INNER JOINs `session_billing` with no
status filter, so cancelled sessions still surface as "billed".

**Fix the central source, not each report.** `computeTherapistEarnings` is the one
source of truth shared by the owed list/payouts (`getTherapistOwed`), the earning
ledger (`syncTherapistEarnings`), the running statement, the payout detail
(`getTherapistPayoutById`) and the monthly report (`getTherapistPeriodStatement`).
Zero a cancelled session there — select `sessions.status`, and for
`status === 'cancelled'` set both `expected = 0` and `amountEarned = 0` (leave
`collectedAmount` real). Then every consumer agrees automatically and no report
needs its own special-case. Patching only one report's display leaves the owed
list, statement and payouts still counting the cancelled money — fix the source.

**One consumer needs the status separately:** `getTherapistPayoutById` recomputes
earned live from collected × frozen rule, so it must also zero earned for cancelled
billings (that is why `status` is exposed on the compute return type, used to build a
`cancelledByBilling` set). A cancelled-after-paid session then shows as over-paid,
consistent with the rest.

**Why:** a cancelled session is not owed money even though its billing row
survives. `no_show` is deliberately NOT treated this way — a no-show is legitimately
billable and should keep showing as owed. `getBillingReports` (client billing
dashboard) is intentionally out of scope — it includes all statuses on purpose.

**Frontend (therapist-payments.tsx Monthly Report):** billed+cancelled rows show a
"Cancelled" badge (not "Billed"), and are kept out of both the Collected and
Uncollected sub-filters (they appear only under "All").
