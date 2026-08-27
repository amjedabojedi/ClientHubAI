/**
 * Automated test for session-note PDF authorization.
 *
 * The PDF endpoint must apply the same service-visibility check as the normal
 * session-note read route. A non-admin must not receive a PDF for a note whose
 * session uses a hidden service, even when that user can guess the note ID.
 *
 * Run with: npx tsx test/session-note-pdf-authz.test.ts
 */

import express from "express";
import cookieParser from "cookie-parser";
import type { Server } from "http";
import { inArray } from "drizzle-orm";
import { db } from "../server/db";
import {
  users,
  clients,
  services,
  sessions,
  sessionNotes,
} from "../shared/schema";
import { registerRoutes } from "../server/routes";
import { createSessionToken } from "../server/auth-middleware";
import { storage } from "../server/storage";

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

const SUFFIX = `t-pdf-authz-${Date.now()}`;
const createdUserIds: number[] = [];
const createdClientIds: number[] = [];
const createdServiceIds: number[] = [];
const createdSessionIds: number[] = [];
const createdSessionNoteIds: number[] = [];

let baseUrl = "";

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

async function requestPdf(path: string, token: string | null) {
  const headers: Record<string, string> = {};
  if (token) headers.Cookie = `sessionToken=${token}`;

  const response = await fetch(`${baseUrl}${path}`, { headers });
  const bytes = Buffer.from(await response.arrayBuffer());
  const contentType = response.headers.get("content-type") || "";
  let body: any = null;
  if (contentType.includes("application/json")) {
    try {
      body = JSON.parse(bytes.toString("utf8"));
    } catch {
      body = null;
    }
  }

  return {
    status: response.status,
    contentType,
    contentDisposition: response.headers.get("content-disposition"),
    bytes,
    body,
  };
}

async function run() {
  console.log("\n🧪 Session-Note PDF Authorization Tests\n");

  let server: Server | null = null;

  try {
    const app = express();
    app.use(express.json({ limit: "50mb" }));
    app.use(express.urlencoded({ extended: false, limit: "50mb" }));
    app.use(cookieParser());
    server = await registerRoutes(app);
    await new Promise<void>((resolve) => server!.listen(0, resolve));
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    baseUrl = `http://127.0.0.1:${port}`;
    console.log(`   Test server listening on ${baseUrl}\n`);

    const owner = await makeUser("therapist", "pdf-owner");
    const otherTherapist = await makeUser("therapist", "pdf-other");
    const admin = await makeUser("admin", "pdf-admin");

    const client = await storage.createClient({
      fullName: `PDF Authorization Client ${SUFFIX}`,
      assignedTherapistId: owner.id,
    } as any);
    createdClientIds.push(client.id);

    const hiddenService = await storage.createService({
      serviceCode: `PDF-${SUFFIX}`,
      serviceName: `Hidden PDF Test Service ${SUFFIX}`,
      duration: 60,
      baseRate: "100.00",
      isActive: true,
      therapistVisible: false,
      clientPortalVisible: true,
    } as any);
    createdServiceIds.push(hiddenService.id);

    const session = await storage.createSession({
      clientId: client.id,
      therapistId: owner.id,
      serviceId: hiddenService.id,
      sessionDate: new Date(),
      sessionType: "individual",
      status: "completed",
    } as any);
    createdSessionIds.push(session.id);

    const note = await storage.createSessionNote({
      sessionId: session.id,
      clientId: client.id,
      therapistId: owner.id,
      date: new Date(),
      sessionFocus: "Protected session note",
      generatedContent: "<p>Protected clinical note content.</p>",
      draftContent: null,
      finalContent: null,
      isDraft: true,
      isFinalized: false,
      aiEnabled: false,
    } as any);
    createdSessionNoteIds.push(note.id);

    const notePath = `/api/session-notes/${note.id}/pdf`;
    const ownerToken = createSessionToken(owner);
    const otherToken = createSessionToken(otherTherapist);
    const adminToken = createSessionToken(admin);

    console.log("Test 1: Hidden-service PDF access is denied to non-admins");
    for (const [label, token] of [
      ["assigned therapist", ownerToken],
      ["unassigned therapist", otherToken],
    ] as const) {
      const denied = await requestPdf(notePath, token);
      assertEqual(denied.status, 404, `${label} gets a non-disclosing 404`);
      assert(
        denied.contentType.startsWith("application/json"),
        `${label} receives JSON instead of PDF bytes`,
      );
      assertEqual(
        denied.body?.message,
        "Session note not found",
        `${label} receives the generic not-found message`,
      );
      assert(
        !denied.bytes.toString("utf8").includes("Protected clinical note content"),
        `${label} response does not contain clinical note content`,
      );
    }

    console.log("\nTest 2: Admin can retrieve the hidden-service PDF");
    const allowed = await requestPdf(notePath, adminToken);
    assertEqual(allowed.status, 200, "Admin receives the PDF");
    assertEqual(allowed.contentType, "application/pdf", "Admin response is application/pdf");
    assert(
      allowed.bytes.subarray(0, 5).equals(Buffer.from("%PDF-")),
      "Admin response starts with the PDF signature",
    );
    assertEqual(
      allowed.contentDisposition,
      `inline; filename="session-note-${note.id}.pdf"`,
      "Admin response uses the session-note PDF filename",
    );
  } catch (error) {
    console.error("\n❌ Test suite error:", error);
    testsFailed++;
  } finally {
    try {
      if (createdSessionNoteIds.length > 0) {
        await db.delete(sessionNotes).where(inArray(sessionNotes.id, createdSessionNoteIds));
      }
      if (createdSessionIds.length > 0) {
        await db.delete(sessions).where(inArray(sessions.id, createdSessionIds));
      }
      if (createdClientIds.length > 0) {
        await db.delete(clients).where(inArray(clients.id, createdClientIds));
      }
      if (createdServiceIds.length > 0) {
        await db.delete(services).where(inArray(services.id, createdServiceIds));
      }
      if (createdUserIds.length > 0) {
        await db.delete(users).where(inArray(users.id, createdUserIds));
      }
      console.log("\n🧹 Cleanup complete.");
    } catch (cleanupError) {
      console.error("⚠️ Cleanup error:", cleanupError);
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
    console.log("\n⚠️ Some tests failed. Please review the output above.");
    process.exit(1);
  }
}

run().catch((error) => {
  console.error("Fatal error running tests:", error);
  process.exit(1);
});