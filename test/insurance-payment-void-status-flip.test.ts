/**
 * Automated Test: voiding INSURANCE-source payments flips paymentStatus
 * correctly down the ladder —
 *   POST /api/payment-transactions/:id/void
 *
 * Why this exists (the gap it closes)
 * -----------------------------------
 * The existing void-status suites only assert the CLIENT side of the ladder:
 *   - billing-transaction-void-restores-balance.test.ts  (paid -> billed, client)
 *   - billing-transaction-void-last-payment-pending.test.ts (billed -> pending, client)
 * and insurance-payment-void-restores-balance.test.ts voids an INSURANCE
 * payment but only proves the MIDDLE rung (paid -> billed) with a client
 * payment surviving.
 *
 * storage.voidPaymentTransaction recomputes the billing totals with a SUM split
 * by `source` ('client' vs 'insurance'), and the COMBINED total drives the
 * status:
 *
 *     COALESCE(SUM(CASE WHEN source = 'client'    THEN amount ELSE 0 END), 0)
 *     COALESCE(SUM(CASE WHEN source = 'insurance' THEN amount ELSE 0 END), 0)
 *     combined = client_total + insurance_total
 *     newStatus = combined >= billAmount ? 'paid' : combined > 0 ? 'billed' : 'pending'
 *
 * Two insurance-specific rungs are still unasserted and are what this suite
 * covers:
 *
 *   CASE A — INSURANCE-ONLY bottom rung (billed -> pending):
 *     A billing partially paid by a SINGLE insurance payment (no client
 *     money). Voiding it must drop insurancePaidAmount AND paymentAmount to $0
 *     and flip 'billed' -> 'pending'. If the insurance branch were mishandled,
 *     the session would look partially paid forever and never resurface as owed.
 *
 *   CASE B — MIXED, void the CLIENT payment, INSURANCE survives (paid -> billed):
 *     A billing fully paid by client + insurance. Voiding the CLIENT payment
 *     must leave the insurance total completely untouched (the surviving source
 *     total), recompute the combined paymentAmount, and flip 'paid' -> 'billed'.
 *     The sibling suite voids the insurance side and keeps the client; this is
 *     the mirror image, proving the surviving INSURANCE source total is correct.
 *
 * This is a FAST, server-level HTTP test — it spawns the real dev server and
 * drives the genuine authenticated route with plain `fetch` + a manual cookie
 * jar (no Chromium), mirroring the sibling void suites.
 *
 * Run with: npx tsx test/insurance-payment-void-status-flip.test.ts
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

const SUFFIX = `ins-void-flip-${Date.now()}`;

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

async function voidTransaction(
  baseUrl: string,
  jar: Record<string, string>,
  txId: number,
): Promise<number> {
  const res = await fetch(`${baseUrl}/api/payment-transactions/${txId}/void`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookieHeader(jar),
      "x-csrf-token": jar.csrfToken || "",
    },
    body: JSON.stringify({ reason: "insurance void status-flip test" }),
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

  // CASE A ids (insurance-only, billed -> pending)
  let sessionAId: number | undefined;
  let billingAId: number | undefined;
  let txInsOnlyId: number | undefined;

  // CASE B ids (mixed, void client, insurance survives, paid -> billed)
  let sessionBId: number | undefined;
  let billingBId: number | undefined;
  let txClientId: number | undefined;
  let txInsKeepId: number | undefined;

  let devServer: DevServer | null = null;

  try {
    // --- Seed the actor (billing-role can void) + an assigned therapist so the
    // client/session FKs are valid. ---------------------------------------
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
    // CASE A seed — INSURANCE-ONLY billing, partially paid, status 'billed'.
    // A $200 billing with a SINGLE $80 insurance payment (no client money).
    // Voiding it must leave $0 collected and flip 'billed' -> 'pending'.
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
        clientPaidAmount: "0.00",
        insurancePaidAmount: "80.00",
        paymentAmount: "80.00",
        billingDate: new Date().toISOString().slice(0, 10),
        paymentStatus: "billed",
      })
      .returning();
    billingAId = billingA.id;

    const [txInsOnly] = await db
      .insert(paymentTransactions)
      .values({
        sessionBillingId: billingAId,
        source: "insurance",
        amount: "80.00",
        paymentMethod: "insurance",
        paymentDate: new Date().toISOString().slice(0, 10),
        recordedBy: billingUserId,
      })
      .returning();
    txInsOnlyId = txInsOnly.id;

    // =====================================================================
    // CASE B seed — MIXED billing fully paid by client + insurance, status
    // 'paid'. A $140 billing with a $50 CLIENT payment + a $90 INSURANCE
    // payment ($140 total = paid). Voiding the CLIENT payment must keep the
    // insurance side untouched and flip 'paid' -> 'billed'.
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
        ratePerUnit: "140.00",
        totalAmount: "140.00",
        clientPaidAmount: "50.00",
        insurancePaidAmount: "90.00",
        paymentAmount: "140.00",
        billingDate: new Date().toISOString().slice(0, 10),
        paymentStatus: "paid",
      })
      .returning();
    billingBId = billingB.id;

    const [txClient] = await db
      .insert(paymentTransactions)
      .values({
        sessionBillingId: billingBId,
        source: "client",
        amount: "50.00",
        paymentMethod: "card",
        paymentDate: new Date().toISOString().slice(0, 10),
        recordedBy: billingUserId,
      })
      .returning();
    txClientId = txClient.id;

    const [txInsKeep] = await db
      .insert(paymentTransactions)
      .values({
        sessionBillingId: billingBId,
        source: "insurance",
        amount: "90.00",
        paymentMethod: "insurance",
        paymentDate: new Date().toISOString().slice(0, 10),
        recordedBy: billingUserId,
      })
      .returning();
    txInsKeepId = txInsKeep.id;

    // --- Spin up the real dev server and drive the route over HTTP. --------
    devServer = await startDevServer();
    const baseUrl = devServer.baseUrl;

    const billingLogin = await login(baseUrl, billingUser.username, "x");
    assertEqual(billingLogin.status, 200, "Billing user logs in");

    // =====================================================================
    // CASE A — void the single insurance payment, expect billed -> pending.
    // =====================================================================
    const voidAStatus = await voidTransaction(
      baseUrl,
      billingLogin.jar,
      txInsOnlyId,
    );
    assertEqual(
      voidAStatus,
      200,
      "CASE A: voiding the only $80 insurance payment returns 200",
    );

    const [afterBillA] = await db
      .select()
      .from(sessionBilling)
      .where(eq(sessionBilling.id, billingAId));

    assertEqual(
      Number(afterBillA.insurancePaidAmount),
      0,
      "CASE A: insurancePaidAmount drops to $0 after voiding the only insurance payment",
    );
    assertEqual(
      Number(afterBillA.paymentAmount),
      0,
      "CASE A: paymentAmount drops to $0 after voiding the only insurance payment",
    );
    assertEqual(
      Number(afterBillA.clientPaidAmount),
      0,
      "CASE A: clientPaidAmount stays $0 (no client payments)",
    );
    // The insurance-only bottom rung the sibling suites never exercise.
    assertEqual(
      afterBillA.paymentStatus,
      "pending",
      "CASE A: paymentStatus recomputes from 'billed' down to 'pending'",
    );

    const [afterVoidTxA] = await db
      .select()
      .from(paymentTransactions)
      .where(eq(paymentTransactions.id, txInsOnlyId));
    assert(
      afterVoidTxA.voidedAt != null,
      "CASE A: voided insurance transaction has voidedAt set",
    );
    assertEqual(
      afterVoidTxA.voidedBy,
      billingUserId,
      "CASE A: voided insurance transaction records who voided it",
    );

    // =====================================================================
    // CASE B — void the CLIENT payment, insurance survives, paid -> billed.
    // =====================================================================
    const voidBStatus = await voidTransaction(
      baseUrl,
      billingLogin.jar,
      txClientId,
    );
    assertEqual(
      voidBStatus,
      200,
      "CASE B: voiding the $50 client payment returns 200",
    );

    const [afterBillB] = await db
      .select()
      .from(sessionBilling)
      .where(eq(sessionBilling.id, billingBId));

    // Client side drops to $0 (its only payment is gone).
    assertEqual(
      Number(afterBillB.clientPaidAmount),
      0,
      "CASE B: clientPaidAmount drops to $0 after voiding the client payment",
    );
    // The surviving INSURANCE source total must be completely untouched — the
    // bug we are guarding against is the void mixing the two source totals.
    assertEqual(
      Number(afterBillB.insurancePaidAmount),
      90,
      "CASE B: surviving insurancePaidAmount is untouched (stays $90)",
    );
    // Combined recomputes to the surviving insurance $90 only.
    assertEqual(
      Number(afterBillB.paymentAmount),
      90,
      "CASE B: paymentAmount = surviving insurance $90 (client gone)",
    );
    // Combined status flips down: $90 > 0 but < $140 total => 'billed'.
    assertEqual(
      afterBillB.paymentStatus,
      "billed",
      "CASE B: combined paymentStatus recomputes from 'paid' down to 'billed'",
    );

    // The surviving insurance transaction must NOT be voided.
    const [afterInsKeepTx] = await db
      .select()
      .from(paymentTransactions)
      .where(eq(paymentTransactions.id, txInsKeepId));
    assert(
      afterInsKeepTx.voidedAt == null,
      "CASE B: the surviving $90 insurance transaction is NOT voided",
    );
    assertEqual(
      Number(afterInsKeepTx.amount),
      90,
      "CASE B: the surviving $90 insurance transaction amount is unchanged",
    );

    // The voided client transaction is stamped.
    const [afterVoidTxB] = await db
      .select()
      .from(paymentTransactions)
      .where(eq(paymentTransactions.id, txClientId));
    assert(
      afterVoidTxB.voidedAt != null,
      "CASE B: voided client transaction has voidedAt set",
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
