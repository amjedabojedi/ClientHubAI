/**
 * Automated Tests proving BLOCKED supporting-file LIST and UPLOAD attempts are
 * written to the HIPAA access log.
 *
 * The download endpoint already records denied attempts (see
 * `supporting-files-download-audit.test.ts`). Its sibling endpoints —
 *   - GET  /api/clients/:clientId/supporting-files  (list)
 *   - POST /api/clients/:clientId/supporting-files  (upload)
 * — must do the same: a blocked attempt to list or upload documents for a
 * client a user shouldn't reach is just as worth recording as a blocked
 * download.
 *
 * Verifies that each 403 produces an `auditLogs` row that:
 *   - has action `unauthorized_access`,
 *   - has result `denied`,
 *   - carries the correct clientId,
 *   - is HIPAA-relevant, and
 *   - records the attempting user's id.
 *
 * Run with: npx tsx test/supporting-files-list-upload-denial-audit.test.ts
 * (Run serially, like the other privacy tests.)
 */

import express from "express";
import cookieParser from "cookie-parser";
import type { Server } from "http";
import { and, eq, gte, inArray, desc } from "drizzle-orm";

let db: typeof import("../server/db")["db"];
let users: typeof import("../shared/schema")["users"];
let clients: typeof import("../shared/schema")["clients"];
let reportSupportingFiles: typeof import("../shared/schema")["reportSupportingFiles"];
let auditLogs: typeof import("../shared/schema")["auditLogs"];
let registerRoutes: typeof import("../server/routes")["registerRoutes"];
let createSessionToken: typeof import("../server/auth-middleware")["createSessionToken"];
let storage: typeof import("../server/storage")["storage"];

async function loadServerModules() {
  const schema = await import("../shared/schema");
  ({ db } = await import("../server/db"));
  ({ users, clients, reportSupportingFiles, auditLogs } = schema);
  ({ registerRoutes } = await import("../server/routes"));
  ({ createSessionToken } = await import("../server/auth-middleware"));
  ({ storage } = await import("../server/storage"));
}

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

const SUFFIX = `t100denial-${Date.now()}`;
const FILE_CONTENT = `Supporting reference material for list/upload denial-audit test ${SUFFIX}`;

// Tracking for cleanup
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

