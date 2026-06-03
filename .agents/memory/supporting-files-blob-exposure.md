---
name: Supporting files & Azure blob exposure
description: Why per-client uploaded files must never return blob URLs in API responses, and the app-wide public-blob caveat.
---

# Per-client supporting files (AI report context)

Therapists can upload reference docs (PDF/Word/.txt) per client as extra AI context for generated reports. Files are stored in Azure blob storage; extracted text is fed to the AI.

## Rule: API responses must return only safe metadata
List/upload responses for `report_supporting_files` return only `id, clientId, originalName, mimeType, fileSize, createdById, createdAt`. Never return `extractedText` (large PHI) or `fileUrl`/`fileBlobName`.

**Why:** the shared Azure container is created with blob-level public access (`access: 'blob'` in `server/azure-blob-storage.ts`), so anyone holding a blob URL can read the file anonymously. Leaking `fileUrl` in a JSON response would make PHI documents externally retrievable. This is an app-wide caveat — report templates and client documents store/expose `fileUrl` the same way.

**How to apply:** when adding any new endpoint that returns rows backed by Azure blobs, strip the URL/blob-name before responding. If you ever need authenticated downloads, add a backend download route with client-level authz rather than handing out the blob URL. Making the container fully private is a larger, app-wide change (would break existing document/template downloads) — treat as a separate task.

## Authenticated download pattern
Supporting files now have `GET /api/supporting-files/:id/download` — checks `userCanAccessClient`, resolves the blob (stored `fileBlobName` first, then `findBlobName`), streams bytes via `res.send`, never exposes the URL. `?inline=1` switches Content-Disposition to inline for preview. Frontend uses `fetch(..., {credentials:'include'})` → blob → object-URL anchor (cookie session auth). Downloads must be audit-logged with action `report_supporting_file_downloaded` (added to AUDIT_ACTIONS enum; remember `report_supporting_file_*` and all audit actions are pg ENUMs that need scripts/ensure-audit-enums.ts run after adding a value).
