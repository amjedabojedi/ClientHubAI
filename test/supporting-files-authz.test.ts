/**
 * Automated Tests for report SUPPORTING-FILE access control & PHI exposure
 *
 * Verifies that the supporting-file endpoints (used to feed extra reference
 * material into AI client reports) enforce the same client-scoped access rules
 * as the rest of the clinical surface, and never leak blob-backed PHI:
 *   1. list / upload / delete are scoped:
 *        - an assigned therapist, an in-scope supervisor, and an admin succeed,
 *        - an unassigned therapist, an out-of-scope supervisor get 403,
 *        - an accountant is blocked from the endpoints entirely.
 *   2. NO response (list, upload, or the seeded rows) ever contains fileUrl,
 *      fileBlobName, or extractedText — the Azure container allows blob-level
 *      reads by URL and extractedText is large PHI.
 *
 * Run with: npx tsx test/supporting-files-authz.test.ts
 * (Run serially, like the other privacy tests.)
 *
 * NOTES:
 * - Spins up the real Express app (registerRoutes) on an ephemeral port and
 *   makes real HTTP requests, exercising the full middleware + handler chain.
 * - Azure blob uploads/deletes inside the routes are best-effort and wrapped in
 *   try/catch, so the endpoints succeed even when no storage account is set.
 */

import express from "express";
import cookieParser from "cookie-parser";
import type { Server } from "http";
import { inArray } from "drizzle-orm";

let db: typeof import("../server/db")["db"];
let users: typeof import("../shared/schema")["users"];
let clients: typeof import("../shared/schema")["clients"];
let supervisorAssignments: typeof import("../shared/schema")["supervisorAssignments"];
let reportSupportingFiles: typeof import("../shared/schema")["reportSupportingFiles"];
let auditLogs: typeof import("../shared/schema")["auditLogs"];
let registerRoutes: typeof import("../server/routes")["registerRoutes"];
let createSessionToken: typeof import("../server/auth-middleware")["createSessionToken"];
let storage: typeof import("../server/storage")["storage"];

