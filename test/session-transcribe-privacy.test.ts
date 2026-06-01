/**
 * Automated Tests for Session Voice Transcription Privacy Rules
 *
 * Verifies that the chunked session-recording flow
 *   POST /api/sessions/:sessionId/transcribe-start
 *   POST /api/sessions/:sessionId/transcribe-chunk
 *   POST /api/sessions/:sessionId/transcribe-finalize
 * enforces the same HIPAA/GDPR access controls that protect client (patient)
 * data as the standalone communications transcribe endpoint:
 *   1. A therapist may only record for their OWN sessions.
 *   2. A supervisor may only record for sessions of therapists they supervise.
 *   3. Admins have full access.
 *   4. Accountants are blocked from the endpoints entirely.
 *   5. AI processing consent must be granted before any transcription happens.
 *   6. A successful finalize is written to the audit log
 *      (action 'session_transcript_created', result 'success').
 *
 * Run with: npx tsx test/session-transcribe-privacy.test.ts
 *
 * NOTES:
 * - Spins up the real Express app (registerRoutes) on an ephemeral port and
 *   makes real HTTP requests, so the full middleware + handler chain is exercised.
 * - Seeds dedicated, uniquely-named test users / clients / consents / sessions
 *   and removes them (and the audit rows they generate) at the end.
 * - The OpenAI Whisper call is stubbed at the global `fetch` layer so no real
 *   transcription API is hit and no cost is incurred.
 * - The session transcribe-start/chunk endpoints do NOT write audit rows on
 *   denial (they just return 403). We therefore assert the HTTP status on
 *   denial and the audit row only on the happy-path finalize.
 */

import express from "express";
import cookieParser from "cookie-parser";
import type { Server } from "http";
import { db } from "../server/db";
import {
  users,
  clients,
  services,
  sessions,
  supervisorAssignments,
  auditLogs,
} from "../shared/schema";
import { registerRoutes } from "../server/routes";
import { createSessionToken } from "../server/auth-middleware";
import { storage } from "../server/storage";
import { and, eq, gte, inArray, desc } from "drizzle-orm";

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

const FAKE_CHUNK_TEXT = "This is a simulated session chunk transcription.";
const SUFFIX = `t24s-${Date.now()}`;

// Tracking for cleanup
const createdUserIds: number[] = [];
const createdClientIds: number[] = [];
const createdServiceIds: number[] = [];
const createdAssignmentIds: number[] = [];

// ---------------------------------------------------------------------------
// Stub the OpenAI Whisper call (it goes through global fetch under the hood)
// ---------------------------------------------------------------------------
const originalFetch = globalThis.fetch;
function installFetchStub() {
  globalThis.fetch = (async (input: any, init?: any) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : (input?.url ?? String(input));
    if (url.includes("/audio/transcriptions")) {
      return new Response(FAKE_CHUNK_TEXT, {
        status: 200,
        headers: { "content-type": "text/plain" },
      });
    }
    return originalFetch(input, init);
  }) as typeof fetch;
}
function restoreFetch() {
  globalThis.fetch = originalFetch;
}

