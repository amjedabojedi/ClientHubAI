/**
 * Privacy/compliance test for the AUDIT TRAIL of the per-client SMS LOG CSV
 * EXPORT endpoint.
 *
 *   GET /api/clients/:id/sms-log/export   (auditDataExport('client_sms_log'))
 *
 * Downloading a client's text-message history is a HIPAA-relevant data export,
 * so the route is wrapped in the `auditDataExport` middleware: every download
 * must leave a `data_exported` audit row, attributed to the staff member who
 * pulled the file and scoped to the client whose data left the system. Equally
 * important, that audit row must NOT itself become a PHI leak — it records WHO
 * exported WHAT, never the client's phone number or the rendered SMS body.
 *
 * A sibling suite (test/sms-log-export-privacy.test.ts) proves the CSV *body*
 * never leaks PHI. This suite locks the COMPLIANCE side independently:
 *   1. Seeds sms_notification audit rows whose details deliberately stuff in a
 *      phone number AND a message body (worst case).
 *   2. Calls the export once over HTTP as an authorized staff user.
 *   3. Asserts EXACTLY ONE data_exported audit row is written, attributed to
 *      the downloading user, scoped to the correct client.
 *   4. Asserts that audit row's details contain NO phone-number digits and NO
 *      SMS message-body text — so the act of auditing the export can never
 *      become its own PHI leak.
 *   5. Confirms a download that is BLOCKED by access control (accountant => 403)
 *      writes no data_exported row.
 *
 * A regression that skipped the audit write (download untracked) or that
 * stuffed PHI into the audit details would fail here.
 *
 * Run with: npx tsx test/sms-log-export-audit.test.ts
 * (Run serially, like the other privacy tests — see
 *  .agents/memory/privacy-test-concurrency.md.)
 *
 * NOTES:
 * - Spins up the real Express app (registerRoutes) on an ephemeral port and
 *   makes real HTTP requests, exercising the full middleware + handler chain.
 * - Seeds audit rows directly and removes everything it created at the end.
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

const SUFFIX = `smslogexportaudit-${process.pid}-${Date.now()}`;

// The sensitive values that MUST NOT leak into the export AUDIT row. Both are
// embedded in the seeded sms_notification audit details so the test proves the
// data_exported audit row never picks them up.
const SECRET_PHONE = "+15195550133";
const SECRET_BODY =
  "SmartHub: Your appointment is confirmed for Mon, Aug 3 at 11:00 AM. Reply STOP to opt out.";

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
// the phone number and the message body, mirroring the worst case the export
// audit row must NOT pick up.
async function seedSmsAudit(
  clientId: number,
  action:
    | "sms_notification_sent"
    | "sms_notification_blocked"
    | "sms_notification_failed",
  result: "success" | "blocked" | "failure",
  eventType: string,
  extra: Record<string, unknown>,
  timestamp: Date,
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
    timestamp,
    details: JSON.stringify({
      eventType,
      phone: SECRET_PHONE,
      body: SECRET_BODY,
      to: SECRET_PHONE,
      message: SECRET_BODY,
      ...extra,
    }),
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
  const raw = await res.text();
  return { status: res.status, raw };
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
    // The client_viewed / data_exported audit rows written by the endpoint.
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
  console.log("\n🧪 Client SMS-Log CSV Export Audit-Trail Compliance Tests\n");

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

    // --- Seed users + client ----------------------------------------------
    const therapist = await makeUser("therapist", "smslogexportaudit-therapist");
    const accountant = await makeUser("accountant", "smslogexportaudit-accountant");
    const client = await makeClient("smslogexportaudit-client");

    const therapistToken = createSessionToken(therapist);
    const accountantToken = createSessionToken(accountant);

    // --- Seed SMS outcomes for the client, each carrying PHI in details ----
    await seedSmsAudit(
      client.id,
      "sms_notification_sent",
      "success",
      "session_scheduled",
      { messageSid: "SM_audit_sent" },
      new Date("2026-01-12T15:00:00.000Z"),
    );
    await seedSmsAudit(
      client.id,
      "sms_notification_blocked",
      "blocked",
      "session_rescheduled",
      { reason: "no SMS consent" },
      new Date("2026-02-18T09:30:00.000Z"),
    );
    await seedSmsAudit(
      client.id,
      "sms_notification_failed",
      "failure",
      "session_reminder",
      { error: "Twilio 21610: number is unsubscribed" },
      new Date("2026-03-22T18:45:00.000Z"),
    );

    const exportPath = `/api/clients/${client.id}/sms-log/export`;

    // Helper: fetch all data_exported audit rows for this client.
    const getExportAudits = () =>
      db
        .select({
          id: auditLogs.id,
          userId: auditLogs.userId,
          username: auditLogs.username,
          clientId: auditLogs.clientId,
          action: auditLogs.action,
          result: auditLogs.result,
          resourceType: auditLogs.resourceType,
          hipaaRelevant: auditLogs.hipaaRelevant,
          riskLevel: auditLogs.riskLevel,
          details: auditLogs.details,
        })
        .from(auditLogs)
        .where(and(eq(auditLogs.action, "data_exported"), eq(auditLogs.clientId, client.id)));

    // =====================================================================
    // 1. A blocked download writes NO export audit row
    // =====================================================================
    console.log("Test 1: A blocked (403) download is not recorded as an export");
    assertEqual((await req("GET", exportPath, accountantToken)).status, 403, "Accountant is blocked from exporting the SMS log (403)");
    assertEqual((await getExportAudits()).length, 0, "No data_exported audit row is written for a blocked download");

    // =====================================================================
    // 2. A successful download writes EXACTLY ONE export audit row
    // =====================================================================
    console.log("\nTest 2: A successful download writes exactly one export audit row");
    const exportRes = await req("GET", exportPath, therapistToken);
    assertEqual(exportRes.status, 200, "Therapist can export the SMS log (200)");

    const audits = await getExportAudits();
    assertEqual(audits.length, 1, "Exactly one data_exported audit row is written for the download");

    const audit = audits[0];

    // =====================================================================
    // 3. The audit row is attributed correctly
    // =====================================================================
    console.log("\nTest 3: The export audit row is attributed to the downloading staff user");
    // A serial PK can come back as a string while an integer FK col comes back
    // as a number — coerce both before comparing.
    assertEqual(Number(audit?.userId), Number(therapist.id), "Export audit row records the downloading user's id");
    assert(typeof audit?.username === "string" && audit!.username!.includes(SUFFIX), "Export audit row records the downloading user's username");
    assertEqual(Number(audit?.clientId), Number(client.id), "Export audit row is scoped to the exported client");
    assertEqual(audit?.action, "data_exported", "Export audit row action is data_exported");
    assertEqual(audit?.result, "success", "Export audit row records a successful export");
    assert(audit?.hipaaRelevant === true, "Export audit row is flagged HIPAA-relevant");

    // =====================================================================
    // 4. The audit row carries NO PHI
    // =====================================================================
    console.log("\nTest 4: The export audit row itself never stores PHI");
    const detailsBlob = audit?.details || "";
    const wholeRowBlob = JSON.stringify(audit);
    assert(!detailsBlob.includes(SECRET_PHONE), "Audit details do NOT contain the client's phone number");
    assert(!detailsBlob.includes("5195550133"), "Audit details do NOT contain the bare phone digits");
    assert(!/\+?1?5195550133/.test(detailsBlob), "Audit details contain no phone-number digit sequence");
    assert(!detailsBlob.includes(SECRET_BODY), "Audit details do NOT contain the SMS message body");
    assert(!detailsBlob.includes("Reply STOP"), "Audit details contain no rendered SMS body text");
    assert(!/appointment is confirmed/i.test(detailsBlob), "Audit details contain no message-body fragments");
    // Defense in depth: the whole row (any column) must not echo PHI either.
    assert(!wholeRowBlob.includes(SECRET_PHONE) && !wholeRowBlob.includes("Reply STOP"), "No column of the export audit row carries PHI");
  } finally {
    if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
    await cleanup().catch((e) => console.error("cleanup error:", e));
  }
}

run()
  .then(() => {
    console.log(`\nClient SMS-log export audit tests: ${testsPassed} passed, ${testsFailed} failed`);
    process.exit(testsFailed > 0 ? 1 : 0);
  })
  .catch(async (err) => {
    console.error("Fatal error in SMS-log export audit test:", err);
    await cleanup().catch(() => {});
    process.exit(1);
  });
