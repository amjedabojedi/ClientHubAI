---
name: Backend dev server reload trap
description: Server-side fixes can appear "not working" because the running tsx process didn't reload the new code.
---

# Backend dev server reload trap

A server-side fix (e.g. `server/notification-service.ts`) was committed and present in the
working tree, but the symptom persisted in the live app — and crucially the new code path
produced **zero logs and zero audit rows**, as if it never ran.

**Root cause:** the running backend process was still the OLD one (`npm run dev` = plain
`tsx server/index.ts`, no `tsx watch`). The auto-restart that's supposed to follow edits did
not actually cycle the backend that time, so the in-memory process kept serving stale code.

**Diagnostic signature:** a brand-new server code path produces NO observable trace at all
(no `console.log` lines, no audit/DB rows it should always write). Don't assume a logic bug —
first confirm the process is fresh.

**How to apply:**
- Check the latest workflow log file's start time / Process ID. If it predates your edit, the
  fix isn't loaded.
- Explicitly `restart_workflow("Start application")` after server-side `.ts` edits before
  concluding the fix doesn't work or chasing a phantom logic bug.
