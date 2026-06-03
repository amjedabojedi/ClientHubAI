/**
 * Automated Tests for AI Client Report SOURCE SELECTION & supporting-file inclusion
 *
 * Verifies that report generation only feeds the AI the data the caller asked
 * for, so we never leak more PHI into the prompt than intended:
 *   1. The profile / sessions+notes / assessments toggles each independently
 *      control whether that section is present in the AI prompt.
 *   2. Only the supportingFileIds explicitly requested are included in the
 *      prompt (non-selected files for the SAME client are excluded).
 *   3. Supporting files belonging to a DIFFERENT client are never included,
 *      even if their ids are passed in supportingFileIds.
 *
 * Run with: npx tsx test/client-report-source-selection.test.ts
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
let reportSupportingFiles: typeof import("../shared/schema")["reportSupportingFiles"];
let auditLogs: typeof import("../shared/schema")["auditLogs"];
let registerRoutes: typeof import("../server/routes")["registerRoutes"];
let createSessionToken: typeof import("../server/auth-middleware")["createSessionToken"];
let storage: typeof import("../server/storage")["storage"];

async function loadServerModules() {
  const schema = await import("../shared/schema");
  ({ db } = await import("../server/db"));
  ({ users, clients, reportTemplates, reportSupportingFiles, auditLogs } = schema);
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
const SUFFIX = `t90src-${Date.now()}`;

// Distinctive markers we look for in the captured prompt.
const PROFILE_HEADER = "CLIENT PROFILE:";
const SESSIONS_HEADER = "SESSIONS:";
const NOTES_HEADER = "SESSION NOTES:";
const ASSESSMENTS_HEADER = "ASSESSMENTS:";
const SUPPORTING_HEADER = "SUPPORTING DOCUMENTS";

const FILE_A_MARKER = `UNIQUE-FILE-A-TEXT-${SUFFIX}`;
const FILE_B_MARKER = `UNIQUE-FILE-B-TEXT-${SUFFIX}`;
const FILE_OTHER_MARKER = `UNIQUE-OTHER-CLIENT-FILE-TEXT-${SUFFIX}`;

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

async function makeTemplate(createdById: number) {
  const template = await storage.createReportTemplate({
    name: `Source Test Template ${SUFFIX}`,
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

async function makeSupportingFile(clientId: number, createdById: number, name: string, text: string) {
  return storage.createReportSupportingFile({
    clientId,
    originalName: name,
    mimeType: "text/plain",
    fileSize: text.length,
    extractedText: text,
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
  console.log("\n🧪 AI Client Report Source-Selection Tests\n");

  let server: Server | null = null;

  if (!process.env.OPENAI_API_KEY && !process.env.AI_INTEGRATIONS_OPENAI_API_KEY) {
    process.env.OPENAI_API_KEY = "sk-test-dummy-source-selection";
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
    const therapist = await makeUser("therapist", "src-therapist");
    const admin = await makeUser("admin", "src-admin");
    const template = await makeTemplate(admin.id);

    const client = await makeClient(therapist.id, "src-client");
    await grantAiConsent(client.id);
    const otherClient = await makeClient(therapist.id, "src-other-client");

    // Two supporting files for the target client + one for another client.
    const fileA = await makeSupportingFile(client.id, therapist.id, "fileA.txt", FILE_A_MARKER);
    const fileB = await makeSupportingFile(client.id, therapist.id, "fileB.txt", FILE_B_MARKER);
    const otherFile = await makeSupportingFile(otherClient.id, therapist.id, "other.txt", FILE_OTHER_MARKER);

    const token = createSessionToken(therapist);
    const genPath = `/api/clients/${client.id}/reports/generate`;

    const generate = (sources: any, supportingFileIds?: number[]) =>
      req("POST", genPath, token, {
        templateId: template.id,
        sources,
        ...(supportingFileIds ? { supportingFileIds } : {}),
      });

    // =======================================================================
    // 1. All sources ON → every section present in the prompt
    // =======================================================================
    console.log("Test 1: All source toggles ON");
    {
      lastUserPrompt = "";
      const r = await generate({ includeProfile: true, includeNotes: true, includeAssessments: true });
      assert(r.status === 201, "Generation succeeds (201)");
      assert(lastUserPrompt.includes(PROFILE_HEADER), "Prompt includes CLIENT PROFILE");
      assert(lastUserPrompt.includes(SESSIONS_HEADER), "Prompt includes SESSIONS");
      assert(lastUserPrompt.includes(NOTES_HEADER), "Prompt includes SESSION NOTES");
      assert(lastUserPrompt.includes(ASSESSMENTS_HEADER), "Prompt includes ASSESSMENTS");
    }

    // =======================================================================
    // 2. Only profile
    // =======================================================================
    console.log("\nTest 2: Only profile ON");
    {
      lastUserPrompt = "";
      const r = await generate({ includeProfile: true, includeNotes: false, includeAssessments: false });
      assert(r.status === 201, "Generation succeeds (201)");
      assert(lastUserPrompt.includes(PROFILE_HEADER), "Prompt includes CLIENT PROFILE");
      assert(!lastUserPrompt.includes(SESSIONS_HEADER), "Prompt excludes SESSIONS");
      assert(!lastUserPrompt.includes(NOTES_HEADER), "Prompt excludes SESSION NOTES");
      assert(!lastUserPrompt.includes(ASSESSMENTS_HEADER), "Prompt excludes ASSESSMENTS");
    }

    // =======================================================================
    // 3. Only sessions+notes
    // =======================================================================
    console.log("\nTest 3: Only sessions+notes ON");
    {
      lastUserPrompt = "";
      const r = await generate({ includeProfile: false, includeNotes: true, includeAssessments: false });
      assert(r.status === 201, "Generation succeeds (201)");
      assert(!lastUserPrompt.includes(PROFILE_HEADER), "Prompt excludes CLIENT PROFILE");
      assert(lastUserPrompt.includes(SESSIONS_HEADER), "Prompt includes SESSIONS");
      assert(lastUserPrompt.includes(NOTES_HEADER), "Prompt includes SESSION NOTES");
      assert(!lastUserPrompt.includes(ASSESSMENTS_HEADER), "Prompt excludes ASSESSMENTS");
    }

    // =======================================================================
    // 4. Only assessments
    // =======================================================================
    console.log("\nTest 4: Only assessments ON");
    {
      lastUserPrompt = "";
      const r = await generate({ includeProfile: false, includeNotes: false, includeAssessments: true });
      assert(r.status === 201, "Generation succeeds (201)");
      assert(!lastUserPrompt.includes(PROFILE_HEADER), "Prompt excludes CLIENT PROFILE");
      assert(!lastUserPrompt.includes(SESSIONS_HEADER), "Prompt excludes SESSIONS");
      assert(!lastUserPrompt.includes(NOTES_HEADER), "Prompt excludes SESSION NOTES");
      assert(lastUserPrompt.includes(ASSESSMENTS_HEADER), "Prompt includes ASSESSMENTS");
    }

    // =======================================================================
    // 5. All sources OFF → no data sections
    // =======================================================================
    console.log("\nTest 5: All source toggles OFF");
    {
      lastUserPrompt = "";
      const r = await generate({ includeProfile: false, includeNotes: false, includeAssessments: false });
      assert(r.status === 201, "Generation succeeds (201)");
      assert(!lastUserPrompt.includes(PROFILE_HEADER), "Prompt excludes CLIENT PROFILE");
      assert(!lastUserPrompt.includes(SESSIONS_HEADER), "Prompt excludes SESSIONS");
      assert(!lastUserPrompt.includes(NOTES_HEADER), "Prompt excludes SESSION NOTES");
      assert(!lastUserPrompt.includes(ASSESSMENTS_HEADER), "Prompt excludes ASSESSMENTS");
    }

    // =======================================================================
    // 6. Only the selected supporting file is included
    // =======================================================================
    console.log("\nTest 6: Only selected supportingFileIds are included");
    {
      lastUserPrompt = "";
      const r = await generate(
        { includeProfile: true, includeNotes: true, includeAssessments: true },
        [fileA.id],
      );
      assert(r.status === 201, "Generation succeeds (201)");
      assert(lastUserPrompt.includes(SUPPORTING_HEADER), "Prompt includes SUPPORTING DOCUMENTS section");
      assert(lastUserPrompt.includes(FILE_A_MARKER), "Prompt includes the SELECTED file's text");
      assert(!lastUserPrompt.includes(FILE_B_MARKER), "Prompt EXCLUDES the non-selected client file's text");
    }

    // =======================================================================
    // 7. No supporting files requested → no SUPPORTING DOCUMENTS section
    // =======================================================================
    console.log("\nTest 7: No supportingFileIds → no supporting docs in prompt");
    {
      lastUserPrompt = "";
      const r = await generate({ includeProfile: true, includeNotes: true, includeAssessments: true }, []);
      assert(r.status === 201, "Generation succeeds (201)");
      assert(!lastUserPrompt.includes(SUPPORTING_HEADER), "Prompt has NO SUPPORTING DOCUMENTS section");
      assert(!lastUserPrompt.includes(FILE_A_MARKER), "Prompt includes no supporting-file text");
    }

    // =======================================================================
    // 8. A supporting file from ANOTHER client is never included
    // =======================================================================
    console.log("\nTest 8: Cross-client supporting files are never included");
    {
      lastUserPrompt = "";
      const r = await generate(
        { includeProfile: true, includeNotes: true, includeAssessments: true },
        [fileA.id, otherFile.id],
      );
      assert(r.status === 201, "Generation succeeds (201)");
      assert(lastUserPrompt.includes(FILE_A_MARKER), "Own client's selected file IS included");
      assert(
        !lastUserPrompt.includes(FILE_OTHER_MARKER),
        "Another client's file is NEVER included even when its id is passed",
      );
    }
  } catch (error) {
    console.error("\n❌ Test suite error:", error);
    testsFailed++;
  } finally {
    restoreFetch();
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
