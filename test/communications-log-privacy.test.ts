/**
 * Privacy/regression test for the per-client COMMUNICATIONS LOG endpoint.
 *
 *   GET /api/clients/:clientId/communications
 *
 * This endpoint surfaces a client's notification / communication history to
 * staff (the "Email History" tab on the client record). Each entry is a row in
 * the `notifications` table. Those rows carry a free-form `data` JSON payload
 * that can hold private detail — the client's email address, transmission ids,
 * internal ids, and potentially a rendered message body — none of which the UI
 * uses. The endpoint must expose ONLY the safe display fields (id, type, title,
 * message, priority, isRead, createdAt, relatedEntityType, relatedEntityId) and
 * must NEVER hand back the raw `data` payload or any other internal column, no
 * matter what is stored on the row.
 *
 * This suite locks that guarantee in:
 *   1. Seeds notifications rows for a client. Each seeded row deliberately
 *      stuffs a secret PHI marker into the `data` JSON (and into the dropped
 *      internal columns) so we can prove the endpoint strips them.
 *   2. Calls the real endpoint over HTTP and asserts every entry carries the
 *      safe display fields, exposes NONE of the internal columns, and that the
 *      secret `data` payload never appears anywhere in the serialized response.
 *   3. Access control:
 *        - unauthenticated  => 401
 *        - accountant       => 403 (blocked from client data entirely)
 *        - therapist/admin  => 200
 *      and an unrelated client's rows are never returned (client-scoped).
 *
 * Run with: npx tsx test/communications-log-privacy.test.ts
 * (Run serially, like the other privacy tests — see
 *  .agents/memory/privacy-test-concurrency.md.)
 *
 * NOTES:
 * - Spins up the real Express app (registerRoutes) on an ephemeral port and
 *   makes real HTTP requests, exercising the full middleware + handler chain.
 * - Seeds notifications rows directly and removes everything it created at the
 *   end.
 */

import express from "express";
import cookieParser from "cookie-parser";
import type { Server } from "http";
import { eq, inArray } from "drizzle-orm";

import { db } from "../server/db";
import { users, clients, notifications, auditLogs } from "../shared/schema";
import { storage } from "../server/storage";
import { registerRoutes } from "../server/routes";
import { createSessionToken } from "../server/auth-middleware";

// ---------------------------------------------------------------------------
// Test utilities
// ---------------------------------------------------------------------------
let testsPassed = 0;
let testsFailed = 0;

function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`✅ PASS: ${message}`);
    testsPassed++;
  } else {
    console.error(`❌ FAIL: ${message}`);
    testsFailed++;
  }
}

function assertEqual(actual: any, expected: any, message: string) {
  if (actual === expected) {
    console.log(`✅ PASS: ${message}`);
    testsPassed++;
  } else {
    console.error(`❌ FAIL: ${message}`);
    console.error(`   Expected: ${JSON.stringify(expected)}`);
    console.error(`   Actual:   ${JSON.stringify(actual)}`);
    testsFailed++;
  }
}

const SUFFIX = `commlog-${process.pid}-${Date.now()}`;

// Secret markers that MUST NOT leak through the endpoint. They are embedded in
// the seeded notification's `data` JSON (and dropped internal columns) so the
// test proves they are stripped.
const SECRET_EMAIL = "secret-patient@private.example";
const SECRET_BODY =
  "RAW-EMAIL-BODY-DO-NOT-LEAK: full clinical message text for the patient.";
const SECRET_TRANSMISSION = "TX_secret_transmission_id_9999";
const SECRET_ACTION_URL = "/internal/secret-action-url-do-not-leak";
// A secret belonging to an UNRELATED client — must never appear when we query a
// different client's log (client-scoping).
const OTHER_SECRET = "OTHER-CLIENT-SECRET-DO-NOT-LEAK";

const createdUserIds: number[] = [];
const createdClientIds: number[] = [];
const createdNotificationIds: number[] = [];

// ---------------------------------------------------------------------------
// Seed helpers
// ---------------------------------------------------------------------------
async function makeUser(role: string, label: string) {
  const user = await storage.createUser({
    username: `${label}-${SUFFIX}`,
    password: "x",
    fullName: `${label} ${SUFFIX}`,
    email: `${label}-${SUFFIX}@example.test`,
    role,
  } as any);
  createdUserIds.push(user.id);
  return user;
}

