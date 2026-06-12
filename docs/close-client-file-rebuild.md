# Technical Handoff / Rebuild — "Close File for Client"

> Source of truth: this document was written from the **actual SmartHub codebase**, not from assumptions. Key files: `shared/schema.ts`, `server/routes.ts`, `server/routes-helpers.ts`, `server/storage.ts`, `client/src/pages/client-detail.tsx`.

---

## 1. Feature Overview

"Close File for Client" lets authorized staff mark a client's case as **closed** so the practice stops active clinical work on that client while **preserving every historical record** (sessions, notes, invoices, documents, transcripts, assessments).

Core idea (important): **closing a file is a status change, not a deletion.**

- Closing = setting the client's `status` to `inactive` (and, automatically, `stage` to `closed`).
- The file can be **reopened** later (status back to `active`) — by an administrator.
- Nothing is destroyed. A separate, explicitly destructive "delete client" action exists but is **not** part of this feature.

There are two ways to close files:
1. **Single client** — from the client detail page ("Close File" / "Reopen File" buttons) → `PUT /api/clients/:id`.
2. **Bulk** — admin/supervisor change many clients at once → `POST /api/clients/bulk-update-status`.

---

## 2. User Flow

### Closing one file (therapist/admin/supervisor)
1. Staff opens the client's detail page (`/clients/:id`).
2. While the client is active, a **"Close File"** button is visible in the header actions.
3. Staff clicks **Close File**.
4. A browser confirm dialog appears:
   > "Are you sure you want to close this client file? The file will become inactive and new sessions/notes cannot be added. All historical data will remain accessible."
5. On confirm, the frontend sends `PUT /api/clients/:id` with `{ status: "inactive" }`.
6. Backend updates the client, auto-sets `stage = "closed"`, writes a `file_closed` history row, and returns the updated client.
7. UI shows a success toast ("Client file closed successfully") and re-renders:
   - A red **"This client file is INACTIVE"** warning banner appears at the top.
   - The status badge flips to **INACTIVE** (red).
   - Buttons to schedule sessions / add / edit notes become **disabled**.

### Reopening a file (administrators only)
1. On an inactive client, only an admin sees a **"Reopen File"** button.
2. Click → confirm dialog:
   > "Are you sure you want to reopen this client file? The client will be reactivated and new sessions/notes can be added."
3. On confirm → `PUT /api/clients/:id` with `{ status: "active" }`.
4. Backend writes a `file_reopened` history row; UI returns to the normal active state.

### Bulk close/reactivate (admin/supervisor)
1. From a client-list/management view, select multiple clients and choose a status.
2. Frontend sends `POST /api/clients/bulk-update-status` with `{ clientIds: number[], status }`.
3. Backend validates role + scope, updates each client, and returns a per-client success/failure summary.

---

## 3. Functional Requirements

**Who can close / reopen**
- **Close (single):** `PUT /api/clients/:id` is guarded by `requireAuth` + `blockAccountant`. Therapists, supervisors, and admins may close (accountant role is blocked). The "Close File" UI is shown for these roles.
- **Reopen (single):** Backend allows status change to `active` for the same roles, **but the UI only renders the "Reopen File" button for `admin`/`administrator`** — this is the enforced product policy ("Only administrators can reopen this file").
- **Bulk:** Only `admin`/`administrator`/`supervisor`. Supervisors are additionally **scope-limited** to clients assigned to therapists they supervise.

**Validations before closing**
- Caller must be authenticated; accountant role blocked.
- Client must exist (404 otherwise).
- Body is parsed with `insertClientSchema.partial()` (Zod) — invalid fields rejected.
- Bulk: `clientIds` must be a non-empty array; `status` must be one of `active | inactive | pending | discharged`.

**Status / stage behavior**
- Closing sets `status = "inactive"`. If no explicit `stage` is supplied, the server **auto-sets `stage = "closed"`**.
- Reopening sets `status = "active"` (stage is not auto-reverted; it can be set explicitly if needed).

**What happens to related data**
- **Future / recurring sessions:** **NOT automatically cancelled.** Closing a file does not touch the `sessions` table or recurrence groups. (Operationally these are managed separately via session cancellation/deletion.)
- **Existing appointments, notes, invoices, documents, transcripts, assessments:** **Preserved and remain viewable.** No cascade, no deletion.
- **New work is blocked in the UI:** scheduling sessions and adding/editing notes are disabled while `status === 'inactive'`.

