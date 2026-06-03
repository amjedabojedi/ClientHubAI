/**
 * Automated Tests proving a BLOCKED supporting-file DELETE attempt is written to
 * the HIPAA access log.
 *
 * The list, upload, and download endpoints already record denied attempts (see
 * `supporting-files-list-upload-denial-audit.test.ts` and
 * `supporting-files-download-audit.test.ts`). Its sibling endpoint —
 *   - DELETE /api/supporting-files/:id  (delete)
 * — must do the same: a blocked attempt to delete a document for a client a user
 * shouldn't reach is just as worth recording as a blocked download.
 *
 * Verifies that the 403 produces an `auditLogs` row that:
 *   - has action `unauthorized_access`,
 *   - has result `denied`,
 *   - carries the correct clientId and resourceId (the file id),
 *   - is HIPAA-relevant, and
 *   - records the attempting user's id.
 *
 * It also confirms the blocked attempt does NOT actually delete the file.
 *
 * Run with: npx tsx test/supporting-files-delete-denial-audit.test.ts
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

const SUFFIX = `t101deldenial-${Date.now()}`;
const FILE_CONTENT = `Supporting reference material for delete denial-audit test ${SUFFIX}`;

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
    originalName: `delete-denial-${SUFFIX}.txt`,
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

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function run() {
  console.log("\n🧪 Supporting-File Delete Denial Audit-Log Tests\n");

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
    const assignedTherapist = await makeUser("therapist", "ddl-assigned");
    const otherTherapist = await makeUser("therapist", "ddl-other");

    const client = await makeClient(assignedTherapist.id, "ddl-client");

    const assignedToken = createSessionToken(assignedTherapist);
    const otherToken = createSessionToken(otherTherapist);

    // --- Seed a supporting file THROUGH the upload endpoint ----------------
    console.log("Seeding a supporting file via the upload endpoint...");
    const uploadPath = `/api/clients/${client.id}/supporting-files`;
    const created = await req("POST", uploadPath, assignedToken, uploadBody());
    assertEqual(created.status, 201, "Seed upload succeeds (201)");
    const fileId: number = created.body?.id;
    assert(typeof fileId === "number", "Seed upload returns a numeric file id");

    const deletePath = `/api/supporting-files/${fileId}`;

    // =======================================================================
    // 1. A BLOCKED DELETE attempt (unassigned therapist) writes a denial row
    // =======================================================================
    console.log("\nTest 1: Blocked DELETE attempt writes a denial audit row");
    {
      const r = await req("DELETE", deletePath, otherToken);
      assertEqual(r.status, 403, "Unassigned therapist delete is denied (403)");

      const denial = await findDenialAudit(otherTherapist.id, client.id, testStart);
      assert(!!denial, "Denial audit row exists for the blocked delete attempt");
      if (denial) {
        assertEqual(denial.action, "unauthorized_access", "Delete denial action is 'unauthorized_access'");
        assertEqual(denial.result, "denied", "Delete denial result is 'denied'");
        assertEqual(Number(denial.clientId), Number(client.id), "Delete denial row carries the correct clientId");
        assertEqual(denial.resourceId, String(fileId), "Delete denial row carries the file id as resourceId");
        assertEqual(denial.resourceType, "report_supporting_file", "Delete denial resourceType is 'report_supporting_file'");
        assertEqual(denial.userId, otherTherapist.id, "Delete denial row is attributed to the blocked user");
        assertEqual(denial.hipaaRelevant, true, "Delete denial row is flagged HIPAA-relevant");
      }
    }

    // =======================================================================
    // 2. The blocked attempt does NOT actually delete the file
    // =======================================================================
    console.log("\nTest 2: Blocked delete leaves the file intact");
    {
      const stillThere = await storage.getReportSupportingFile(fileId);
      assert(!!stillThere, "Supporting file still exists after the blocked delete");
    }

    // =======================================================================
    // 3. An AUTHORIZED delete by the assigned therapist does NOT write a denial
    // =======================================================================
    console.log("\nTest 3: Authorized delete does not write a denial row");
    const beforeAuthorized = new Date();
    {
      const r = await req("DELETE", deletePath, assignedToken);
      assertEqual(r.status, 200, "Assigned therapist delete returns 200");
      const denial = await findDenialAudit(assignedTherapist.id, client.id, beforeAuthorized);
      assert(!denial, "No denial row for the assigned therapist's authorized delete");
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
