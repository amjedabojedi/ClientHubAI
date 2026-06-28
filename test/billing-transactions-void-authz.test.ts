/**
 * Automated Test: the AUTHORIZATION MATRIX of the two payment-history sibling
 * routes that share the manual-payment route's role allow-list but had no
 * focused authz lock of their own:
 *   GET  /api/billing/:billingId/transactions   (view a payment's history)
 *   POST /api/payment-transactions/:id/void      (void a single transaction)
 *
 * Why this exists (the gap it closes)
 * -----------------------------------
 * Task #228 added a focused authorization-matrix test for RECORDING a payment
 * (PUT /api/billing/:billingId/payment). Its two siblings — viewing payment
 * history and voiding a transaction — enforce the same staff allow-list
 * (admin / supervisor / accountant / billing, plus the ASSIGNED therapist for
 * viewing) but nothing asserted that matrix. Without this lock, a future edit
 * could silently drop `billing`, or let an unassigned therapist / a client
 * through, and every existing suite would still pass.
 *
 * This is a FAST, server-level HTTP test — it spawns the real dev server and
 * drives the genuine authenticated routes with plain `fetch` + a manual cookie
 * jar (no Chromium), so it runs in a couple of seconds, not the ~minute a
 * puppeteer suite costs. (Mirrors test/billing-payment-authz.test.ts.)
 *
 * What it asserts (one shared $200 billing with one real client payment
 * transaction seeded so the void route has something to void):
 *   GET .../transactions:
 *     1. The ASSIGNED therapist views history          -> NOT 403 (200).
 *        (positive control + proves the assigned-therapist branch works.)
 *     2. A dedicated `billing` user views history       -> NOT 403 (200).
 *     3. A NON-assigned therapist views history         -> 403.
 *     4. A `client`-role user views history             -> 403.
 *   POST .../void (the 403 cases run FIRST so they never consume the one
 *   seeded transaction; the successful void runs last):
 *     5. A NON-assigned therapist voids                 -> 403.
 *     6. The ASSIGNED therapist voids                   -> 403 (view != void;
 *        voiding is admin/billing-only, even for the assigned therapist).
 *     7. A `client`-role user voids                     -> 403.
 *     8. A dedicated `billing` user voids               -> NOT 403 (200).
 *
 * Run with: npx tsx test/billing-transactions-void-authz.test.ts
 *
 * NOTES:
 * - DB-backed: seeds dedicated, uniquely-named rows and removes them (and
 *   anything derived) in a finally block.
 * - Must run serially with the other app-level tests (shared dev DB races on
 *   generated identifiers when run concurrently — see
 *   .agents/memory/privacy-test-concurrency.md). Chained into `test-privacy`.
 */

import { startDevServer, type DevServer } from "./helpers/browser";
import { db } from "../server/db";
import { storage } from "../server/storage";
import {
  users,
  clients,
  services,
  sessions,
  sessionBilling,
  paymentTransactions,
} from "../shared/schema";
import { eq, inArray } from "drizzle-orm";

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

const SUFFIX = `txn-void-authz-${Date.now()}`;

// ---------------------------------------------------------------------------
// Minimal cookie-jar HTTP client: log in via the real /api/auth/login (which
// sets httpOnly sessionToken + readable csrfToken cookies), capture those
// cookies, and replay them (plus the matching x-csrf-token header) on writes.
// This mirrors a real authenticated browser session without spawning Chromium.
// ---------------------------------------------------------------------------
function parseSetCookies(res: Response): Record<string, string> {
  const jar: Record<string, string> = {};
  // Node 18.14+/undici exposes getSetCookie(); fall back to a single header.
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
  // Drain the body so the socket is freed.
  await res.text().catch(() => {});
  return { jar: parseSetCookies(res), status: res.status };
}

function cookieHeader(jar: Record<string, string>): string {
  return Object.entries(jar)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
}

async function getTransactions(
  baseUrl: string,
  jar: Record<string, string>,
  billingId: number,
): Promise<number> {
  const res = await fetch(`${baseUrl}/api/billing/${billingId}/transactions`, {
    method: "GET",
    headers: { Cookie: cookieHeader(jar) },
  });
  await res.text().catch(() => {});
  return res.status;
}

