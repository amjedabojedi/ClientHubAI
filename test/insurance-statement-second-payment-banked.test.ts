/**
 * Automated Test: a genuinely larger SECOND insurance statement still BANKS the
 * real increment (it is NOT swallowed by the double-count dedup), and that the
 * extra collection flows all the way through to therapist earned / owed.
 *
 * Background
 * ----------
 * The double-count guard in storage.postInsuranceStatement treats a second
 * statement on the SAME billing as the SAME claim and adds only the increment:
 *
 *     additional = max(0, lineAmount - billing.insurancePaidAmount)
 *
 * That accepted tradeoff (see .agents/memory/insurance-statement-double-count.md)
 * is protected in one direction by insurance-statement-double-payment.test.ts:
 * a duplicate / equal / lower second statement must add NOTHING.
 *
 * This suite protects the OPPOSITE direction, which had no dedicated test: a
 * HIGHER second statement (e.g. a corrected or secondary-insurer EOB) must still
 * bank the genuine INCREMENT so the therapist is paid for real additional
 * collections. A future "tighten the dedup" change that started swallowing the
 * increment would fail here loudly instead of silently losing money.
 *
 * Scenario (single billing, percentage pay rule = 50%, no manual entry):
 *   1. Post statement #1 ($100)  -> collected 100, earned 50,  owed 50.
 *   2. Post statement #2 ($150)  -> collected 150 (a real $50 increment banked),
 *      postedAmount = 50, earned 75, owed 75 (the extra $50 flows to pay at 50%).
 *   3. Post statement #3 ($150, EQUAL) -> adds $0 (postedAmount 0, totals unchanged).
 *   4. Post statement #4 ($120, LOWER) -> adds $0 (postedAmount 0, totals unchanged).
 *
 * Run with: npx tsx test/insurance-statement-second-payment-banked.test.ts
 *
 * NOTES:
 * - Exercises the real storage layer against the live database (no mocks).
 * - Seeds dedicated, uniquely-named test rows and removes them at the end.
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
  insuranceStatements,
  insuranceStatementLines,
} from "../shared/schema";
import { and, eq, inArray, isNull } from "drizzle-orm";

// ---------------------------------------------------------------------------
// Test utilities
// ---------------------------------------------------------------------------
let testsPassed = 0;
let testsFailed = 0;

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

const SUFFIX = `ins-2nd-${Date.now()}`;

// Tracking for cleanup
const createdUserIds: number[] = [];
const createdClientIds: number[] = [];
const createdServiceIds: number[] = [];
const createdBillingIds: number[] = [];
const createdStatementIds: number[] = [];

// The pay rule is a flat 50% of collections, so a $50 increment in collected
// insurance must lift the therapist's earned / owed by exactly $25.
const PAY_PERCENT = 50;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
async function getBilling(billingId: number) {
  const [b] = await db
    .select()
    .from(sessionBilling)
    .where(eq(sessionBilling.id, billingId))
    .limit(1);
  return b;
}

// Sum of NON-voided insurance payment_transactions amounts for a billing — the
// ledger view of collected insurance. Must always agree with the column.
async function ledgerInsurance(billingId: number): Promise<number> {
  const rows = await db
    .select({ amt: paymentTransactions.amount })
    .from(paymentTransactions)
    .where(
      and(
        eq(paymentTransactions.sessionBillingId, billingId),
        eq(paymentTransactions.source, "insurance"),
        isNull(paymentTransactions.voidedAt),
      ),
    );
  return +rows.reduce((sum, r) => sum + (Number(r.amt) || 0), 0).toFixed(2);
}

async function getLine(statementId: number) {
  const [line] = await db
    .select()
    .from(insuranceStatementLines)
    .where(eq(insuranceStatementLines.statementId, statementId))
    .limit(1);
  return line;
}

async function getLineById(lineId: number) {
  const [line] = await db
    .select()
    .from(insuranceStatementLines)
    .where(eq(insuranceStatementLines.id, lineId))
    .limit(1);
  return line;
}

// Seed a billing record (user → client → service → session → billing) with a
// default 50% pay rule so earnings/owed are computable, and return the ids.
async function seedBilling(label: string) {
  const therapist = await storage.createUser({
    username: `${label}-${SUFFIX}`,
    password: "x",
    fullName: `${label} ${SUFFIX}`,
    email: `${label}-${SUFFIX}@example.test`,
    role: "therapist",
  } as any);
  createdUserIds.push(therapist.id);

  // Default (service-agnostic) pay rule: 50% of collections.
  await storage.upsertTherapistPayRule({
    therapistId: therapist.id,
    serviceId: null,
    payType: "percentage",
    payValue: String(PAY_PERCENT),
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

  return { therapist, client, service, session, billing };
}

// Create a draft statement with a single line and confirm it against `billingId`
// (overriding auto-match) so the post path is deterministic.
async function createConfirmedStatement(
  billingId: number,
  insurancePaidAmount: string,
  label: string,
): Promise<{ statementId: number; lineId: number }> {
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
        clientNameRaw: `Patient secondpay ${SUFFIX}`,
        serviceCode: `SVC-${label}-${SUFFIX}`,
        insurancePaidAmount,
      } as any,
    ],
  );
  createdStatementIds.push(stmt.id);

  const line = await getLine(stmt.id);
  await storage.updateStatementLineMatch(line.id, {
    matchStatus: "confirmed",
    matchedSessionBillingId: billingId,
  });

  return { statementId: stmt.id, lineId: line.id };
}

// The therapist's owed total + the single owed item for this billing. Calling
// getTherapistOwed also triggers the lazy earnings sync, so the ledger reflects
// the latest collections.
async function owedFor(therapistId: number, billingId: number) {
  const owed = await storage.getTherapistOwed(therapistId);
  // A serial PK can come back as a string ("3583") while the owed item's
  // sessionBillingId is a number — coerce both sides before comparing.
  const item = owed.items.find((i) => Number(i.sessionBillingId) === Number(billingId));
  return { total: owed.total, item };
}

// ---------------------------------------------------------------------------
// Scenario: a higher second statement banks the real increment; earned/owed
// reflect it; an equal/lower follow-up adds nothing.
// ---------------------------------------------------------------------------
async function scenarioSecondPaymentBanked(userId: number) {
  console.log(
    "\n🧪 Higher second statement banks the increment; equal/lower adds $0\n",
  );

  const { therapist, billing } = await seedBilling("SP");

  // --- 1. Statement #1 ($100): the first real collection. -------------------
  const s1 = await createConfirmedStatement(billing.id, "100.00", "SP");
  await storage.postInsuranceStatement(s1.statementId, userId);

  let b = await getBilling(billing.id);
  assertEqual(Number(b.insurancePaidAmount), 100, "S1: collected insurance is 100");
  assertEqual(await ledgerInsurance(billing.id), 100, "S1: live ledger insurance is 100");
  assertEqual(Number((await getLineById(s1.lineId)).postedAmount), 100, "S1: line posts the full 100");

  let owed = await owedFor(therapist.id, billing.id);
  assertEqual(owed.item ? Number(owed.item.amountEarned) : null, 50, "S1: earned is 50 (50% of 100)");
  assertEqual(owed.total, 50, "S1: owed total is 50");

  // --- 2. Statement #2 ($150): a genuinely HIGHER second EOB. The dedup must
  //        bank only the $50 increment — never swallow it, never re-count the
  //        whole $150. -------------------------------------------------------
  const s2 = await createConfirmedStatement(billing.id, "150.00", "SP2");
  await storage.postInsuranceStatement(s2.statementId, userId);

  b = await getBilling(billing.id);
  assertEqual(Number(b.insurancePaidAmount), 150, "S2: collected rises to 150 (the $50 increment is banked)");
  assertEqual(await ledgerInsurance(billing.id), 150, "S2: live ledger insurance equals 150");
  assertEqual(Number((await getLineById(s2.lineId)).postedAmount), 50, "S2: line posts exactly the 50 increment");

  owed = await owedFor(therapist.id, billing.id);
  assertEqual(owed.item ? Number(owed.item.amountEarned) : null, 75, "S2: earned rises to 75 (50% of 150)");
  assertEqual(owed.total, 75, "S2: owed total rises to 75 — the extra $50 flowed through to pay");

  // --- 3. Statement #3 ($150, EQUAL): the dedup must add nothing. -----------
  const s3 = await createConfirmedStatement(billing.id, "150.00", "SP3");
  await storage.postInsuranceStatement(s3.statementId, userId);

  b = await getBilling(billing.id);
  assertEqual(Number(b.insurancePaidAmount), 150, "S3: an EQUAL second statement adds nothing (stays 150)");
  assertEqual(await ledgerInsurance(billing.id), 150, "S3: live ledger insurance stays 150");
  assertEqual(Number((await getLineById(s3.lineId)).postedAmount), 0, "S3: equal line posts a 0 shortfall");

  owed = await owedFor(therapist.id, billing.id);
  assertEqual(owed.item ? Number(owed.item.amountEarned) : null, 75, "S3: earned unchanged at 75");
  assertEqual(owed.total, 75, "S3: owed total unchanged at 75");

  // --- 4. Statement #4 ($120, LOWER): the dedup must add nothing. -----------
  const s4 = await createConfirmedStatement(billing.id, "120.00", "SP4");
  await storage.postInsuranceStatement(s4.statementId, userId);

  b = await getBilling(billing.id);
  assertEqual(Number(b.insurancePaidAmount), 150, "S4: a LOWER second statement adds nothing (stays 150)");
  assertEqual(await ledgerInsurance(billing.id), 150, "S4: live ledger insurance stays 150");
  assertEqual(Number((await getLineById(s4.lineId)).postedAmount), 0, "S4: lower line posts a 0 shortfall");

  owed = await owedFor(therapist.id, billing.id);
  assertEqual(owed.item ? Number(owed.item.amountEarned) : null, 75, "S4: earned unchanged at 75");
  assertEqual(owed.total, 75, "S4: owed total unchanged at 75");
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------
async function run() {
  console.log("\n🧪 Insurance: genuine second payment still banked (not lost to dedup)\n");

  const sysUser = await storage.createUser({
    username: `sys-${SUFFIX}`,
    password: "x",
    fullName: `Sys ${SUFFIX}`,
    email: `sys-${SUFFIX}@example.test`,
    role: "admin",
  } as any);
  createdUserIds.push(sysUser.id);

  try {
    await scenarioSecondPaymentBanked(sysUser.id);
  } catch (error) {
    console.error("\n❌ Test suite error:", error);
    testsFailed++;
  } finally {
    // --- Cleanup -------------------------------------------------------------
    try {
      if (createdBillingIds.length > 0) {
        await db
          .delete(paymentTransactions)
          .where(inArray(paymentTransactions.sessionBillingId, createdBillingIds));
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
        await db.delete(therapistPayRules).where(inArray(therapistPayRules.therapistId, createdUserIds));
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

  // --- Summary ---------------------------------------------------------------
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