async function makeClient(label: string) {
  const client = await storage.createClient({
    fullName: `${label} ${SUFFIX}`,
  } as any);
  createdClientIds.push(client.id);
  return client;
}

// Insert a client-scoped notification whose `data` JSON (and dropped internal
// columns) deliberately carry secret PHI, mirroring the worst case the endpoint
// must protect against.
async function seedNotification(
  ownerUserId: number,
  clientId: number,
  type: string,
  title: string,
  message: string,
  secret: string,
) {
  const [row] = await db
    .insert(notifications)
    .values({
      userId: ownerUserId,
      type,
      title,
      message,
      // The raw payload is the leak we are guarding against — the endpoint must
      // never echo it back.
      data: JSON.stringify({
        clientEmail: secret === OTHER_SECRET ? OTHER_SECRET : SECRET_EMAIL,
        rawBody: secret,
        transmissionId: SECRET_TRANSMISSION,
      }),
      priority: "medium",
      // Another internal column that should never be surfaced.
      actionUrl: SECRET_ACTION_URL,
      relatedEntityType: "client" as any,
      relatedEntityId: clientId,
    } as any)
    .returning();
  createdNotificationIds.push(row.id);
  return row;
}

// ---------------------------------------------------------------------------
// Request helpers
// ---------------------------------------------------------------------------
let baseUrl = "";

function authHeaders(token: string | null) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token) headers["Cookie"] = `sessionToken=${token}`;
  return headers;
}

async function req(method: string, path: string, token: string | null) {
  const res = await fetch(`${baseUrl}${path}`, { method, headers: authHeaders(token) });
  const ct = res.headers.get("content-type") || "";
  let parsed: any = null;
  let raw = "";
  try {
    raw = await res.text();
    parsed = ct.includes("application/json") && raw ? JSON.parse(raw) : raw;
  } catch {
    parsed = raw;
  }
  return { status: res.status, body: parsed, raw };
}

async function cleanup() {
  if (createdNotificationIds.length > 0) {
    await db.delete(notifications).where(inArray(notifications.id, createdNotificationIds));
  }
  if (createdClientIds.length > 0) {
    // The client_viewed audit rows written by the endpoint's own middleware.
    await db.delete(auditLogs).where(inArray(auditLogs.clientId, createdClientIds));
    await db.delete(clients).where(inArray(clients.id, createdClientIds));
  }
  if (createdUserIds.length > 0) {
    await db.delete(auditLogs).where(inArray(auditLogs.userId, createdUserIds));
    // Deleting the owning user cascades any of its notifications too.
    await db.delete(users).where(inArray(users.id, createdUserIds));
  }
}