async function voidTransaction(
  baseUrl: string,
  jar: Record<string, string>,
  txId: number,
): Promise<number> {
  const res = await fetch(
    `${baseUrl}/api/payment-transactions/${txId}/void`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: cookieHeader(jar),
        "x-csrf-token": jar.csrfToken || "",
      },
      body: JSON.stringify({ reason: "authz test void" }),
    },
  );
  await res.text().catch(() => {});
  return res.status;
}

// ---------------------------------------------------------------------------
async function main() {
  let assignedTherapistId: number | undefined;
  let otherTherapistId: number | undefined;
  let billingUserId: number | undefined;
  let clientUserId: number | undefined;
  let clientId: number | undefined;
  let serviceId: number | undefined;
  let sessionId: number | undefined;
  let billingId: number | undefined;
  let txId: number | undefined;

  let devServer: DevServer | null = null;

  try {
    // --- Seed the role players (plaintext password "x" — the login route
    // accepts non-bcrypt passwords for test users). ------------------------
    const assignedTherapist = await storage.createUser({
      username: `assigned-ther-${SUFFIX}`,
      password: "x",
      fullName: `Assigned Therapist ${SUFFIX}`,
      email: `assigned-ther-${SUFFIX}@example.test`,
      role: "therapist",
    } as any);
    assignedTherapistId = assignedTherapist.id;

    const otherTherapist = await storage.createUser({
      username: `other-ther-${SUFFIX}`,
      password: "x",
      fullName: `Other Therapist ${SUFFIX}`,
      email: `other-ther-${SUFFIX}@example.test`,
      role: "therapist",
    } as any);
    otherTherapistId = otherTherapist.id;

    const billingUser = await storage.createUser({
      username: `billing-${SUFFIX}`,
      password: "x",
      fullName: `Billing ${SUFFIX}`,
      email: `billing-${SUFFIX}@example.test`,
      role: "billing",
    } as any);
    billingUserId = billingUser.id;

    const clientUser = await storage.createUser({
      username: `client-${SUFFIX}`,
      password: "x",
      fullName: `Client User ${SUFFIX}`,
      email: `client-${SUFFIX}@example.test`,
      role: "client",
    } as any);
    clientUserId = clientUser.id;

    // Insert the client directly with an explicit, unique clientId to avoid the
    // sequential CL-YEAR-NNNN MAX+1 race against concurrent suites.
    const [client] = await db
      .insert(clients)
      .values({
        clientId: `T${Date.now()}`.slice(0, 20),
        fullName: `Patient ${SUFFIX}`,
        assignedTherapistId: assignedTherapistId,
      } as any)
      .returning();
    clientId = client.id;

    const [service] = await db
      .insert(services)
      .values({
        serviceCode: `SVC-${SUFFIX}`.slice(0, 50),
        serviceName: `Test Service ${SUFFIX}`,
        duration: 60,
        baseRate: "200.00",
      })
      .returning();
    serviceId = service.id;

    const [session] = await db
      .insert(sessions)
      .values({
        clientId,
        therapistId: assignedTherapistId,
        serviceId,
        sessionDate: new Date(),
        sessionType: "individual",
        status: "completed",
      })
      .returning();
    sessionId = session.id;

    const [billing] = await db
      .insert(sessionBilling)
      .values({
        sessionId,
        serviceCode: service.serviceCode,
        units: 1,
        ratePerUnit: "200.00",
        totalAmount: "200.00",
        clientPaidAmount: "50.00",
        insurancePaidAmount: "0.00",
        billingDate: new Date().toISOString().slice(0, 10),
        paymentStatus: "billed",
      })
      .returning();
    billingId = billing.id;

    // One real client payment transaction so the void route has a target.
    const [tx] = await db
      .insert(paymentTransactions)
      .values({
        sessionBillingId: billingId,
        source: "client",
        amount: "50.00",
        paymentMethod: "card",
        paymentDate: new Date().toISOString().slice(0, 10),
        recordedBy: assignedTherapistId,
      })
      .returning();
    txId = tx.id;

    // --- Spin up the real dev server and drive the routes over HTTP. -------
    devServer = await startDevServer();
    const baseUrl = devServer.baseUrl;

    // Log every role in once and reuse the cookie jars.
    const assignedLogin = await login(baseUrl, assignedTherapist.username, "x");
    assertEqual(assignedLogin.status, 200, "Assigned therapist logs in");
    const otherLogin = await login(baseUrl, otherTherapist.username, "x");
    assertEqual(otherLogin.status, 200, "Non-assigned therapist logs in");
    const billingLogin = await login(baseUrl, billingUser.username, "x");
    assertEqual(billingLogin.status, 200, "Billing user logs in");
    const clientLogin = await login(baseUrl, clientUser.username, "x");
    assertEqual(clientLogin.status, 200, "Client-role user logs in");

    // =====================================================================
    // GET /api/billing/:billingId/transactions  (view payment history)
    // =====================================================================
    // 1. ASSIGNED therapist — positive control + assigned-therapist branch.
    const assignedView = await getTransactions(baseUrl, assignedLogin.jar, billingId);
    assert(
      assignedView !== 403,
      `Assigned therapist is NOT 403 viewing payment history (got ${assignedView})`,
    );
    assertEqual(assignedView, 200, "Assigned therapist views payment history (200)");

    // 2. BILLING user — the regression this suite guards.
    const billingView = await getTransactions(baseUrl, billingLogin.jar, billingId);
    assert(
      billingView !== 403,
      `Billing user is NOT 403 viewing payment history (got ${billingView})`,
    );
    assertEqual(billingView, 200, "Billing-role user views payment history (200)");

    // 3. NON-assigned therapist — must stay blocked.
    const otherView = await getTransactions(baseUrl, otherLogin.jar, billingId);
    assertEqual(
      otherView,
      403,
      "A NON-assigned therapist still gets 403 viewing payment history",
    );

    // 4. CLIENT role — must stay blocked.
    const clientView = await getTransactions(baseUrl, clientLogin.jar, billingId);
    assertEqual(
      clientView,
      403,
      "A client-role user still gets 403 viewing payment history",
    );

    // =====================================================================
    // POST /api/payment-transactions/:id/void  (void a single transaction)
    // The 403 cases run FIRST so they can never consume the one seeded tx.
    // =====================================================================
    // 5. NON-assigned therapist — blocked (admin/billing-only route).
    const otherVoid = await voidTransaction(baseUrl, otherLogin.jar, txId);
    assertEqual(
      otherVoid,
      403,
      "A NON-assigned therapist still gets 403 voiding a transaction",
    );

    // 6. ASSIGNED therapist — view != void; voiding is admin/billing-only.
    const assignedVoid = await voidTransaction(baseUrl, assignedLogin.jar, txId);
    assertEqual(
      assignedVoid,
      403,
      "Even the ASSIGNED therapist gets 403 voiding a transaction (view != void)",
    );

    // 7. CLIENT role — blocked.
    const clientVoid = await voidTransaction(baseUrl, clientLogin.jar, txId);
    assertEqual(
      clientVoid,
      403,
      "A client-role user still gets 403 voiding a transaction",
    );

    // 8. BILLING user — authorized; runs last and consumes the seeded tx.
    const billingVoid = await voidTransaction(baseUrl, billingLogin.jar, txId);
    assert(
      billingVoid !== 403,
      `Billing user is NOT 403 voiding a transaction (got ${billingVoid})`,
    );
    assertEqual(
      billingVoid,
      200,
      "Billing-role user voids a transaction successfully (200)",
    );
  } catch (error) {
    console.error("\n❌ Test suite error:", error);
    testsFailed++;
  } finally {
    if (devServer) await devServer.stop();

    // Cleanup in FK-safe order.
    try {
      if (billingId != null) {
        await db
          .delete(paymentTransactions)
          .where(eq(paymentTransactions.sessionBillingId, billingId));
        await db.delete(sessionBilling).where(eq(sessionBilling.id, billingId));
      }
      if (sessionId != null) {
        await db.delete(sessions).where(eq(sessions.id, sessionId));
      }
      if (clientId != null) {
        await db.delete(clients).where(eq(clients.id, clientId));
      }
      if (serviceId != null) {
        await db.delete(services).where(eq(services.id, serviceId));
      }
      const userIds = [
        assignedTherapistId,
        otherTherapistId,
        billingUserId,
        clientUserId,
      ].filter((x): x is number => x != null);
      if (userIds.length > 0) {
        await db.delete(users).where(inArray(users.id, userIds));
      }
      console.log("\n🧹 Cleanup complete.");
    } catch (cleanupErr) {
      console.error("⚠️  Cleanup error (non-fatal):", cleanupErr);
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