async function makeClient(assignedTherapistId: number, label: string) {
  const client = await storage.createClient({
    fullName: `${label} ${SUFFIX}`,
    assignedTherapistId,
  } as any);
  createdClientIds.push(client.id);
  return client;
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

async function req(method: string, path: string, token: string | null, body?: any) {
  const init: any = { method, headers: authHeaders(token) };
  if (body !== undefined) init.body = JSON.stringify(body);
  const res = await fetch(`${baseUrl}${path}`, init);
  let parsed: any = null;
  const ct = res.headers.get("content-type") || "";
  try {
    parsed = ct.includes("application/json") ? await res.json() : await res.text();
  } catch {
    parsed = null;
  }
  return { status: res.status, body: parsed };
}

function uploadBody() {
  return {
    fileContent: Buffer.from(FILE_CONTENT, "utf-8").toString("base64"),
    originalName: `list-upload-denial-${SUFFIX}.txt`,
    mimeType: "text/plain",
  };
}

// Find the most recent denial audit row for (userId, clientId) since `since`.
async function findDenialAudit(userId: number, clientId: number, since: Date) {
  const rows = await db
    .select()
    .from(auditLogs)
    .where(
      and(
        eq(auditLogs.userId, userId),
        eq(auditLogs.clientId, clientId),
        eq(auditLogs.action, "unauthorized_access" as any),
        gte(auditLogs.timestamp, since),
      ),
    )
    .orderBy(desc(auditLogs.timestamp))
    .limit(1);
  return rows.length > 0 ? rows[0] : null;
}

// Count denial audit rows for (userId, clientId) since `since`.
async function countDenialAudits(userId: number, clientId: number, since: Date) {
  const rows = await db
    .select()
    .from(auditLogs)
    .where(
      and(
        eq(auditLogs.userId, userId),
        eq(auditLogs.clientId, clientId),
        eq(auditLogs.action, "unauthorized_access" as any),
        gte(auditLogs.timestamp, since),
      ),
    );
  return rows.length;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function run() {
  console.log("\n🧪 Supporting-File List/Upload Denial Audit-Log Tests\n");

  const testStart = new Date();
  let server: Server | null = null;
  await loadServerModules();

  try {
    const app = express();
    app.use(express.json({ limit: "50mb" }));
    app.use(express.urlencoded({ extended: false, limit: "50mb" }));
    app.use(cookieParser());
    server = await registerRoutes(app);
    await new Promise<void>((resolve) => server!.listen(0, resolve));
    const addr = server.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    baseUrl = `http://127.0.0.1:${port}`;
    console.log(`   Test server listening on ${baseUrl}\n`);

    // --- Seed users --------------------------------------------------------
    const assignedTherapist = await makeUser("therapist", "lud-assigned");
    const otherTherapist = await makeUser("therapist", "lud-other");

    const client = await makeClient(assignedTherapist.id, "lud-client");

    const assignedToken = createSessionToken(assignedTherapist);
    const otherToken = createSessionToken(otherTherapist);

    const listPath = `/api/clients/${client.id}/supporting-files`;
    const uploadPath = `/api/clients/${client.id}/supporting-files`;

    // =======================================================================
    // 1. A BLOCKED LIST attempt (unassigned therapist) writes a denial row
    // =======================================================================
    console.log("\nTest 1: Blocked LIST attempt writes a denial audit row");
    {
      const r = await req("GET", listPath, otherToken);
      assertEqual(r.status, 403, "Unassigned therapist list is denied (403)");

      const denial = await findDenialAudit(otherTherapist.id, client.id, testStart);
      assert(!!denial, "Denial audit row exists for the blocked list attempt");
      if (denial) {
        assertEqual(denial.action, "unauthorized_access", "List denial action is 'unauthorized_access'");
        assertEqual(denial.result, "denied", "List denial result is 'denied'");
        assertEqual(Number(denial.clientId), Number(client.id), "List denial row carries the correct clientId");
        assertEqual(denial.resourceType, "report_supporting_file", "List denial resourceType is 'report_supporting_file'");
        assertEqual(denial.userId, otherTherapist.id, "List denial row is attributed to the blocked user");
        assertEqual(denial.hipaaRelevant, true, "List denial row is flagged HIPAA-relevant");
      }
    }

    // =======================================================================
    // 2. A BLOCKED UPLOAD attempt (unassigned therapist) writes a denial row
    // =======================================================================
    console.log("\nTest 2: Blocked UPLOAD attempt writes a denial audit row");
    const beforeUpload = new Date();
    {
      const r = await req("POST", uploadPath, otherToken, uploadBody());
      assertEqual(r.status, 403, "Unassigned therapist upload is denied (403)");

      const denial = await findDenialAudit(otherTherapist.id, client.id, beforeUpload);
      assert(!!denial, "Denial audit row exists for the blocked upload attempt");
      if (denial) {
        assertEqual(denial.action, "unauthorized_access", "Upload denial action is 'unauthorized_access'");
        assertEqual(denial.result, "denied", "Upload denial result is 'denied'");
        assertEqual(Number(denial.clientId), Number(client.id), "Upload denial row carries the correct clientId");
        assertEqual(denial.resourceType, "report_supporting_file", "Upload denial resourceType is 'report_supporting_file'");
        assertEqual(denial.userId, otherTherapist.id, "Upload denial row is attributed to the blocked user");
        assertEqual(denial.hipaaRelevant, true, "Upload denial row is flagged HIPAA-relevant");
      }

      // The blocked upload must NOT have persisted a supporting-file row.
      const sneakFiles = await db
        .select()
        .from(reportSupportingFiles)
        .where(eq(reportSupportingFiles.clientId, client.id));
      assertEqual(sneakFiles.length, 0, "Blocked upload does not persist a supporting-file row");
    }

    // =======================================================================
    // 3. Both blocked attempts produced their OWN distinct denial rows
    // =======================================================================
    console.log("\nTest 3: List and upload denials are two distinct rows");
    {
      const total = await countDenialAudits(otherTherapist.id, client.id, testStart);
      assert(total >= 2, "At least two denial rows recorded (one list, one upload)");
    }

    // =======================================================================
    // 4. An AUTHORIZED list by the assigned therapist does NOT write a denial
    // =======================================================================
    console.log("\nTest 4: Authorized list does not write a denial row");
    {
      const r = await req("GET", listPath, assignedToken);
      assertEqual(r.status, 200, "Assigned therapist list returns 200");
      const denial = await findDenialAudit(assignedTherapist.id, client.id, testStart);
      assert(!denial, "No denial row for the assigned therapist's authorized list");
    }
  } catch (error) {
    console.error("\n❌ Test suite error:", error);
    testsFailed++;
  } finally {
    try {
      if (createdClientIds.length > 0) {
        await db.delete(reportSupportingFiles).where(inArray(reportSupportingFiles.clientId, createdClientIds));
        await db.delete(auditLogs).where(inArray(auditLogs.clientId, createdClientIds));
      }
      if (createdUserIds.length > 0) {
        await db.delete(auditLogs).where(inArray(auditLogs.userId, createdUserIds));
      }
      if (createdClientIds.length > 0) {
        await db.delete(clients).where(inArray(clients.id, createdClientIds));
      }
      if (createdUserIds.length > 0) {
        await db.delete(users).where(inArray(users.id, createdUserIds));
      }
      console.log("\n🧹 Cleanup complete.");
    } catch (cleanupErr) {
      console.error("⚠️  Cleanup error:", cleanupErr);
    }

    if (server) {
      await new Promise<void>((resolve) => server!.close(() => resolve()));
    }
  }

  console.log("\n" + "=".repeat(50));
  console.log("📊 TEST SUMMARY");
  console.log("=".repeat(50));
  console.log(`✅ Passed: ${testsPassed}`);
  console.log(`❌ Failed: ${testsFailed}`);
  console.log(`📈 Total:  ${testsPassed + testsFailed}`);

  if (testsFailed === 0) {
    console.log("\n🎉 All tests passed!");
    process.exit(0);
  } else {
    console.log("\n⚠️  Some tests failed. Please review the output above.");
    process.exit(1);
  }
}

run().catch((error) => {
  console.error("Fatal error running tests:", error);
  process.exit(1);
});
