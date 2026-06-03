/**
 * Automated Tests for supporting-file DOWNLOAD access control & blob-link leakage
 *
 * Verifies that GET /api/supporting-files/:id/download:
 *   1. Enforces the same client-scoped access rules as the rest of the clinical
 *      surface:
 *        - unauthenticated            => 401
 *        - unassigned therapist       => 403
 *        - out-of-scope supervisor    => 403
 *        - accountant                 => 403 (blocked from the endpoint entirely)
 *        - assigned therapist         => 200
 *        - in-scope supervisor        => 200
 *        - admin                      => 200
 *   2. Streams the stored bytes through the server and NEVER hands out the raw
 *      Azure blob URL — the container allows blob-level reads by URL. The
 *      authorized response must:
 *        - return 200 (not a 30x redirect),
 *        - carry no Location header,
 *        - have a Content-Disposition of attachment/inline (not a redirect),
 *        - contain the original file bytes in the body,
 *        - never contain a "blob.core.windows.net" URL anywhere in the body.
 *
 * Run with: npx tsx test/supporting-files-download-authz.test.ts
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

const SUFFIX = `t96dl-${Date.now()}`;
// The exact bytes we upload; the download must return them verbatim.
const FILE_CONTENT = `Supporting reference material for download test ${SUFFIX}`;

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

// Raw download: do NOT auto-follow redirects so we can detect a leak via 30x,
// and read the body as bytes so we can verify streaming.
async function download(path: string, token: string | null) {
  const res = await fetch(`${baseUrl}${path}`, {
    method: "GET",
    headers: authHeaders(token),
    redirect: "manual",
  });
  const buf = Buffer.from(await res.arrayBuffer());
  return {
    status: res.status,
    location: res.headers.get("location"),
    contentDisposition: res.headers.get("content-disposition"),
    contentType: res.headers.get("content-type"),
    bodyText: buf.toString("utf-8"),
    byteLength: buf.length,
  };
}

function uploadBody() {
  return {
    fileContent: Buffer.from(FILE_CONTENT, "utf-8").toString("base64"),
    originalName: `download-${SUFFIX}.txt`,
    mimeType: "text/plain",
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function run() {
  console.log("\n🧪 Supporting-File Download Access Control & Blob-Link Leakage Tests\n");

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
    const assignedTherapist = await makeUser("therapist", "dl-assigned");
    const otherTherapist = await makeUser("therapist", "dl-other");
    const supInScope = await makeUser("supervisor", "dl-sup-in");
    const supOutScope = await makeUser("supervisor", "dl-sup-out");
    const admin = await makeUser("admin", "dl-admin");
    const accountant = await makeUser("accountant", "dl-accountant");

    const supAssignment = await storage.createSupervisorAssignment({
      supervisorId: supInScope.id,
      therapistId: assignedTherapist.id,
      isActive: true,
    } as any);
    createdAssignmentIds.push(supAssignment.id);

    const client = await makeClient(assignedTherapist.id, "dl-client");

    const assignedToken = createSessionToken(assignedTherapist);
    const otherToken = createSessionToken(otherTherapist);
    const supInToken = createSessionToken(supInScope);
    const supOutToken = createSessionToken(supOutScope);
    const adminToken = createSessionToken(admin);
    const accountantToken = createSessionToken(accountant);

    // --- Seed a supporting file THROUGH the upload endpoint ----------------
    // This stores the original bytes in blob storage so the download streams
    // real content (not just a row with a stale/missing blob).
    console.log("Seeding a supporting file via the upload endpoint...");
    const uploadPath = `/api/clients/${client.id}/supporting-files`;
    const created = await req("POST", uploadPath, assignedToken, uploadBody());
    assertEqual(created.status, 201, "Seed upload succeeds (201)");
    const fileId: number = created.body?.id;
    assert(typeof fileId === "number", "Seed upload returns a numeric file id");

    const downloadPath = `/api/supporting-files/${fileId}/download`;

    // =======================================================================
    // 1. Download: authentication + access scope
    // =======================================================================
    console.log("\nTest 1: Download access scope");
    {
      assertEqual((await download(downloadPath, null)).status, 401, "Unauthenticated cannot download (401)");
      assertEqual((await download(downloadPath, otherToken)).status, 403, "Unassigned therapist cannot download (403)");
      assertEqual((await download(downloadPath, supOutToken)).status, 403, "Out-of-scope supervisor cannot download (403)");
      assertEqual((await download(downloadPath, accountantToken)).status, 403, "Accountant cannot download (403)");
      assertEqual((await download(downloadPath, assignedToken)).status, 200, "Assigned therapist can download (200)");
      assertEqual((await download(downloadPath, supInToken)).status, 200, "In-scope supervisor can download (200)");
      assertEqual((await download(downloadPath, adminToken)).status, 200, "Admin can download (200)");
    }

    // =======================================================================
    // 2. Authorized download streams bytes and never leaks the blob URL
    // =======================================================================
    console.log("\nTest 2: Authorized download streams bytes, no blob-link leak");
    {
      const r = await download(downloadPath, assignedToken);
      assertEqual(r.status, 200, "Download returns 200 (not a redirect)");
      assert(r.location === null, "Download response has no Location header (no redirect to blob)");
      assert(r.byteLength > 0, "Download response has a non-empty body");
      assert(r.bodyText.includes(FILE_CONTENT), "Download response body contains the original file bytes");
      assert(
        !r.bodyText.includes("blob.core.windows.net"),
        "Download response body never contains a blob.core.windows.net URL",
      );
      assert(
        typeof r.contentDisposition === "string" && /^(attachment|inline)/i.test(r.contentDisposition || ""),
        "Content-Disposition is attachment/inline (streamed, not redirected)",
      );
    }

    // =======================================================================
    // 3. The unauthorized responses never leak the blob URL either
    // =======================================================================
    console.log("\nTest 3: Unauthorized responses never leak the blob URL");
    {
      for (const [label, token] of [
        ["unassigned therapist", otherToken],
        ["out-of-scope supervisor", supOutToken],
        ["accountant", accountantToken],
      ] as const) {
        const r = await download(downloadPath, token);
        assert(r.location === null, `${label} response has no Location header`);
        assert(
          !r.bodyText.includes("blob.core.windows.net"),
          `${label} response never contains a blob.core.windows.net URL`,
        );
      }
    }

    // =======================================================================
    // 4. Missing file id => 404 (for an authorized caller)
    // =======================================================================
    console.log("\nTest 4: Unknown file id returns 404 for an authorized caller");
    {
      const r = await download(`/api/supporting-files/999999999/download`, adminToken);
      assertEqual(r.status, 404, "Unknown file id returns 404");
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
