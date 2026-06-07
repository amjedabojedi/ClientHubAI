/**
 * Regression test for the per-client SMS LOG CSV EXPORT endpoint.
 *
 *   GET /api/clients/:id/sms-log/export
 *
 * The export reports how many entries were exported via the
 * `X-Export-Row-Count` response header, and staff rely on that number during
 * audits/hand-offs. This suite proves the reported count and the actual CSV
 * body always agree with each other AND with the active filters (outcome +
 * date range), so a regression can't quietly under/over-report rows.
 *
 * What it locks in:
 *   1. For a matrix of filter combos (outcome=all/sent/blocked/failed, with and
 *      without start/end dates) it asserts that:
 *        - the X-Export-Row-Count header == the number of CSV data rows
 *          (the body, excluding the header line), and
 *        - both equal the count of seeded rows that match those filters.
 *   2. The empty-result case (no rows match) reports a count of 0 and a CSV
 *      with only the header line.
 *
 * Run with: npx tsx test/sms-log-export-count.test.ts
 * (Run serially, like the other privacy tests — see
 *  .agents/memory/privacy-test-concurrency.md.)
 *
 * NOTES:
 * - Spins up the real Express app (registerRoutes) on an ephemeral port and
 *   makes real HTTP requests, exercising the full middleware + handler chain.
 * - Seeds sms_notification audit rows with controlled timestamps so the
 *   date-range filters can be exercised deterministically, and removes
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

const SUFFIX = `smsexport-${process.pid}-${Date.now()}`;

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
    phone: "+15195550100",
  } as any);
  createdClientIds.push(client.id);
  return client;
}

// Insert an sms_notification audit row at a specific timestamp so the
// date-range filters can be exercised deterministically.
async function seedSmsAudit(
  clientId: number,
  action:
    | "sms_notification_sent"
    | "sms_notification_blocked"
    | "sms_notification_failed",
  result: "success" | "blocked" | "failure",
  eventType: string,
  timestamp: Date,
  extra: Record<string, unknown>,
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
    details: JSON.stringify({ eventType, ...extra }),
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

async function exportReq(path: string, token: string | null) {
  const res = await fetch(`${baseUrl}${path}`, {
    method: "GET",
    headers: authHeaders(token),
  });
  const raw = await res.text();
  return {
    status: res.status,
    headerCount: res.headers.get("X-Export-Row-Count"),
    raw,
  };
}

// Count the number of CSV DATA rows in an exported body: strip the leading
// UTF-8 BOM, split on the CRLF row separator, drop empty lines (the export
// ends with a trailing CRLF), and exclude the header line. The seeded reasons
// deliberately contain no commas/newlines, so plain line-splitting is safe.
function countCsvDataRows(raw: string): number {
  const withoutBom = raw.replace(/^\uFEFF/, "");
  const lines = withoutBom.split("\r\n").filter((l) => l.length > 0);
  // First line is the header ("Outcome,Event Type,Timestamp,Reason").
  return Math.max(0, lines.length - 1);
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
    // The data_export / client_viewed audit rows written by the endpoint's own
    // middleware as it serves each export.
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
  console.log("\n🧪 Client SMS-Log Export Count Tests\n");

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

    const therapist = await makeUser("therapist", "smsexport-therapist");
    const therapistToken = createSessionToken(therapist);

    const client = await makeClient("smsexport-client");
    const otherClient = await makeClient("smsexport-other");

    // Seed a known, dated set of outcomes for the target client. Distinct dates
    // let us exercise start/end filters deterministically.
    //   2025-01-10  sent
    //   2025-02-20  blocked
    //   2025-03-15  sent
    //   2025-04-05  failed
    await seedSmsAudit(client.id, "sms_notification_sent", "success", "session_scheduled", new Date("2025-01-10T12:00:00.000Z"), { messageSid: "SM_jan" });
    await seedSmsAudit(client.id, "sms_notification_blocked", "blocked", "session_rescheduled", new Date("2025-02-20T12:00:00.000Z"), { reason: "no SMS consent" });
    await seedSmsAudit(client.id, "sms_notification_sent", "success", "session_reminder", new Date("2025-03-15T12:00:00.000Z"), { messageSid: "SM_mar" });
    await seedSmsAudit(client.id, "sms_notification_failed", "failure", "session_reminder", new Date("2025-04-05T12:00:00.000Z"), { error: "Twilio 21610 unsubscribed" });

    // An unrelated client's row that must never be counted in the target's export.
    await seedSmsAudit(otherClient.id, "sms_notification_sent", "success", "session_scheduled", new Date("2025-03-01T12:00:00.000Z"), { messageSid: "SM_other" });

    const base = `/api/clients/${client.id}/sms-log/export`;

    // Each case: a query string + the number of seeded rows that should match.
    const cases: { name: string; query: string; expected: number }[] = [
      { name: "outcome=all, no dates (every seeded row)", query: "?outcome=all", expected: 4 },
      { name: "no params at all (defaults to all)", query: "", expected: 4 },
      { name: "outcome=sent", query: "?outcome=sent", expected: 2 },
      { name: "outcome=blocked", query: "?outcome=blocked", expected: 1 },
      { name: "outcome=failed", query: "?outcome=failed", expected: 1 },
      // Date range filters (endDate is treated as inclusive of the whole day).
      { name: "all, startDate=2025-02-01 (excludes Jan)", query: "?outcome=all&startDate=2025-02-01", expected: 3 },
      { name: "all, endDate=2025-02-28 (Jan + Feb only)", query: "?outcome=all&endDate=2025-02-28", expected: 2 },
      { name: "all, start+end window 2025-02-01..2025-03-31", query: "?outcome=all&startDate=2025-02-01&endDate=2025-03-31", expected: 2 },
      // Outcome + date range combined.
      { name: "sent, startDate=2025-02-01 (only Mar sent)", query: "?outcome=sent&startDate=2025-02-01", expected: 1 },
      { name: "blocked, window excluding the blocked row (empty)", query: "?outcome=blocked&startDate=2025-03-01", expected: 0 },
      { name: "all, window before any row (empty)", query: "?outcome=all&endDate=2024-12-31", expected: 0 },
    ];

    for (const c of cases) {
      console.log(`\nCase: ${c.name}`);
      const r = await exportReq(`${base}${c.query}`, therapistToken);
      assertEqual(r.status, 200, `  responds 200`);

      const headerCount = r.headerCount === null ? NaN : parseInt(r.headerCount, 10);
      const bodyCount = countCsvDataRows(r.raw);

      assertEqual(headerCount, c.expected, `  X-Export-Row-Count == expected (${c.expected})`);
      assertEqual(bodyCount, c.expected, `  CSV data rows == expected (${c.expected})`);
      assertEqual(headerCount, bodyCount, `  header count matches CSV body rows`);

      // Even for the empty case the header line must still be present.
      const hasHeader = r.raw.replace(/^\uFEFF/, "").startsWith("Outcome,Event Type,Timestamp,Reason");
      assert(hasHeader, `  CSV always includes the header row`);

      // The unrelated client's row must never appear in the target's export.
      assert(!r.raw.includes("SM_other"), `  excludes the unrelated client's row`);
    }
  } finally {
    if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
    await cleanup().catch((e) => console.error("cleanup error:", e));
  }
}

run()
  .then(() => {
    console.log(`\nClient SMS-log export count tests: ${testsPassed} passed, ${testsFailed} failed`);
    process.exit(testsFailed > 0 ? 1 : 0);
  })
  .catch(async (err) => {
    console.error("Fatal error in SMS-log export count test:", err);
    await cleanup().catch(() => {});
    process.exit(1);
  });
