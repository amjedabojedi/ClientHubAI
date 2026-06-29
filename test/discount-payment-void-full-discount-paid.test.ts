/**
 * Automated Test: voiding the ONLY payment on a FULLY-discounted (free / comp'd)
 * session keeps it marked 'paid' — POST /api/payment-transactions/:id/void
 *
 * Why this exists (the gap it closes)
 * -----------------------------------
 * storage.voidPaymentTransaction recomputes paymentStatus against the DISCOUNTED
 * bill amount, not the raw total:
 *
 *     billAmount = total_amount - discount_amount
 *     newStatus  = combined >= billAmount ? 'paid'
 *                : combined > 0           ? 'billed'
 *                :                          'pending'
 *
 * The sibling void suite `discount-payment-void-status-flip.test.ts` pins this
 * `- discount_amount` comparison for PARTIAL discounts (a $50 discount on a $200
 * bill). Task #242's `discount-payment-full-discount-paid.test.ts` pins the ZERO
 * boundary, but only on the RECORD path. The ZERO boundary on the VOID path is
 * still unverified: for a fully-discounted (free) billing, voiding a transaction
 * should still resolve to 'paid' (0 >= 0), never drop to 'pending'/'billed'.
 *
 * At that boundary `billAmount = total_amount - discount_amount = 0`, so after
 * the only payment is voided `combined (0) >= billAmount (0)` and the session
 * MUST stay 'paid'. Two regression modes would break this and are caught here:
 *   - comparing `combined` against the RAW $200 total (0 >= 200 is false) would
 *     drop a free session to 'pending' / perpetually owed after a void; and
 *   - using a STRICT `combined > billAmount` (0 > 0 is false) would never let a
 *     free session reach 'paid', dropping it to 'pending'.
 *
 * CASE A — fully-discounted bill, void the only ($0) payment (stays 'paid'):
 *   A $200 billing with a $200 discount => effective bill $0. A single $0 client
 *   payment leaves it 'paid'. Voiding that payment leaves $0 collected. $0 >= the
 *   discounted $0 bill => MUST stay 'paid'. This is the discriminating
 *   zero-boundary case for the void path.
 *
 * This is a FAST, server-level HTTP test — it spawns the real dev server and
 * drives the genuine authenticated route with plain `fetch` + a manual cookie
 * jar (no Chromium), mirroring the sibling void suites.
 *
 * Run with: npx tsx test/discount-payment-void-full-discount-paid.test.ts
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

const SUFFIX = `disc-void-full-paid-${Date.now()}`;

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
    body: JSON.stringify({ reason: "free-session void zero-boundary test" }),
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

  // CASE A ids (fully discounted, void the only $0 payment, stays paid)
  let sessionAId: number | undefined;
  let billingAId: number | undefined;
  let txAVoidId: number | undefined;

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
    // CASE A seed — FULLY-DISCOUNTED billing, currently 'paid' via a single $0
    // client payment. $200 total - $200 discount => $0 effective bill. Voiding
    // the only payment leaves $0 collected, which still equals the discounted
    // $0 bill, so the status MUST STAY 'paid'. This is the zero boundary:
    // comparing against the raw $200 total, or using a strict `combined > $0`,
    // would wrongly drop this free session to 'pending'.
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
        discountValue: "200.00",
        discountAmount: "200.00",
        clientPaidAmount: "0.00",
        insurancePaidAmount: "0.00",
        paymentAmount: "0.00",
        billingDate: new Date().toISOString().slice(0, 10),
        paymentStatus: "paid",
      })
      .returning();
    billingAId = billingA.id;

    // The only payment: a $0 client payment. Voiding it must keep the free
    // session 'paid' (0 collected >= the discounted $0 bill).
    const [txAVoid] = await db
      .insert(paymentTransactions)
      .values({
        sessionBillingId: billingAId,
        source: "client",
        amount: "0.00",
        paymentMethod: "card",
        paymentDate: new Date().toISOString().slice(0, 10),
        recordedBy: billingUserId,
      })
      .returning();
    txAVoidId = txAVoid.id;

    // --- Spin up the real dev server and drive the route over HTTP. --------
    devServer = await startDevServer();
    const baseUrl = devServer.baseUrl;

    const billingLogin = await login(baseUrl, billingUser.username, "x");
    assertEqual(billingLogin.status, 200, "Billing user logs in");

    // =====================================================================
    // CASE A — void the only ($0) payment; remaining $0 still equals the
    // discounted $0 bill, so status MUST stay 'paid'.
    // =====================================================================
    const voidAStatus = await voidTransaction(
      baseUrl,
      billingLogin.jar,
      txAVoidId,
    );
    assertEqual(
      voidAStatus,
      200,
      "CASE A: voiding the only $0 payment returns 200",
    );

    const [afterBillA] = await db
      .select()
      .from(sessionBilling)
      .where(eq(sessionBilling.id, billingAId));

    assertEqual(
      Number(afterBillA.clientPaidAmount),
      0,
      "CASE A: clientPaidAmount stays $0 (free session, nothing collected)",
    );
    assertEqual(
      Number(afterBillA.insurancePaidAmount),
      0,
      "CASE A: insurancePaidAmount stays $0",
    );
    assertEqual(
      Number(afterBillA.paymentAmount),
      0,
      "CASE A: combined paymentAmount recomputes to $0 after the void",
    );
    // The zero-boundary assertion: $0 collected >= ($200 - $200 discount = $0)
    // bill => STAYS 'paid'. A regression comparing against the raw $200 total,
    // or a strict `combined > billAmount`, would wrongly drop this to 'pending'.
    assertEqual(
      afterBillA.paymentStatus,
      "paid",
      "CASE A: a fully-discounted (free) session stays 'paid' after voiding its only payment",
    );

    // The voided transaction is stamped.
    const [afterVoidTxA] = await db
      .select()
      .from(paymentTransactions)
      .where(eq(paymentTransactions.id, txAVoidId));
    assert(
      afterVoidTxA.voidedAt != null,
      "CASE A: voided transaction has voidedAt set",
    );
    assertEqual(
      afterVoidTxA.voidedBy,
      billingUserId,
      "CASE A: voided transaction records who voided it",
    );
  } catch (error) {
    console.error("\n❌ Test suite error:", error);
    testsFailed++;
  } finally {
    if (devServer) await devServer.stop();

    // Cleanup in FK-safe order.
    try {
      const billingIds = [billingAId].filter((x): x is number => x != null);
      if (billingIds.length > 0) {
        await db
          .delete(paymentTransactions)
          .where(inArray(paymentTransactions.sessionBillingId, billingIds));
        await db
          .delete(sessionBilling)
          .where(inArray(sessionBilling.id, billingIds));
      }
      const sessionIds = [sessionAId].filter((x): x is number => x != null);
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