**Inactive vs archived**
- There is no separate "archived" flag. **Inactive IS the closed/archived state.** The status vocabulary is `active | inactive | pending | discharged`; `inactive` represents a closed file.

**Reopenable?** Yes — set status back to `active` (admin via UI).

**Audit / history**
- A `client_history` row is written for the closure (`file_closed`) and reopening (`file_reopened`), plus a `stage_change` row when stage changes.
- Bulk updates write a `bulk_update_status` activity log entry.
- The audit action vocabulary includes `client_updated`, `client_status_changed`, `bulk_update_status` (see `AUDIT_ACTIONS` in schema).

---

## 4. Technical Architecture

```
┌────────────────────────────────────────────────────────────┐
│ Frontend: client/src/pages/client-detail.tsx                │
│  - updateClientStatusMutation (TanStack Query)              │
│  - handleCloseFile() / handleReopenFile() (window.confirm)  │
│  - INACTIVE banner + status badge + disabled controls       │
└───────────────┬────────────────────────────────────────────┘
                │ apiRequest PUT /api/clients/:id { status }
                ▼
┌────────────────────────────────────────────────────────────┐
│ Backend route: server/routes.ts                             │
│  PUT /api/clients/:id                                        │
│   requireAuth → blockAccountant → auditClientAccess(...)     │
│   - load original client (404 if missing)                   │
│   - strip assignedTherapistId for non-admins                │
│   - empty-string → undefined cleanup                        │
│   - insertClientSchema.partial().parse()                    │
│   - if status==='inactive' && !stage → stage='closed'       │
│   - storage.updateClient(id, validatedData)                 │
│   - trackClientHistory(file_closed | file_reopened)         │
│   - trackClientHistory(stage_change) if stage changed       │
│                                                             │
│  POST /api/clients/bulk-update-status                        │
│   requireAuth → blockAccountant → role gate (admin/super)   │
│   - supervisor scope check                                   │
│   - loop storage.updateClient(id,{status})                  │
│   - storage.logUserActivity('bulk_update_status')           │
└───────────────┬────────────────────────────────────────────┘
                │ Drizzle ORM
                ▼
┌────────────────────────────────────────────────────────────┐
│ PostgreSQL (Neon)                                           │
│  clients(status, stage, lastUpdateDate, updatedAt, ...)     │
│  client_history(eventType, fromValue, toValue, ...)         │
│  audit_logs / user activity                                 │
└────────────────────────────────────────────────────────────┘
```

**Stack:** React 18 + TanStack Query + wouter (frontend); Express + Drizzle ORM + PostgreSQL/Neon (backend); Zod validation via `drizzle-zod`.

---

## 5. Data Flow

**Close (single):**
1. User confirms → `updateClientStatusMutation.mutate({ status: 'inactive' })`.
2. `apiRequest('/api/clients/:id', 'PUT', { status: 'inactive' })`.
3. Route loads `originalClient`; if not found → 404.
4. Non-admins: `assignedTherapistId` stripped from payload (security).
5. Empty strings/nulls coerced to `undefined`; payload parsed by `insertClientSchema.partial()`.
6. Because `status === 'inactive'` and no `stage` given → `stage` set to `'closed'`.
7. `storage.updateClient(id, validatedData)` persists; recalculates derived fields (e.g. `phoneE164` if phone changed) and timestamps.
8. Since `status` changed → `trackClientHistory({ eventType: 'file_closed', fromValue: oldStatus, toValue: 'inactive', ... })`.
9. Since `stage` changed → `trackClientHistory({ eventType: 'stage_change', ... })`.
10. Response = updated client. Frontend invalidates `[/api/clients/:id]` and `[/api/clients]`, shows toast, re-renders inactive state.

**Reopen:** same path with `{ status: 'active' }` → history `file_reopened`.

**Bulk:**
1. `POST /api/clients/bulk-update-status` `{ clientIds, status }`.
2. Role gate; supervisors verified against supervised therapists' clients.
3. Per-client `storage.updateClient(id, { status })` inside try/catch → tallies `successful` / `failed` / `errors`.
4. One `logUserActivity({ action: 'bulk_update_status', ... })` entry.
5. Returns `{ total, successful, failed, errors }`.

