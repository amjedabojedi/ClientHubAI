---
name: Insurance audited mutation atomicity + terminal-line locks
description: HIPAA-audited insurance statement-line mutations must persist the data change and its audit row atomically, and terminal line states are locked.
---

# HIPAA-audited insurance mutations: atomic audit + terminal-state locks

**Rule 1 — atomic audit.** Any HIPAA-audited mutation on insurance statement lines
(edit, reverse, post, etc.) must write the data change AND its `auditLogs` row inside
ONE `db.transaction`. Never do "storage.mutate() then a separate db.insert(auditLogs)"
in the route — if the audit insert fails, the change is already committed with no audit
trail (and vice-versa).

**Why:** compliance requires every change to be logged. A committed edit with a missing
audit row (DB blip / enum drift / transient error) silently violates that. Found during
review of the inline line-edit feature, where the route originally inserted the audit row
after the storage write returned.

**How to apply:** pass the audit context (userId, username, ip, userAgent) INTO the storage
method and let it insert the audit row on the same `tx` it uses for the write. If a
matcher/read is needed, compute it BEFORE opening the transaction so the tx holds a single
pool connection (pool max is small; nesting a second connection inside a tx can deadlock).

**Rule 2 — terminal line states are locked.** Editing/re-matching an insurance statement
line is blocked when: `matchStatus === 'posted'`, `matchStatus === 'reversed'`, or the
parent statement `status === 'voided'`. `reversed` = money that was posted then undone;
re-editing + auto-rematch could resurrect a path to re-posting, so treat it as terminal
just like posted. Enforce in BOTH storage (throw) and the UI (hide the control) — a
reversed line is not "posted" so a naive `canEdit = status !== 'posted'` still shows it.
