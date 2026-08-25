---
name: JSONB function compatibility
description: Database compatibility guidance for counting keys in JSONB metadata.
---

Some supported project database environments do not provide PostgreSQL's `jsonb_object_length(jsonb)` function. When a JSONB object is only needed for a safe derived metadata value, retrieve it inside the trusted storage layer, count keys in application code, and omit the original object from the API response.

**Why:** A report query using `jsonb_object_length` failed at runtime even though TypeScript and the SQL shape appeared valid.

**How to apply:** Prefer portable JSONB predicates/functions; if a key count is required and result sets are bounded or already filtered, calculate it after retrieval and keep the JSONB payload internal.