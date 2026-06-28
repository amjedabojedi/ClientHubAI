/**
 * Automated Test: the BEHAVIOR of voiding an INSURANCE payment —
 *   POST /api/payment-transactions/:id/void
 *
 * Why this exists (the gap it closes)
 * -----------------------------------
 * test/billing-transaction-void-restores-balance.test.ts proves that voiding a
 * CLIENT payment recomputes the balance correctly, but it never touches the
 * INSURANCE branch. storage.voidPaymentTransaction recomputes the billing
 * totals with a SUM split by `source` ('client' vs 'insurance'):
 *
 *     COALESCE(SUM(CASE WHEN source = 'client'    THEN amount ELSE 0 END), 0)
 *     COALESCE(SUM(CASE WHEN source = 'insurance' THEN amount ELSE 0 END), 0)
 *
 * A regression that mishandled the insurance branch — or mixed the client and
 * insurance totals — would not be caught today. Insurance is where the larger
 * dollar amounts and the trickier reconciliation live, so it is the
 * higher-risk path. This test voids an INSURANCE payment and proves that ONLY
 * the insurance total moves, the client total is untouched, and the combined
 * paymentAmount / paymentStatus recompute correctly.
 *
 * This is a FAST, server-level HTTP test — it spawns the real dev server and
 * drives the genuine authenticated route with plain `fetch` + a manual cookie
 * jar (no Chromium), mirroring the sibling client-void suite.
 *
 * What it asserts (one $200 billing, fully paid by a $50 CLIENT payment plus
 * TWO insurance payments of $90 + $60, so voiding the $60 insurance payment
 * leaves a real, recomputable insurance remainder of $90):
 *   1. Voiding the $60 insurance payment returns 200.
 *   2. insurancePaidAmount drops by EXACTLY the voided $60 ($150 -> $90).
 *   3. clientPaidAmount is completely untouched (stays $50).
 *   4. paymentAmount = client ($50) + remaining insurance ($90) = $140.
 *   5. paymentStatus recomputes from 'paid' down to 'billed' ($140 > 0, < $200).
 *   6. The voided transaction row is stamped (voided_at / voided_by / reason).
 *   7. The surviving $90 insurance + $50 client transactions are untouched.
 *   8. Voiding the SAME (already-voided) transaction again returns 400 and the
 *      balance is unchanged.
 *
 * Run with: npx tsx test/insurance-payment-void-restores-balance.test.ts
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

const SUFFIX = `ins-void-balance-${Date.now()}`;

// ---------------------------------------------------------------------------
// Minimal cookie-jar HTTP client (mirrors the client-void suite).
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
      body: JSON.stringify({ reason: "insurance void balance behavior test" }),
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
  let txClientId: number | undefined;
  let txInsKeepId: number | undefined;
  let txInsVoidId: number | undefined;

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

    // A $200 billing FULLY paid by a $50 CLIENT payment plus TWO insurance
    // payments ($90 + $60). Voiding the $60 insurance payment must leave a
    // real, recomputable insurance remainder of $90 while the client side and
    // the surviving insurance payment are untouched.
    const [billing] = await db
      .insert(sessionBilling)
      .values({
        sessionId,
        serviceCode: service.serviceCode,
        units: 1,
        ratePerUnit: "200.00",
        totalAmount: "200.00",
        clientPaidAmount: "50.00",
        insurancePaidAmount: "150.00",
        paymentAmount: "200.00",
        billingDate: new Date().toISOString().slice(0, 10),
        paymentStatus: "paid",
      })
      .returning();
    billingId = billing.id;

    // The CLIENT payment — must remain completely untouched after the void.
    const [txClient] = await db
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
    txClientId = txClient.id;

    // The INSURANCE payment we KEEP (must remain untouched after the void).
    const [txInsKeep] = await db
      .insert(paymentTransactions)
      .values({
        sessionBillingId: billingId,
        source: "insurance",
        amount: "90.00",
        paymentMethod: "insurance",
        paymentDate: new Date().toISOString().slice(0, 10),
        recordedBy: billingUserId,
      })
      .returning();
    txInsKeepId = txInsKeep.id;

    // The INSURANCE payment we VOID.
    const [txInsVoid] = await db
      .insert(paymentTransactions)
      .values({
        sessionBillingId: billingId,
        source: "insurance",
        amount: "60.00",
        paymentMethod: "insurance",
        paymentDate: new Date().toISOString().slice(0, 10),
        recordedBy: billingUserId,
      })
      .returning();
    txInsVoidId = txInsVoid.id;

    // --- Spin up the real dev server and drive the route over HTTP. --------
    devServer = await startDevServer();
    const baseUrl = devServer.baseUrl;

    const billingLogin = await login(baseUrl, billingUser.username, "x");
    assertEqual(billingLogin.status, 200, "Billing user logs in");

    // =====================================================================
    // 1. Void the $60 INSURANCE payment — expect success.
    // =====================================================================
    const voidStatus = await voidTransaction(
      baseUrl,
      billingLogin.jar,
      txInsVoidId,
    );
    assertEqual(voidStatus, 200, "Voiding the $60 insurance payment returns 200");

    // Re-read the billing record straight from the DB and assert the money.
    const [afterBill] = await db
      .select()
      .from(sessionBilling)
      .where(eq(sessionBilling.id, billingId));

    // 2. Insurance total drops by EXACTLY the voided $60 (was $150, now $90).
    assertEqual(
      Number(afterBill.insurancePaidAmount),
      90,
      "insurancePaidAmount dropped by the voided $60 ($150 -> $90)",
    );

    // 3. Client side is completely untouched — the bug we are guarding against
    //    is mixing the two source totals.
    assertEqual(
      Number(afterBill.clientPaidAmount),
      50,
      "clientPaidAmount is untouched by the insurance void (stays $50)",
    );

    // 4. Combined paymentAmount = client ($50) + remaining insurance ($90).
    assertEqual(
      Number(afterBill.paymentAmount),
      140,
      "paymentAmount = client $50 + remaining insurance $90 = $140",
    );

    // 5. Status recomputes from fully-paid down to 'billed' ($140 > 0, < $200).
    assertEqual(
      afterBill.paymentStatus,
      "billed",
      "paymentStatus recomputes from 'paid' down to 'billed'",
    );

    // 6. The voided transaction row is stamped.
    const [afterVoidTx] = await db
      .select()
      .from(paymentTransactions)
      .where(eq(paymentTransactions.id, txInsVoidId));
    assert(afterVoidTx.voidedAt != null, "Voided transaction has voidedAt set");
    assertEqual(
      afterVoidTx.voidedBy,
      billingUserId,
      "Voided transaction records who voided it",
    );
    assert(
      !!afterVoidTx.voidReason && afterVoidTx.voidReason.length >= 3,
      "Voided transaction records a void reason",
    );

    // 7. The surviving insurance + client transactions are untouched.
    const [afterInsKeepTx] = await db
      .select()
      .from(paymentTransactions)
      .where(eq(paymentTransactions.id, txInsKeepId));
    assert(
      afterInsKeepTx.voidedAt == null,
      "The surviving $90 insurance transaction is NOT voided",
    );
    assertEqual(
      Number(afterInsKeepTx.amount),
      90,
      "The surviving $90 insurance transaction amount is unchanged",
    );

    const [afterClientTx] = await db
      .select()
      .from(paymentTransactions)
      .where(eq(paymentTransactions.id, txClientId));
    assert(
      afterClientTx.voidedAt == null,
      "The $50 client transaction is NOT voided",
    );
    assertEqual(
      Number(afterClientTx.amount),
      50,
      "The $50 client transaction amount is unchanged",
    );

    // =====================================================================
    // 8. Voiding the SAME (already-voided) transaction again -> 400.
    // =====================================================================
    const reVoidStatus = await voidTransaction(
      baseUrl,
      billingLogin.jar,
      txInsVoidId,
    );
    assertEqual(
      reVoidStatus,
      400,
      "Voiding an already-voided insurance transaction returns 400",
    );

    // And the double-void attempt must NOT have re-touched the balance.
    const [finalBill] = await db
      .select()
      .from(sessionBilling)
      .where(eq(sessionBilling.id, billingId));
    assertEqual(
      Number(finalBill.insurancePaidAmount),
      90,
      "insurancePaidAmount unchanged after the rejected double-void ($90)",
    );
    assertEqual(
      Number(finalBill.clientPaidAmount),
      50,
      "clientPaidAmount unchanged after the rejected double-void ($50)",
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
