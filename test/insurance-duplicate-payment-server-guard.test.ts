/**
 * Automated Test: the SERVER-SIDE duplicate-insurance-payment guard in
 * storage.recordPayment (and the PUT /api/billing/:id/payment route) rejects a
 * manual insurance payment that re-keys an amount already posted from a
 * statement — even when the request bypasses the browser entirely.
 *
 * Background
 * ----------
 * Task #192 added a CLIENT-SIDE advisory in the Record Payment dialog: keying a
 * manual insurance amount that closely matches an insurance payment already
 * posted from an uploaded statement (an EOB) surfaces a warning + override
 * checkbox (see test/insurance-duplicate-payment-warning-ui.test.ts). But that
 * guard is purely in the UI — a scripted call, a stale page, or a future UI
 * change could PUT the same amount again and silently double-count collected
 * insurance.
 *
 * Task #218 closes that gap with a server-side guard. When recordPayment records
 * a MANUAL insurance payment (no sourceStatement(Line)Id) whose newly-added
 * amount matches (within the dialog's tolerance — the greater of $1 or 5%) an
 * insurance payment already posted from a statement for the same billing, it
 * throws a DUPLICATE_INSURANCE_PAYMENT error (surfaced as HTTP 422) UNLESS the
 * caller passes acknowledgeDuplicate — the explicit confirmation the dialog's
 * override checkbox now forwards.
 *
 * Scenario (single billing, $200 total, a posted $100 insurance statement):
 *   1. Post a $100 statement -> collected insurance $100 (carries sourceStatementId).
 *   2. recordPayment a manual $100 insurance payment (cumulative $200, no ack)
 *      -> REJECTED with DUPLICATE_INSURANCE_PAYMENT; collected insurance stays $100.
 *   3. recordPayment the same manual $100 WITH acknowledgeDuplicate=true
 *      -> ACCEPTED; collected insurance becomes $200.
 *   4. (Fresh billing, posted $100) recordPayment a DIFFERENT manual $50 top-up
 *      (cumulative $150, no ack) -> ACCEPTED (genuine separate payment, not flagged).
 *
 * Run with: npx tsx test/insurance-duplicate-payment-server-guard.test.ts
 *
 * NOTES:
 * - Exercises the real storage layer against the live database (no mocks).
 * - Seeds dedicated, uniquely-named test rows and removes them at the end.
 * - Must run serially with the other app-level tests (shared dev DB races on
 *   generated identifiers when run concurrently). Chained into `test-privacy`.
 */

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
  insuranceStatements,
  insuranceStatementLines,
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

const SUFFIX = `ins-dup-srv-${Date.now()}`;

const createdUserIds: number[] = [];
const createdClientIds: number[] = [];
const createdServiceIds: number[] = [];
const createdBillingIds: number[] = [];
const createdStatementIds: number[] = [];

async function getBilling(billingId: number) {
  const [b] = await db
    .select()
    .from(sessionBilling)
    .where(eq(sessionBilling.id, billingId))
    .limit(1);
  return b;
}

// Seed user → client → service → session → billing ($200 total) and a 50% pay
// rule so the lazy earnings sync has something to compute. Returns the ids.
async function seedBilling(label: string) {
  const therapist = await storage.createUser({
    username: `${label}-${SUFFIX}`,
    password: "x",
    fullName: `${label} ${SUFFIX}`,
    email: `${label}-${SUFFIX}@example.test`,
    role: "therapist",
  } as any);
  createdUserIds.push(therapist.id);

  await storage.upsertTherapistPayRule({
    therapistId: therapist.id,
    serviceId: null,
    payType: "percentage",
    payValue: "50",
  } as any);

  const client = await storage.createClient({
    fullName: `Patient ${label} ${SUFFIX}`,
    assignedTherapistId: therapist.id,
  } as any);
  createdClientIds.push(client.id);

  const service = await storage.createService({
    serviceCode: `SVC-${label}-${SUFFIX}`,
    serviceName: `Test Service ${label} ${SUFFIX}`,
    duration: 60,
    baseRate: "200.00",
  } as any);
  createdServiceIds.push(service.id);

  const session = await storage.createSession({
    clientId: client.id,
    therapistId: therapist.id,
    serviceId: service.id,
    sessionDate: new Date(),
    sessionType: "individual",
    status: "completed",
  } as any);

  const billing = await storage.createSessionBilling(session.id);
  if (!billing) throw new Error("Failed to create billing for test session");
  createdBillingIds.push(billing.id);

  // Ensure the bill total is $200 so partial insurance leaves it owed.
  await db
    .update(sessionBilling)
    .set({ totalAmount: "200.00", ratePerUnit: "200.00" })
    .where(eq(sessionBilling.id, billing.id));

  return { therapist, client, service, session, billing };
}

// Post a confirmed single-line statement for `billingId` carrying
// sourceStatementId — exactly what the duplicate guard looks for.
async function postStatement(
  billingId: number,
  insurancePaidAmount: string,
  userId: number,
  label: string,
) {
  const stmt = await storage.createInsuranceStatement(
    {
      fileName: `stmt-${label}-${SUFFIX}.pdf`,
      sourceType: "pdf",
      payerName: `Test Payer ${SUFFIX}`,
      statementDate: new Date().toISOString().slice(0, 10),
      status: "draft",
    } as any,
    [
      {
        clientNameRaw: `Patient ${label} ${SUFFIX}`,
        serviceCode: `SVC-${label}-${SUFFIX}`,
        insurancePaidAmount,
      } as any,
    ],
  );
  createdStatementIds.push(stmt.id);

  const [line] = await db
    .select()
    .from(insuranceStatementLines)
    .where(eq(insuranceStatementLines.statementId, stmt.id))
    .limit(1);
  await storage.updateStatementLineMatch(line.id, {
    matchStatus: "confirmed",
    matchedSessionBillingId: billingId,
  });
  await storage.postInsuranceStatement(stmt.id, userId);
}

