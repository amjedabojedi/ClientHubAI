---
name: Bulk money-action scope
description: How filtered bulk actions (re-scan / post-all) must scope to the on-screen working set and treat empty vs absent id lists.
---

# Bulk money-action scope (insurance reconciliation Transactions tab)

A bulk action triggered from a *filtered* list (e.g. "Post all confirmed" or
"Re-scan unmatched" on the insurance Transactions screen) must act only on the
working set the user can currently see — never silently on hidden rows of other
therapists.

**Rule:** the client always sends an explicit `statementIds[]` derived from the
current therapist scope. The server filter helper distinguishes three cases:
- field **absent / not an array** → `null` → fall back to global (all eligible).
- field **present but empty `[]`** → empty `Set` → act on **nothing**.
- field present with ids → `Set` of those ids.

An empty JS `Set` is truthy, so `if (idFilter) rows.filter(s => idFilter.has(s.id))`
correctly yields zero rows for `[]` instead of going global. Returning `null` for
an empty array (the original bug) silently re-globalizes a filtered money action.

Also disable the bulk button when the in-scope count is 0 so the empty-scope path
can't be reached from the UI at all.

**Why:** posting affects therapist pay and is only undoable by voiding. A user who
filters to one therapist and clicks Post must not commit another therapist's
confirmed lines. Confirm-before-post stays the money-safety gate (post-all only
touches `matchStatus==='confirmed'`).

**How to apply:** any new bulk endpoint over insurance lines/statements should
reuse `parseStatementIdFilter` semantics and accept a client-supplied scoped id
list; return per-statement `failed[]` (HTTP 200) for partial-failure clarity
rather than fail-fast, since earlier statements may already be committed.
