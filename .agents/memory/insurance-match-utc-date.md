---
name: Insurance matcher date compare must be practice-local
description: Why insurance statement lines miss a session that clearly exists (one-day-off), and the tz fix.
---

# Insurance auto-match: compare session date in practice tz, not raw UTC

**Symptom:** an insurance statement line shows "No session matched" even though
the session exists for that client on that exact date the app displays. Same
client/name format matches fine on OTHER lines — so it is NOT a name issue.

**Root cause:** `sessions.session_date` is `timestamp without time zone` holding a
**UTC instant**; the whole app DISPLAYS it in `PRACTICE_TIMEZONE`
(America/New_York). An evening session (e.g. 8:00 PM Eastern) is stored on the
**next** UTC calendar day (00:00 UTC). The matcher's date prefilter compared the
raw `sessions.sessionDate::date` (UTC date) against the statement's local
`serviceDate`, so any session after the UTC-day boundary read one day ahead and
failed to match. A late-afternoon session (5:30 PM Eastern = 21:30 UTC) stayed on
the same date and matched — which is why only *some* lines missed.

**Fix:** convert to practice tz before truncating to date, in
`findBillingMatchForLine` (server/storage.ts):
`(sessionDate AT TIME ZONE 'UTC' AT TIME ZONE PRACTICE_TIMEZONE)::date = serviceDate::date`.
`PRACTICE_TIMEZONE` from `server/practiceTime.ts`. This aligns the match with the
date users actually see.

**Why safe:** date only narrows candidates; the name subset gate + single-candidate
rule still decide the client, and matches are only ever 'suggested' (human confirms).

**How to apply / gotchas:**
- Any date-vs-UTC-timestamp comparison against a *local* date (billing/report
  buckets, day filters) has this same trap — convert via AT TIME ZONE 'UTC' AT TIME
  ZONE PRACTICE_TIMEZONE, don't cast the raw instant.
- The fix only affects NEW match runs. Existing 'unmatched' lines are re-evaluated
  by `/api/insurance/statements/:id/rematch` or `/api/insurance/rematch-all`
  (both skip confirmed/posted/skipped/reversed).
