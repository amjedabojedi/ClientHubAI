---
name: Session count classification for AI reports
description: How "completed psychotherapy session" counts/date-ranges are computed for AI client reports, and why the AI must not count.
---

# Session counts in AI client reports

When an AI client report needs a number like "the client attended X completed
psychotherapy sessions between [first] and [last]", the count and date range are
computed server-side and injected into the prompt as an authoritative
SESSION STATISTICS block. The AI is explicitly forbidden from counting the
session list itself.

**Why:**
- LLMs miscount/hallucinate (observed a report claiming 13 when only 11 completed
  sessions existed). The session list shown to the model is also truncated.
- The `sessions.session_type` column is unreliable: many non-therapy
  appointments (e.g. service "Admin", "Assessment 4 hours") are still tagged
  `psychotherapy`. The linked **service catalogue name** is the trustworthy
  signal, not `session_type`. `services.category` is also useless here — almost
  every service is categorised "Therapy".

**How to apply:**
- Classify a session as a counted psychotherapy session only when:
  status is `completed`, the date is not in the future, `session_type` is not
  `assessment`/`consultation`, and the service name does NOT match the exclusion
  keyword set (admin, assessment, consult, document, planning, report,
  transport, prescreen, test). **Fail closed**: a missing/blank service name is
  NOT counted.
- The date range uses the first/last *counted* psychotherapy session — so an
  early assessment or admin appointment does not become the "first session date".
- Tag each session line in the prompt as counted/not-counted so the AI's
  narrative stays consistent with the statistics.
- The exclusion keyword list is a heuristic over messy free-text service names;
  revisit it if new non-therapy service names appear.