// The safe display fields the endpoint is allowed to return.
const ALLOWED_FIELDS = [
  "id",
  "type",
  "title",
  "message",
  "priority",
  "isRead",
  "createdAt",
  "relatedEntityType",
  "relatedEntityId",
];
// Internal columns that must never be surfaced.
const FORBIDDEN_FIELDS = [
  "data",
  "userId",
  "actionUrl",
  "actionLabel",
  "groupingKey",
  "expiresAt",
  "readAt",
];

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function run() {
  console.log("\n🧪 Client Communications-Log Privacy & Access-Control Tests\n");

  let server: Server | null = null;
  try {
    const app = express();
    app.use(express.json({ limit: "10mb" }));
    app.use(express.urlencoded({ extended: false }));
    app.use(cookieParser());
    server = await registerRoutes(app);
    await new Promise<void>((resolve) => server!.listen(0, resolve));
    const addr = server.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    baseUrl = `http://127.0.0.1:${port}`;
    console.log(`   Test server listening on ${baseUrl}\n`);

    // --- Seed users + clients ---------------------------------------------
    const therapist = await makeUser("therapist", "commlog-therapist");
    const admin = await makeUser("admin", "commlog-admin");
    const accountant = await makeUser("accountant", "commlog-accountant");

    const client = await makeClient("commlog-client");
    const otherClient = await makeClient("commlog-other");

    const therapistToken = createSessionToken(therapist);
    const adminToken = createSessionToken(admin);
    const accountantToken = createSessionToken(accountant);

    // --- Seed communications for the target client ------------------------
    await seedNotification(
      admin.id,
      client.id,
      "invoice_sent",
      `Invoice Sent - INV-${SUFFIX}`,
      "Invoice sent to the client with PDF attachment.",
      SECRET_BODY,
    );
    await seedNotification(
      admin.id,
      client.id,
      "session_scheduled",
      `Session Scheduled - ${SUFFIX}`,
      "A new session has been scheduled.",
      SECRET_BODY,
    );
    // An UNRELATED client's row — must never surface in the target's log.
    await seedNotification(
      admin.id,
      otherClient.id,
      "invoice_sent",
      `Other Invoice - ${SUFFIX}`,
      "Invoice sent for a different client.",
      OTHER_SECRET,
    );

    const path = `/api/clients/${client.id}/communications`;

    // =====================================================================
    // 1. Access control
    // =====================================================================
    console.log("Test 1: Access control");
    {
      assertEqual((await req("GET", path, null)).status, 401, "Unauthenticated cannot view communications (401)");
      assertEqual((await req("GET", path, accountantToken)).status, 403, "Accountant is blocked from communications (403)");
      assertEqual((await req("GET", path, therapistToken)).status, 200, "Therapist can view communications (200)");
      assertEqual((await req("GET", path, adminToken)).status, 200, "Admin can view communications (200)");
    }

    // =====================================================================
    // 2. Returns only the safe display fields
    // =====================================================================
    console.log("\nTest 2: Returns safe display fields only");
    const r = await req("GET", path, therapistToken);
    const entries = Array.isArray(r.body) ? r.body : [];
    assertEqual(entries.length, 2, "Exactly the 2 seeded rows for this client are returned");

    for (const e of entries) {
      assert(e.id != null && Number.isFinite(Number(e.id)), "Entry has an id");
      assert(typeof e.type === "string" && e.type.length > 0, "Entry has a type");
      assert(typeof e.title === "string" && e.title.length > 0, "Entry has a title");
      assert(typeof e.message === "string", "Entry has a message");
      assert("createdAt" in e, "Entry has a timestamp");
      // No internal columns leak through.
      for (const forbidden of FORBIDDEN_FIELDS) {
        assert(!(forbidden in e), `Entry does NOT expose internal field "${forbidden}"`);
      }
      // Only allowed keys are present.
      for (const key of Object.keys(e)) {
        assert(ALLOWED_FIELDS.includes(key), `Entry key "${key}" is an allowed safe field`);
      }
    }

    // =====================================================================
    // 3. NEVER leaks the raw data payload / PHI
    // =====================================================================
    console.log("\nTest 3: No raw data payload or PHI leaks");
    const serialized = JSON.stringify(r.body);
    assert(!serialized.includes(SECRET_EMAIL), "Response does NOT contain the client's private email");
    assert(!serialized.includes(SECRET_BODY), "Response does NOT contain the raw message body payload");
    assert(!serialized.includes(SECRET_TRANSMISSION), "Response does NOT contain the internal transmission id");
    assert(!serialized.includes(SECRET_ACTION_URL), "Response does NOT contain the internal actionUrl");
    // Defense in depth: the raw payload key itself is never echoed.
    assert(!serialized.includes('"data"'), 'Response does NOT echo the raw "data" key');
    assert(!serialized.includes("rawBody"), "Response does NOT echo any raw payload contents");

    // =====================================================================
    // 4. Client-scoped: an unrelated client's rows never appear
    // =====================================================================
    console.log("\nTest 4: Unrelated client's data is never returned");
    assert(!serialized.includes(OTHER_SECRET), "Target client's log excludes the unrelated client's secret");
    assert(!serialized.includes("Other Invoice"), "Target client's log excludes the unrelated client's row");

    const otherRes = await req("GET", `/api/clients/${otherClient.id}/communications`, therapistToken);
    const otherEntries = Array.isArray(otherRes.body) ? otherRes.body : [];
    assertEqual(otherEntries.length, 1, "Unrelated client's log returns only its own single row");
    assert(!JSON.stringify(otherRes.body).includes(OTHER_SECRET), "Unrelated client's log also strips its raw payload");
  } finally {
    if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
    await cleanup().catch((e) => console.error("cleanup error:", e));
  }
}

run()
  .then(() => {
    console.log(`\nClient communications-log privacy tests: ${testsPassed} passed, ${testsFailed} failed`);
    process.exit(testsFailed > 0 ? 1 : 0);
  })
  .catch(async (err) => {
    console.error("Fatal error in communications-log privacy test:", err);
    await cleanup().catch(() => {});
    process.exit(1);
  });
