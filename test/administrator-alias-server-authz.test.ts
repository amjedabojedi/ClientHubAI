/**
 * Automated Test: administrator ROLE ALIAS on protected SERVER actions.
 *
 * Why this exists (the gap it closes)
 * -----------------------------------
 * The application accepts both "admin" and "administrator" as valid
 * administrator role spellings. The browser suite
 * (test/administrator-role-alias-ui.test.ts) already protects navigation and
 * page route guards, but API handlers hand-roll their own role checks and can
 * regress independently — a handler comparing only `role === 'admin'` would
 * 403 a valid "administrator" user while every UI test still passes.
 *
 * This is a FAST, server-level HTTP test — it spawns the real dev server and
 * drives genuine authenticated routes with plain `fetch` + a manual cookie
 * jar (no Chromium). It covers REPRESENTATIVE admin-only endpoints across
 * distinct guard styles in server/routes.ts:
 *
 *   1. GET  /api/roles           (role management — inline `!== 'administrator' && !== 'admin'` guard)
 *   2. GET  /api/permissions     (permission management — same inline guard style, separate handler)
 *   3. POST /api/forms/templates (form builder WRITE — `isAdmin = 'administrator' || 'admin'` guard)
 *
 * What it asserts:
 *   - A seeded user with role "administrator" (the long alias) gets a
 *     SUCCESS (200/201) from each endpoint — never 403.
 *   - A therapist gets 403 from each endpoint.
 *   - A supervisor gets 403 from each endpoint.
 *
 * Run with: npx tsx test/administrator-alias-server-authz.test.ts
 *
 * NOTES:
 * - DB-backed: seeds dedicated, uniquely-named users (and deletes the form
 *   template the administrator creates) in a finally block.
 * - Must run serially with the other app-level tests (shared dev DB — see
 *   .agents/memory/privacy-test-concurrency.md). Chained into the privacy
 *   test runner.
 */

import { startDevServer, type DevServer } from "./helpers/browser";
import { db } from "../server/db";
import { storage } from "../server/storage";
import { users, formTemplates } from "../shared/schema";
import { inArray, eq } from "drizzle-orm";

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

const SUFFIX = `admin-alias-authz-${Date.now()}`;

// ---------------------------------------------------------------------------
// Minimal cookie-jar HTTP client (mirrors test/billing-payment-authz.test.ts):
// log in via the real /api/auth/login, capture httpOnly sessionToken +
// csrfToken cookies, replay them (plus x-csrf-token) on subsequent requests.
// ---------------------------------------------------------------------------
function parseSetCookies(res: Response): Record<string, string> {
  const jar: Record<string, string> = {};
  const raw: string[] = (res.headers as any).getSetCookie
    ? (res.headers as any).getSetCookie()
    : ([res.headers.get("set-cookie")].filter(Boolean) as string[]);
  for (const line of raw) {
    const [pair] = line.split(";");
    const idx = pair.indexOf("=");
    if (idx > 0) jar[pair.slice(0, idx).trim()] = pair.slice(idx + 1).trim();
  }
  return jar;
}

async function login(
  baseUrl: string,
  username: string,
  password: string,
): Promise<{ jar: Record<string, string>; status: number }> {
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  await res.text().catch(() => {});
  return { jar: parseSetCookies(res), status: res.status };
}

async function request(
  baseUrl: string,
  jar: Record<string, string>,
  method: string,
  path: string,
  body?: Record<string, unknown>,
): Promise<{ status: number; json: any }> {
  const cookieHeader = Object.entries(jar)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Cookie: cookieHeader,
      "x-csrf-token": jar.csrfToken || "",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json: any = null;
  try {
    json = await res.json();
  } catch {
    await res.text().catch(() => {});
  }
  return { status: res.status, json };
}

function templateBody(name: string) {
  return {
    name,
    description: "Fixture created by administrator alias authz test",
    category: "custom",
    requiresSignature: false,
    isActive: false,
  };
}

