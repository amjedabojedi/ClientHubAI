/**
 * Automated Tests for AI Client Report TEMPLATE-DEFAULT source fallback.
 *
 * The source-selection tests always pass explicit profile/sessions/assessments
 * toggles. This suite covers the OTHER path: when a therapist generates a report
 * WITHOUT a `sources` object in the request body, the generate route must fall
 * back to the template's saved defaults
 * (`defaultIncludeProfile`, `defaultIncludeNotes`, `defaultIncludeAssessments`).
 *
 * We seed templates with NON-default toggle combinations and generate with no
 * `sources`, then assert the captured AI prompt honors those template defaults.
 *
 * Run with: npx tsx test/client-report-template-defaults.test.ts
 * (Run serially, like the other privacy tests — it seeds clients with a
 *  CL-<year>-<MAX+1> id and races on concurrent inserts otherwise.)
 *
 * NOTES:
 * - Spins up the real Express app (registerRoutes) on an ephemeral port and
 *   makes real HTTP requests, so the full middleware + handler chain runs.
 * - The OpenAI chat-completion call is stubbed at the global `fetch` layer; the
 *   stub also CAPTURES the outgoing prompt so we can assert exactly what data
 *   the AI was given. The module-level OpenAI client captures `globalThis.fetch`
 *   at CONSTRUCTION time, so the stub MUST be installed BEFORE any server module
 *   is loaded — hence the dynamic imports in loadServerModules().
 */

import express from "express";
import cookieParser from "cookie-parser";
import type { Server } from "http";
import { inArray } from "drizzle-orm";

let db: typeof import("../server/db")["db"];
let users: typeof import("../shared/schema")["users"];
let clients: typeof import("../shared/schema")["clients"];
let reportTemplates: typeof import("../shared/schema")["reportTemplates"];
let auditLogs: typeof import("../shared/schema")["auditLogs"];
let registerRoutes: typeof import("../server/routes")["registerRoutes"];
let createSessionToken: typeof import("../server/auth-middleware")["createSessionToken"];
let storage: typeof import("../server/storage")["storage"];

