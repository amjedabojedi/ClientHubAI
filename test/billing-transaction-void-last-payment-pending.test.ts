/**
 * Automated Test: voiding the LAST remaining payment drops a billing all the
 * way back to 'pending' —
 *   POST /api/payment-transactions/:id/void
 *
 * Why this exists (the gap it closes)
 * -----------------------------------
 * test/billing-transaction-void-restores-balance.test.ts proves the MIDDLE
 * rung of the status ladder: a fully-paid billing ('paid') voided down to one
 * remaining payment recomputes to 'billed'. But the BOTTOM rung —
 * 'billed' -> 'pending', when voiding the single remaining payment leaves $0
 * collected — is never asserted.
 *
 * This is exactly the money-correctness edge an authz-only test misses. If
 * voiding the final payment failed to flip the billing back to 'pending', the
 * session would look partially paid forever (stuck at 'billed' with $0
 * collected) and would never resurface as owed.
 *
 * This is a FAST, server-level HTTP test — it spawns the real dev server and
 * drives the genuine authenticated route with plain `fetch` + a manual cookie
 * jar (no Chromium), mirroring the sibling void suites.
 *
 * What it asserts (one $200 billing, partially paid by a SINGLE $50 client
 * payment so the starting status is 'billed', and voiding it leaves $0):
 *   1. The single $50 payment voids successfully (200).
 *   2. clientPaidAmount drops to exactly $0.
 *   3. paymentAmount drops to exactly $0.
 *   4. paymentStatus recomputes from 'billed' down to 'pending' (no money left).
 *   5. The voided transaction row is stamped (voided_at / voided_by / reason).
 *
 * Run with: npx tsx test/billing-transaction-void-last-payment-pending.test.ts
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

const SUFFIX = `txn-void-pending-${Date.now()}`;

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
  const res = await fetch(
    `${baseUrl}/api/payment-transactions/${txId}/void`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: cookieHeader(jar),
        "x-csrf-token": jar.csrfToken || "",
      },
      body: JSON.stringify({ reason: "void last payment pending test" }),
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

    // A $200 billing PARTIALLY paid by a SINGLE $50 client payment, so the
    // starting status is 'billed' (some money in, but not fully paid). Voiding
    // that single payment must leave $0 collected and flip to 'pending'.
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
        paymentAmount: "50.00",
        billingDate: new Date().toISOString().slice(0, 10),
        paymentStatus: "billed",
      })
      .returning();
    billingId = billing.id;

    // The single $50 payment — the LAST (and only) remaining payment.
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
    // 1. Void the single $50 payment — expect success.
    // =====================================================================
    const voidStatus = await voidTransaction(baseUrl, billingLogin.jar, txVoidId);
    assertEqual(voidStatus, 200, "Voiding the only $50 payment returns 200");

    // Re-read the billing record straight from the DB and assert the money.
    const [afterBill] = await db
      .select()
      .from(sessionBilling)
      .where(eq(sessionBilling.id, billingId));

    // 2 + 3. Paid totals drop all the way to $0 (the only payment is gone).
    assertEqual(
      Number(afterBill.clientPaidAmount),
      0,
      "clientPaidAmount drops to $0 after voiding the only payment",
    );
    assertEqual(
      Number(afterBill.paymentAmount),
      0,
      "paymentAmount drops to $0 after voiding the only payment",
    );
    // Insurance side untouched (no insurance payments existed).
    assertEqual(
      Number(afterBill.insurancePaidAmount),
      0,
      "insurancePaidAmount stays $0 (no insurance payments)",
    );

    // 4. Status recomputes from 'billed' down to 'pending' ($0 collected).
    //    This is the rung the sibling suite never exercises.
    assertEqual(
      afterBill.paymentStatus,
      "pending",
      "paymentStatus recomputes from 'billed' down to 'pending'",
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
