/**
 * Automated Test: the OPTIMISTIC-CONCURRENCY guard on the manual-payment route
 *   PUT /api/billing/:billingId/payment
 *
 * Why this exists (the gap it closes)
 * -----------------------------------
 * recordPayment() (server/storage.ts) treats `amount` as the CUMULATIVE total
 * paid for a given source (client / insurance). Both billing screens compute
 * that cumulative as (already-paid-for-source + this new payment) from an
 * "already paid" figure they READ when the form was opened. If two staff record
 * a payment for the same bill+source at nearly the same time, the second submit
 * was computed against a now-stale "already paid" figure, so writing its
 * cumulative would silently OVERWRITE the first person's payment.
 *
 * The fix: the form sends `expectedPreviousForSource` (what it believed the
 * prior per-source total was). Inside the row lock, recordPayment compares it to
 * the authoritative value; if it has changed, it throws STALE_PAYMENT_STATE and
 * the route maps that to HTTP 409 — telling the user to reopen and re-enter
 * instead of clobbering the other payment.
 *
 * Nothing asserted that this guard actually fires, so a future change could
 * quietly remove the protection and every other suite would still pass. This
 * suite locks it in.
 *
 * This is a FAST, server-level HTTP test — it spawns the real dev server and
 * drives the genuine authenticated route with plain `fetch` + a manual cookie
 * jar (no Chromium), so it runs in a couple of seconds.
 *
 * What it asserts (one shared $200 billing, recorded by an admin user):
 *   1. First payment ($50, client source, expectedPrevious 0) succeeds (200) and
 *      client_paid_amount becomes 50.                          (positive control)
 *   2. A SECOND client submit computed from the STALE already-paid figure
 *      (expectedPrevious 0, but the bill now shows 50) is REJECTED with
 *      409 / STALE_PAYMENT_STATE, and client_paid_amount is UNCHANGED (50) — the
 *      first payment was not overwritten.                       (the regression)
 *   3. A normal, non-concurrent payment for the OTHER source (insurance, with a
 *      correct expectedPrevious 0) still SUCCEEDS (200) — proving the guard is
 *      per-source and does not produce false rejections.       (no false positive)
 *
 * Run with: npx tsx test/billing-payment-stale-concurrency.test.ts
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

const SUFFIX = `billing-stale-${Date.now()}`;

// ---------------------------------------------------------------------------
// Minimal cookie-jar HTTP client (mirrors a real authenticated browser session
// without spawning Chromium): log in via the real /api/auth/login (sets
// httpOnly sessionToken + readable csrfToken cookies), capture them, and replay
// them (plus the matching x-csrf-token header) on the PUT.
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

// Returns both the HTTP status and the parsed JSON body so we can assert on the
// 409 status AND the STALE_PAYMENT_STATE error code.
async function putPayment(
  baseUrl: string,
  jar: Record<string, string>,
  billingId: number,
  body: Record<string, unknown>,
): Promise<{ status: number; body: any }> {
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
  const text = await res.text().catch(() => "");
  let parsed: any = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }
  return { status: res.status, body: parsed };
}

// Read the authoritative per-source paid columns straight from the DB.
async function readPaid(
  billingId: number,
): Promise<{ client: number; insurance: number }> {
  const [row] = await db
    .select({
      client: sessionBilling.clientPaidAmount,
      insurance: sessionBilling.insurancePaidAmount,
    })
    .from(sessionBilling)
    .where(eq(sessionBilling.id, billingId));
  return {
    client: Number(row?.client ?? 0),
    insurance: Number(row?.insurance ?? 0),
  };
}

// ---------------------------------------------------------------------------
async function main() {
  let adminUserId: number | undefined;
  let therapistId: number | undefined;
  let clientId: number | undefined;
  let serviceId: number | undefined;
  let sessionId: number | undefined;
  let billingId: number | undefined;

  let devServer: DevServer | null = null;

  try {
    // --- Seed the actors (plaintext password "x" — the login route accepts
    // non-bcrypt passwords for test users). --------------------------------
    const adminUser = await storage.createUser({
      username: `admin-${SUFFIX}`,
      password: "x",
      fullName: `Admin ${SUFFIX}`,
      email: `admin-${SUFFIX}@example.test`,
      role: "administrator",
    } as any);
    adminUserId = adminUser.id;

    const therapist = await storage.createUser({
      username: `ther-${SUFFIX}`,
      password: "x",
      fullName: `Therapist ${SUFFIX}`,
      email: `ther-${SUFFIX}@example.test`,
      role: "therapist",
    } as any);
    therapistId = therapist.id;

    // Insert the client directly with an explicit, unique clientId to avoid the
    // sequential CL-YEAR-NNNN MAX+1 race against concurrent suites.
    const [client] = await db
      .insert(clients)
      .values({
        clientId: `T${Date.now()}`.slice(0, 20),
        fullName: `Patient ${SUFFIX}`,
        assignedTherapistId: therapistId,
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
        therapistId,
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
      therapistId,
      serviceId: null,
      payType: "percentage",
      payValue: "50.00",
    });

    // --- Spin up the real dev server and drive the route over HTTP. --------
    devServer = await startDevServer();
    const baseUrl = devServer.baseUrl;

    const adminLogin = await login(baseUrl, adminUser.username, "x");
    assertEqual(adminLogin.status, 200, "Admin logs in");

    // 1. First payment: $50 client, form opened when paid was 0. ------------
    const first = await putPayment(baseUrl, adminLogin.jar, billingId, {
      status: "paid",
      amount: 50,
      date: new Date().toISOString().slice(0, 10),
      method: "card",
      source: "client",
      clientId,
      expectedPreviousForSource: 0,
    });
    assertEqual(first.status, 200, "First client payment ($50) succeeds (200)");
    const afterFirst = await readPaid(billingId);
    assertEqual(
      afterFirst.client,
      50,
      "client_paid_amount is 50 after the first payment",
    );

    // 2. STALE concurrent submit: a second staffer who also opened the form
    //    when paid was 0 tries to add their own payment. Their cumulative was
    //    computed from the stale 0, so they send expectedPreviousForSource=0 —
    //    but the bill now shows 50. Must be rejected, NOT overwrite the first.
    const stale = await putPayment(baseUrl, adminLogin.jar, billingId, {
      status: "paid",
      amount: 30, // 0 (stale already-paid) + 30 new = 30 cumulative
      date: new Date().toISOString().slice(0, 10),
      method: "card",
      source: "client",
      clientId,
      expectedPreviousForSource: 0, // stale: real prior total is now 50
    });
    assertEqual(
      stale.status,
      409,
      "Stale concurrent client payment is rejected with 409",
    );
    assertEqual(
      stale.body?.code,
      "STALE_PAYMENT_STATE",
      "Rejection carries the STALE_PAYMENT_STATE code",
    );
    const afterStale = await readPaid(billingId);
    assertEqual(
      afterStale.client,
      50,
      "client_paid_amount is STILL 50 — the first payment was not overwritten",
    );

    // 3. No false positive: a normal, non-concurrent payment for the OTHER
    //    source (insurance) with a correct expectedPrevious of 0 still works.
    const other = await putPayment(baseUrl, adminLogin.jar, billingId, {
      status: "paid",
      amount: 70,
      date: new Date().toISOString().slice(0, 10),
      method: "insurance",
      source: "insurance",
      clientId,
      expectedPreviousForSource: 0, // insurance genuinely still at 0
    });
    assertEqual(
      other.status,
      200,
      "A non-concurrent payment for the OTHER source (insurance) still succeeds (200)",
    );
    const afterOther = await readPaid(billingId);
    assertEqual(
      afterOther.insurance,
      70,
      "insurance_paid_amount is 70 after the other-source payment",
    );
    assertEqual(
      afterOther.client,
      50,
      "client_paid_amount is untouched (still 50) by the insurance payment",
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
      if (therapistId != null) {
        await db
          .delete(therapistPayRules)
          .where(eq(therapistPayRules.therapistId, therapistId));
      }
      if (clientId != null) {
        await db.delete(clients).where(eq(clients.id, clientId));
      }
      if (serviceId != null) {
        await db.delete(services).where(eq(services.id, serviceId));
      }
      const userIds = [adminUserId, therapistId].filter(
        (x): x is number => x != null,
      );
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
