---
name: Insurance post/delete serialization & pool-size deadlock trap
description: Why post and delete of an insurance statement share an advisory lock, and why the whole post must run on one connection.
---

# Post vs delete serialization

`postInsuranceStatement` records billing payments BEFORE it flips the statement
status to 'posted'. So a delete that reads 'draft' could race a concurrent post
and remove the statement (and null its payment refs) mid-post, leaving billing
balances inflated with no statement to void.

**Rule:** post and delete must serialize on the SAME transaction-scoped advisory
lock `pg_advisory_xact_lock(hashtext('insurance_statement'), id)`. Delete also
takes `SELECT ... FOR UPDATE` and re-checks `status==='posted'` (reject → "void
first"). A posted statement can then never be deleted without voiding.

**Why transaction-scoped, not session-level:** the driver is **postgres-js with a
small pool (max 2 dev / 5 prod)**. A session-level `pg_advisory_lock` can lock on
one pooled connection and unlock on another → the lock leaks forever. Transaction
-scoped locks auto-release on commit/rollback, so use those.

# Pool-size deadlock trap (the non-obvious one)

If a storage method holds a lock transaction (`db.transaction(lockTx => ...)`)
while its body opens MORE transactions/connections via the global `db` (e.g.
`recordPayment` opens its own `db.transaction`), then with pool max = 2, two
concurrent calls each grab a lockTx connection and then starve waiting for a
second connection that never frees → **deadlock**.

**How to apply:** run the WHOLE locked operation on the single `lockTx`. We added
an optional `executor?` arg to `recordPayment` so post passes `lockTx` and
everything stays on one connection (no executor = unchanged behavior, opens its
own transaction). Any future "hold a lock across a multi-step storage op" must do
the same — thread the executor through, never let the body grab extra connections.

# All four insurance ops share this one lock now

post, delete, **void**, and **single-line reverse** (`reverseStatementLine`, undo
ONE posted line without voiding the whole statement) all run inside one
`db.transaction` and take the SAME key `pg_advisory_xact_lock(hashtext(
'insurance_statement'), statementId)`, with every read/write and every
`recordPayment` on `lockTx`. Void was originally NOT locked/transactional — adding
reverse forced it to be, otherwise reverse-vs-void could interleave and corrupt a
billing's cumulative `insurancePaidAmount`. **Rule:** any NEW operation that mutates
a statement's posted lines or its billings MUST join this lock + single-connection
pattern, or it silently breaks the serialization the others rely on. Reverse takes
the lock by reading `statementId` first (unlocked), locking, then re-reading the
line and re-checking `matchStatus==='posted'` + parent `status==='posted'`; it
re-balances surviving posted siblings with void's exact algorithm but leaves the
statement 'posted'.