> Note: the bulk path calls `updateClient` directly and does **not** run the single-route's auto-`stage='closed'` logic or per-client `trackClientHistory` closure rows. If parity is required, see Edge Cases §9.

---

## 6. API Design

### `PUT /api/clients/:id`
- **Auth:** `requireAuth`, `blockAccountant`, `auditClientAccess('client_updated')`.
- **Path params:** `id` (integer client id).
- **Body:** `Partial<InsertClient>`. For this feature: `{ "status": "inactive" }` or `{ "status": "active" }`. May also include `stage`.
- **Server behavior:**
  - 404 if client not found.
  - Non-admin callers cannot set `assignedTherapistId` (silently stripped).
  - `status === 'inactive'` with no `stage` ⇒ `stage = 'closed'`.
  - Writes `file_closed` / `file_reopened` history when status changes; `stage_change` history when stage changes.
- **Response:** `200` updated client object.
- **Errors:** `401` (no auth), `403` (accountant blocked), `404` (not found), `400` (Zod validation), `500`.

### `POST /api/clients/bulk-update-status`
- **Auth:** `requireAuth`, `blockAccountant`, then role must be `admin`/`administrator`/`supervisor`.
- **Body:** `{ "clientIds": number[], "status": "active" | "inactive" | "pending" | "discharged" }`.
- **Validation:** non-empty `clientIds` array; `status` in the allowed set.
- **Supervisor scope:** all target clients must belong to supervised therapists, else `403` with `unauthorizedClientIds`.
- **Response:** `{ total, successful, failed, errors: [{ clientId, message }] }`.
- **Errors:** `401`, `403` (role / scope), `400` (bad input), `500`.

---

## 7. Code Design

### Database (`shared/schema.ts`)

`clients` table (relevant columns):
```ts
status: varchar("status", { length: 50 }),      // 'active' | 'inactive' | 'pending' | 'discharged'  ('inactive' = closed)
stage:  varchar("stage",  { length: 50 }),      // 'intake' | 'assessment' | 'psychotherapy' | 'maintenance' | 'closed' | 'discharged'
lastUpdateDate: timestamp("last_update_date").notNull().defaultNow(),
```

`client_history` table (audit/history trail):
```ts
export const clientHistory = pgTable("client_history", {
  id: serial("id").primaryKey(),
  clientId: integer("client_id").notNull().references(() => clients.id, { onDelete: 'cascade' }),
  eventType: varchar("event_type", { length: 50 }).notNull(), // 'file_closed' | 'file_reopened' | 'stage_change' | 'therapist_assignment' | ...
  eventSource: varchar("event_source", { length: 100 }),      // helper sets 'api'
  fromValue: text("from_value"),
  toValue: text("to_value"),
  metadata: text("metadata"),       // JSON string
  description: text("description"),
  createdBy: integer("created_by").references(() => users.id, { onDelete: 'set null' }),
  createdByName: varchar("created_by_name", { length: 255 }),
  auditLogId: integer("audit_log_id").references(() => auditLogs.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, /* indexes on clientId, (clientId, createdAt), eventType, createdAt */);
```

### History helper (`server/routes-helpers.ts`)
```ts
export async function trackClientHistory(params: {
  clientId: number; eventType: string;
  fromValue?: string | null; toValue?: string | null;
  description?: string; metadata?: any;
  createdBy?: number; createdByName?: string; auditLogId?: number;
}) {
  try {
    await db.insert(clientHistory).values({
      clientId: params.clientId,
      eventType: params.eventType,
      eventSource: 'api',
      fromValue: params.fromValue || null,
      toValue: params.toValue || null,
      description: params.description || null,
      metadata: params.metadata ? JSON.stringify(params.metadata) : null,
      createdBy: params.createdBy || null,
      createdByName: params.createdByName || null,
      auditLogId: params.auditLogId || null,
    });
  } catch (error) {
    console.error('Failed to track client history:', error);
    // Don't throw — history tracking must not break the main operation
  }
}
```
**Design note:** history writes are best-effort — a failure to log is swallowed so the status change itself still succeeds.

