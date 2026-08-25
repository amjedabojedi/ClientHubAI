---
name: Recording cleanup audit context
description: Required audit fields for destructive cleanup of unfinished recording attempts.
---

# Recording cleanup audits need both identifiers

Destructive cleanup audit events must identify the selected recording attempt as
the resource and retain the affected client's `clientId` context. A successful
audit action without the client association is incomplete for review and
client-scoped audit reporting.

**Why:** The cleanup route initially recorded the action and attempt resource
but omitted the client context; a route-level regression test caught the gap
even though the delete and audit transaction itself succeeded.

**How to apply:** When adding or changing recording cleanup handlers, assert the
HTTP boundary and inspect the persisted audit row for action, resource id, user,
and client association.