// ---------------------------------------------------------------------------
// Seed helpers
// ---------------------------------------------------------------------------
async function makeUser(role: string, label: string) {
  const user = await storage.createUser({
    username: `${label}-${SUFFIX}`,
    password: "x", // never used; auth is via minted token
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

async function makeService() {
  const service = await storage.createService({
    serviceCode: `SVC-${SUFFIX}`,
    serviceName: `Test Service ${SUFFIX}`,
    duration: 60,
    baseRate: "100.00",
  } as any);
  createdServiceIds.push(service.id);
  return service;
}

async function makeSession(therapistId: number, clientId: number, serviceId: number) {
  const session = await storage.createSession({
    clientId,
    therapistId,
    serviceId,
    sessionDate: new Date(),
    sessionType: "individual",
    status: "scheduled",
  } as any);
  return session;
}

async function grantAiConsent(clientId: number) {
  await storage.createClientConsent({
    clientId,
    consentType: "ai_processing",
    consentVersion: "1.0",
    granted: true,
  } as any);
}

// ---------------------------------------------------------------------------
// Request helpers
// ---------------------------------------------------------------------------
let baseUrl = "";

function authHeaders(token: string | null): Record<string, string> {
  const headers: Record<string, string> = {};
  if (token) headers["Cookie"] = `sessionToken=${token}`;
  return headers;
}

async function startRequest(token: string | null, sessionId: number) {
  const res = await fetch(`${baseUrl}/api/sessions/${sessionId}/transcribe-start`, {
    method: "POST",
    headers: { ...authHeaders(token), "content-type": "application/json" },
    body: JSON.stringify({}),
  });
  let body: any = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { status: res.status, body };
}

async function chunkRequest(token: string | null, sessionId: number, uploadId: string) {
  const fd = new FormData();
  fd.append("uploadId", uploadId);
  fd.append("chunkIndex", "0");
  fd.append("chunkDurationSeconds", "5");
  fd.append(
    "audio",
    new Blob([Buffer.from("fake-audio-bytes")], { type: "audio/webm" }),
    "chunk-0.webm",
  );
  const res = await fetch(`${baseUrl}/api/sessions/${sessionId}/transcribe-chunk`, {
    method: "POST",
    headers: authHeaders(token),
    body: fd,
  });
  let body: any = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { status: res.status, body };
}

async function finalizeRequest(token: string | null, sessionId: number, uploadId: string) {
  const res = await fetch(`${baseUrl}/api/sessions/${sessionId}/transcribe-finalize`, {
    method: "POST",
    headers: { ...authHeaders(token), "content-type": "application/json" },
    body: JSON.stringify({ uploadId, expectedChunks: 1, totalChunks: 1 }),
  });
  let body: any = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { status: res.status, body };
}

// Returns the audit row for (userId, clientId, action) created at/after `since`.
async function auditHasAction(
  userId: number,
  clientId: number,
  action: string,
  since: Date,
) {
  const rows = await db
    .select()
    .from(auditLogs)
    .where(
      and(
        eq(auditLogs.userId, userId),
        eq(auditLogs.clientId, clientId),
        eq(auditLogs.action, action as any),
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
  console.log("\n🧪 Session Transcription Privacy Tests\n");

  const testStart = new Date();
  let server: Server | null = null;

  try {
    // --- Build the real app -------------------------------------------------
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

    installFetchStub();

    // --- Seed users --------------------------------------------------------
    const assignedTherapist = await makeUser("therapist", "assigned-therapist");
    const otherTherapist = await makeUser("therapist", "other-therapist");
    const supervisorOfAssigned = await makeUser("supervisor", "supervisor-in-scope");
    const supervisorOutOfScope = await makeUser("supervisor", "supervisor-out-scope");
    const admin = await makeUser("admin", "admin");
    const accountant = await makeUser("accountant", "accountant");

    // supervisorOfAssigned supervises assignedTherapist; the other does not.
    const assignment = await storage.createSupervisorAssignment({
      supervisorId: supervisorOfAssigned.id,
      therapistId: assignedTherapist.id,
      isActive: true,
    } as any);
    createdAssignmentIds.push(assignment.id);

    // --- Seed service + clients + sessions ---------------------------------
    const service = await makeService();

    // Client WITH consent + a session owned by assignedTherapist.
    const consentClient = await makeClient(assignedTherapist.id, "consent-client");
    await grantAiConsent(consentClient.id);
    const consentSession = await makeSession(
      assignedTherapist.id,
      consentClient.id,
      service.id,
    );

    // Client WITHOUT consent + a session owned by assignedTherapist.
    const noConsentClient = await makeClient(assignedTherapist.id, "no-consent-client");
    const noConsentSession = await makeSession(
      assignedTherapist.id,
      noConsentClient.id,
      service.id,
    );

    // --- Tokens ------------------------------------------------------------
    const assignedToken = createSessionToken(assignedTherapist);
    const otherToken = createSessionToken(otherTherapist);
    const supInScopeToken = createSessionToken(supervisorOfAssigned);
    const supOutScopeToken = createSessionToken(supervisorOutOfScope);
    const adminToken = createSessionToken(admin);
    const accountantToken = createSessionToken(accountant);

    // =======================================================================
    // 1. Unauthenticated request is rejected
    // =======================================================================
    console.log("Test 1: Unauthenticated request");
    {
      const r = await startRequest(null, consentSession.id);
      assertEqual(r.status, 401, "No session token returns 401");
    }

    // =======================================================================
    // 2. Therapist starting on a session they do NOT own → 403
    // =======================================================================
    console.log("\nTest 2: Unauthorized therapist (not session owner)");
    {
      const r = await startRequest(otherToken, consentSession.id);
      assertEqual(r.status, 403, "Non-owner therapist gets 403");
    }

    // =======================================================================
    // 3. Supervisor scope is enforced
    // =======================================================================
    console.log("\nTest 3: Supervisor scope enforcement");
    {
      // Out-of-scope supervisor → 403
      const denied = await startRequest(supOutScopeToken, consentSession.id);
      assertEqual(denied.status, 403, "Out-of-scope supervisor gets 403");

      // In-scope supervisor → allowed (200) and receives a server-minted uploadId
      const allowed = await startRequest(supInScopeToken, consentSession.id);
      assertEqual(allowed.status, 200, "In-scope supervisor is allowed (200)");
      assert(
        typeof allowed.body?.uploadId === "string" &&
          allowed.body.uploadId.startsWith("srv-"),
        "In-scope supervisor receives a server-minted uploadId",
      );
    }

    // =======================================================================
    // 4. Missing AI consent → 403 (even for the owning therapist)
    // =======================================================================
    console.log("\nTest 4: Missing AI processing consent");
    {
      const r = await startRequest(assignedToken, noConsentSession.id);
      assertEqual(r.status, 403, "No AI consent returns 403");
    }

    // =======================================================================
    // 5. Accountant is blocked from the endpoint entirely
    // =======================================================================
    console.log("\nTest 5: Accountant blocked");
    {
      const r = await startRequest(accountantToken, consentSession.id);
      assertEqual(r.status, 403, "Accountant gets 403 on transcribe-start");
      // chunk endpoint must also reject accountants
      const c = await chunkRequest(accountantToken, consentSession.id, "srv-irrelevant");
      assertEqual(c.status, 403, "Accountant gets 403 on transcribe-chunk");
    }

    // =======================================================================
    // 6. Chunk upload rejects a non-owner therapist (upload binding) → 403
    // =======================================================================
    console.log("\nTest 6: Chunk upload bound to starting user");
    {
      const start = await startRequest(assignedToken, consentSession.id);
      assertEqual(start.status, 200, "Owner can start an upload");
      const uploadId = start.body.uploadId as string;

      // A different therapist cannot push chunks to this session at all.
      const hijack = await chunkRequest(otherToken, consentSession.id, uploadId);
      assertEqual(hijack.status, 403, "Non-owner therapist cannot upload chunks (403)");
    }

    // =======================================================================
    // 7. Happy path: assigned therapist start → chunk → finalize → 200 + audit
    // =======================================================================
    console.log("\nTest 7: Happy path (owner therapist, consent granted)");
    {
      const start = await startRequest(assignedToken, consentSession.id);
      assertEqual(start.status, 200, "Start returns 200");
      const uploadId = start.body.uploadId as string;

      const chunk = await chunkRequest(assignedToken, consentSession.id, uploadId);
      assertEqual(chunk.status, 200, "Chunk upload returns 200");
      assertEqual(
        chunk.body?.chunkText,
        FAKE_CHUNK_TEXT,
        "Chunk response contains the (stubbed) transcription text",
      );

      const finalize = await finalizeRequest(assignedToken, consentSession.id, uploadId);
      assertEqual(finalize.status, 200, "Finalize returns 200");
      assertEqual(finalize.body?.status, "ready", "Finalized transcript status is 'ready'");

      const log = await auditHasAction(
        assignedTherapist.id,
        consentClient.id,
        "session_transcript_created",
        testStart,
      );
      assert(!!log, "Finalize success logged as 'session_transcript_created'");
      if (log) assertEqual(log.result, "success", "Success audit result is 'success'");
    }

    // =======================================================================
    // 8. Admin has full access (different therapist's session)
    // =======================================================================
    console.log("\nTest 8: Admin full access");
    {
      const r = await startRequest(adminToken, consentSession.id);
      assertEqual(r.status, 200, "Admin can start an upload (200)");
    }

    // =======================================================================
    // 9. Invalid session id is rejected with 400
    // =======================================================================
    console.log("\nTest 9: Invalid session id");
    {
      const res = await fetch(`${baseUrl}/api/sessions/not-a-number/transcribe-start`, {
        method: "POST",
        headers: { ...authHeaders(assignedToken), "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      assertEqual(res.status, 400, "Invalid session id returns 400");
    }
  } catch (error) {
    console.error("\n❌ Test suite error:", error);
    testsFailed++;
  } finally {
    // --- Cleanup -----------------------------------------------------------
    restoreFetch();
    try {
      if (createdClientIds.length > 0) {
        // audit_logs.clientId is ON DELETE SET NULL, so remove our audit rows first.
        await db.delete(auditLogs).where(inArray(auditLogs.clientId, createdClientIds));
      }
      if (createdUserIds.length > 0) {
        await db.delete(auditLogs).where(inArray(auditLogs.userId, createdUserIds));
      }
      if (createdAssignmentIds.length > 0) {
        await db
          .delete(supervisorAssignments)
          .where(inArray(supervisorAssignments.id, createdAssignmentIds));
      }
      if (createdClientIds.length > 0) {
        // Deleting clients cascades sessions → session_transcripts and consents.
        await db.delete(clients).where(inArray(clients.id, createdClientIds));
      }
      if (createdServiceIds.length > 0) {
        await db.delete(services).where(inArray(services.id, createdServiceIds));
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

  // --- Summary -------------------------------------------------------------
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
  restoreFetch();
  process.exit(1);
});
