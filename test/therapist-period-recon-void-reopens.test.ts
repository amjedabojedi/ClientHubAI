/**
 * Regression test: voiding a therapist payout reopens its pay period so the
 * practice can re-record; re-recording closes it again.
 *
 * The period reconciliation (`getTherapistPeriodReconciliation`) builds one row
 * per non-voided payout's period label. Voiding every payout for a label
 * removes that row entirely (remaining balance is logically "fully open again").
 * Re-recording with the same label brings it back and closes it.
 *
 * This test also verifies that `derivePeriodFromDates` assigns an evening
 * session the correct PRACTICE-TIMEZONE calendar date rather than the next
 * calendar day that UTC would give — e.g. a session stored at 01:00 UTC on
 * Feb 1 is 8 pm EST on Jan 31 and must land in January, not February.
 *
 * Scenario:
 *   1. Seed a therapist with two January sessions:
 *      - Session A: 2026-01-15T14:00:00Z  (9 am EST, unambiguously January)
 *      - Session B: 2026-02-01T01:00:00Z  (8 pm EST on Jan 31 — UTC crosses
 *        into Feb 1 but the local date is still 2026-01-31)
 *   2. Record a lump payment covering both sessions → period label is
 *      2026-01-15..2026-01-31 (derived from the EST dates of the sessions).
 *   3. Check: getTherapistPeriodReconciliation shows the period as CLOSED
 *      (paidForPeriod >= earnedInPeriod, remaining ≈ 0).
 *   4. Void the payout → getTherapistPeriodReconciliation no longer includes
 *      that period at all (all payouts for the label are voided; the bucket
 *      never forms).
 *   5. Re-record a new payout with the same period label → period is CLOSED
 *      again.
 *
 * Run with: npx tsx test/therapist-period-recon-void-reopens.test.ts
 *
 * NOTES:
 * - Uses the LIVE database.
 * - Seeds dedicated, uniquely-named rows and removes everything in a finally
 *   block (FK-safe bottom-up order).
 * - The client is inserted with an explicit prefixed id to avoid racing with
 *   other suites on the MAX+1 CL-YEAR-NNNN sequence.
 */

import { db } from "../server/db";
import { storage } from "../server/storage";
import { derivePeriodFromDates } from "../server/storage";
import {
  users,
  clients,
  services,
  sessions,
  sessionBilling,
  therapistPayRules,
  therapistPayouts,
  therapistPaymentAllocations,
  therapistEarnings,
} from "../shared/schema";
import { eq, inArray } from "drizzle-orm";

// ---------------------------------------------------------------------------
// Tiny assertion helpers
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

function assertTrue(condition: boolean, message: string) {
  if (condition) {
    console.log(`✅ PASS: ${message}`);
    testsPassed++;
  } else {
    console.error(`❌ FAIL: ${message}`);
    testsFailed++;
  }
}

// ---------------------------------------------------------------------------
// Main test
// ---------------------------------------------------------------------------
const SUFFIX = `tperiodvoid-${Date.now()}`;

