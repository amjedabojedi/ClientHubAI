---
name: Audit log display-name resolution
description: How to resolve user + client names for the HIPAA Audit page; audit rows often lack denormalized names.
---

The HIPAA Audit page (`/api/audit/logs`) must JOIN to resolve display names — the
denormalized columns on `audit_logs` are frequently empty.

**User name:** `audit_logs.username` is empty/NULL on many rows that DO have
`user_id` (e.g. ~all `notes_viewed`). Resolve via
`coalesce(nullif(username,''), users.full_name, users.username)` (leftJoin users
on user_id). The user-search filter and the stats "top active users" grouping
must use the SAME resolved expression or they drift from what's displayed.
Rows with neither user_id nor username are genuine system/unauthenticated
actions → frontend shows "System".

**Client name:** the client is NOT always in `audit_logs.client_id`.
- `client_viewed` (resource_type 'client') — usually has client_id, but a chunk
  only have the id in `resource_id`.
- `notes_viewed` (resource_type 'client_notes') — client_id is ALWAYS null; the
  client id lives in `resource_id`.
- `calendar_feed_accessed` (resource_type 'calendar_feed') — NO client; stays blank.
Resolve with a second aliased clients join on a CASE-guarded cast:
`case when resource_type in ('client','client_notes') and resource_id ~ '^[0-9]+$'
and length(resource_id) <= 18 then resource_id::bigint else null end`, then
`clientName = coalesce(clients.fullName, resourceClients.fullName)`.

**Why the CASE guard matters:** `resource_id` is varchar and holds non-numeric
values (e.g. "duplicates"). A plain `resource_id::int` in a JOIN ON breaks the
whole query ("invalid input syntax for integer") because Postgres does NOT
guarantee AND short-circuits cast errors in a join condition — only CASE does.
Cast to bigint (clients.id is bigint) + length<=18 avoids overflow too.

**Note:** remaining blank client names are typically ephemeral test clients that
the running `test-privacy` suite created then deleted — not a bug.
