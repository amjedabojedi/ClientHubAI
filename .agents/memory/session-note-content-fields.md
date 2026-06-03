---
name: Session note content fields
description: session_notes has no single "content" column; anything reading note text must use finalContent/draft/generated + structured fields.
---

The `session_notes` table stores a note's text across many columns, NOT a single
`content`/`note`/`summary` field. Any code that reads note text (AI prompts,
exports, summaries) must pull from:

1. `finalContent` → `draftContent` → `generatedContent` (the rich-text/HTML note,
   in that precedence — finalized first).
2. Fallback to the structured clinical fields: `sessionFocus`, `symptoms`,
   `shortTermGoals`, `intervention`, `progress`, `remarks`, `recommendations`.

**Why:** The AI client-report builder originally read `n.content || n.note || n.summary`,
none of which exist, so every session note reached the model as an empty body
(date + therapist only) and reports read as if notes were missing.

**How to apply:** When choosing among the rich-text candidates, normalize/strip HTML
BEFORE the truthiness check — empty editor placeholders like `<p><br></p>` or
`&nbsp;` are "truthy" raw but contain no text, and would wrongly block fallback to
a populated draft/structured field.