// ---------------------------------------------------------------------------
async function main() {
  const createdUserIds: number[] = [];
  const createdTemplateIds: number[] = [];
  let devServer: DevServer | null = null;

  try {
    // --- Seed the role players (plaintext password "x" — the login route
    // accepts non-bcrypt passwords for test users). ------------------------
    const administrator = await storage.createUser({
      username: `administrator-${SUFFIX}`,
      password: "x",
      fullName: `Administrator Alias ${SUFFIX}`,
      email: `administrator-${SUFFIX}@example.test`,
      role: "administrator",
    } as any);
    createdUserIds.push(administrator.id);

    const therapist = await storage.createUser({
      username: `therapist-${SUFFIX}`,
      password: "x",
      fullName: `Therapist ${SUFFIX}`,
      email: `therapist-${SUFFIX}@example.test`,
      role: "therapist",
    } as any);
    createdUserIds.push(therapist.id);

    const supervisor = await storage.createUser({
      username: `supervisor-${SUFFIX}`,
      password: "x",
      fullName: `Supervisor ${SUFFIX}`,
      email: `supervisor-${SUFFIX}@example.test`,
      role: "supervisor",
    } as any);
    createdUserIds.push(supervisor.id);

    // --- Spin up the real dev server and drive the routes over HTTP. -------
    devServer = await startDevServer();
    const baseUrl = devServer.baseUrl;

    // 1. ADMINISTRATOR alias — every protected action must SUCCEED. --------
    const adminLogin = await login(baseUrl, administrator.username, "x");
    assertEqual(adminLogin.status, 200, "Administrator alias user logs in");

    const adminRoles = await request(baseUrl, adminLogin.jar, "GET", "/api/roles");
    assert(
      adminRoles.status !== 403,
      `Administrator alias is NOT 403 on GET /api/roles (got ${adminRoles.status})`,
    );
    assertEqual(adminRoles.status, 200, "Administrator alias lists roles (200)");

    const adminPerms = await request(
      baseUrl,
      adminLogin.jar,
      "GET",
      "/api/permissions",
    );
    assert(
      adminPerms.status !== 403,
      `Administrator alias is NOT 403 on GET /api/permissions (got ${adminPerms.status})`,
    );
    assertEqual(
      adminPerms.status,
      200,
      "Administrator alias lists permissions (200)",
    );

    const adminCreate = await request(
      baseUrl,
      adminLogin.jar,
      "POST",
      "/api/forms/templates",
      templateBody(`Alias Template ${SUFFIX}`),
    );
    assert(
      adminCreate.status !== 403,
      `Administrator alias is NOT 403 on POST /api/forms/templates (got ${adminCreate.status})`,
    );
    assertEqual(
      adminCreate.status,
      201,
      "Administrator alias creates a form template (201)",
    );
    if (adminCreate.json?.id) createdTemplateIds.push(adminCreate.json.id);

    // 2. THERAPIST — every protected action must stay DENIED. --------------
    const therapistLogin = await login(baseUrl, therapist.username, "x");
    assertEqual(therapistLogin.status, 200, "Therapist logs in");

    const therapistRoles = await request(
      baseUrl,
      therapistLogin.jar,
      "GET",
      "/api/roles",
    );
    assertEqual(
      therapistRoles.status,
      403,
      "Therapist gets 403 on GET /api/roles",
    );

    const therapistPerms = await request(
      baseUrl,
      therapistLogin.jar,
      "GET",
      "/api/permissions",
    );
    assertEqual(
      therapistPerms.status,
      403,
      "Therapist gets 403 on GET /api/permissions",
    );

    const therapistCreate = await request(
      baseUrl,
      therapistLogin.jar,
      "POST",
      "/api/forms/templates",
      templateBody(`Therapist Template ${SUFFIX}`),
    );
    assertEqual(
      therapistCreate.status,
      403,
      "Therapist gets 403 on POST /api/forms/templates",
    );
    if (therapistCreate.json?.id) createdTemplateIds.push(therapistCreate.json.id);

    // 3. SUPERVISOR — every protected action must stay DENIED. -------------
    const supervisorLogin = await login(baseUrl, supervisor.username, "x");
    assertEqual(supervisorLogin.status, 200, "Supervisor logs in");

    const supervisorRoles = await request(
      baseUrl,
      supervisorLogin.jar,
      "GET",
      "/api/roles",
    );
    assertEqual(
      supervisorRoles.status,
      403,
      "Supervisor gets 403 on GET /api/roles",
    );

    const supervisorPerms = await request(
      baseUrl,
      supervisorLogin.jar,
      "GET",
      "/api/permissions",
    );
    assertEqual(
      supervisorPerms.status,
      403,
      "Supervisor gets 403 on GET /api/permissions",
    );

    const supervisorCreate = await request(
      baseUrl,
      supervisorLogin.jar,
      "POST",
      "/api/forms/templates",
      templateBody(`Supervisor Template ${SUFFIX}`),
    );
    assertEqual(
      supervisorCreate.status,
      403,
      "Supervisor gets 403 on POST /api/forms/templates",
    );
    if (supervisorCreate.json?.id) createdTemplateIds.push(supervisorCreate.json.id);
  } catch (error) {
    console.error("\n❌ Test suite error:", error);
    testsFailed++;
  } finally {
    if (devServer) await devServer.stop();

    // Cleanup in FK-safe order.
    try {
      if (createdTemplateIds.length > 0) {
        await db
          .delete(formTemplates)
          .where(inArray(formTemplates.id, createdTemplateIds));
      }
      // Safety net: remove any template created by our fixture users even if
      // the response body was not captured.
      for (const userId of createdUserIds) {
        await db
          .delete(formTemplates)
          .where(eq(formTemplates.createdById, userId));
      }
      if (createdUserIds.length > 0) {
        await db.delete(users).where(inArray(users.id, createdUserIds));
      }
      console.log("\n🧹 Cleanup complete.");
    } catch (cleanupErr) {
      console.error("⚠️  Cleanup error (non-fatal):", cleanupErr);
      testsFailed++;
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
    console.log("\n⚠️  Some tests failed.");
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("Fatal error running tests:", error);
  process.exit(1);
});
