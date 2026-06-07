/**
 * Privacy/regression test for the per-client SMS LOG endpoint.
 *
 *   GET /api/clients/:id/sms-log
 *
 * This endpoint surfaces a client's text-message history to staff. SMS attempts
 * are PHI-sensitive: the audit row that backs each entry can carry the client's
 * phone number and the rendered message body in its `details` JSON. The
 * endpoint must expose ONLY the safe outcome of each attempt — the action
 * (sent/blocked/failed), the result, the event type, a human-readable reason,
 * and the timestamp — and must NEVER hand back the phone number or the message
 * body, no matter what is stored in the audit details.
 *
 * This suite locks that guarantee in:
 *   1. Seeds audit_logs rows (resourceType='sms_notification') for the SENT,
 *      BLOCKED and FAILED outcomes. Each seeded row deliberately stuffs a phone
 *      number AND a message body into the details JSON (worst case / defense in
 *      depth) so we can prove the endpoint strips them.
 *   2. Calls the real endpoint over HTTP and asserts every entry carries
 *      action/result/eventType/reason/timestamp, and that NO phone number or
 *      message body appears anywhere in the serialized response.
 *   3. Access control:
 *        - unauthenticated  => 401
 *        - accountant       => 403 (blocked from client data entirely)
 *        - therapist/admin  => 200
 *        - an unrelated client's SMS rows are never returned (client-scoped).
 *
 * Run with: npx tsx test/sms-log-privacy.test.ts
 * (Run serially, like the other privacy tests — see
 *  .agents/memory/privacy-test-concurrency.md.)
 *
 * NOTES:
 * - Spins up the real Express app (registerRoutes) on an ephemeral port and
 *   makes real HTTP requests, exercising the full middleware + handler chain.
 * - Seeds audit rows directly (the action/result values already exist in the
 *   audit enums because the live notification service writes them) and removes
 *   everything it created at the end.
 */

import express from "express";
import cookieParser from "cookie-parser";
import type { Server } from "http";
import { and, eq, inArray } from "drizzle-orm";

import { db } from "../server/db";
import { users, clients, auditLogs } from "../shared/schema";
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

const SUFFIX = `smslog-${process.pid}-${Date.now()}`;

// The sensitive values that MUST NOT leak through the endpoint. Both are
// embedded in the seeded audit details so the test proves they are stripped.
const SECRET_PHONE = "+15195550199";
const SECRET_BODY =
  "SmartHub: Your appointment is confirmed for Wed, Jul 1 at 3:00 PM. Reply STOP to opt out.";
// A phone/body belonging to an UNRELATED client — must never appear when we
// query a different client's log (client-scoping).
const OTHER_PHONE = "+15195550288";
const OTHER_BODY = "SmartHub reminder for a different client. Reply STOP to opt out.";

const createdUserIds: number[] = [];
const createdClientIds: number[] = [];

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
    phone: SECRET_PHONE,
  } as any);
  createdClientIds.push(client.id);
  return client;
}

