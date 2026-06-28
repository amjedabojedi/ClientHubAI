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
status filter, so cancelled sessions still surface as "billed". Any report that
shows Expected/Uncollected ("money owed") must special-case `status === 'cancelled'`
and treat it as $0 owed, or cancelled sessions inflate the owed totals.

**Rule applied in `getTherapistPeriodStatement` (Monthly Report):** for a billed
row whose live session status is `cancelled`, set `expected = 0` and
`uncollected = 0` and exclude them from `totalExpected`/`totalUncollected`.
`collected` and `earned` are left on collected-money semantics (money actually
collected before a cancellation stays earned — earned is 0 anyway when nothing was
collected).

**Why:** a cancelled session is not owed money even though its billing row
survives. `no_show` is deliberately NOT treated this way — a no-show is legitimately
billable and should keep showing as owed.

**Frontend (therapist-payments.tsx Monthly Report):** billed+cancelled rows show a
"Cancelled" badge (not "Billed"), and are kept out of both the Collected and
Uncollected sub-filters (they appear only under "All").
