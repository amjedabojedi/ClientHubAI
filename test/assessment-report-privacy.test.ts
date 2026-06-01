/**
 * Automated Tests for AI Assessment Report Privacy Rules
 *
 * Verifies that POST /api/assessments/assignments/:assignmentId/generate-report
 * enforces the HIPAA/GDPR access controls that protect client (patient) data:
 *   1. Only the user who CREATED the assessment (assignedById) may generate a report.
 *   2. A different therapist (not the creator) is denied.
 *   3. Admins can view assessments but cannot generate reports (edit) → denied.
 *   4. Accountants are blocked from the endpoint entirely.
 *   5. AI processing consent must be granted before any report is generated.
 *   6. Consent denial logs 'ai_processing_blocked'; success logs
 *      'assessment_report_generated'.
 *
 * Run with: npx tsx test/assessment-report-privacy.test.ts
 *
 * NOTES:
 * - Spins up the real Express app (registerRoutes) on an ephemeral port and
 *   makes real HTTP requests, so the full middleware + handler chain is exercised.
 * - Seeds dedicated, uniquely-named test users / clients / consents / templates
 *   / assignments and removes them (and the audit rows they generate) at the end.
 * - The OpenAI chat-completion call is stubbed at the global `fetch` layer so no
 *   real API is hit and no cost is incurred.
 * - The creator-permission denial returns 403 WITHOUT writing an audit row (the
 *   endpoint short-circuits before logging), so we assert HTTP status only there.
 */

import express from "express";
import cookieParser from "cookie-parser";
import type { Server } from "http";
import { and, eq, gte, inArray, desc } from "drizzle-orm";

// IMPORTANT: the module-level OpenAI client in server/ai/openai.ts captures
// `globalThis.fetch` at CONSTRUCTION time (this.fetch = options.fetch ??
// getDefaultFetch()). server/routes.ts imports that module statically, so we
// MUST install our fetch stub BEFORE any server module is loaded — otherwise
// the chat-completion client keeps a reference to the real fetch and the stub
// is never used. We therefore load all server modules dynamically, after the
// stub is installed at the top of run().
let db: typeof import("../server/db")["db"];
let users: typeof import("../shared/schema")["users"];
let clients: typeof import("../shared/schema")["clients"];
let assessmentTemplates: typeof import("../shared/schema")["assessmentTemplates"];
let assessmentAssignments: typeof import("../shared/schema")["assessmentAssignments"];
let auditLogs: typeof import("../shared/schema")["auditLogs"];
let registerRoutes: typeof import("../server/routes")["registerRoutes"];
let createSessionToken: typeof import("../server/auth-middleware")["createSessionToken"];
let storage: typeof import("../server/storage")["storage"];

async function loadServerModules() {
  const schema = await import("../shared/schema");
  ({ db } = await import("../server/db"));
  ({ users, clients, assessmentTemplates, assessmentAssignments, auditLogs } = schema);
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

const FAKE_REPORT_HTML = "<h2>Test Report</h2><p>Simulated AI assessment report.</p>";
const SUFFIX = `t24a-${Date.now()}`;

// Tracking for cleanup
const createdUserIds: number[] = [];
const createdClientIds: number[] = [];
const createdTemplateIds: number[] = [];

// ---------------------------------------------------------------------------
// Stub the OpenAI chat-completion call (it goes through global fetch under the hood)
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
    if (url.includes("/chat/completions")) {
      const payload = {
        id: "chatcmpl-test",
        object: "chat.completion",
        created: 0,
        model: "gpt-4o",
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: FAKE_REPORT_HTML },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      };
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "content-type": "application/json" },
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

async function makeTemplate(createdById: number) {
  const template = await storage.createAssessmentTemplate({
    name: `Test Assessment ${SUFFIX}`,
    createdById,
  } as any);
  createdTemplateIds.push(template.id);
  return template;
}

