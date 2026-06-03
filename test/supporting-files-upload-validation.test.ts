/**
 * Automated Tests for supporting-file UPLOAD VALIDATION (bad input rejection)
 *
 * The supporting-file upload route (POST /api/clients/:clientId/supporting-files)
 * feeds extra reference documents into AI client reports. Beyond access control,
 * the route validates the payload itself and rejects bad uploads with a 400:
 *   1. Missing fields (fileContent / originalName / mimeType).
 *   2. Unsupported file type (not .docx / .pdf / .txt).
 *   3. Oversized file (decoded buffer > 15MB).
 *
 * These branches guard against garbage / unsupported / oversized documents
 * silently being accepted and feeding bad data (or PHI) into AI reports. This
 * suite drives an authorized therapist through each branch and confirms:
 *   - the request is rejected with HTTP 400 and a clear error message, and
 *   - NO supporting-file row is persisted for any rejected upload.
 *
 * Run with: npx tsx test/supporting-files-upload-validation.test.ts
 * (Run serially, like the other privacy tests.)
 *
 * NOTES:
 * - Spins up the real Express app (registerRoutes) on an ephemeral port and
 *   makes real HTTP requests, exercising the full middleware + handler chain.
 * - Azure blob uploads inside the route are best-effort and wrapped in
 *   try/catch, so the happy path succeeds even when no storage account is set.
 */

import express from "express";
import cookieParser from "cookie-parser";
import type { Server } from "http";
import { inArray } from "drizzle-orm";

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

const SUFFIX = `t94upval-${Date.now()}`;

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

function messageOf(body: any): string {
  if (body && typeof body === "object" && typeof body.message === "string") return body.message;
  return typeof body === "string" ? body : "";
}

// A small valid .txt upload payload (the happy-path baseline).
function validUploadBody() {
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
  console.log("\n🧪 Supporting-File Upload Validation Tests\n");

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

    // --- Seed an authorized therapist + their client ----------------------
    const therapist = await makeUser("therapist", "upval-therapist");
    const client = await makeClient(therapist.id, "upval-client");
    const token = createSessionToken(therapist);

    const uploadPath = `/api/clients/${client.id}/supporting-files`;

    // Helper: number of supporting-file rows currently persisted for the client.
    async function rowCount(): Promise<number> {
      const rows = await storage.getReportSupportingFilesByClient(client.id);
      return rows.length;
    }

    // =======================================================================
    // 1. Missing required fields -> 400, nothing persisted
    // =======================================================================
    console.log("Test 1: Missing required fields are rejected (400)");
    {
      const before = await rowCount();

      // Missing fileContent.
      const noContent = await req("POST", uploadPath, token, {
        originalName: `missing-content-${SUFFIX}.txt`,
        mimeType: "text/plain",
      });
      assertEqual(noContent.status, 400, "Missing fileContent rejected (400)");
      assert(/required/i.test(messageOf(noContent.body)), "Missing fileContent has a clear 'required' message");

      // Missing originalName.
      const noName = await req("POST", uploadPath, token, {
        fileContent: validUploadBody().fileContent,
        mimeType: "text/plain",
      });
      assertEqual(noName.status, 400, "Missing originalName rejected (400)");

      // Missing mimeType.
      const noMime = await req("POST", uploadPath, token, {
        fileContent: validUploadBody().fileContent,
        originalName: `missing-mime-${SUFFIX}.txt`,
      });
      assertEqual(noMime.status, 400, "Missing mimeType rejected (400)");

      // Empty body entirely.
      const emptyBody = await req("POST", uploadPath, token, {});
      assertEqual(emptyBody.status, 400, "Empty body rejected (400)");

      const after = await rowCount();
      assertEqual(after, before, "No row persisted for missing-field uploads");
    }

    // =======================================================================
    // 2. Unsupported file type -> 400, nothing persisted
    // =======================================================================
    console.log("\nTest 2: Unsupported file type is rejected (400)");
    {
      const before = await rowCount();

      // An image: unsupported mimeType AND unsupported extension.
      const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      const unsupported = await req("POST", uploadPath, token, {
        fileContent: pngBytes.toString("base64"),
        originalName: `evil-${SUFFIX}.png`,
        mimeType: "image/png",
      });
      assertEqual(unsupported.status, 400, "Unsupported file type rejected (400)");
      assert(
        /word|pdf|text|\.docx|\.pdf|\.txt|support/i.test(messageOf(unsupported.body)),
        "Unsupported type error names the allowed formats",
      );

      // An executable-ish payload with a bogus mimeType.
      const exe = await req("POST", uploadPath, token, {
        fileContent: Buffer.from("MZbinary").toString("base64"),
        originalName: `payload-${SUFFIX}.exe`,
        mimeType: "application/octet-stream",
      });
      assertEqual(exe.status, 400, "Unsupported .exe upload rejected (400)");

      const after = await rowCount();
      assertEqual(after, before, "No row persisted for unsupported-type uploads");
    }

    // =======================================================================
    // 3. Oversized file (> 15MB decoded) -> 400, nothing persisted
    // =======================================================================
    console.log("\nTest 3: Oversized file is rejected (400)");
    {
      const before = await rowCount();

      // Use a SUPPORTED type (.txt) so the request reaches the size check, then
      // make the decoded buffer exceed the 15MB cap.
      const oversizedBuffer = Buffer.alloc(15 * 1024 * 1024 + 1024, 0x41); // ~15MB + 1KB of 'A'
      const oversized = await req("POST", uploadPath, token, {
        fileContent: oversizedBuffer.toString("base64"),
        originalName: `huge-${SUFFIX}.txt`,
        mimeType: "text/plain",
      });
      assertEqual(oversized.status, 400, "Oversized file rejected (400)");
      assert(/too large|15\s*MB/i.test(messageOf(oversized.body)), "Oversized error mentions the 15MB limit");

      const after = await rowCount();
      assertEqual(after, before, "No row persisted for oversized uploads");
    }

    // =======================================================================
    // 4. Sanity: a valid upload still succeeds (guards against false 400s)
    // =======================================================================
    console.log("\nTest 4: A valid upload still succeeds (201)");
    {
      const before = await rowCount();
      const ok = await req("POST", uploadPath, token, validUploadBody());
      assertEqual(ok.status, 201, "Valid .txt upload succeeds (201)");
      assert(typeof ok.body?.id === "number", "Valid upload returns the new file id");
      const after = await rowCount();
      assertEqual(after, before + 1, "Exactly one row persisted for the valid upload");
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
