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
  appointments (e.g. "Admin", "Assessment 4 hours") are still tagged
  `psychotherapy`. `services.category` is also useless — almost every service is
  categorised "Therapy". The **structured `services.serviceCode`** is the
  trustworthy signal (do NOT use the free-typed `serviceName` either).

**How to apply:**
- Classify a session as a counted psychotherapy session only when: status is
  `completed`, the date is not in the future, and the service CODE matches a
  psychotherapy family. Psychotherapy codes: `^(psy|ifh-[0-9]|fam|cou|ink)` (case
  insensitive) plus the standalone `MVA`. This covers Psy*/Psyc*, IFH-1H/2H/3H,
  "Psychotherapy - IFH" (starts "PSY"), FAM* (family), COU* (couples), INK*
  (intake). Inclusion-by-code-family, so it **fails closed**: a missing/unknown
  code is NOT counted (avoids the over-count the user reported).
- Excluded code families: assessment (ASS*, IFH-ASSESS, MVA01/MVA02, LE*, TM*,
  IFHP), admin (ADM*), documentation (DOC*), transport (TP*), report (WRI*, PR),
  prescreening. Note `MVA` alone = psychotherapy but `MVA01/MVA02` = assessment.
- The date range uses the first/last *counted* psychotherapy session — so an
  early assessment or admin appointment does not become the "first session date".
- Tag each session line in the prompt as counted/not-counted so the AI's
  narrative stays consistent with the statistics.
- If new psychotherapy code families are introduced later, add them to
  `PSYCHOTHERAPY_CODE` in generateClientReportFromTemplate.
