/**
 * Automated Tests for AI Client Report Privacy & Access Rules
 *
 * Verifies that the AI client-report feature enforces the HIPAA/GDPR access
 * controls that protect client (patient) data across its full surface:
 *   1. Report generation fails CLOSED when AI processing consent is not granted,
 *      and the block is audit-logged as 'ai_processing_blocked'.
 *   2. Report generation / listing / viewing / editing / finalizing / downloading
 *      is scoped:
 *        - a therapist may only act on reports for their OWN assigned clients,
 *        - a supervisor only for clients of therapists they supervise,
 *        - an admin for all clients,
 *        - everyone else (and unassigned therapists / out-of-scope supervisors)
 *          gets 403, and accountants are blocked from the endpoints entirely.
 *   3. Only admins can create / delete report templates (others get 403).
 *
 * Run with: npx tsx test/client-report-privacy.test.ts
 *
 * NOTES:
 * - Spins up the real Express app (registerRoutes) on an ephemeral port and
 *   makes real HTTP requests, so the full middleware + handler chain is exercised.
 * - Seeds dedicated, uniquely-named test users / clients / consents / templates /
 *   reports and removes them (and the audit rows they generate) at the end.
 * - The OpenAI chat-completion call is stubbed at the global `fetch` layer so no
 *   real API is hit and no cost is incurred. The module-level OpenAI client in
 *   server/ai/openai.ts captures `globalThis.fetch` at CONSTRUCTION time, so we
 *   MUST install the stub BEFORE any server module is loaded — hence the dynamic
 *   imports in loadServerModules(), called after the stub is installed.
 */

import express from "express";
import cookieParser from "cookie-parser";
import type { Server } from "http";
import { and, eq, gte, inArray, desc } from "drizzle-orm";

let db: typeof import("../server/db")["db"];
let users: typeof import("../shared/schema")["users"];
let clients: typeof import("../shared/schema")["clients"];
let reportTemplates: typeof import("../shared/schema")["reportTemplates"];
let supervisorAssignments: typeof import("../shared/schema")["supervisorAssignments"];
let auditLogs: typeof import("../shared/schema")["auditLogs"];
let registerRoutes: typeof import("../server/routes")["registerRoutes"];
let createSessionToken: typeof import("../server/auth-middleware")["createSessionToken"];
let storage: typeof import("../server/storage")["storage"];

async function loadServerModules() {
  const schema = await import("../shared/schema");
  ({ db } = await import("../server/db"));
  ({ users, clients, reportTemplates, supervisorAssignments, auditLogs } = schema);
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

const FAKE_REPORT_HTML = "<h2>Test Report</h2><p>Simulated AI client report.</p>";
const SUFFIX = `t73-${Date.now()}`;

// Tracking for cleanup
const createdUserIds: number[] = [];
const createdClientIds: number[] = [];
const createdTemplateIds: number[] = [];
const createdAssignmentIds: number[] = [];

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
  const template = await storage.createReportTemplate({
    name: `Test Report Template ${SUFFIX}`,
    originalName: "template.docx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    structureText: "Heading 1\nHeading 2",
    isActive: true,
    createdById,
  } as any);
  createdTemplateIds.push(template.id);
  return template;
}

