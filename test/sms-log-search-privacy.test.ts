/**
 * Privacy/regression test for the SEARCH parameter on the per-client SMS LOG
 * endpoint.
 *
 *   GET /api/clients/:id/sms-log?search=...
 *
 * The free-text search is deliberately limited to the same non-PHI fields the
 * UI already renders — the event type and the blocked/failed reason/error. It
 * matches in JS against the PARSED values (eventType, reason) rather than the
 * raw `details` JSON, so a search can never match the SMS message body or the
 * client's phone number even though both are stored in that JSON.
 *
 * A regression that searched the raw details JSON (or any other PHI field)
 * would let staff confirm a phone number or the message text by substring —
 * leaking PHI. This suite locks the guarantee in:
 *   1. Seeds an sms_notification audit row whose details JSON contains a phone
 *      number and a message body, plus a distinct eventType and reason.
 *   2. Asserts searching for a substring of the PHONE NUMBER returns no match.
 *   3. Asserts searching for a substring of the MESSAGE BODY returns no match.
 *   4. Asserts searching for a substring of the EVENT TYPE does match.
 *   5. Asserts searching for a substring of the REASON / ERROR does match.
 *
 * Run with: npx tsx test/sms-log-search-privacy.test.ts
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

const SUFFIX = `smslogsearch-${process.pid}-${Date.now()}`;

// The PHI that lives in the audit details JSON. Substrings of these must NEVER
// match the search — otherwise staff could confirm a phone number or message
// body by guessing fragments of it.
const SECRET_PHONE = "+15195550411";
const SECRET_BODY =
  "SmartHub: Your appointment is confirmed for Mon, Aug 3 at 9:30 AM. Reply STOP to opt out.";

// The non-PHI fields the search is allowed to match. These are deliberately
// made unique/unusual so a match can only have come from the parsed values.
const SEARCH_EVENT_TYPE = "session_rescheduled_zebra";
const SEARCH_REASON = "no SMS consent quokka";

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

// Insert one sms_notification audit row. The details JSON carries the phone
// number and message body (the PHI we must never match) alongside the distinct
// eventType and reason (the non-PHI fields search is allowed to match).
async function seedSmsAudit(
  clientId: number,
  action: "sms_notification_blocked",
  result: "blocked",
  eventType: string,
  reason: string,
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
    details: JSON.stringify({
      eventType,
      reason,
      phone,
      to: phone,
      body,
      message: body,
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
  console.log("\n🧪 Client SMS-Log SEARCH Privacy Tests\n");

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

    const therapist = await makeUser("therapist", "smslogsearch-therapist");
    const therapistToken = createSessionToken(therapist);

    const client = await makeClient("smslogsearch-client");

    await seedSmsAudit(
      client.id,
      "sms_notification_blocked",
      "blocked",
      SEARCH_EVENT_TYPE,
      SEARCH_REASON,
      SECRET_PHONE,
      SECRET_BODY,
    );

    const basePath = `/api/clients/${client.id}/sms-log`;

    // Helper: run a search and return the matching entries array.
    async function search(term: string) {
      const r = await req(
        "GET",
        `${basePath}?search=${encodeURIComponent(term)}`,
        therapistToken,
      );
      return Array.isArray(r.body) ? r.body : [];
    }

    // Sanity: the seeded row is visible with no search active.
    console.log("Test 0: Seeded row is present with no search filter");
    {
      const all = await search("");
      assertEqual(all.length, 1, "Exactly the one seeded row is returned with no search term");
    }

    // =====================================================================
    // 1. Searching for PHI (phone number) must NOT match
    // =====================================================================
    console.log("\nTest 1: Phone number substrings never match");
    {
      // Substrings drawn from the phone number stored in the details JSON.
      for (const term of ["5195550411", "550411", "+1519", "15195550411"]) {
        const matches = await search(term);
        assertEqual(matches.length, 0, `Searching phone substring "${term}" returns no match`);
      }
    }

    // =====================================================================
    // 2. Searching for PHI (message body) must NOT match
    // =====================================================================
    console.log("\nTest 2: Message body substrings never match");
    {
      // Substrings drawn from the SMS body stored in the details JSON.
      for (const term of ["appointment is confirmed", "Reply STOP", "9:30 AM", "Aug 3"]) {
        const matches = await search(term);
        assertEqual(matches.length, 0, `Searching body substring "${term}" returns no match`);
      }
    }

    // =====================================================================
    // 3. Searching the non-PHI event type DOES match
    // =====================================================================
    console.log("\nTest 3: Event type substrings DO match");
    {
      // The handler renders underscores as spaces before matching, so search a
      // fragment that survives that transform.
      for (const term of ["zebra", "rescheduled zebra", "session rescheduled"]) {
        const matches = await search(term);
        assertEqual(matches.length, 1, `Searching event-type substring "${term}" matches the row`);
      }
    }

    // =====================================================================
    // 4. Searching the non-PHI reason DOES match
    // =====================================================================
    console.log("\nTest 4: Reason substrings DO match");
    {
      for (const term of ["quokka", "no sms consent", "consent quokka"]) {
        const matches = await search(term);
        assertEqual(matches.length, 1, `Searching reason substring "${term}" matches the row`);
      }
    }
  } finally {
    if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
    await cleanup().catch((e) => console.error("cleanup error:", e));
  }
}

run()
  .then(() => {
    console.log(`\nClient SMS-log search privacy tests: ${testsPassed} passed, ${testsFailed} failed`);
    process.exit(testsFailed > 0 ? 1 : 0);
  })
  .catch(async (err) => {
    console.error("Fatal error in SMS-log search privacy test:", err);
    await cleanup().catch(() => {});
    process.exit(1);
  });
