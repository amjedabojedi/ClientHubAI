---
name: AI transcribe authz for unsaved notes
description: Authorizing AI transcription/processing when the note has no saved id yet.
---

# AI transcription on new/unsaved notes must authorize by session scope

When an AI-processing endpoint can be hit for a record that does **not yet exist**
in the DB (e.g. the in-note "voice typing" button firing on a brand-new session
note with no `sessionNoteId`), it must still run full access control before
processing.

**Rule:** identify the protected resource from a server-trusted handle (the
`sessionId`), resolve it server-side, run the existing scope check
(`assertSessionAccess`: admin=all, therapist=own sessions, supervisor=supervised
only), then derive `clientId` **from the session** — never from a value the
client put in the request body.

**Why:** an earlier version passed a client-supplied `clientId` and only checked
that the client *existed*, then relied on the AI-consent gate. That is an IDOR:
consent is not a substitute for authorization — any authenticated non-accountant
user could transcribe under any consented client. Trusting `clientId` from the
body is the bug; deriving it from an authorized session is the fix.

**How to apply:** for any "works on an unsaved record" AI/data path, require the
parent resource id (session), authorize it with the same helper the saved-record
path uses, and fail closed (400) when no authorized context is available. Mirror
the saved path's scope model exactly so both branches stay consistent.
