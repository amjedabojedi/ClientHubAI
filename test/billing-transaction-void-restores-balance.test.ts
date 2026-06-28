/**
 * Automated Test: the BEHAVIOR of a SUCCESSFUL payment void —
 *   POST /api/payment-transactions/:id/void
 *
 * Why this exists (the gap it closes)
 * -----------------------------------
 * Task #229 (test/billing-transactions-void-authz.test.ts) locked down WHO is
 * allowed to void a payment, but nothing asserts what a successful void actually
 * DOES to the money. The whole point of voiding is to undo a payment: the
 * billing record's client/insurance paid totals must be recomputed from the
 * REMAINING (non-voided) transactions, and the payment status must flip back
 * down the ladder (paid -> billed -> pending) to reflect the now-larger
 * outstanding balance.
 *
 * A regression here would let a voided payment still count toward "paid",
 * understating what a client owes — a money-correctness bug the authz test
 * cannot catch (it only checks status codes, never the recomputed totals).
 *
 * This is a FAST, server-level HTTP test — it spawns the real dev server and
 * drives the genuine authenticated route with plain `fetch` + a manual cookie
 * jar (no Chromium), mirroring test/billing-transactions-void-authz.test.ts.
 *
 * What it asserts (one $200 billing, fully paid by TWO client payments of
 * $150 + $50, so voiding one leaves a real, recomputable remainder):
 *   1. Voiding the $50 payment returns 200.
 *   2. clientPaidAmount drops by exactly the voided amount ($200 -> $150).
 *   3. paymentAmount drops by exactly the voided amount ($200 -> $150).
 *   4. paymentStatus recomputes from fully-paid down to 'billed'
 *      (remaining $150 is > 0 but < the $200 bill).
 *   5. The voided transaction row is stamped (voided_at / voided_by / reason).
 *   6. The surviving $150 transaction is untouched (still non-voided).
 *   7. Voiding the SAME (already-voided) transaction again returns 400.
 *
 * Run with: npx tsx test/billing-transaction-void-restores-balance.test.ts
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

const SUFFIX = `txn-void-balance-${Date.now()}`;

// ---------------------------------------------------------------------------
// Minimal cookie-jar HTTP client (mirrors the void-authz suite).
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
  const res = await fetch(
    `${baseUrl}/api/payment-transactions/${txId}/void`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: cookieHeader(jar),
        "x-csrf-token": jar.csrfToken || "",
      },
      body: JSON.stringify({ reason: "void balance behavior test" }),
    },
  );
  await res.text().catch(() => {});
  return res.status;
}

// ---------------------------------------------------------------------------
async function main() {
  let billingUserId: number | undefined;
  let assignedTherapistId: number | undefined;
  let clientId: number | undefined;
  let serviceId: number | undefined;
  let sessionId: number | undefined;
  let billingId: number | undefined;
  let txKeepId: number | undefined;
  let txVoidId: number | undefined;

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

    // A $200 billing that is FULLY paid by two client payments ($150 + $50).
    const [billing] = await db
      .insert(sessionBilling)
      .values({
        sessionId,
        serviceCode: service.serviceCode,
        units: 1,
        ratePerUnit: "200.00",
        totalAmount: "200.00",
        clientPaidAmount: "200.00",
        insurancePaidAmount: "0.00",
        paymentAmount: "200.00",
        billingDate: new Date().toISOString().slice(0, 10),
        paymentStatus: "paid",
      })
      .returning();
    billingId = billing.id;

    // The payment we KEEP (must remain untouched after the void).
    const [txKeep] = await db
      .insert(paymentTransactions)
      .values({
        sessionBillingId: billingId,
        source: "client",
        amount: "150.00",
        paymentMethod: "card",
        paymentDate: new Date().toISOString().slice(0, 10),
        recordedBy: billingUserId,
      })
      .returning();
    txKeepId = txKeep.id;

    // The payment we VOID.
    const [txVoid] = await db
      .insert(paymentTransactions)
      .values({
        sessionBillingId: billingId,
        source: "client",
        amount: "50.00",
        paymentMethod: "card",
        paymentDate: new Date().toISOString().slice(0, 10),
        recordedBy: billingUserId,
      })
      .returning();
    txVoidId = txVoid.id;

    // --- Spin up the real dev server and drive the route over HTTP. --------
    devServer = await startDevServer();
    const baseUrl = devServer.baseUrl;

    const billingLogin = await login(baseUrl, billingUser.username, "x");
    assertEqual(billingLogin.status, 200, "Billing user logs in");

    // =====================================================================
    // 1. Void the $50 payment — expect success.
    // =====================================================================
    const voidStatus = await voidTransaction(baseUrl, billingLogin.jar, txVoidId);
    assertEqual(voidStatus, 200, "Voiding the $50 payment returns 200");

    // Re-read the billing record straight from the DB and assert the money.
    const [afterBill] = await db
      .select()
      .from(sessionBilling)
      .where(eq(sessionBilling.id, billingId));

    // 2 + 3. Paid totals drop by EXACTLY the voided $50 (was $200, now $150).
    assertEqual(
      Number(afterBill.clientPaidAmount),
      150,
      "clientPaidAmount dropped by the voided $50 ($200 -> $150)",
    );
    assertEqual(
      Number(afterBill.paymentAmount),
      150,
      "paymentAmount dropped by the voided $50 ($200 -> $150)",
    );
    // Insurance side untouched (no insurance payments existed).
    assertEqual(
      Number(afterBill.insurancePaidAmount),
      0,
      "insurancePaidAmount stays $0 (no insurance payments)",
    );

    // 4. Status recomputes from fully-paid down to 'billed' ($150 > 0, < $200).
    assertEqual(
      afterBill.paymentStatus,
      "billed",
      "paymentStatus recomputes from 'paid' down to 'billed'",
    );

    // 5. The voided transaction row is stamped.
    const [afterVoidTx] = await db
      .select()
      .from(paymentTransactions)
      .where(eq(paymentTransactions.id, txVoidId));
    assert(
      afterVoidTx.voidedAt != null,
      "Voided transaction has voidedAt set",
    );
    assertEqual(
      afterVoidTx.voidedBy,
      billingUserId,
      "Voided transaction records who voided it",
    );
    assert(
      !!afterVoidTx.voidReason && afterVoidTx.voidReason.length >= 3,
      "Voided transaction records a void reason",
    );

    // 6. The surviving $150 transaction is untouched.
    const [afterKeepTx] = await db
      .select()
      .from(paymentTransactions)
      .where(eq(paymentTransactions.id, txKeepId));
    assert(
      afterKeepTx.voidedAt == null,
      "The surviving $150 transaction is NOT voided",
    );
    assertEqual(
      Number(afterKeepTx.amount),
      150,
      "The surviving $150 transaction amount is unchanged",
    );

    // =====================================================================
    // 7. Voiding the SAME (already-voided) transaction again -> 400.
    // =====================================================================
    const reVoidStatus = await voidTransaction(baseUrl, billingLogin.jar, txVoidId);
    assertEqual(
      reVoidStatus,
      400,
      "Voiding an already-voided transaction returns 400",
    );

    // And the double-void attempt must NOT have re-touched the balance.
    const [finalBill] = await db
      .select()
      .from(sessionBilling)
      .where(eq(sessionBilling.id, billingId));
    assertEqual(
      Number(finalBill.clientPaidAmount),
      150,
      "Balance is unchanged after the rejected double-void ($150)",
    );
    assertEqual(
      finalBill.paymentStatus,
      "billed",
      "paymentStatus is unchanged after the rejected double-void",
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
