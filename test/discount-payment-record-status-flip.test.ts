/**
 * Automated Test: recording a payment on a DISCOUNTED billing computes
 * paymentStatus against the DISCOUNTED bill amount (total - discount) —
 *   PUT /api/billing/:billingId/payment
 *
 * Why this exists (the gap it closes)
 * -----------------------------------
 * storage.recordPayment computes the authoritative paymentStatus against the
 * DISCOUNTED bill amount, not the raw total:
 *
 *     billAmount = total_amount - discount_amount
 *     newStatus  = combined >= billAmount ? 'paid'
 *                : combined > 0           ? 'billed'
 *                :                          paymentData.status
 *
 * The sibling suite `discount-payment-void-status-flip.test.ts` pins the same
 * `- discount_amount` comparison on the VOID path, but NO test seeds a billing
 * with a real discount on the FIRST-RECORD (add/record-payment) path. A
 * regression there (comparing against the raw total) would mis-classify a
 * discounted session as STILL OWED even after the client paid the full
 * discounted price — money-correctness risk on the opposite (positive) axis of
 * the same logic.
 *
 * Two cases pin the discounted comparison:
 *
 *   CASE A — payment exactly covers the DISCOUNTED bill (-> 'paid'):
 *     A $200 billing with a $50 discount => effective bill $150. Recording a
 *     $150 client payment leaves $150 collected. $150 >= the discounted $150
 *     bill => MUST become 'paid'. This is the discriminating case: if
 *     recordPayment wrongly compared $150 against the raw $200 total it would
 *     stay 'billed' and the session would resurface as owed even though the
 *     client paid the full discounted price.
 *
 *   CASE B — payment stays BELOW the discounted bill (stays 'billed'):
 *     A $200 billing with a $50 discount => effective bill $150. Recording a
 *     $100 client payment leaves $100 collected. $100 > 0 but < the discounted
 *     $150 bill => 'billed'.
 *
 * This is a FAST, server-level HTTP test — it spawns the real dev server and
 * drives the genuine authenticated route with plain `fetch` + a manual cookie
 * jar (no Chromium), mirroring the sibling void suites.
 *
 * Run with: npx tsx test/discount-payment-record-status-flip.test.ts
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

const SUFFIX = `disc-record-flip-${Date.now()}`;

// ---------------------------------------------------------------------------
// Minimal cookie-jar HTTP client (mirrors the sibling void suites).
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

function cookieHeader(jar: Record<string, string>): string {
  return Object.entries(jar)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
}

async function recordPayment(
  baseUrl: string,
  jar: Record<string, string>,
  billingId: number,
  body: Record<string, unknown>,
): Promise<number> {
  const res = await fetch(`${baseUrl}/api/billing/${billingId}/payment`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookieHeader(jar),
      "x-csrf-token": jar.csrfToken || "",
    },
    body: JSON.stringify(body),
  });
  await res.text().catch(() => {});
  return res.status;
}

// ---------------------------------------------------------------------------
async function main() {
  let billingUserId: number | undefined;
  let assignedTherapistId: number | undefined;
  let clientId: number | undefined;
  let serviceId: number | undefined;

  // CASE A ids (discounted, payment covers discounted bill, becomes paid)
  let sessionAId: number | undefined;
  let billingAId: number | undefined;

  // CASE B ids (discounted, payment stays below discounted bill, stays billed)
  let sessionBId: number | undefined;
  let billingBId: number | undefined;

  let devServer: DevServer | null = null;

  try {
    // --- Seed the actor (billing-role can record payments) + an assigned
    // therapist so the client/session FKs are valid. ---------------------
    const billingUser = await storage.createUser({
      username: `billing-${SUFFIX}`,
      password: "x",
      fullName: `Billing ${SUFFIX}`,
      email: `billing-${SUFFIX}@example.test`,
      role: "billing",
    } as any);
    billingUserId = billingUser.id;

    const assignedTherapist = await storage.createUser({
      username: `assigned-ther-${SUFFIX}`,
      password: "x",
      fullName: `Assigned Therapist ${SUFFIX}`,
      email: `assigned-ther-${SUFFIX}@example.test`,
      role: "therapist",
    } as any);
    assignedTherapistId = assignedTherapist.id;

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

    // =====================================================================
    // CASE A seed — DISCOUNTED billing, NO payments yet, status 'billed'.
    // $200 total - $50 discount => $150 effective bill. We'll record a $150
    // client payment which exactly covers the DISCOUNTED bill, so the status
    // MUST become 'paid'. This is the discriminating case: comparing against
    // the raw $200 total would wrongly leave it 'billed'.
    // =====================================================================
    const [sessionA] = await db
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
    sessionAId = sessionA.id;

    const [billingA] = await db
      .insert(sessionBilling)
      .values({
        sessionId: sessionAId,
        serviceCode: service.serviceCode,
        units: 1,
        ratePerUnit: "200.00",
        totalAmount: "200.00",
        discountType: "fixed",
        discountValue: "50.00",
        discountAmount: "50.00",
        clientPaidAmount: "0.00",
        insurancePaidAmount: "0.00",
        paymentAmount: "0.00",
        billingDate: new Date().toISOString().slice(0, 10),
        paymentStatus: "billed",
      })
      .returning();
    billingAId = billingA.id;

    // =====================================================================
    // CASE B seed — DISCOUNTED billing, NO payments yet, status 'billed'.
    // $200 total - $50 discount => $150 effective bill. We'll record a $100
    // client payment which stays BELOW the discounted bill, so the status
    // stays 'billed'.
    // =====================================================================
    const [sessionB] = await db
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
    sessionBId = sessionB.id;

    const [billingB] = await db
      .insert(sessionBilling)
      .values({
        sessionId: sessionBId,
        serviceCode: service.serviceCode,
        units: 1,
        ratePerUnit: "200.00",
        totalAmount: "200.00",
        discountType: "fixed",
        discountValue: "50.00",
        discountAmount: "50.00",
        clientPaidAmount: "0.00",
        insurancePaidAmount: "0.00",
        paymentAmount: "0.00",
        billingDate: new Date().toISOString().slice(0, 10),
        paymentStatus: "billed",
      })
      .returning();
    billingBId = billingB.id;

    // --- Spin up the real dev server and drive the route over HTTP. --------
    devServer = await startDevServer();
    const baseUrl = devServer.baseUrl;

    const billingLogin = await login(baseUrl, billingUser.username, "x");
    assertEqual(billingLogin.status, 200, "Billing user logs in");

    // =====================================================================
    // CASE A — record a $150 client payment; it exactly covers the discounted
    // $150 bill, so the status MUST become 'paid'.
    // =====================================================================
    const recordAStatus = await recordPayment(baseUrl, billingLogin.jar, billingAId, {
      status: "billed",
      amount: 150,
      date: new Date().toISOString().slice(0, 10),
      method: "card",
      source: "client",
      clientId,
    });
    assertEqual(
      recordAStatus,
      200,
      "CASE A: recording the $150 client payment returns 200",
    );

    const [afterBillA] = await db
      .select()
      .from(sessionBilling)
      .where(eq(sessionBilling.id, billingAId));

    assertEqual(
      Number(afterBillA.clientPaidAmount),
      150,
      "CASE A: clientPaidAmount records $150",
    );
    assertEqual(
      Number(afterBillA.paymentAmount),
      150,
      "CASE A: combined paymentAmount records $150",
    );
    // The discount-axis assertion: $150 collected >= ($200 - $50 discount =
    // $150) bill => 'paid'. A regression comparing against the raw $200 total
    // would wrongly leave this as 'billed'.
    assertEqual(
      afterBillA.paymentStatus,
      "paid",
      "CASE A: paymentStatus becomes 'paid' (compares against discounted $150, not raw $200)",
    );

    // =====================================================================
    // CASE B — record a $100 client payment; it stays BELOW the discounted
    // $150 bill, so the status stays 'billed'.
    // =====================================================================
    const recordBStatus = await recordPayment(baseUrl, billingLogin.jar, billingBId, {
      status: "billed",
      amount: 100,
      date: new Date().toISOString().slice(0, 10),
      method: "card",
      source: "client",
      clientId,
    });
    assertEqual(
      recordBStatus,
      200,
      "CASE B: recording the $100 client payment returns 200",
    );

    const [afterBillB] = await db
      .select()
      .from(sessionBilling)
      .where(eq(sessionBilling.id, billingBId));

    assertEqual(
      Number(afterBillB.clientPaidAmount),
      100,
      "CASE B: clientPaidAmount records $100",
    );
    assertEqual(
      Number(afterBillB.paymentAmount),
      100,
      "CASE B: combined paymentAmount records $100",
    );
    // $100 > 0 but < the discounted $150 bill => 'billed'.
    assertEqual(
      afterBillB.paymentStatus,
      "billed",
      "CASE B: paymentStatus stays 'billed' against the discounted $150 bill",
    );
  } catch (error) {
    console.error("\n❌ Test suite error:", error);
    testsFailed++;
  } finally {
    if (devServer) await devServer.stop();

    // Cleanup in FK-safe order.
    try {
      const billingIds = [billingAId, billingBId].filter(
        (x): x is number => x != null,
      );
      if (billingIds.length > 0) {
        await db
          .delete(paymentTransactions)
          .where(inArray(paymentTransactions.sessionBillingId, billingIds));
        await db
          .delete(sessionBilling)
          .where(inArray(sessionBilling.id, billingIds));
      }
      const sessionIds = [sessionAId, sessionBId].filter(
        (x): x is number => x != null,
      );
      if (sessionIds.length > 0) {
        await db.delete(sessions).where(inArray(sessions.id, sessionIds));
      }
      if (clientId != null) {
        await db.delete(clients).where(eq(clients.id, clientId));
      }
      if (serviceId != null) {
        await db.delete(services).where(eq(services.id, serviceId));
      }
      const userIds = [billingUserId, assignedTherapistId].filter(
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