async function run() {
  console.log("\n🧪 Therapist period-recon: void reopens, re-record closes\n");

  let therapistId: number | undefined;
  let clientId: number | undefined;
  let serviceId: number | undefined;
  let sessionAId: number | undefined;
  let sessionBId: number | undefined;
  let billingAId: number | undefined;
  let billingBId: number | undefined;
  let firstPayoutId: number | undefined;
  let secondPayoutId: number | undefined;

  try {
    // -----------------------------------------------------------------------
    // 0. Seed fixtures: therapist, client, service, two sessions + billings
    // -----------------------------------------------------------------------
    const therapist = await storage.createUser({
      username: `therapist-${SUFFIX}`,
      password: "x",
      fullName: `Therapist ${SUFFIX}`,
      email: `therapist-${SUFFIX}@example.test`,
      role: "therapist",
    } as any);
    therapistId = therapist.id;

    // Use an explicit prefixed clientId to avoid CL-YEAR-MAX+1 races.
    const [client] = await db
      .insert(clients)
      .values({
        clientId: `T${Date.now()}`.slice(0, 20),
        fullName: `Client ${SUFFIX}`,
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
        baseRate: "100.00",
      })
      .returning();
    serviceId = service.id;

    // 50% percentage rule (applies to all services).
    await db.insert(therapistPayRules).values({
      therapistId,
      serviceId: null,
      payType: "percentage",
      payValue: "50.00",
    });

    // Session A — 9 am EST on Jan 15 (UTC 14:00 — unambiguously January in
    // any timezone).
    const [sessionA] = await db
      .insert(sessions)
      .values({
        clientId,
        therapistId,
        serviceId,
        sessionDate: new Date("2026-01-15T14:00:00.000Z"),
        sessionType: "individual",
        status: "completed",
      })
      .returning();
    sessionAId = sessionA.id;

    // Session B — 8 pm EST on Jan 31 (UTC 2026-02-01T01:00:00Z).
    // The UTC date is Feb 1 but the practice-timezone date is Jan 31.
    // This verifies that the period label uses the local (EST) date, not UTC.
    const [sessionB] = await db
      .insert(sessions)
      .values({
        clientId,
        therapistId,
        serviceId,
        sessionDate: new Date("2026-02-01T01:00:00.000Z"),
        sessionType: "individual",
        status: "completed",
      })
      .returning();
    sessionBId = sessionB.id;

    // Billing for Session A: $200 collected → $100 earned (50%).
    const [billingA] = await db
      .insert(sessionBilling)
      .values({
        sessionId: sessionAId,
        serviceCode: service.serviceCode,
        units: 1,
        ratePerUnit: "200.00",
        totalAmount: "200.00",
        clientPaidAmount: "200.00",
        insurancePaidAmount: "0.00",
        billingDate: "2026-01-15",
        paymentStatus: "paid",
      })
      .returning();
    billingAId = billingA.id;

    await db.insert(therapistEarnings).values({
      therapistId,
      sessionBillingId: billingAId,
      sessionId: sessionAId,
      clientId,
      clientName: client.fullName,
      serviceCode: service.serviceCode,
      serviceName: service.serviceName,
      entryType: "earning",
      amountEarned: "100.00",
      collectedSnapshot: "200.00",
      earnedDate: "2026-01-15",
    });

    // Billing for Session B: $200 collected → $100 earned (50%).
    // earnedDate is the EST date (Jan 31), not the UTC date (Feb 1).
    const [billingB] = await db
      .insert(sessionBilling)
      .values({
        sessionId: sessionBId,
        serviceCode: service.serviceCode,
        units: 1,
        ratePerUnit: "200.00",
        totalAmount: "200.00",
        clientPaidAmount: "200.00",
        insurancePaidAmount: "0.00",
        billingDate: "2026-01-31",
        paymentStatus: "paid",
      })
      .returning();
    billingBId = billingB.id;

    await db.insert(therapistEarnings).values({
      therapistId,
      sessionBillingId: billingBId,
      sessionId: sessionBId,
      clientId,
      clientName: client.fullName,
      serviceCode: service.serviceCode,
      serviceName: service.serviceName,
      entryType: "earning",
      amountEarned: "100.00",
      collectedSnapshot: "200.00",
      // EST calendar date (Jan 31), even though UTC is Feb 1.
      earnedDate: "2026-01-31",
    });

    // -----------------------------------------------------------------------
    // 1. Verify derivePeriodFromDates uses the practice timezone (EST).
    //    Session B is stored as 2026-02-01T01:00:00Z (UTC Feb 1) but in EST
    //    that is still Jan 31 — the period end must be "2026-01-31", not
    //    "2026-02-01".
    // -----------------------------------------------------------------------
    console.log("\n── Section 1: derivePeriodFromDates timezone check ──");
    const derived = derivePeriodFromDates([
      new Date("2026-01-15T14:00:00.000Z"),
      new Date("2026-02-01T01:00:00.000Z"), // UTC Feb 1, EST Jan 31
    ]);
    assertEqual(
      derived.start,
      "2026-01-15",
      "Derived period start is 2026-01-15 (session A's EST date)",
    );
    assertEqual(
      derived.end,
      "2026-01-31",
      "Derived period END is 2026-01-31 (session B's EST date), not 2026-02-01 (UTC date)",
    );

    // -----------------------------------------------------------------------
    // 2. Record a lump payout covering both sessions ($200 total).
    //    The period label is supplied explicitly to match the EST-derived dates.
    // -----------------------------------------------------------------------
    console.log("\n── Section 2: Record payout → period shows Closed ──");
    const result = await storage.createTherapistLumpPayment({
      therapistId,
      amount: 200,
      paymentDate: "2026-02-05",
      periodStart: "2026-01-15",
      periodEnd: "2026-01-31",
      createdBy: therapistId,
    });
    firstPayoutId = result.id;

    // The period label must reflect the supplied explicit range.
    assertEqual(
      (result as any).periodStart,
      "2026-01-15",
      "Payout periodStart is 2026-01-15",
    );
    assertEqual(
      (result as any).periodEnd,
      "2026-01-31",
      "Payout periodEnd is 2026-01-31",
    );

    const reconAfterPay = await storage.getTherapistPeriodReconciliation(therapistId);
    const periodAfterPay = reconAfterPay.periods.find(
      (p) => p.periodStart === "2026-01-15" && p.periodEnd === "2026-01-31",
    );
    assertTrue(
      periodAfterPay !== undefined,
      "Period 2026-01-15..2026-01-31 appears in reconciliation after payout",
    );
    assertEqual(
      periodAfterPay?.paidForPeriod,
      200,
      "paidForPeriod is 200 after recording $200 payout",
    );
    assertEqual(
      periodAfterPay?.earnedInPeriod,
      200,
      "earnedInPeriod is 200 (both sessions' earnings fall within the period dates)",
    );
    assertTrue(
      periodAfterPay?.closed === true,
      "Period is CLOSED after payout (remaining ≤ 0)",
    );
    assertTrue(
      (periodAfterPay?.remaining ?? 1) <= 0.005,
      "Remaining is effectively 0 (fully settled)",
    );

    // -----------------------------------------------------------------------
    // 3. Void the payout → the period must disappear (no bucket without a
    //    non-voided payout) — the period is logically open again.
    // -----------------------------------------------------------------------
    console.log("\n── Section 3: Void payout → period re-opens ──");
    await storage.voidTherapistPayout(firstPayoutId, therapistId, `test void ${SUFFIX}`);

    const reconAfterVoid = await storage.getTherapistPeriodReconciliation(therapistId);
    const periodAfterVoid = reconAfterVoid.periods.find(
      (p) => p.periodStart === "2026-01-15" && p.periodEnd === "2026-01-31",
    );
    assertTrue(
      periodAfterVoid === undefined,
      "Period 2026-01-15..2026-01-31 does NOT appear in reconciliation after void (all payouts voided, bucket absent)",
    );
    assertEqual(
      reconAfterVoid.unlabeledPayments.length,
      0,
      "No unlabeled payments (voided payouts are entirely excluded, not demoted to unlabeled)",
    );

    // -----------------------------------------------------------------------
    // 4. Re-record a new payout with the same period label → Closed again.
    // -----------------------------------------------------------------------
    console.log("\n── Section 4: Re-record payout → period Closed again ──");
    const result2 = await storage.createTherapistLumpPayment({
      therapistId,
      amount: 200,
      paymentDate: "2026-02-10",
      periodStart: "2026-01-15",
      periodEnd: "2026-01-31",
      createdBy: therapistId,
    });
    secondPayoutId = result2.id;

    const reconAfterRepay = await storage.getTherapistPeriodReconciliation(therapistId);
    const periodAfterRepay = reconAfterRepay.periods.find(
      (p) => p.periodStart === "2026-01-15" && p.periodEnd === "2026-01-31",
    );
    assertTrue(
      periodAfterRepay !== undefined,
      "Period 2026-01-15..2026-01-31 re-appears in reconciliation after re-recording",
    );
    assertEqual(
      periodAfterRepay?.paidForPeriod,
      200,
      "paidForPeriod is 200 after re-recording",
    );
    assertTrue(
      periodAfterRepay?.closed === true,
      "Period is CLOSED again after re-recording",
    );
    assertTrue(
      (periodAfterRepay?.remaining ?? 1) <= 0.005,
      "Remaining is again effectively 0",
    );
    assertEqual(
      periodAfterRepay?.payoutCount,
      1,
      "payoutCount is 1 (only the new non-voided payout counts)",
    );
  } catch (error) {
    console.error("\n❌ Test suite error:", error);
    testsFailed++;
  } finally {
    // Cleanup in FK-safe bottom-up order.
    try {
      if (therapistId != null) {
        await db
          .delete(therapistPaymentAllocations)
          .where(
            inArray(
              therapistPaymentAllocations.payoutId,
              [firstPayoutId, secondPayoutId].filter(Boolean) as number[],
            ),
          )
          .catch(() => {});
        await db.delete(therapistPayouts).where(eq(therapistPayouts.therapistId, therapistId));
      }
      if (billingAId != null) {
        await db
          .delete(therapistEarnings)
          .where(eq(therapistEarnings.sessionBillingId, billingAId))
          .catch(() => {});
      }
      if (billingBId != null) {
        await db
          .delete(therapistEarnings)
          .where(eq(therapistEarnings.sessionBillingId, billingBId))
          .catch(() => {});
      }
      if (therapistId != null) {
        await db
          .delete(therapistPayRules)
          .where(eq(therapistPayRules.therapistId, therapistId));
      }
      if (billingAId != null) {
        await db.delete(sessionBilling).where(eq(sessionBilling.id, billingAId));
      }
      if (billingBId != null) {
        await db.delete(sessionBilling).where(eq(sessionBilling.id, billingBId));
      }
      if (sessionAId != null) {
        await db.delete(sessions).where(eq(sessions.id, sessionAId));
      }
      if (sessionBId != null) {
        await db.delete(sessions).where(eq(sessions.id, sessionBId));
      }
      if (clientId != null) {
        await db.delete(clients).where(eq(clients.id, clientId));
      }
      if (serviceId != null) {
        await db.delete(services).where(eq(services.id, serviceId));
      }
      if (therapistId != null) {
        await db.delete(users).where(inArray(users.id, [therapistId]));
      }
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

run().catch((error) => {
  console.error("Fatal error running tests:", error);
  process.exit(1);
});