async function loadServerModules() {
  const schema = await import("../shared/schema");
  ({ db } = await import("../server/db"));
  ({ users, clients, supervisorAssignments, reportSupportingFiles, auditLogs } = schema);
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

const SUFFIX = `t90authz-${Date.now()}`;
const SECRET_TEXT = `SECRET-EXTRACTED-PHI-${SUFFIX}`;

// A field that must never appear in any API response for a supporting file.
const FORBIDDEN_FIELDS = ["fileUrl", "fileBlobName", "extractedText"] as const;

function hasNoForbiddenFields(obj: any): boolean {
  if (!obj || typeof obj !== "object") return true;
  return FORBIDDEN_FIELDS.every((f) => !(f in obj));
}

// Tracking for cleanup
const createdUserIds: number[] = [];
const createdClientIds: number[] = [];
const createdAssignmentIds: number[] = [];

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

async function makeSupportingFile(clientId: number, createdById: number) {
  return storage.createReportSupportingFile({
    clientId,
    originalName: `seeded-${SUFFIX}.txt`,
    mimeType: "text/plain",
    fileSize: SECRET_TEXT.length,
    extractedText: SECRET_TEXT,
    fileBlobName: `blob-${SUFFIX}`,
    fileUrl: `https://example.blob.core.windows.net/c/blob-${SUFFIX}`,
    createdById,
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

// A small valid .txt upload payload.
function uploadBody() {
  const content = `Some supporting reference text ${SUFFIX}`;
  return {
    fileContent: Buffer.from(content, "utf-8").toString("base64"),
    originalName: `upload-${SUFFIX}.txt`,
    mimeType: "text/plain",
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function run() {
  console.log("\n🧪 Supporting-File Access Control & PHI Exposure Tests\n");

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
    const assignedTherapist = await makeUser("therapist", "sf-assigned");
    const otherTherapist = await makeUser("therapist", "sf-other");
    const supInScope = await makeUser("supervisor", "sf-sup-in");
    const supOutScope = await makeUser("supervisor", "sf-sup-out");
    const admin = await makeUser("admin", "sf-admin");
    const accountant = await makeUser("accountant", "sf-accountant");

    const supAssignment = await storage.createSupervisorAssignment({
      supervisorId: supInScope.id,
      therapistId: assignedTherapist.id,
      isActive: true,
    } as any);
    createdAssignmentIds.push(supAssignment.id);

    const client = await makeClient(assignedTherapist.id, "sf-client");

    const assignedToken = createSessionToken(assignedTherapist);
    const otherToken = createSessionToken(otherTherapist);
    const supInToken = createSessionToken(supInScope);
    const supOutToken = createSessionToken(supOutScope);
    const adminToken = createSessionToken(admin);
    const accountantToken = createSessionToken(accountant);

    const listPath = `/api/clients/${client.id}/supporting-files`;
    const uploadPath = `/api/clients/${client.id}/supporting-files`;

    // =======================================================================
    // 1. List: authentication + access scope
    // =======================================================================
    console.log("Test 1: Listing supporting files access scope");
    {
      assertEqual((await req("GET", listPath, null)).status, 401, "Unauthenticated cannot list (401)");
      assertEqual((await req("GET", listPath, otherToken)).status, 403, "Unassigned therapist cannot list (403)");
      assertEqual((await req("GET", listPath, supOutToken)).status, 403, "Out-of-scope supervisor cannot list (403)");
      assertEqual((await req("GET", listPath, accountantToken)).status, 403, "Accountant cannot list (403)");
      assertEqual((await req("GET", listPath, assignedToken)).status, 200, "Assigned therapist can list (200)");
      assertEqual((await req("GET", listPath, supInToken)).status, 200, "In-scope supervisor can list (200)");
      assertEqual((await req("GET", listPath, adminToken)).status, 200, "Admin can list (200)");
    }

    // =======================================================================
    // 2. List never exposes blob URL / blob name / extractedText
    // =======================================================================
    console.log("\nTest 2: Listing never exposes blob PHI");
    {
      await makeSupportingFile(client.id, assignedTherapist.id);
      const r = await req("GET", listPath, assignedToken);
      assertEqual(r.status, 200, "List succeeds (200)");
      const rows = Array.isArray(r.body) ? r.body : [];
      assert(rows.length >= 1, "List returns the seeded file");
      assert(rows.every(hasNoForbiddenFields), "No listed row has fileUrl/fileBlobName/extractedText");
      const serialized = JSON.stringify(r.body);
      assert(!serialized.includes(SECRET_TEXT), "Raw extractedText value never appears in the list response");
      assert(!serialized.includes("blob.core.windows.net"), "No blob URL appears in the list response");
    }

    // =======================================================================
    // 3. Upload: access scope
    // =======================================================================
    console.log("\nTest 3: Uploading a supporting file access scope");
    {
      assertEqual((await req("POST", uploadPath, null, uploadBody())).status, 401, "Unauthenticated cannot upload (401)");
      assertEqual((await req("POST", uploadPath, otherToken, uploadBody())).status, 403, "Unassigned therapist cannot upload (403)");
      assertEqual((await req("POST", uploadPath, supOutToken, uploadBody())).status, 403, "Out-of-scope supervisor cannot upload (403)");
      assertEqual((await req("POST", uploadPath, accountantToken, uploadBody())).status, 403, "Accountant cannot upload (403)");
    }

    // =======================================================================
    // 4. Upload happy path + response never exposes blob PHI
    // =======================================================================
    console.log("\nTest 4: Authorized uploads succeed and hide blob PHI");
    {
      const r = await req("POST", uploadPath, assignedToken, uploadBody());
      assertEqual(r.status, 201, "Assigned therapist can upload (201)");
      assert(hasNoForbiddenFields(r.body), "Upload response has no fileUrl/fileBlobName/extractedText");
      assert(typeof r.body?.id === "number", "Upload response returns the new file id");

      const supR = await req("POST", uploadPath, supInToken, uploadBody());
      assertEqual(supR.status, 201, "In-scope supervisor can upload (201)");
      const admR = await req("POST", uploadPath, adminToken, uploadBody());
      assertEqual(admR.status, 201, "Admin can upload (201)");
    }

    // =======================================================================
    // 5. Delete: access scope
    // =======================================================================
    console.log("\nTest 5: Deleting a supporting file access scope");
    {
      const target = await makeSupportingFile(client.id, assignedTherapist.id);
      const delPath = `/api/supporting-files/${target.id}`;
      assertEqual((await req("DELETE", delPath, null)).status, 401, "Unauthenticated cannot delete (401)");
      assertEqual((await req("DELETE", delPath, otherToken)).status, 403, "Unassigned therapist cannot delete (403)");
      assertEqual((await req("DELETE", delPath, supOutToken)).status, 403, "Out-of-scope supervisor cannot delete (403)");
      assertEqual((await req("DELETE", delPath, accountantToken)).status, 403, "Accountant cannot delete (403)");
      // Still present after the failed attempts.
      assert(!!(await storage.getReportSupportingFile(target.id)), "File survives all unauthorized delete attempts");
      assertEqual((await req("DELETE", delPath, assignedToken)).status, 200, "Assigned therapist can delete (200)");
      assert(!(await storage.getReportSupportingFile(target.id)), "File is gone after authorized delete");
    }

    // =======================================================================
    // 6. In-scope supervisor and admin can delete too
    // =======================================================================
    console.log("\nTest 6: In-scope supervisor and admin can delete");
    {
      const supTarget = await makeSupportingFile(client.id, assignedTherapist.id);
      assertEqual(
        (await req("DELETE", `/api/supporting-files/${supTarget.id}`, supInToken)).status,
        200,
        "In-scope supervisor can delete (200)",
      );
      const admTarget = await makeSupportingFile(client.id, assignedTherapist.id);
      assertEqual(
        (await req("DELETE", `/api/supporting-files/${admTarget.id}`, adminToken)).status,
        200,
        "Admin can delete (200)",
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
      if (createdAssignmentIds.length > 0) {
        await db.delete(supervisorAssignments).where(inArray(supervisorAssignments.id, createdAssignmentIds));
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
