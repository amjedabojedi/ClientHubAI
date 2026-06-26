/**
 * Regression test: a therapist's MONTHLY/period statement always reconciles
 * with their RUNNING statement.
 *
 * Earnings surface in two independently-computed places:
 *   - the running statement (`getTherapistStatement`) — the full append-only
 *     ledger collapsed into one net earning line per session/billing, with a
 *     running balance; and
 *   - the per-month statement (`getTherapistMonthlyStatement` →
 *     `getTherapistPeriodStatement`) — the same persisted ledger rows bucketed
 *     by earnedDate into opening / earned-in-period / paid-in-period / closing.
 *
 * They are DESIGNED to agree (same net earned per session, and the monthly
 * opening+earned−paid chain must land on the running balance), but nothing
 * automatically verifies it — a future change to either path could silently
 * make a therapist's monthly numbers diverge from their running balance.
 *
 * This test seeds:
 *   - a FEBRUARY session/billing with a single earning row (+30) — the prior
 *     activity that becomes March's non-zero OPENING balance;
 *   - a MARCH session/billing whose ledger is a MULTI-ROW stack for one billing
 *     (earning +50, adjustment +25, adjustment −25 → net 50); and
 *   - a MARCH payout of $20.
 *
 * and asserts:
 *   1. March's "earned in period" equals the running statement's NET earning
 *      line for that same session (50 == 50) — the multi-row stack reconciles.
 *   2. opening + earned − paid == closing for the month (30 + 50 − 20 == 60).
 *   3. The month's CLOSING balance equals the running statement's currentOwed
 *      (60 == 60) — i.e. the latest period closes exactly on the running
 *      balance; the two views agree.
 *
 * Each billing's ledger NET is made to equal what the billing would compute
 * (collected * 50% rule), so the pre-read syncTherapistEarnings is a no-op
 * (delta 0) and leaves the hand-seeded rows untouched.
 *
 * Run with: npx tsx test/therapist-statement-monthly-running-agree.test.ts
 *
 * NOTES:
 * - Uses the LIVE database. Seeds dedicated, uniquely-named rows and removes
 *   them (and anything derived) in a finally block.
 */

import { db } from "../server/db";
import { storage } from "../server/storage";
import {
  users,
  clients,
  services,
  sessions,
  sessionBilling,
  therapistPayRules,
  therapistPayouts,
  therapistEarnings,
  auditLogs,
} from "../shared/schema";
import { eq, inArray } from "drizzle-orm";

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

const SUFFIX = `tmonthly-${Date.now()}`;