async function loadServerModules() {
  const schema = await import("../shared/schema");
  ({ db } = await import("../server/db"));
  ({ users, clients, reportTemplates, auditLogs } = schema);
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

const FAKE_REPORT_HTML = "<h2>Test Report</h2><p>Simulated AI client report.</p>";
const SUFFIX = `t93defaults-${Date.now()}`;

// Distinctive markers we look for in the captured prompt.
const PROFILE_HEADER = "CLIENT PROFILE:";
const SESSIONS_HEADER = "SESSIONS:";
const NOTES_HEADER = "SESSION NOTES:";
const ASSESSMENTS_HEADER = "ASSESSMENTS:";

// Tracking for cleanup
const createdUserIds: number[] = [];
const createdClientIds: number[] = [];
const createdTemplateIds: number[] = [];

// ---------------------------------------------------------------------------
// Stub + capture the OpenAI chat-completion call (goes through global fetch).
// ---------------------------------------------------------------------------
const originalFetch = globalThis.fetch;
let lastUserPrompt = "";

function installFetchStub() {
  globalThis.fetch = (async (input: any, init?: any) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : (input?.url ?? String(input));
    if (url.includes("/chat/completions")) {
      // Capture the user prompt so tests can assert what the AI received.
      try {
        const body = JSON.parse(String(init?.body ?? "{}"));
        const userMsg = (body.messages || []).find((m: any) => m.role === "user");
        lastUserPrompt = userMsg?.content ?? "";
      } catch {
        lastUserPrompt = "";
      }
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

async function makeTemplate(
  createdById: number,
  label: string,
  defaults: {
    defaultIncludeProfile: boolean;
    defaultIncludeNotes: boolean;
    defaultIncludeAssessments: boolean;
  },
) {
  const template = await storage.createReportTemplate({
    name: `Defaults Test Template ${label} ${SUFFIX}`,
    originalName: "template.docx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    structureText: "Heading 1\nHeading 2",
    isActive: true,
    createdById,
    ...defaults,
  } as any);
  createdTemplateIds.push(template.id);
  return template;
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

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function run() {
  console.log("\n🧪 AI Client Report Template-Default Fallback Tests\n");

  let server: Server | null = null;

  if (!process.env.OPENAI_API_KEY && !process.env.AI_INTEGRATIONS_OPENAI_API_KEY) {
    process.env.OPENAI_API_KEY = "sk-test-dummy-template-defaults";
  }

  installFetchStub();
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

    // --- Seed --------------------------------------------------------------
    const therapist = await makeUser("therapist", "def-therapist");
    const admin = await makeUser("admin", "def-admin");

    const client = await makeClient(therapist.id, "def-client");
    await grantAiConsent(client.id);

    const token = createSessionToken(therapist);
    const genPath = `/api/clients/${client.id}/reports/generate`;

    // Generate WITHOUT a `sources` object so the route falls back to defaults.
    const generateNoSources = (templateId: number) =>
      req("POST", genPath, token, { templateId });

    // =======================================================================
    // 1. Template default: profile ON, notes OFF, assessments OFF
    //    No `sources` in body → prompt must honor those defaults.
    // =======================================================================
    console.log("Test 1: Defaults profile=ON, notes=OFF, assessments=OFF");
    {
      const template = await makeTemplate(admin.id, "profile-only", {
        defaultIncludeProfile: true,
        defaultIncludeNotes: false,
        defaultIncludeAssessments: false,
      });
      lastUserPrompt = "";
      const r = await generateNoSources(template.id);
      assert(r.status === 201, "Generation succeeds (201) with no sources in body");
      assert(lastUserPrompt.includes(PROFILE_HEADER), "Prompt includes CLIENT PROFILE (template default ON)");
      assert(!lastUserPrompt.includes(SESSIONS_HEADER), "Prompt excludes SESSIONS (template default OFF)");
      assert(!lastUserPrompt.includes(NOTES_HEADER), "Prompt excludes SESSION NOTES (template default OFF)");
      assert(!lastUserPrompt.includes(ASSESSMENTS_HEADER), "Prompt excludes ASSESSMENTS (template default OFF)");
    }

    // =======================================================================
    // 2. Reverse combination: profile OFF, notes ON, assessments ON
    //    No `sources` in body → prompt must honor those defaults.
    // =======================================================================
    console.log("\nTest 2: Defaults profile=OFF, notes=ON, assessments=ON");
    {
      const template = await makeTemplate(admin.id, "no-profile", {
        defaultIncludeProfile: false,
        defaultIncludeNotes: true,
        defaultIncludeAssessments: true,
      });
      lastUserPrompt = "";
      const r = await generateNoSources(template.id);
      assert(r.status === 201, "Generation succeeds (201) with no sources in body");
      assert(!lastUserPrompt.includes(PROFILE_HEADER), "Prompt excludes CLIENT PROFILE (template default OFF)");
      assert(lastUserPrompt.includes(SESSIONS_HEADER), "Prompt includes SESSIONS (template default ON)");
      assert(lastUserPrompt.includes(NOTES_HEADER), "Prompt includes SESSION NOTES (template default ON)");
      assert(lastUserPrompt.includes(ASSESSMENTS_HEADER), "Prompt includes ASSESSMENTS (template default ON)");
    }

    // =======================================================================
    // 3. Explicit `sources` still overrides the template defaults.
    //    Template defaults profile OFF, but caller asks for profile ON only.
    // =======================================================================
    console.log("\nTest 3: Explicit sources override template defaults");
    {
      const template = await makeTemplate(admin.id, "override", {
        defaultIncludeProfile: false,
        defaultIncludeNotes: true,
        defaultIncludeAssessments: true,
      });
      lastUserPrompt = "";
      const r = await req("POST", genPath, token, {
        templateId: template.id,
        sources: { includeProfile: true, includeNotes: false, includeAssessments: false },
      });
      assert(r.status === 201, "Generation succeeds (201) with explicit sources");
      assert(lastUserPrompt.includes(PROFILE_HEADER), "Prompt includes CLIENT PROFILE (override ON beats default OFF)");
      assert(!lastUserPrompt.includes(SESSIONS_HEADER), "Prompt excludes SESSIONS (override OFF beats default ON)");
      assert(!lastUserPrompt.includes(NOTES_HEADER), "Prompt excludes SESSION NOTES (override OFF beats default ON)");
      assert(!lastUserPrompt.includes(ASSESSMENTS_HEADER), "Prompt excludes ASSESSMENTS (override OFF beats default ON)");
    }
  } catch (error) {
    console.error("\n❌ Test suite error:", error);
    testsFailed++;
  } finally {
    restoreFetch();
    try {
      if (createdClientIds.length > 0) {
        await db.delete(auditLogs).where(inArray(auditLogs.clientId, createdClientIds));
      }
      if (createdUserIds.length > 0) {
        await db.delete(auditLogs).where(inArray(auditLogs.userId, createdUserIds));
      }
      if (createdClientIds.length > 0) {
        await db.delete(clients).where(inArray(clients.id, createdClientIds));
      }
      if (createdTemplateIds.length > 0) {
        await db.delete(reportTemplates).where(inArray(reportTemplates.id, createdTemplateIds));
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
  restoreFetch();
  process.exit(1);
});