### Route logic (`server/routes.ts`, `PUT /api/clients/:id`)
Key excerpt:
```ts
const validatedData = insertClientSchema.partial().parse(clientData);

// AUTO-UPDATE: closing a file (status='inactive') forces stage='closed'
if (validatedData.status === 'inactive' && !validatedData.stage) {
  validatedData.stage = 'closed';
}

const client = await storage.updateClient(id, validatedData);

// Track status change as file_closed / file_reopened
if (validatedData.status && validatedData.status !== originalClient.status) {
  await trackClientHistory({
    clientId: client.id,
    eventType: validatedData.status === 'inactive' ? 'file_closed' : 'file_reopened',
    fromValue: originalClient.status || 'unknown',
    toValue: validatedData.status,
    description: validatedData.status === 'inactive'
      ? 'Client file closed and set to inactive'
      : 'Client file reopened and reactivated',
    createdBy: req.user.id,
    createdByName: req.user.username,
  });
}
```

### Frontend (`client/src/pages/client-detail.tsx`)
```ts
const updateClientStatusMutation = useMutation({
  mutationFn: ({ status }: { status: 'active' | 'inactive' }) =>
    apiRequest(`/api/clients/${clientId}`, "PUT", { status }),
  onSuccess: (_, variables) => {
    queryClient.invalidateQueries({ queryKey: [`/api/clients/${clientId}`] });
    queryClient.invalidateQueries({ queryKey: ["/api/clients"] });
    const action = variables.status === 'inactive' ? 'closed' : 'reopened';
    toast({ title: "Success", description: `Client file ${action} successfully` });
  },
  onError: (error: any) =>
    toast({ title: "Error", description: error.message || "Failed to update client status", variant: "destructive" }),
});

const handleCloseFile = () => {
  if (window.confirm("Are you sure you want to close this client file? The file will become inactive and new sessions/notes cannot be added. All historical data will remain accessible.")) {
    updateClientStatusMutation.mutate({ status: 'inactive' });
  }
};

const handleReopenFile = () => {
  if (window.confirm("Are you sure you want to reopen this client file? The client will be reactivated and new sessions/notes can be added.")) {
    updateClientStatusMutation.mutate({ status: 'active' });
  }
};
```

UI state derived from `client.status === 'inactive'`:
- Red INACTIVE banner ("No new sessions or notes can be added. Historical data remains accessible…"; admins additionally see "Only administrators can reopen this file").
- Status badge: red **INACTIVE** vs green **ACTIVE**.
- "Reopen File" button rendered only for `admin`/`administrator`.
- Schedule-session and add/edit-note controls `disabled` with explanatory `title` tooltips.

---

## 8. Pseudocode

### Single close/reopen (backend)
```
PUT /api/clients/:id  (requireAuth, blockAccountant, auditClientAccess):
  if !user: 401
  original = getClient(id); if !original: 404
  data = {...body}
  if user.role not in (admin, administrator): delete data.assignedTherapistId
  for each key in data: if value is "" or null -> undefined
  validated = insertClientSchema.partial().parse(data)
  if validated.status == 'inactive' and not validated.stage:
      validated.stage = 'closed'
  client = updateClient(id, validated)
  if validated.status and validated.status != original.status:
      trackClientHistory(eventType = (inactive ? 'file_closed' : 'file_reopened'),
                         from=original.status, to=validated.status, by=user)
  if validated.stage and validated.stage != original.stage:
      trackClientHistory(eventType='stage_change', from=original.stage, to=validated.stage, by=user)
  return 200 client
```

### Bulk update (backend)
```
POST /api/clients/bulk-update-status (requireAuth, blockAccountant):
  if !user: 401
  if role not in (admin, administrator, supervisor): 403
  {clientIds, status} = body
  if !Array(clientIds) or empty: 400
  if status not in [active, inactive, pending, discharged]: 400
  if role == supervisor:
      supervised = supervisedTherapistIds(user)
      if none: 403
      load clients; if any client.assignedTherapistId not in supervised: 403 (+unauthorizedClientIds)
  results = {total: len, successful:0, failed:0, errors:[]}
  for id in clientIds:
      try: updateClient(id, {status}); successful++
      catch e: failed++; errors.push({id, e.message})
  logUserActivity(action='bulk_update_status', details=...)
  return results
```

### Frontend
```
onClickCloseFile:
  if confirm(closeMessage): mutate({status:'inactive'})
onClickReopenFile (admins only):
  if confirm(reopenMessage): mutate({status:'active'})
onSuccess: invalidate [/api/clients/:id], [/api/clients]; toast
render:
  if client.status=='inactive': show red banner, INACTIVE badge, disable scheduling/notes
  show "Close File" when active; show "Reopen File" only when inactive AND role in (admin, administrator)
```