async function run() {
  console.log("\n🧪 Therapist monthly vs running statement reconciliation\n");

  let therapistId: number | undefined;
  let clientId: number | undefined;
  let serviceId: number | undefined;
  let febSessionId: number | undefined;
  let febBillingId: number | undefined;
  let marSessionId: number | undefined;
  let marBillingId: number | undefined;

  try {
    // --- Seed a therapist, client, service --------------------------------
    const therapist = await storage.createUser({
      username: `therapist-${SUFFIX}`,
      password: "x",
      fullName: `Therapist ${SUFFIX}`,
      email: `therapist-${SUFFIX}@example.test`,
      role: "therapist",
    } as any);
    therapistId = therapist.id;

    // Insert the client directly with an explicit, unique clientId. We avoid
    // storage.createClient here because it derives a sequential CL-YEAR-NNNN id
    // from MAX+1, which races (unique-constraint violation) against other
    // suites/the test-privacy workflow creating clients concurrently.
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

    // Default percentage pay rule: 50% of collected (applies to all services).
    await db.insert(therapistPayRules).values({
      therapistId,
      serviceId: null,
      payType: "percentage",
      payValue: "50.00",
    });

    // --- FEBRUARY session/billing: the prior activity (opening balance) -----
    // collected $60 * 50% = $30 computed; single ledger earning row of $30, so
    // sync stays a no-op for this billing too.
    const [febSession] = await db
      .insert(sessions)
      .values({
        clientId,
        therapistId,
        serviceId,
        sessionDate: new Date("2026-02-10T10:00:00.000Z"),
        sessionType: "individual",
        status: "completed",
      })
      .returning();
    febSessionId = febSession.id;

    const [febBilling] = await db
      .insert(sessionBilling)
      .values({
        sessionId: febSessionId,
        serviceCode: service.serviceCode,
        units: 1,
        ratePerUnit: "60.00",
        totalAmount: "60.00",
        clientPaidAmount: "60.00",
        insurancePaidAmount: "0.00",
        billingDate: "2026-02-10",
        paymentStatus: "paid",
      })
      .returning();
    febBillingId = febBilling.id;

    await db.insert(therapistEarnings).values({
      therapistId,
      sessionBillingId: febBillingId,
      sessionId: febSessionId,
      clientId,
      clientName: client.fullName,
      serviceCode: service.serviceCode,
      serviceName: service.serviceName,
      entryType: "earning",
      amountEarned: "30.00",
      collectedSnapshot: "60.00",
      earnedDate: "2026-02-10",
    });

    // --- MARCH session/billing: the multi-row ledger under test -------------
    // collected $100 * 50% = $50 computed; ledger earning +50, adjustment +25,
    // adjustment -25 (net 50) — three rows for ONE billing, NET equals computed.
    const [marSession] = await db
      .insert(sessions)
      .values({
        clientId,
        therapistId,
        serviceId,
        sessionDate: new Date("2026-03-15T10:00:00.000Z"),
        sessionType: "individual",
        status: "completed",
      })
      .returning();
    marSessionId = marSession.id;

    const [marBilling] = await db
      .insert(sessionBilling)
      .values({
        sessionId: marSessionId,
        serviceCode: service.serviceCode,
        units: 1,
        ratePerUnit: "100.00",
        totalAmount: "100.00",
        clientPaidAmount: "100.00",
        insurancePaidAmount: "0.00",
        billingDate: "2026-03-15",
        paymentStatus: "paid",
      })
      .returning();
    marBillingId = marBilling.id;

    const marEarnedDate = "2026-03-15";
    await db.insert(therapistEarnings).values([
      {
        therapistId,
        sessionBillingId: marBillingId,
        sessionId: marSessionId,
        clientId,
        clientName: client.fullName,
        serviceCode: service.serviceCode,
        serviceName: service.serviceName,
        entryType: "earning",
        amountEarned: "50.00",
        collectedSnapshot: "100.00",
        earnedDate: marEarnedDate,
      },
      {
        therapistId,
        sessionBillingId: marBillingId,
        sessionId: marSessionId,
        clientId,
        clientName: client.fullName,
        serviceCode: service.serviceCode,
        serviceName: service.serviceName,
        entryType: "adjustment",
        amountEarned: "25.00",
        collectedSnapshot: "150.00",
        earnedDate: marEarnedDate,
      },
      {
        therapistId,
        sessionBillingId: marBillingId,
        sessionId: marSessionId,
        clientId,
        clientName: client.fullName,
        serviceCode: service.serviceCode,
        serviceName: service.serviceName,
        entryType: "adjustment",
        amountEarned: "-25.00",
        collectedSnapshot: "100.00",
        earnedDate: marEarnedDate,
      },
    ]);

    // --- MARCH payout: makes paidInMonth / totalPaid non-zero --------------
    await db.insert(therapistPayouts).values({
      therapistId,
      totalAmount: "20.00",
      paymentDate: "2026-03-20",
      paymentType: "itemized",
      status: "paid",
    });

    // --- Read BOTH statements ---------------------------------------------
    const running = await storage.getTherapistStatement(therapistId);
    const march = await storage.getTherapistMonthlyStatement(therapistId, "2026-03");

    // Sync must NOT have appended any 4th delta row to either billing (each
    // ledger net already matches its computed earning).
    const marRows = await db
      .select()
      .from(therapistEarnings)
      .where(eq(therapistEarnings.sessionBillingId, marBillingId));
    assertEqual(marRows.length, 3, "March billing still has its 3 hand-seeded ledger rows (sync was a no-op)");

    // The running statement's NET earning line for the March session.
    const marRunningEarning = running.entries.find(
      (e) => e.type === "earning" && e.sessionId === marSessionId,
    );
    assertEqual(
      marRunningEarning?.earned,
      50,
      "Running statement collapses March's 3 ledger rows into ONE net earning line of 50",
    );

    // (1) March's "earned in period" equals the running net earning for the
    //     same session — the two views agree on what was earned that month.
    assertEqual(march.earnedInMonth, 50, "March earnedInMonth equals the net of the month's ledger rows (50)");
    assertEqual(
      march.earnedInMonth,
      marRunningEarning?.earned,
      "March earnedInMonth equals the running statement's net earning for that session",
    );

    // Opening reflects February's prior earning ($30), nothing paid yet.
    assertEqual(march.openingBalance, 30, "March opening balance carries February's prior earning (30)");
    assertEqual(march.paidInMonth, 20, "March paidInMonth reflects the in-month $20 payout");

    // (2) opening + earned − paid == closing.
    assertEqual(
      Math.round((march.openingBalance + march.earnedInMonth - march.paidInMonth) * 100) / 100,
      march.closingBalance,
      "opening + earned − paid == closing for March (30 + 50 − 20 == 60)",
    );
    assertEqual(march.closingBalance, 60, "March closing balance is 60");

    // (3) The latest period closes exactly on the running balance — the
    //     monthly and running views reconcile.
    assertEqual(running.totalEarned, 80, "Running totalEarned across all time is 80 (30 + 50)");
    assertEqual(running.totalPaid, 20, "Running totalPaid across all time is 20");
    assertEqual(
      march.closingBalance,
      running.currentOwed,
      "March closing balance equals the running statement's currentOwed (60) — the views agree",
    );
  } catch (error) {
    console.error("\n❌ Test suite error:", error);
    testsFailed++;
  } finally {
    // Cleanup in FK-safe order.
    try {
      if (therapistId != null) {
        await db.delete(therapistPayouts).where(eq(therapistPayouts.therapistId, therapistId));
      }
      const billingIds = [febBillingId, marBillingId].filter((x): x is number => x != null);
      if (billingIds.length) {
        await db.delete(therapistEarnings).where(inArray(therapistEarnings.sessionBillingId, billingIds));
      }
      if (therapistId != null) {
        await db.delete(therapistPayRules).where(eq(therapistPayRules.therapistId, therapistId));
        await db
          .delete(auditLogs)
          .where(eq(auditLogs.resourceType, "therapist_earning"))
          .catch(() => {});
      }
      if (billingIds.length) {
        await db.delete(sessionBilling).where(inArray(sessionBilling.id, billingIds));
      }
      const sessionIds = [febSessionId, marSessionId].filter((x): x is number => x != null);
      if (sessionIds.length) {
        await db.delete(sessions).where(inArray(sessions.id, sessionIds));
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
