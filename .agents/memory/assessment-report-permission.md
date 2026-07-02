---
name: assessment report permission
description: Therapist-only AI assessment workflow — admins are fully blocked from creating assessments and generating/editing reports (view + download only).
---

Final owner model: the client's **assigned therapist** does everything for an AI
assessment — create/assign it, enter answers, and generate/edit/finalize the report.
The **admin is fully blocked** from creating/assigning assessments AND from
generating/editing reports. Admins remain view-only and can still download PDF/Word.

Backend enforcement (all in one place per concern, so every endpoint agrees):
- `checkAssessmentEditPermission` (server/routes-helpers.ts) gates generate/edit/finalize/
  unfinalize for ALL report endpoints in routes.ts. Denies admins; allows the client's
  assigned therapist (`assignment.client?.assignedTherapistId === userId`); creator
  fallback (`assignment.assignedById === userId`) is kept for legitimate therapist creators.
- `checkAssessmentResponsePermission` gates saving answers; denies admins.
- **Two** create paths must both 403 admins (easy to miss the second one — different
  storage method): `POST /api/assessments/assignments` (calls `createAssessmentAssignment`)
  and `POST /api/clients/:clientId/assessments` (calls `assignAssessmentToClient`).

Frontend `isAdmin` gating (role 'admin' || 'administrator') hides admin-facing controls so
admin = view + download only: assessments.tsx (Assign), client-detail.tsx (assign
Select + button), assessment-completion.tsx + assessment-section-summary.tsx (Generate
Report via `canGenerate` prop), and assessment-report.tsx (Generate/Regenerate/Reopen,
Edit Assessment Responses, Save Draft/Save&Finalize, Edit Responses toggle + Save All
Responses; ReactQuill forced readOnly for admins). Downloads stay visible for admins.

**Why:** owner wanted the clinical report to "go through the therapist," not admin. Backend
is source of truth; frontend gating just avoids showing admins buttons that would 403.

**How to apply:** `getAssessmentAssignmentById` returns the full `client` row so
`assignment.client?.assignedTherapistId` is available (optional-chain — client can be null).
A `pending` assignment with 0 responses has no data to summarize. Scope note: only ADMIN
was to be blocked — do NOT strip the creator fallback or supervisor response access, which
support legitimate therapist/supervisor flows.