---

## 9. Edge Cases

1. **Client not found** → `404` before any update; no history written.
2. **Accountant role** → blocked by `blockAccountant` (`403`) on both endpoints.
3. **Non-admin tries to reassign therapist while closing** → `assignedTherapistId` silently stripped; close still proceeds.
4. **Empty-string fields in payload** → coerced to `undefined` so they don't overwrite columns or cause PG date errors.
5. **Closing without specifying stage** → `stage` auto-set to `'closed'`. Closing with an explicit stage → that stage is respected (auto-rule only fires when `!stage`).
6. **History write fails** → error logged, swallowed; the status change still succeeds (history is best-effort).
7. **Future/recurring sessions remain scheduled** → closing does **not** cancel them. If business rules require auto-cancellation, that logic must be added explicitly (it does not exist today).
8. **Reopening** does not auto-revert `stage` from `closed` — stage stays `closed` unless explicitly changed.
9. **Bulk path divergence** → bulk `updateClient(id,{status})` does **not** auto-set `stage='closed'` and does **not** write per-client `file_closed` history rows; it only writes one aggregate `bulk_update_status` activity log. Rebuild with this parity gap in mind (or close it deliberately).
10. **Supervisor bulk scope** → if a supervisor includes clients outside their supervised therapists, the whole request is rejected `403` with `unauthorizedClientIds`; partial application is not attempted.
11. **Supervisor with zero supervised therapists** → `403` ("You have no supervised therapists").
12. **Invalid bulk status value** (e.g. `"closed"`) → `400`; note the DB stage vocabulary uses `closed` but the **status** vocabulary does not — closing maps to `inactive`, not `closed`.
13. **UI guard vs API capability** → the API would accept a reopen from a therapist, but the UI only exposes "Reopen File" to admins. If reopen must be hard-enforced, add a server-side role check (currently it is UI-only policy).
14. **Concurrent edits** → last write wins on `updateClient`; no optimistic locking.

---

## 10. Rebuild Instructions

1. **Schema** (`shared/schema.ts`):
   - Ensure `clients.status varchar(50)` and `clients.stage varchar(50)` exist. Treat `status='inactive'` as the closed state.
   - Add the `client_history` table exactly as in §7 (FK to `clients` with `onDelete:'cascade'`, FK to `users` `createdBy` with `onDelete:'set null'`, optional `auditLogId` FK to `audit_logs`; indexes on `clientId`, `(clientId, createdAt)`, `eventType`, `createdAt`).
   - Add `insertClientHistorySchema` via `createInsertSchema(clientHistory).omit({ id, createdAt })`.
   - Include `client_updated`, `client_status_changed`, `bulk_update_status` in your audit action enum.
   - Run `npm run db:generate` then `npm run db:push` (use `--force` only if a safe data-loss warning appears).

2. **History helper** (`server/routes-helpers.ts`): add `trackClientHistory(params)` that inserts into `client_history` with `eventSource:'api'`, stringifies `metadata`, and **never throws** (wrap in try/catch, log on failure).

3. **Single endpoint** (`server/routes.ts`): implement `PUT /api/clients/:id` with `requireAuth`, `blockAccountant`, and an audit middleware. Follow the §8 pseudocode precisely — load original, strip `assignedTherapistId` for non-admins, coerce empty strings, `insertClientSchema.partial().parse`, auto-set `stage='closed'`, persist, then `trackClientHistory` for status (`file_closed`/`file_reopened`) and stage changes.

4. **Bulk endpoint**: implement `POST /api/clients/bulk-update-status` with the role gate (admin/administrator/supervisor), supervisor scope verification, per-client try/catch tally, and one `logUserActivity('bulk_update_status')`. Validate `clientIds` non-empty and `status ∈ {active,inactive,pending,discharged}`.

5. **Storage** (`server/storage.ts`): `updateClient(id, data)` should perform the Drizzle update, refresh `updatedAt`/`lastUpdateDate`, and recompute any derived columns (e.g. phone). Keep "delete client" as a **separate** destructive method — do not invoke it from close.

