---
name: Insurance matching sees unbilled sessions + back-bill on confirm
description: Why the insurance statement auto-matcher must match against sessions (not only billed sessions), and how confirming a line back-bills atomically.
---

The insurance statement auto-matcher must match a payment line against **sessions**, not only against sessions that already have a `session_billing` row.

**Why:** Billing only started part-way through the practice's life, so thousands of older completed/no-show sessions were never billed. A matcher that joins `session_billing → sessions` is blind to those, so it either "loses" the session entirely or worse, suggests a *different* already-billed client who happens to share a name token (a single shared surname like "Ahmed"≈"Ahmad" was enough to mis-suggest a stranger).

**How to apply:**
- The candidate query in `findBillingMatchForLine` selects FROM `sessions` and LEFT JOINs `session_billing`; eligibility is `status IN ('completed','no_show') OR session_billing.id IS NOT NULL` (so future `scheduled`/`rescheduled` placeholders are excluded unless deliberately billed). An unbilled match returns `billingId = null`.
- A **partial** name-tier suggestion requires **≥2** distinct statement tokens to each have a similar client token (not ≥1) — a lone shared surname must not suggest an unrelated client.
- Display/list queries resolve session+client via `matchedSessionId`/`matchedClientId` directly (billing amounts still via `matchedSessionBillingId`), so unbilled suggestions still show who/when.
- **Back-bill on confirm:** confirming a line with no billing but a matched session creates the bill in that flow (idempotent: `getSessionBilling ?? createSessionBilling`). The post step is unchanged because by confirm time the line always has a billing row.
- The back-bill is **concurrency-unsafe by default** (`session_billing.session_id` is NOT unique, and the create is read-then-insert). Wrap it in a `db.transaction` holding `pg_advisory_xact_lock(hashtext('session_billing'), sessionId)` and run BOTH the re-check and the create on that one locked tx connection (pool max is 2 dev / 5 prod — never fan the lock and the create across two connections). `getSessionBilling`/`createSessionBilling` take an optional `executor` arg for exactly this.
