---
name: assessment report permission
description: Who may generate/edit/finalize an AI assessment report, and the admin-created deadlock that this rule fixes.
---

`checkAssessmentEditPermission` (server/routes-helpers.ts) gates generate/edit/finalize/
unfinalize of AI assessment reports for ALL assessment endpoints in routes.ts. Fixing it
in one place fixes every report action consistently.

Rule (current): admins are view-only (blocked from editing the report); the client's
**assigned therapist** (`assignment.client.assignedTherapistId === userId`) is always
allowed; otherwise fall back to the creator (`assignment.assignedById === userId`).

**Why:** Admins were view-only AND non-admins were creator-only. When an *admin account*
created an assessment, nobody could ever generate its report — admin blocked (view-only),
therapist blocked (not creator). Deadlock. The owner's model: admins create/assign, but
the clinical report must "go through the therapist." So the client's assigned therapist was
added as an always-allowed editor.

**How to apply:** `getAssessmentAssignmentById` returns the assignment with a full `client`
row, so `assignment.client?.assignedTherapistId` is available (optional-chain it — client
can be null). If a client has no `assignedTherapistId` and an admin created the assignment,
it still can't proceed until a therapist is assigned to the client. Report generation reads
`assessment_responses`; a `pending` assignment with 0 responses has no data to summarize.