// Insert an sms_notification audit row whose details deliberately also contain
// the phone number and the message body, mirroring the worst case the endpoint
// must protect against.
async function seedSmsAudit(
  clientId: number,
  action:
    | "sms_notification_sent"
    | "sms_notification_blocked"
    | "sms_notification_failed",
  result: "success" | "blocked" | "failure",
  eventType: string,
  extra: Record<string, unknown>,
  phone: string,
  body: string,
) {
  await db.insert(auditLogs).values({
    userId: null,
    username: "system",
    action,
    result,
    resourceType: "sms_notification",
    resourceId: String(clientId),
    clientId,
    ipAddress: "system",
    userAgent: "notification-service",
    hipaaRelevant: true,
    riskLevel: "medium",
    // These two PHI fields are the leak we are guarding against — the endpoint
    // must never echo them back.
    details: JSON.stringify({ eventType, phone, body, to: phone, message: body, ...extra }),
    accessReason: "Appointment SMS notification (consent-gated)",
  } as any);
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
  if (createdClientIds.length > 0) {
    await db
      .delete(auditLogs)
      .where(
        and(
          eq(auditLogs.resourceType, "sms_notification"),
          inArray(
            auditLogs.resourceId,
            createdClientIds.map((id) => String(id)),
          ),
        ),
      );
    // The client_viewed audit rows written by the endpoint's own middleware.
    await db.delete(auditLogs).where(inArray(auditLogs.clientId, createdClientIds));
    await db.delete(clients).where(inArray(clients.id, createdClientIds));
  }
  if (createdUserIds.length > 0) {
    await db.delete(auditLogs).where(inArray(auditLogs.userId, createdUserIds));
    await db.delete(users).where(inArray(users.id, createdUserIds));
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function run() {
  console.log("\n🧪 Client SMS-Log Privacy & Access-Control Tests\n");

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
    const therapist = await makeUser("therapist", "smslog-therapist");
    const admin = await makeUser("admin", "smslog-admin");
    const accountant = await makeUser("accountant", "smslog-accountant");

    const client = await makeClient("smslog-client");
    const otherClient = await makeClient("smslog-other");

    const therapistToken = createSessionToken(therapist);
    const adminToken = createSessionToken(admin);
    const accountantToken = createSessionToken(accountant);

    // --- Seed the three SMS outcomes for the target client ----------------
    await seedSmsAudit(
      client.id,
      "sms_notification_sent",
      "success",
      "session_scheduled",
      { messageSid: "SM_test_sent" },
      SECRET_PHONE,
      SECRET_BODY,
    );
    await seedSmsAudit(
      client.id,
      "sms_notification_blocked",
      "blocked",
      "session_rescheduled",
      { reason: "no SMS consent", hasPhone: true },
      SECRET_PHONE,
      SECRET_BODY,
    );
    await seedSmsAudit(
      client.id,
      "sms_notification_failed",
      "failure",
      "session_reminder",
      { error: "Twilio 21610: number is unsubscribed" },
      SECRET_PHONE,
      SECRET_BODY,
    );
    // An UNRELATED client's row — must never surface in the target's log.
    await seedSmsAudit(
      otherClient.id,
      "sms_notification_sent",
      "success",
      "session_scheduled",
      { messageSid: "SM_other" },
      OTHER_PHONE,
      OTHER_BODY,
    );

    const path = `/api/clients/${client.id}/sms-log`;

    // =====================================================================
    // 1. Access control
    // =====================================================================
    console.log("Test 1: Access control");
    {
      assertEqual((await req("GET", path, null)).status, 401, "Unauthenticated cannot view SMS log (401)");
      assertEqual((await req("GET", path, accountantToken)).status, 403, "Accountant is blocked from the SMS log (403)");
      assertEqual((await req("GET", path, therapistToken)).status, 200, "Therapist can view the SMS log (200)");
      assertEqual((await req("GET", path, adminToken)).status, 200, "Admin can view the SMS log (200)");
    }

    // =====================================================================
    // 2. Returns the safe outcome fields, in newest-first order
    // =====================================================================
    console.log("\nTest 2: Returns safe outcome fields only");
    const r = await req("GET", path, therapistToken);
    const entries = Array.isArray(r.body) ? r.body : [];
    assertEqual(entries.length, 3, "Exactly the 3 seeded rows for this client are returned");

    const byAction: Record<string, any> = {};
    for (const e of entries) byAction[e.action] = e;

    for (const action of [
      "sms_notification_sent",
      "sms_notification_blocked",
      "sms_notification_failed",
    ]) {
      const e = byAction[action];
      assert(!!e, `Entry present for ${action}`);
      if (!e) continue;
      assert(typeof e.result === "string" && e.result.length > 0, `${action}: has a result outcome`);
      assert(typeof e.eventType === "string" && e.eventType.length > 0, `${action}: has an eventType`);
      assert(!!e.timestamp, `${action}: has a timestamp`);
    }
    // Reason is surfaced for the blocked/failed outcomes.
    assert(/consent/i.test(byAction["sms_notification_blocked"]?.reason || ""), "Blocked entry surfaces its reason");
    assert(/twilio|unsubscribed/i.test(byAction["sms_notification_failed"]?.reason || ""), "Failed entry surfaces its error as the reason");

    // =====================================================================
    // 3. NEVER leaks the phone number or the message body
    // =====================================================================
    console.log("\nTest 3: No phone number or message body leaks");
    const serialized = JSON.stringify(r.body);
    assert(!serialized.includes(SECRET_PHONE), "Response does NOT contain the client's phone number");
    assert(!serialized.includes("5195550199"), "Response does NOT contain the bare phone digits");
    assert(!serialized.includes(SECRET_BODY), "Response does NOT contain the SMS message body");
    assert(!serialized.includes("Reply STOP"), "Response does NOT contain any rendered SMS body text");
    // Defense in depth: none of the raw detail keys that carried PHI are echoed.
    for (const leakedKey of ["phone", "body", '"to"', "message"]) {
      assert(!serialized.includes(leakedKey), `Response does NOT echo the raw detail key ${leakedKey}`);
    }

    // =====================================================================
    // 4. Client-scoped: an unrelated client's rows never appear
    // =====================================================================
    console.log("\nTest 4: Unrelated client's data is never returned");
    assert(!serialized.includes("SM_other"), "Target client's log excludes the unrelated client's row");
    assert(!serialized.includes(OTHER_PHONE), "Target client's log excludes the unrelated client's phone");

    const otherRes = await req("GET", `/api/clients/${otherClient.id}/sms-log`, therapistToken);
    const otherEntries = Array.isArray(otherRes.body) ? otherRes.body : [];
    assertEqual(otherEntries.length, 1, "Unrelated client's log returns only its own single row");
    assert(!JSON.stringify(otherRes.body).includes(OTHER_PHONE), "Unrelated client's log also strips its phone number");
  } finally {
    if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
    await cleanup().catch((e) => console.error("cleanup error:", e));
  }
}

run()
  .then(() => {
    console.log(`\nClient SMS-log privacy tests: ${testsPassed} passed, ${testsFailed} failed`);
    process.exit(testsFailed > 0 ? 1 : 0);
  })
  .catch(async (err) => {
    console.error("Fatal error in SMS-log privacy test:", err);
    await cleanup().catch(() => {});
    process.exit(1);
  });
