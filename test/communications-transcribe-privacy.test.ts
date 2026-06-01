/**
 * Automated Tests for Communication Voice Transcription Privacy Rules
 *
 * Verifies that POST /api/communications/transcribe enforces the HIPAA/GDPR
 * relevant access controls that protect client (patient) data:
 *   1. A therapist may only transcribe for their OWN assigned clients.
 *   2. A supervisor may only transcribe for clients of therapists they supervise.
 *   3. Admins have full access.
 *   4. Accountants are blocked from the endpoint entirely.
 *   5. AI processing consent must be granted before any transcription happens.
 *   6. Every denial / success is written to the audit log with the correct action.
 *
 * Run with: npx tsx test/communications-transcribe-privacy.test.ts
 *
 * NOTES:
 * - Spins up the real Express app (registerRoutes) on an ephemeral port and
 *   makes real HTTP requests, so the full middleware + handler chain is exercised.
 * - Seeds dedicated, uniquely-named test users / clients / consents and removes
 *   them (and the audit rows they generate) at the end.
 * - The OpenAI Whisper call is stubbed at the global `fetch` layer so no real
 *   transcription API is hit and no cost is incurred.
 */

import express from "express";
import cookieParser from "cookie-parser";
import type { Server } from "http";
import { db } from "../server/db";
import {
  users,
  clients,
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

const FAKE_TRANSCRIPTION = "This is a simulated transcription for testing.";
const SUFFIX = `t20-${Date.now()}`;

// Tracking for cleanup
const createdUserIds: number[] = [];
const createdClientIds: number[] = [];
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
      return new Response(FAKE_TRANSCRIPTION, {
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

async function grantAiConsent(clientId: number) {
  await storage.createClientConsent({
    clientId,
    consentType: "ai_processing",
    consentVersion: "1.0",
    granted: true,
  } as any);
}

// ---------------------------------------------------------------------------
// Request helper
// ---------------------------------------------------------------------------
let baseUrl = "";

async function transcribeRequest(token: string | null, clientId: number | string | null) {
  const fd = new FormData();
  if (clientId !== null) fd.append("clientId", String(clientId));
  fd.append(
    "audio",
    new Blob([Buffer.from("fake-audio-bytes")], { type: "audio/webm" }),
    "note.webm",
  );

  const headers: Record<string, string> = {};
  if (token) headers["Cookie"] = `sessionToken=${token}`;

  const res = await fetch(`${baseUrl}/api/communications/transcribe`, {
    method: "POST",
    headers,
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

// Returns true if an audit log row exists for (userId, clientId) with the
// given action created at/after the test start time.
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
  console.log("\n🧪 Communication Transcription Privacy Tests\n");

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

    // --- Seed clients ------------------------------------------------------
    // Client WITH consent, assigned to assignedTherapist.
    const consentClient = await makeClient(assignedTherapist.id, "consent-client");
    await grantAiConsent(consentClient.id);
    // Client WITHOUT consent, assigned to assignedTherapist (no consent granted).
    const noConsentClient = await makeClient(assignedTherapist.id, "no-consent-client");

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
      const r = await transcribeRequest(null, consentClient.id);
      assertEqual(r.status, 401, "No session token returns 401");
    }

    // =======================================================================
    // 2. Therapist transcribing for a client they are NOT assigned → 403
    // =======================================================================
    console.log("\nTest 2: Unauthorized therapist (not assigned)");
    {
      const r = await transcribeRequest(otherToken, consentClient.id);
      assertEqual(r.status, 403, "Unassigned therapist gets 403");
      const log = await auditHasAction(
        otherTherapist.id,
        consentClient.id,
        "unauthorized_access",
        testStart,
      );
      assert(!!log, "Denial logged as 'unauthorized_access'");
      if (log) assertEqual(log.result, "denied", "Audit result is 'denied'");
    }

    // =======================================================================
    // 3. Supervisor scope is enforced
    // =======================================================================
    console.log("\nTest 3: Supervisor scope enforcement");
    {
      // Out-of-scope supervisor (does not supervise the assigned therapist) → 403
      const denied = await transcribeRequest(supOutScopeToken, consentClient.id);
      assertEqual(denied.status, 403, "Out-of-scope supervisor gets 403");
      const deniedLog = await auditHasAction(
        supervisorOutOfScope.id,
        consentClient.id,
        "unauthorized_access",
        testStart,
      );
      assert(!!deniedLog, "Out-of-scope supervisor denial logged as 'unauthorized_access'");

      // In-scope supervisor (supervises the assigned therapist) → allowed (200)
      const allowed = await transcribeRequest(supInScopeToken, consentClient.id);
      assertEqual(allowed.status, 200, "In-scope supervisor is allowed (200)");
      assertEqual(
        allowed.body?.transcription,
        FAKE_TRANSCRIPTION,
        "In-scope supervisor receives the transcription",
      );
      const okLog = await auditHasAction(
        supervisorOfAssigned.id,
        consentClient.id,
        "voice_transcription_processed",
        testStart,
      );
      assert(!!okLog, "In-scope supervisor success logged as 'voice_transcription_processed'");
    }

    // =======================================================================
    // 4. Missing AI consent → 403 (even for the assigned therapist)
    // =======================================================================
    console.log("\nTest 4: Missing AI processing consent");
    {
      const r = await transcribeRequest(assignedToken, noConsentClient.id);
      assertEqual(r.status, 403, "No AI consent returns 403");
      const log = await auditHasAction(
        assignedTherapist.id,
        noConsentClient.id,
        "ai_processing_blocked",
        testStart,
      );
      assert(!!log, "Consent denial logged as 'ai_processing_blocked'");
      if (log) assertEqual(log.result, "denied", "Consent denial audit result is 'denied'");
    }

    // =======================================================================
    // 5. Accountant is blocked from the endpoint entirely
    // =======================================================================
    console.log("\nTest 5: Accountant blocked");
    {
      const r = await transcribeRequest(accountantToken, consentClient.id);
      assertEqual(r.status, 403, "Accountant gets 403");
    }

    // =======================================================================
    // 6. Happy path: assigned therapist + consented client → 200 + transcription
    // =======================================================================
    console.log("\nTest 6: Happy path (assigned therapist, consent granted)");
    {
      const r = await transcribeRequest(assignedToken, consentClient.id);
      assertEqual(r.status, 200, "Authorized request returns 200");
      assertEqual(
        r.body?.transcription,
        FAKE_TRANSCRIPTION,
        "Response contains the transcription text",
      );
      const log = await auditHasAction(
        assignedTherapist.id,
        consentClient.id,
        "voice_transcription_processed",
        testStart,
      );
      assert(!!log, "Success logged as 'voice_transcription_processed'");
      if (log) assertEqual(log.result, "success", "Success audit result is 'success'");
    }

    // =======================================================================
    // 7. Admin has full access (different therapist's client)
    // =======================================================================
    console.log("\nTest 7: Admin full access");
    {
      const r = await transcribeRequest(adminToken, consentClient.id);
      assertEqual(r.status, 200, "Admin is allowed (200)");
    }

    // =======================================================================
    // 8. Missing clientId is rejected with 400
    // =======================================================================
    console.log("\nTest 8: Missing clientId");
    {
      const r = await transcribeRequest(assignedToken, null);
      assertEqual(r.status, 400, "Missing clientId returns 400");
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
        // patient_consents cascade-delete with the client.
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
