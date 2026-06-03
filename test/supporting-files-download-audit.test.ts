/**
 * Automated Tests proving supporting-file DOWNLOADS are written to the access log
 *
 * The download endpoint (GET /api/supporting-files/:id/download) writes a
 * HIPAA-relevant audit entry (`report_supporting_file_downloaded`) on every
 * successful download. A regression that silently stopped logging who pulled a
 * client's document would break the compliance trail without any other visible
 * symptom. The sibling test `supporting-files-download-authz.test.ts` proves
 * access control + blob-link safety, but NOT that the audit row is actually
 * recorded. This test closes that gap.
 *
 * Verifies that an authorized download produces an `auditLogs` row that:
 *   - has action `report_supporting_file_downloaded`,
 *   - has result `success`,
 *   - carries the correct clientId and resourceId (the file id),
 *   - is HIPAA-relevant, and
 *   - records the downloading user's id — an assigned therapist and an admin
 *     each produce their own distinct entry attributed to the right user.
 *
 * Run with: npx tsx test/supporting-files-download-audit.test.ts
 * (Run serially, like the other privacy tests.)
 *
 * NOTES:
 * - Spins up the real Express app (registerRoutes) on an ephemeral port and
 *   makes real HTTP requests, exercising the full middleware + handler chain.
 * - The supporting file is seeded through the real upload endpoint so the blob
 *   actually exists in storage and the download streams real bytes.
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

const SUFFIX = `t98dlaudit-${Date.now()}`;
const FILE_CONTENT = `Supporting reference material for download-audit test ${SUFFIX}`;

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

async function download(path: string, token: string | null) {
  const res = await fetch(`${baseUrl}${path}`, {
    method: "GET",
    headers: authHeaders(token),
    redirect: "manual",
  });
  // Drain the body so the request fully completes before we query the audit log.
  await res.arrayBuffer();
  return { status: res.status };
}

function uploadBody() {
  return {
    fileContent: Buffer.from(FILE_CONTENT, "utf-8").toString("base64"),
    originalName: `download-audit-${SUFFIX}.txt`,
    mimeType: "text/plain",
  };
}

// Find the most recent download audit row for (userId, clientId) since `since`.
async function findDownloadAudit(userId: number, clientId: number, since: Date) {
  const rows = await db
    .select()
    .from(auditLogs)
    .where(
      and(
        eq(auditLogs.userId, userId),
        eq(auditLogs.clientId, clientId),
        eq(auditLogs.action, "report_supporting_file_downloaded" as any),
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
  console.log("\n🧪 Supporting-File Download Audit-Log Tests\n");

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
    const assignedTherapist = await makeUser("therapist", "dla-assigned");
    const admin = await makeUser("admin", "dla-admin");

    const client = await makeClient(assignedTherapist.id, "dla-client");

    const assignedToken = createSessionToken(assignedTherapist);
    const adminToken = createSessionToken(admin);

    // --- Seed a supporting file THROUGH the upload endpoint ----------------
    console.log("Seeding a supporting file via the upload endpoint...");
    const uploadPath = `/api/clients/${client.id}/supporting-files`;
    const created = await req("POST", uploadPath, assignedToken, uploadBody());
    assertEqual(created.status, 201, "Seed upload succeeds (201)");
    const fileId: number = created.body?.id;
    assert(typeof fileId === "number", "Seed upload returns a numeric file id");

    const downloadPath = `/api/supporting-files/${fileId}/download`;

    // =======================================================================
    // 1. Authorized download by the assigned therapist is recorded
    // =======================================================================
    console.log("\nTest 1: Assigned therapist download writes a success audit row");
    {
      const r = await download(downloadPath, assignedToken);
      assertEqual(r.status, 200, "Assigned therapist download returns 200");

      const log = await findDownloadAudit(assignedTherapist.id, client.id, testStart);
      assert(!!log, "Audit row exists for the assigned therapist's download");
      if (log) {
        assertEqual(log.action, "report_supporting_file_downloaded", "Audit action is 'report_supporting_file_downloaded'");
        assertEqual(log.result, "success", "Audit result is 'success'");
        assertEqual(Number(log.clientId), Number(client.id), "Audit row carries the correct clientId");
        assertEqual(log.resourceId, String(fileId), "Audit row carries the file id as resourceId");
        assertEqual(log.resourceType, "report_supporting_file", "Audit row resourceType is 'report_supporting_file'");
        assertEqual(log.userId, assignedTherapist.id, "Audit row is attributed to the assigned therapist");
        assertEqual(log.hipaaRelevant, true, "Audit row is flagged HIPAA-relevant");
      }
    }

    // =======================================================================
    // 2. An admin download produces a DISTINCT entry under the admin's id
    // =======================================================================
    console.log("\nTest 2: Admin download writes its own distinct audit row");
    {
      const r = await download(downloadPath, adminToken);
      assertEqual(r.status, 200, "Admin download returns 200");

      const adminLog = await findDownloadAudit(admin.id, client.id, testStart);
      assert(!!adminLog, "Audit row exists for the admin's download");
      if (adminLog) {
        assertEqual(adminLog.userId, admin.id, "Admin's audit row is attributed to the admin");
        assertEqual(adminLog.result, "success", "Admin's audit result is 'success'");
        assertEqual(adminLog.resourceId, String(fileId), "Admin's audit row carries the file id as resourceId");
      }

      // The two downloads must be two separate, correctly-attributed rows.
      const therapistRows = await db
        .select()
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.userId, assignedTherapist.id),
            eq(auditLogs.clientId, client.id),
            eq(auditLogs.action, "report_supporting_file_downloaded" as any),
            gte(auditLogs.timestamp, testStart),
          ),
        );
      const adminRows = await db
        .select()
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.userId, admin.id),
            eq(auditLogs.clientId, client.id),
            eq(auditLogs.action, "report_supporting_file_downloaded" as any),
            gte(auditLogs.timestamp, testStart),
          ),
        );
      assert(therapistRows.length >= 1, "At least one download row attributed to the therapist");
      assert(adminRows.length >= 1, "At least one download row attributed to the admin");
      assert(
        !therapistRows.some((row) => row.userId === admin.id) &&
          !adminRows.some((row) => row.userId === assignedTherapist.id),
        "Therapist and admin downloads are recorded under distinct user ids",
      );
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