// ---------------------------------------------------------------------------
async function scenario(userId: number) {
  console.log("\n🧪 Server-side duplicate-insurance guard\n");

  // --- A: duplicate is rejected without ack, accepted with ack -------------
  const { billing } = await seedBilling("DUP");
  await postStatement(billing.id, "100.00", userId, "DUP");

  let b = await getBilling(billing.id);
  assertEqual(
    Number(b.insurancePaidAmount),
    100,
    "Precondition — posting the statement records the real $100 insurance payment",
  );

  // Scripted/stale-page call: re-key the same $100 (cumulative $200), no ack.
  let rejected = false;
  let rejectionCode: string | undefined;
  try {
    await storage.recordPayment(billing.id, {
      status: "paid",
      amount: 200, // cumulative = previous 100 + new 100
      date: new Date().toISOString().slice(0, 10),
      method: "insurance",
      source: "insurance",
      recordedBy: userId,
    });
  } catch (err: any) {
    rejected = true;
    rejectionCode = err?.code;
  }
  assert(rejected, "An unacknowledged duplicate $100 insurance payment is REJECTED");
  assertEqual(
    rejectionCode,
    "DUPLICATE_INSURANCE_PAYMENT",
    "Rejection carries the DUPLICATE_INSURANCE_PAYMENT code (route maps to 422)",
  );

  b = await getBilling(billing.id);
  assertEqual(
    Number(b.insurancePaidAmount),
    100,
    "The rejected duplicate did NOT change collected insurance (stays $100)",
  );

  // Deliberate override: same $100 with acknowledgeDuplicate=true is accepted.
  await storage.recordPayment(billing.id, {
    status: "paid",
    amount: 200,
    date: new Date().toISOString().slice(0, 10),
    method: "insurance",
    source: "insurance",
    recordedBy: userId,
    acknowledgeDuplicate: true,
  });
  b = await getBilling(billing.id);
  assertEqual(
    Number(b.insurancePaidAmount),
    200,
    "The acknowledged duplicate IS accepted (collected insurance becomes $200)",
  );

  // --- B: a genuinely different top-up is NOT flagged ----------------------
  const { billing: billing2 } = await seedBilling("TOP");
  await postStatement(billing2.id, "100.00", userId, "TOP");

  // Add a different $50 (cumulative $150), no ack — must go through.
  await storage.recordPayment(billing2.id, {
    status: "billed",
    amount: 150, // cumulative = previous 100 + new 50
    date: new Date().toISOString().slice(0, 10),
    method: "insurance",
    source: "insurance",
    recordedBy: userId,
  });
  const b2 = await getBilling(billing2.id);
  assertEqual(
    Number(b2.insurancePaidAmount),
    150,
    "A different ($50) top-up is NOT flagged and records normally (becomes $150)",
  );
}

// ---------------------------------------------------------------------------
async function run() {
  const sysUser = await storage.createUser({
    username: `sys-${SUFFIX}`,
    password: "x",
    fullName: `System ${SUFFIX}`,
    email: `sys-${SUFFIX}@example.test`,
    role: "admin",
  } as any);
  createdUserIds.push(sysUser.id);

  try {
    await scenario(sysUser.id);
  } catch (error) {
    console.error("\n❌ Test suite error:", error);
    testsFailed++;
  } finally {
    try {
      if (createdBillingIds.length > 0) {
        await db
          .delete(paymentTransactions)
          .where(inArray(paymentTransactions.sessionBillingId, createdBillingIds));
        await db
          .delete(therapistEarnings)
          .where(inArray(therapistEarnings.sessionBillingId, createdBillingIds));
      }
      if (createdStatementIds.length > 0) {
        await db
          .delete(insuranceStatements)
          .where(inArray(insuranceStatements.id, createdStatementIds));
      }
      if (createdBillingIds.length > 0) {
        await db.delete(sessionBilling).where(inArray(sessionBilling.id, createdBillingIds));
      }
      if (createdUserIds.length > 0) {
        await db
          .delete(therapistPayRules)
          .where(inArray(therapistPayRules.therapistId, createdUserIds));
      }
      if (createdClientIds.length > 0) {
        await db.delete(clients).where(inArray(clients.id, createdClientIds));
      }
      if (createdServiceIds.length > 0) {
        await db.delete(services).where(inArray(services.id, createdServiceIds));
      }
      if (createdUserIds.length > 0) {
        await db.delete(users).where(inArray(users.id, createdUserIds));
      }
      console.log("\n🧹 Cleanup complete.");
    } catch (cleanupErr) {
      console.error("⚠️  Cleanup error:", cleanupErr);
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
    console.log("\n⚠️  Some tests failed. Please review the output above.");
    process.exit(1);
  }
}

run().catch((error) => {
  console.error("Fatal error running tests:", error);
  process.exit(1);
});