async function makeAssignment(templateId: number, clientId: number, assignedById: number) {
  return storage.createAssessmentAssignment({
    templateId,
    clientId,
    assignedById,
    status: "completed",
  } as any);
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

async function generateReportRequest(token: string | null, assignmentId: number | string) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token) headers["Cookie"] = `sessionToken=${token}`;
  const res = await fetch(
    `${baseUrl}/api/assessments/assignments/${assignmentId}/generate-report`,
    { method: "POST", headers, body: JSON.stringify({}) },
  );
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
  console.log("\n🧪 AI Assessment Report Privacy Tests\n");

  const testStart = new Date();
  let server: Server | null = null;

  // Install the fetch stub FIRST, then load all server modules so the
  // module-level OpenAI client constructs with the stubbed fetch.
  installFetchStub();
  await loadServerModules();

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

    // --- Seed users --------------------------------------------------------
    const creator = await makeUser("therapist", "creator-therapist");
    const otherTherapist = await makeUser("therapist", "other-therapist");
    const admin = await makeUser("admin", "admin");
    const accountant = await makeUser("accountant", "accountant");

    // --- Seed clients + template + assignments -----------------------------
    const template = await makeTemplate(creator.id);

    // Client WITH consent, assignment created by `creator`.
    const consentClient = await makeClient(creator.id, "consent-client");
    await grantAiConsent(consentClient.id);
    const consentAssignment = await makeAssignment(
      template.id,
      consentClient.id,
      creator.id,
    );

    // Client WITHOUT consent, assignment created by `creator`.
    const noConsentClient = await makeClient(creator.id, "no-consent-client");
    const noConsentAssignment = await makeAssignment(
      template.id,
      noConsentClient.id,
      creator.id,
    );

    // --- Tokens ------------------------------------------------------------
    const creatorToken = createSessionToken(creator);
    const otherToken = createSessionToken(otherTherapist);
    const adminToken = createSessionToken(admin);
    const accountantToken = createSessionToken(accountant);

    // =======================================================================
    // 1. Unauthenticated request is rejected
    // =======================================================================
    console.log("Test 1: Unauthenticated request");
    {
      const r = await generateReportRequest(null, consentAssignment.id);
      assertEqual(r.status, 401, "No session token returns 401");
    }

    // =======================================================================
    // 2. A therapist who did NOT create the assessment → 403
    // =======================================================================
    console.log("\nTest 2: Unauthorized therapist (not the creator)");
    {
      const r = await generateReportRequest(otherToken, consentAssignment.id);
      assertEqual(r.status, 403, "Non-creator therapist gets 403");
    }

    // =======================================================================
    // 3. Admin can view but cannot generate (edit) → 403
    // =======================================================================
    console.log("\nTest 3: Admin cannot generate (edit-only restriction)");
    {
      const r = await generateReportRequest(adminToken, consentAssignment.id);
      assertEqual(r.status, 403, "Admin gets 403 (view-only, cannot generate)");
    }

    // =======================================================================
    // 4. Accountant is blocked from the endpoint entirely
    // =======================================================================
    console.log("\nTest 4: Accountant blocked");
    {
      const r = await generateReportRequest(accountantToken, consentAssignment.id);
      assertEqual(r.status, 403, "Accountant gets 403");
    }

    // =======================================================================
    // 5. Missing AI consent → 403 + ai_processing_blocked audit
    // =======================================================================
    console.log("\nTest 5: Missing AI processing consent");
    {
      const r = await generateReportRequest(creatorToken, noConsentAssignment.id);
      assertEqual(r.status, 403, "No AI consent returns 403");
      const log = await auditHasAction(
        creator.id,
        noConsentClient.id,
        "ai_processing_blocked",
        testStart,
      );
      assert(!!log, "Consent denial logged as 'ai_processing_blocked'");
      if (log) assertEqual(log.result, "denied", "Consent denial audit result is 'denied'");
    }

    // =======================================================================
    // 6. Happy path: creator + consent → 201 + assessment_report_generated audit
    // =======================================================================
    console.log("\nTest 6: Happy path (creator, consent granted)");
    {
      const r = await generateReportRequest(creatorToken, consentAssignment.id);
      assertEqual(r.status, 201, "Authorized request returns 201");
      assert(
        typeof r.body?.generatedContent === "string" &&
          r.body.generatedContent.includes("Simulated AI assessment report"),
        "Response contains the (stubbed) generated report content",
      );
      const log = await auditHasAction(
        creator.id,
        consentClient.id,
        "assessment_report_generated",
        testStart,
      );
      assert(!!log, "Success logged as 'assessment_report_generated'");
      if (log) assertEqual(log.result, "success", "Success audit result is 'success'");
    }

    // =======================================================================
    // 7. Invalid assignment id is rejected with 400
    // =======================================================================
    console.log("\nTest 7: Invalid assignment id");
    {
      const r = await generateReportRequest(creatorToken, "not-a-number");
      assertEqual(r.status, 400, "Invalid assignment id returns 400");
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
      if (createdClientIds.length > 0) {
        // Deleting clients cascades assignments → responses → reports and consents.
        await db.delete(clients).where(inArray(clients.id, createdClientIds));
      }
      if (createdTemplateIds.length > 0) {
        await db
          .delete(assessmentTemplates)
          .where(inArray(assessmentTemplates.id, createdTemplateIds));
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