async function makeReport(clientId: number, templateId: number, createdById: number) {
  return storage.createClientReport({
    clientId,
    templateId,
    templateName: `Test Report Template ${SUFFIX}`,
    generatedContent: FAKE_REPORT_HTML,
    draftContent: null,
    finalContent: null,
    isDraft: true,
    isFinalized: false,
    generatedAt: new Date(),
    createdById,
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
// Request helpers
// ---------------------------------------------------------------------------
let baseUrl = "";

function authHeaders(token: string | null, json = true) {
  const headers: Record<string, string> = {};
  if (json) headers["content-type"] = "application/json";
  if (token) headers["Cookie"] = `sessionToken=${token}`;
  return headers;
}

async function req(
  method: string,
  path: string,
  token: string | null,
  body?: any,
) {
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
  console.log("\n🧪 AI Client Report Privacy & Access Tests\n");

  const testStart = new Date();
  let server: Server | null = null;

  // Ensure the AI key gate (checked before consent) does not short-circuit.
  if (!process.env.OPENAI_API_KEY && !process.env.AI_INTEGRATIONS_OPENAI_API_KEY) {
    process.env.OPENAI_API_KEY = "sk-test-dummy-client-report";
  }

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
    const assignedTherapist = await makeUser("therapist", "assigned-therapist");
    const otherTherapist = await makeUser("therapist", "other-therapist");
    const supInScope = await makeUser("supervisor", "supervisor-in-scope");
    const supOutScope = await makeUser("supervisor", "supervisor-out-scope");
    const admin = await makeUser("admin", "admin");
    const accountant = await makeUser("accountant", "accountant");

    // supInScope supervises assignedTherapist; supOutScope does not.
    const supAssignment = await storage.createSupervisorAssignment({
      supervisorId: supInScope.id,
      therapistId: assignedTherapist.id,
      isActive: true,
    } as any);
    createdAssignmentIds.push(supAssignment.id);

    // --- Seed clients + template -------------------------------------------
    const template = await makeTemplate(admin.id);

    // Client WITH consent, assigned to assignedTherapist.
    const consentClient = await makeClient(assignedTherapist.id, "consent-client");
    await grantAiConsent(consentClient.id);
    // Client WITHOUT consent, assigned to assignedTherapist.
    const noConsentClient = await makeClient(assignedTherapist.id, "no-consent-client");

    // --- Tokens ------------------------------------------------------------
    const assignedToken = createSessionToken(assignedTherapist);
    const otherToken = createSessionToken(otherTherapist);
    const supInToken = createSessionToken(supInScope);
    const supOutToken = createSessionToken(supOutScope);
    const adminToken = createSessionToken(admin);
    const accountantToken = createSessionToken(accountant);

    const genPath = (clientId: number | string) =>
      `/api/clients/${clientId}/reports/generate`;
    const generate = (token: string | null, clientId: number | string) =>
      req("POST", genPath(clientId), token, { templateId: template.id });

    // =======================================================================
    // 1. Generation: unauthenticated request is rejected
    // =======================================================================
    console.log("Test 1: Generation requires authentication");
    {
      const r = await generate(null, consentClient.id);
      assertEqual(r.status, 401, "No session token returns 401");
    }

    // =======================================================================
    // 2. Generation: accountant is blocked from the endpoint entirely
    // =======================================================================
    console.log("\nTest 2: Generation blocked for accountant");
    {
      const r = await generate(accountantToken, consentClient.id);
      assertEqual(r.status, 403, "Accountant gets 403");
    }

    // =======================================================================
    // 3. Generation: access is scoped to assigned clients
    // =======================================================================
    console.log("\nTest 3: Generation access scope");
    {
      const unassigned = await generate(otherToken, consentClient.id);
      assertEqual(unassigned.status, 403, "Unassigned therapist gets 403");

      const outScope = await generate(supOutToken, consentClient.id);
      assertEqual(outScope.status, 403, "Out-of-scope supervisor gets 403");
    }

    // =======================================================================
    // 4. Generation: fails CLOSED without AI consent + audit log
    // =======================================================================
    console.log("\nTest 4: Generation fails closed without consent");
    {
      const r = await generate(assignedToken, noConsentClient.id);
      assertEqual(r.status, 403, "No AI consent returns 403");
      assert(
        r.body?.consentRequired === true,
        "Response flags consentRequired",
      );
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
    // 5. Generation: happy path (assigned therapist + consent) + audit
    // =======================================================================
    console.log("\nTest 5: Generation happy path (assigned therapist, consent)");
    {
      const r = await generate(assignedToken, consentClient.id);
      assertEqual(r.status, 201, "Authorized request returns 201");
      assert(
        typeof r.body?.generatedContent === "string" &&
          r.body.generatedContent.includes("Simulated AI client report"),
        "Response contains the (stubbed) generated report content",
      );
      const log = await auditHasAction(
        assignedTherapist.id,
        consentClient.id,
        "client_report_generated",
        testStart,
      );
      assert(!!log, "Success logged as 'client_report_generated'");
      if (log) assertEqual(log.result, "success", "Success audit result is 'success'");
    }

    // =======================================================================
    // 6. Generation: in-scope supervisor and admin are allowed
    // =======================================================================
    console.log("\nTest 6: Generation allowed for in-scope supervisor and admin");
    {
      const sup = await generate(supInToken, consentClient.id);
      assertEqual(sup.status, 201, "In-scope supervisor can generate (201)");
      const adm = await generate(adminToken, consentClient.id);
      assertEqual(adm.status, 201, "Admin can generate for any client (201)");
    }

    // =======================================================================
    // 7. List reports: access scope
    // =======================================================================
    console.log("\nTest 7: Listing reports access scope");
    {
      const listPath = `/api/clients/${consentClient.id}/reports`;
      assertEqual((await req("GET", listPath, assignedToken)).status, 200, "Assigned therapist can list (200)");
      assertEqual((await req("GET", listPath, otherToken)).status, 403, "Unassigned therapist cannot list (403)");
      assertEqual((await req("GET", listPath, supInToken)).status, 200, "In-scope supervisor can list (200)");
      assertEqual((await req("GET", listPath, supOutToken)).status, 403, "Out-of-scope supervisor cannot list (403)");
      assertEqual((await req("GET", listPath, adminToken)).status, 200, "Admin can list (200)");
      assertEqual((await req("GET", listPath, accountantToken)).status, 403, "Accountant cannot list (403)");
    }

    // =======================================================================
    // 8. View a single report: access scope
    // =======================================================================
    console.log("\nTest 8: Viewing a report access scope");
    {
      const report = await makeReport(consentClient.id, template.id, assignedTherapist.id);
      const path = `/api/reports/${report.id}`;
      assertEqual((await req("GET", path, assignedToken)).status, 200, "Assigned therapist can view (200)");
      assertEqual((await req("GET", path, otherToken)).status, 403, "Unassigned therapist cannot view (403)");
      assertEqual((await req("GET", path, supInToken)).status, 200, "In-scope supervisor can view (200)");
      assertEqual((await req("GET", path, supOutToken)).status, 403, "Out-of-scope supervisor cannot view (403)");
      assertEqual((await req("GET", path, adminToken)).status, 200, "Admin can view (200)");
      assertEqual((await req("GET", path, accountantToken)).status, 403, "Accountant cannot view (403)");
    }

    // =======================================================================
    // 9. Edit (save draft): access scope
    // =======================================================================
    console.log("\nTest 9: Editing a report access scope");
    {
      const report = await makeReport(consentClient.id, template.id, assignedTherapist.id);
      const path = `/api/reports/${report.id}`;
      const draft = { draftContent: "<p>edited</p>" };
      assertEqual((await req("PUT", path, otherToken, draft)).status, 403, "Unassigned therapist cannot edit (403)");
      assertEqual((await req("PUT", path, supOutToken, draft)).status, 403, "Out-of-scope supervisor cannot edit (403)");
      assertEqual((await req("PUT", path, accountantToken, draft)).status, 403, "Accountant cannot edit (403)");
      assertEqual((await req("PUT", path, assignedToken, draft)).status, 200, "Assigned therapist can edit (200)");
      assertEqual((await req("PUT", path, supInToken, draft)).status, 200, "In-scope supervisor can edit (200)");
      assertEqual((await req("PUT", path, adminToken, draft)).status, 200, "Admin can edit (200)");
    }

    // =======================================================================
    // 10. Finalize: access scope
    // =======================================================================
    console.log("\nTest 10: Finalizing a report access scope");
    {
      // A report can only be finalized once, so use a fresh report per positive case.
      const report = await makeReport(consentClient.id, template.id, assignedTherapist.id);
      const path = `/api/reports/${report.id}/finalize`;
      assertEqual((await req("POST", path, otherToken)).status, 403, "Unassigned therapist cannot finalize (403)");
      assertEqual((await req("POST", path, supOutToken)).status, 403, "Out-of-scope supervisor cannot finalize (403)");
      assertEqual((await req("POST", path, accountantToken)).status, 403, "Accountant cannot finalize (403)");
      const ok = await req("POST", path, assignedToken);
      assertEqual(ok.status, 200, "Assigned therapist can finalize (200)");
      const log = await auditHasAction(
        assignedTherapist.id,
        consentClient.id,
        "client_report_finalized",
        testStart,
      );
      assert(!!log, "Finalize logged as 'client_report_finalized'");

      // In-scope supervisor can finalize one of their supervisee's client reports.
      const supReport = await makeReport(consentClient.id, template.id, assignedTherapist.id);
      assertEqual(
        (await req("POST", `/api/reports/${supReport.id}/finalize`, supInToken)).status,
        200,
        "In-scope supervisor can finalize (200)",
      );

      // Admin can finalize any client's report.
      const adminReport = await makeReport(consentClient.id, template.id, assignedTherapist.id);
      assertEqual(
        (await req("POST", `/api/reports/${adminReport.id}/finalize`, adminToken)).status,
        200,
        "Admin can finalize (200)",
      );
    }

    // =======================================================================
    // 11. Download (PDF): access scope
    // =======================================================================
    console.log("\nTest 11: Downloading a report access scope");
    {
      const report = await makeReport(consentClient.id, template.id, assignedTherapist.id);
      const path = `/api/reports/${report.id}/download/pdf`;
      assertEqual((await req("GET", path, otherToken)).status, 403, "Unassigned therapist cannot download (403)");
      assertEqual((await req("GET", path, supOutToken)).status, 403, "Out-of-scope supervisor cannot download (403)");
      assertEqual((await req("GET", path, accountantToken)).status, 403, "Accountant cannot download (403)");
      assertEqual((await req("GET", path, assignedToken)).status, 200, "Assigned therapist can download (200)");
      assertEqual((await req("GET", path, supInToken)).status, 200, "In-scope supervisor can download (200)");
      assertEqual((await req("GET", path, adminToken)).status, 200, "Admin can download (200)");
    }

    // =======================================================================
    // 12. Report templates: only admins can create
    // =======================================================================
    console.log("\nTest 12: Only admins can create report templates");
    {
      const path = "/api/report-templates";
      // Non-admins are rejected on the role gate (before any body validation).
      assertEqual((await req("POST", path, otherToken, {})).status, 403, "Therapist cannot create template (403)");
      assertEqual((await req("POST", path, supInToken, {})).status, 403, "Supervisor cannot create template (403)");
      assertEqual((await req("POST", path, accountantToken, {})).status, 403, "Accountant cannot create template (403)");
      // Admin passes the role gate (then fails body validation with 400, NOT 403).
      const adm = await req("POST", path, adminToken, {});
      assertEqual(adm.status, 400, "Admin passes role gate and reaches body validation (400)");
    }

    // =======================================================================
    // 13. Report templates: only admins can delete
    // =======================================================================
    console.log("\nTest 13: Only admins can delete report templates");
    {
      const target = await makeTemplate(admin.id);
      const path = `/api/report-templates/${target.id}`;
      assertEqual((await req("DELETE", path, otherToken)).status, 403, "Therapist cannot delete template (403)");
      assertEqual((await req("DELETE", path, supInToken)).status, 403, "Supervisor cannot delete template (403)");
      assertEqual((await req("DELETE", path, accountantToken)).status, 403, "Accountant cannot delete template (403)");
      const adm = await req("DELETE", path, adminToken);
      assertEqual(adm.status, 200, "Admin can delete template (200)");
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
        // Deleting clients cascades reports and consents.
        await db.delete(clients).where(inArray(clients.id, createdClientIds));
      }
      if (createdTemplateIds.length > 0) {
        await db
          .delete(reportTemplates)
          .where(inArray(reportTemplates.id, createdTemplateIds));
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
