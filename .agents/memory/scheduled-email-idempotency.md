---
name: Scheduled / recurring outbound email idempotency
description: How to make a background "send once per recipient per day" email job restart-safe without duplicate sends.
---

For any background job that emails each recipient once per period (e.g. the daily
8 AM Eastern therapist schedule digest), use a **claim-first** pattern backed by a
table with a UNIQUE (recipient, periodKey) index. Status lifecycle:
`processing -> sent | failed`.

The rule: **claim the row BEFORE sending, mark the result AFTER.** Never
send-then-record.

**Why:** Sending first and writing the "sent" record afterward has a crash
window — if the process dies after the provider accepts the email but before the
record is written, the next run sees no record and sends a duplicate. Writing a
`processing` row first closes that window: a crashed attempt leaves a `processing`
row that blocks re-sends.

**Choose at-most-once over at-least-once for emails.** A duplicate email to a
client is a visible privacy/quality failure; a rare missed digest is not. So a
stuck `processing` row must NEVER be re-claimed — do not add a stale-`processing`
lease/reclaim branch, because that branch re-opens the duplicate-send window
exactly in the crash case it claims to recover. Recovering a genuinely-stuck row
should be a manual/observability action, not an automatic resend.

**How to apply:**
- Claim is a single atomic `INSERT ... ON CONFLICT (recipient, periodKey) DO
  UPDATE ... RETURNING`. The `setWhere` clause decides re-claim eligibility:
  re-claim ONLY when `status='failed' AND attempts < MAX`. If `RETURNING` is
  empty, you did NOT win the claim — skip (it is already sent, in flight, or
  exhausted). Both `sent` and `processing` rows therefore never match `setWhere`,
  so neither can ever be re-sent.
- Permanent failures (e.g. recipient has no email address) should be written at
  the retry cap so they are not pointlessly re-claimed all period.
- The in-process in-flight boolean guard only prevents overlapping ticks in ONE
  process; the DB claim is what guarantees correctness across restarts and
  multiple instances.
- Privacy still applies to the body — see external-client-privacy.

**Reused for the quiet-hours catch-up summary** (`processDeferredSummaryEmails`,
see quiet-hours-global-prefs.md): same claim-first / at-most-once contract — rows are
claimed pending→processing before send, a crash leaves them 'processing' and they are
never auto-re-sent. The difference is the period key: the catch-up flush is gated by
"user no longer muted", not a calendar day.

**Testing the send loop (DB-backed):** to drive `processDailyScheduleEmails`
without hitting SparkPost, stub `SparkPost.prototype.post` (the single method
that `transmissions.send` funnels through); the formatted payload arrives as
`options.json.recipients[].address.email`, so count/branch per recipient to
isolate your seeded therapists from other rows in the shared dev DB. The loop
iterates ALL active therapists, so it MUST run serially (folded into the
`test-privacy` validation) — a parallel suite creating/deleting therapists
causes FK violations on `daily_schedule_emails`. The "no email address" branch
is unreachable from a real row (`users.email` is NOT NULL), so don't test it.