6. **Frontend** (`client/src/pages/client-detail.tsx`):
   - Add `updateClientStatusMutation` (TanStack Query) calling `apiRequest('/api/clients/:id','PUT',{status})`; invalidate `[/api/clients/:id]` and `[/api/clients]` on success; toast on success/error.
   - Add `handleCloseFile` / `handleReopenFile` using `window.confirm` with the exact warning copy.
   - Render the red INACTIVE banner, status badge, and **disable** scheduling + add/edit-note controls when `status==='inactive'`.
   - Show "Close File" for active files; show "Reopen File" only for `admin`/`administrator`.

7. **Verify**: close a file → confirm `status='inactive'`, `stage='closed'`, a `file_closed` history row, banner + disabled controls. Reopen as admin → `status='active'`, `file_reopened` row. Confirm sessions/notes/invoices/documents/transcripts still load read-only. Bulk update as supervisor with an out-of-scope client → expect `403`.

---

## 11. AI Agent Rebuild Prompt

> You are rebuilding the **"Close File for Client"** feature in a therapy practice-management app (React 18 + TanStack Query + wouter frontend; Express + Drizzle ORM + PostgreSQL/Neon backend; Zod via drizzle-zod).
>
> **Concept:** Closing a client file is a **status change, not a deletion**. Closing sets the client's `status` to `"inactive"` and auto-sets `stage` to `"closed"`. All historical data (sessions, notes, invoices, documents, transcripts, assessments) is preserved and viewable read-only. Files can be reopened (status → `"active"`).
>
> **Schema:** `clients.status varchar(50)` with values `active|inactive|pending|discharged` (`inactive` = closed); `clients.stage varchar(50)` (`intake|assessment|psychotherapy|maintenance|closed|discharged`). Add a `client_history` table: `id`, `clientId`(FK clients, cascade), `eventType`(varchar 50), `eventSource`, `fromValue`(text), `toValue`(text), `metadata`(text JSON), `description`(text), `createdBy`(FK users, set null), `createdByName`, `auditLogId`(FK audit_logs), `createdAt`; index `clientId`, `(clientId,createdAt)`, `eventType`, `createdAt`.
>
> **Helper:** `trackClientHistory(params)` inserts a history row with `eventSource:'api'`, JSON-stringifies metadata, and must **never throw** (try/catch + log).
>
> **Endpoint 1 — `PUT /api/clients/:id`** (`requireAuth`, `blockAccountant`, audit middleware): load original client (404 if missing); for non-admins delete `assignedTherapistId` from the payload; coerce empty-string/null fields to undefined; parse with `insertClientSchema.partial()`; if `status==='inactive' && !stage` set `stage='closed'`; `updateClient`; if status changed write history `file_closed`/`file_reopened`; if stage changed write `stage_change`. Return updated client.
>
> **Endpoint 2 — `POST /api/clients/bulk-update-status`** (`requireAuth`, `blockAccountant`, role ∈ {admin, administrator, supervisor}): validate `clientIds` non-empty array and `status ∈ {active,inactive,pending,discharged}`; for supervisors verify every target client belongs to a supervised therapist (else 403 + `unauthorizedClientIds`); loop `updateClient(id,{status})` in try/catch tallying `{total,successful,failed,errors}`; write one `bulk_update_status` activity log; return the tally.
>
> **Frontend (client detail page):** TanStack `updateClientStatusMutation` → `apiRequest('/api/clients/:id','PUT',{status})`, invalidate `[/api/clients/:id]` and `[/api/clients]`, toast on result. `handleCloseFile`/`handleReopenFile` use `window.confirm` with this exact copy — close: "Are you sure you want to close this client file? The file will become inactive and new sessions/notes cannot be added. All historical data will remain accessible." reopen: "Are you sure you want to reopen this client file? The client will be reactivated and new sessions/notes can be added." When `status==='inactive'`: render a red "This client file is INACTIVE" banner, an INACTIVE badge, and disable scheduling + add/edit-note controls. Show "Close File" for active files; show "Reopen File" only to `admin`/`administrator`.
>
> **Rules & edge cases:** never cascade-cancel future/recurring sessions on close (preserve them); never delete data (deletion is a separate destructive action); history writes are best-effort; reopen does not auto-revert stage; bulk path does not auto-set stage or write per-client closure history (one aggregate log only) — preserve or deliberately close this gap; supervisor bulk requests are all-or-nothing within scope. Validate everything with Zod, keep routes thin, and put DB access behind the storage interface.
