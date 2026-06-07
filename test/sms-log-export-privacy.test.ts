/**
 * Privacy/regression test for the per-client SMS LOG CSV EXPORT endpoint.
 *
 *   GET /api/clients/:id/sms-log/export
 *
 * Staff can download a client's text-message history as a CSV. SMS attempts are
 * PHI-sensitive: the audit row that backs each entry can carry the client's
 * phone number and the rendered message body in its `details` JSON. The export
 * must contain ONLY the four non-PHI columns — Outcome, Event Type, Timestamp,
 * Reason — and must NEVER write the phone number or the message body into the
 * file, no matter what is stored in the audit details. It must also honor the
 * active outcome/date-range filters, and the act of exporting must itself be
 * audited (a `data_exported` row attributed to the client).
 *
 * This suite locks those guarantees in:
 *   1. Seeds audit_logs rows (resourceType='sms_notification') for the SENT,
 *      BLOCKED and FAILED outcomes across distinct dates. Each seeded row
 *      deliberately stuffs a phone number AND a message body into the details
 *      JSON (worst case / defense in depth) so we can prove the export strips
 *      them.
 *   2. Hits the real endpoint over HTTP and asserts:
 *        - the CSV header is EXACTLY: Outcome, Event Type, Timestamp, Reason
 *        - NO phone number or message-body substring appears anywhere
 *        - the outcome filter (?outcome=sent|blocked|failed) narrows the rows
 *        - the date-range filter (?startDate/?endDate) narrows the rows
 *        - a `data_exported` audit row is written, attributed to the client
 *        - an unrelated client's SMS rows are never exported (client-scoped)
 *   3. Access control: unauthenticated => 401, accountant => 403.
 *
 * Run with: npx tsx test/sms-log-export-privacy.test.ts
 * (Run serially, like the other privacy tests — see
 *  .agents/memory/privacy-test-concurrency.md.)
 */

import express from "express";
import cookieParser from "cookie-parser";
import type { Server } from "http";
import { and, desc, eq, inArray } from "drizzle-orm";

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

const SUFFIX = `smslogexport-${process.pid}-${Date.now()}`;

// The sensitive values that MUST NOT leak through the export. Both are embedded
// in the seeded audit details so the test proves they are stripped.
const SECRET_PHONE = "+15195550199";
const SECRET_BODY =
  "SmartHub: Your appointment is confirmed for Wed, Jul 1 at 3:00 PM. Reply STOP to opt out.";
// A phone/body belonging to an UNRELATED client — must never appear when we
// export a different client's log (client-scoping).
const OTHER_PHONE = "+15195550288";
const OTHER_BODY = "SmartHub reminder for a different client. Reply STOP to opt out.";

// Distinct, fixed timestamps so the date-range filter is testable.
const TS_SENT = new Date("2026-01-10T15:00:00.000Z");
const TS_BLOCKED = new Date("2026-02-15T09:30:00.000Z");
const TS_FAILED = new Date("2026-03-20T18:45:00.000Z");

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
    // These two PHI fields are the leak we are guarding against — the export
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
  const raw = await res.text();
  return { status: res.status, contentType: ct, raw };
}

