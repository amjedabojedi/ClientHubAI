/**
 * Automated Test: the AUTHORIZATION MATRIX of the manual-payment route
 *   PUT /api/billing/:billingId/payment
 *
 * Why this exists (the gap it closes)
 * -----------------------------------
 * Task #226 fixed this route so the plain `billing` role is authorized to record
 * a manual payment (it previously 403'd). The override-submit browser suite
 * (test/insurance-duplicate-payment-override-submit-ui.test.ts) now logs in as a
 * billing user, but only ever exercises the DUPLICATE-insurance path. Nothing
 * asserted the authorization matrix itself: that a `billing` user gets a
 * non-403 on a PLAIN (non-duplicate) payment, while an unauthorized role still
 * gets 403. Without that lock, a future edit could silently re-exclude `billing`
 * (or over-loosen the guard) and every existing test would still pass.
 *
 * This is a FAST, server-level HTTP test — it spawns the real dev server and
 * drives the genuine authenticated route with plain `fetch` + a manual cookie
 * jar (no Chromium), so it runs in a couple of seconds, not the ~minute a
 * puppeteer suite costs.
 *
 * What it asserts (one shared $200 billing, NO posted statement so the
 * duplicate-insurance guard can never fire — every PUT is a plain client
 * payment):
 *   1. The ASSIGNED therapist records a plain payment        -> NOT 403 (200).
 *      (positive control — proves the 403s below are real authz differences,
 *       not a broken test setup.)
 *   2. A dedicated `billing` user records a plain payment     -> NOT 403 (200).
 *      (the regression this suite primarily guards.)
 *   3. A NON-assigned therapist records the same payment      -> 403.
 *   4. A `client`-role user records the same payment          -> 403.
 *
 * Run with: npx tsx test/billing-payment-authz.test.ts
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
  therapistPayRules,
  therapistEarnings,
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

const SUFFIX = `billing-authz-${Date.now()}`;

// ---------------------------------------------------------------------------
// Minimal cookie-jar HTTP client: log in via the real /api/auth/login (which
// sets httpOnly sessionToken + readable csrfToken cookies), capture those
// cookies, and replay them (plus the matching x-csrf-token header) on the PUT.
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

async function putPayment(
  baseUrl: string,
  jar: Record<string, string>,
  billingId: number,
  body: Record<string, unknown>,
): Promise<number> {
  const cookieHeader = Object.entries(jar)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
  const res = await fetch(`${baseUrl}/api/billing/${billingId}/payment`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookieHeader,
      "x-csrf-token": jar.csrfToken || "",
    },
    body: JSON.stringify(body),
  });
  await res.text().catch(() => {});
  return res.status;
}

// A plain (non-insurance) client payment — the duplicate-insurance guard can
// never fire on this, so the ONLY thing under test is the authorization branch.
function plainPaymentBody(clientId: number) {
  return {
    status: "paid",
    amount: 50,
    date: new Date().toISOString().slice(0, 10),
    method: "card",
    source: "client",
    clientId,
  };
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
        clientPaidAmount: "0.00",
        insurancePaidAmount: "0.00",
        billingDate: new Date().toISOString().slice(0, 10),
        paymentStatus: "pending",
      })
      .returning();
    billingId = billing.id;

    // A 50% pay rule so the lazy earnings sync has something to compute.
    await db.insert(therapistPayRules).values({
      therapistId: assignedTherapistId,
      serviceId: null,
      payType: "percentage",
      payValue: "50.00",
    });

    // --- Spin up the real dev server and drive the route over HTTP. --------
    devServer = await startDevServer();
    const baseUrl = devServer.baseUrl;

    // 1. ASSIGNED therapist — positive control. ----------------------------
    const assignedLogin = await login(baseUrl, assignedTherapist.username, "x");
    assertEqual(assignedLogin.status, 200, "Assigned therapist logs in");
    const assignedStatus = await putPayment(
      baseUrl,
      assignedLogin.jar,
      billingId,
      plainPaymentBody(clientId),
    );
    assert(
      assignedStatus !== 403,
      `Assigned therapist is NOT 403 recording a plain payment (got ${assignedStatus})`,
    );
    assertEqual(
      assignedStatus,
      200,
      "Assigned therapist records a plain payment successfully (200)",
    );

    // 2. BILLING user — the regression this suite guards. ------------------
    const billingLogin = await login(baseUrl, billingUser.username, "x");
    assertEqual(billingLogin.status, 200, "Billing user logs in");
    const billingStatus = await putPayment(
      baseUrl,
      billingLogin.jar,
      billingId,
      plainPaymentBody(clientId),
    );
    assert(
      billingStatus !== 403,
      `Billing user is NOT 403 recording a plain payment (got ${billingStatus})`,
    );
    assertEqual(
      billingStatus,
      200,
      "Billing-role user records a plain manual payment successfully (200)",
    );

    // 3. NON-assigned therapist — must stay blocked. -----------------------
    const otherLogin = await login(baseUrl, otherTherapist.username, "x");
    assertEqual(otherLogin.status, 200, "Non-assigned therapist logs in");
    const otherStatus = await putPayment(
      baseUrl,
      otherLogin.jar,
      billingId,
      plainPaymentBody(clientId),
    );
    assertEqual(
      otherStatus,
      403,
      "A NON-assigned therapist still gets 403 (guard not loosened too far)",
    );

    // 4. CLIENT role — must stay blocked. ----------------------------------
    const clientLogin = await login(baseUrl, clientUser.username, "x");
    assertEqual(clientLogin.status, 200, "Client-role user logs in");
    const clientStatus = await putPayment(
      baseUrl,
      clientLogin.jar,
      billingId,
      plainPaymentBody(clientId),
    );
    assertEqual(
      clientStatus,
      403,
      "A client-role user still gets 403 recording a payment",
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
        await db
          .delete(therapistEarnings)
          .where(eq(therapistEarnings.sessionBillingId, billingId));
        await db.delete(sessionBilling).where(eq(sessionBilling.id, billingId));
      }
      if (sessionId != null) {
        await db.delete(sessions).where(eq(sessions.id, sessionId));
      }
      if (assignedTherapistId != null) {
        await db
          .delete(therapistPayRules)
          .where(eq(therapistPayRules.therapistId, assignedTherapistId));
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
