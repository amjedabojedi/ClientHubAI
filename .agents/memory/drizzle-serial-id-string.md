---
name: Drizzle serial id returns string vs integer FK number
description: Why comparing a captured serial PK to a referencing integer FK column can silently fail in tests/code.
---

A serial/auto-increment primary key fetched via `.returning()` (or a plain
select) can come back as a JS **string** (e.g. `"11"`), while an `integer`
column that references it comes back as a JS **number** (e.g. `11`). Within the
same fetched row you can see the PK `id` as a string and other integer columns
as numbers.

**Why:** the postgres driver maps the serial/identity type differently from a
plain `integer` column. This is environment/driver behavior, not something the
schema reveals.

**How to apply:** never compare an id captured from one query directly against
an id column from another query with `===` / `Array.includes` / `Set.has`.
Coerce both sides with `Number(...)` first. This bit a browser test asserting a
`client_checklists` row existed: `createdTemplateIds` held `"11"` (string) while
`clientChecklists.templateId` was `11` (number), so `.includes` returned false
even though the row was correctly inserted.
