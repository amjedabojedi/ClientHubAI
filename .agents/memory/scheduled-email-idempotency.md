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

**How to apply:**
- Claim is a single atomic `INSERT ... ON CONFLICT (recipient, periodKey) DO
  UPDATE ... RETURNING`. The `setWhere` clause decides re-claim eligibility:
  re-claim only when `status='failed' AND attempts < MAX`, OR
  `status='processing' AND updated_at < now() - lease`. If `RETURNING` is empty,
  you did NOT win the claim — skip (it is already sent, in flight, or exhausted).
  A `sent` row therefore never matches `setWhere`, so it can never be re-sent.
- The stale-`processing` lease (e.g. 10 min, comfortably longer than one
  send+record cycle) gives at-least-once recovery for the rare send-then-crash
  case while never stealing live work.
- Permanent failures (e.g. recipient has no email address) should be written at
  the retry cap so they are not pointlessly re-claimed all period.
- The in-process in-flight boolean guard only prevents overlapping ticks in ONE
  process; the DB claim is what guarantees correctness across restarts and
  multiple instances.
- Privacy still applies to the body — see external-client-privacy.