// Minimal RFC-4180 CSV parser: handles quoted cells, embedded quotes/commas,
// and \r\n line endings. Good enough to verify the export's structure.
function parseCsv(text: string): string[][] {
  // Strip a leading UTF-8 BOM if present.
  const input = text.replace(/^\uFEFF/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (inQuotes) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\r") {
      // swallow; \n handles the row break
    } else if (ch === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += ch;
    }
  }
  // Trailing cell/row if the file did not end on a newline.
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
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
  console.log("\n🧪 Client SMS-Log CSV Export Privacy & Filter Tests\n");

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
    const therapist = await makeUser("therapist", "smslogexport-therapist");
    const accountant = await makeUser("accountant", "smslogexport-accountant");

    const client = await makeClient("smslogexport-client");
    const otherClient = await makeClient("smslogexport-other");

    const therapistToken = createSessionToken(therapist);
    const accountantToken = createSessionToken(accountant);

    // --- Seed the three SMS outcomes for the target client, across dates ---
    await seedSmsAudit(
      client.id,
      "sms_notification_sent",
      "success",
      "session_scheduled",
      { messageSid: "SM_test_sent" },
      SECRET_PHONE,
      SECRET_BODY,
      TS_SENT,
    );
    await seedSmsAudit(
      client.id,
      "sms_notification_blocked",
      "blocked",
      "session_rescheduled",
      { reason: "no SMS consent", hasPhone: true },
      SECRET_PHONE,
      SECRET_BODY,
      TS_BLOCKED,
    );
    await seedSmsAudit(
      client.id,
      "sms_notification_failed",
      "failure",
      "session_reminder",
      { error: "Twilio 21610: number is unsubscribed" },
      SECRET_PHONE,
      SECRET_BODY,
      TS_FAILED,
    );
    // An UNRELATED client's row — must never surface in the target's export.
    await seedSmsAudit(
      otherClient.id,
      "sms_notification_sent",
      "success",
      "session_scheduled",
      { messageSid: "SM_other" },
      OTHER_PHONE,
      OTHER_BODY,
      TS_SENT,
    );

    const exportPath = `/api/clients/${client.id}/sms-log/export`;

    // =====================================================================
    // 1. Access control
    // =====================================================================
    console.log("Test 1: Access control");
    assertEqual((await req("GET", exportPath, null)).status, 401, "Unauthenticated cannot export the SMS log (401)");
    assertEqual((await req("GET", exportPath, accountantToken)).status, 403, "Accountant is blocked from exporting the SMS log (403)");

    // =====================================================================
    // 2. CSV structure: exactly the four non-PHI columns
    // =====================================================================
    console.log("\nTest 2: CSV header is exactly the four non-PHI columns");
    const full = await req("GET", exportPath, therapistToken);
    assertEqual(full.status, 200, "Therapist can export the SMS log (200)");
    assert(full.contentType.includes("text/csv"), "Response is served as text/csv");

    const rows = parseCsv(full.raw);
    const header = rows[0] || [];
    assertEqual(
      JSON.stringify(header),
      JSON.stringify(["Outcome", "Event Type", "Timestamp", "Reason"]),
      "CSV columns are exactly Outcome, Event Type, Timestamp, Reason",
    );
    assertEqual(header.length, 4, "Exactly four columns — no extra (PHI) columns");

    const dataRows = rows.slice(1);
    assertEqual(dataRows.length, 3, "All 3 seeded outcomes for this client are exported");

    const outcomes = dataRows.map((r) => r[0]).sort();
    assertEqual(
      JSON.stringify(outcomes),
      JSON.stringify(["Blocked", "Failed", "Sent"]),
      "Outcome column carries the human-readable outcomes (Sent/Blocked/Failed)",
    );

    // Reason column surfaces the safe block/error reason — not the body.
    const reasons = dataRows.map((r) => r[3]).join(" | ");
    assert(/consent/i.test(reasons), "Reason column surfaces the blocked reason");
    assert(/twilio|unsubscribed/i.test(reasons), "Reason column surfaces the failure error");

    // =====================================================================
    // 3. NEVER leaks the phone number or the message body
    // =====================================================================
    console.log("\nTest 3: No phone number or message body leaks into the CSV");
    assert(!full.raw.includes(SECRET_PHONE), "CSV does NOT contain the client's phone number");
    assert(!full.raw.includes("5195550199"), "CSV does NOT contain the bare phone digits");
    assert(!full.raw.includes(SECRET_BODY), "CSV does NOT contain the SMS message body");
    assert(!full.raw.includes("Reply STOP"), "CSV does NOT contain any rendered SMS body text");

    // =====================================================================
    // 4. Client-scoped: an unrelated client's rows never appear
    // =====================================================================
    console.log("\nTest 4: Unrelated client's data is never exported");
    assert(!full.raw.includes("SM_other"), "Target client's export excludes the unrelated client's row");
    assert(!full.raw.includes(OTHER_PHONE), "Target client's export excludes the unrelated client's phone");

    // =====================================================================
    // 5. Outcome filter narrows the exported rows
    // =====================================================================
    console.log("\nTest 5: Outcome filter narrows the exported rows");
    const sentOnly = parseCsv((await req("GET", `${exportPath}?outcome=sent`, therapistToken)).raw).slice(1);
    assertEqual(sentOnly.length, 1, "outcome=sent exports exactly one row");
    assertEqual(sentOnly[0]?.[0], "Sent", "outcome=sent exports only the Sent row");

    const blockedOnly = parseCsv((await req("GET", `${exportPath}?outcome=blocked`, therapistToken)).raw).slice(1);
    assertEqual(blockedOnly.length, 1, "outcome=blocked exports exactly one row");
    assertEqual(blockedOnly[0]?.[0], "Blocked", "outcome=blocked exports only the Blocked row");

    const failedOnly = parseCsv((await req("GET", `${exportPath}?outcome=failed`, therapistToken)).raw).slice(1);
    assertEqual(failedOnly.length, 1, "outcome=failed exports exactly one row");
    assertEqual(failedOnly[0]?.[0], "Failed", "outcome=failed exports only the Failed row");

    const invalidOutcome = await req("GET", `${exportPath}?outcome=bogus`, therapistToken);
    assertEqual(invalidOutcome.status, 400, "An invalid outcome filter is rejected (400)");

    // =====================================================================
    // 6. Date-range filter narrows the exported rows
    // =====================================================================
    console.log("\nTest 6: Date-range filter narrows the exported rows");
    // Window covering only the BLOCKED row (Feb 2026).
    const febRows = parseCsv(
      (await req("GET", `${exportPath}?startDate=2026-02-01&endDate=2026-02-28`, therapistToken)).raw,
    ).slice(1);
    assertEqual(febRows.length, 1, "A Feb-only window exports exactly the one Feb row");
    assertEqual(febRows[0]?.[0], "Blocked", "The Feb window exports the Blocked (Feb) row");

    // Window covering the first two rows (Jan + Feb), excluding the Mar row.
    const janFebRows = parseCsv(
      (await req("GET", `${exportPath}?startDate=2026-01-01&endDate=2026-02-28`, therapistToken)).raw,
    ).slice(1);
    assertEqual(janFebRows.length, 2, "A Jan–Feb window excludes the March row");
    assert(
      !janFebRows.some((r) => r[0] === "Failed"),
      "The Jan–Feb window does not include the March (Failed) row",
    );

    // startDate after every row => empty (header only).
    const emptyRows = parseCsv(
      (await req("GET", `${exportPath}?startDate=2026-06-01`, therapistToken)).raw,
    ).slice(1);
    assertEqual(emptyRows.length, 0, "A future-only window exports zero data rows (header only)");

    const invalidDate = await req("GET", `${exportPath}?startDate=not-a-date`, therapistToken);
    assertEqual(invalidDate.status, 400, "An invalid startDate is rejected (400)");

    // Combined filter still cannot leak PHI.
    const combined = await req("GET", `${exportPath}?outcome=blocked&startDate=2026-02-01&endDate=2026-02-28`, therapistToken);
    assert(!combined.raw.includes(SECRET_PHONE) && !combined.raw.includes("Reply STOP"), "Combined outcome+date export still leaks no PHI");

    // =====================================================================
    // 7. The export is itself audited, attributed to the client
    // =====================================================================
    console.log("\nTest 7: A data_exported audit row is written for the client");
    const exportAudits = await db
      .select({
        userId: auditLogs.userId,
        clientId: auditLogs.clientId,
        action: auditLogs.action,
        result: auditLogs.result,
        details: auditLogs.details,
      })
      .from(auditLogs)
      .where(and(eq(auditLogs.action, "data_exported"), eq(auditLogs.clientId, client.id)))
      .orderBy(desc(auditLogs.timestamp));

    assert(exportAudits.length > 0, "At least one data_exported audit row exists for the client");
    const exportAudit = exportAudits[0];
    // A serial PK can come back as a string ("10240") while an integer FK col
    // comes back as a number — coerce both before comparing.
    assertEqual(Number(exportAudit?.clientId), Number(client.id), "data_exported audit row is attributed to the client");
    assertEqual(Number(exportAudit?.userId), Number(therapist.id), "data_exported audit row records the exporting user");
    // The audit row itself must not carry the leaked PHI.
    const auditBlob = JSON.stringify(exportAudits);
    assert(!auditBlob.includes(SECRET_PHONE) && !auditBlob.includes("Reply STOP"), "data_exported audit row carries no PHI");
  } finally {
    if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
    await cleanup().catch((e) => console.error("cleanup error:", e));
  }
}

run()
  .then(() => {
    console.log(`\nClient SMS-log export privacy tests: ${testsPassed} passed, ${testsFailed} failed`);
    process.exit(testsFailed > 0 ? 1 : 0);
  })
  .catch(async (err) => {
    console.error("Fatal error in SMS-log export privacy test:", err);
    await cleanup().catch(() => {});
    process.exit(1);
  });
