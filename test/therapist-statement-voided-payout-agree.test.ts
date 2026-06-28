/**
 * Regression test: a VOIDED payout reconciles across a therapist's RUNNING
 * statement and their per-month (period) statements, even when the payout is
 * paid in one month and voided in a LATER month.
 *
 * A void is never erased. The two statement views model it differently but must
 * still agree:
 *   - the running statement (`getTherapistStatement`) keeps the ORIGINAL payment
 *     line on its paymentDate and appends a reversing 'adjustment' line (negative
 *     paid) on the void date — the two net to zero in the running balance; while
 *   - the period statement (`getTherapistPeriodStatement`) buckets the POSITIVE
 *     payment event on its paymentDate and the NEGATIVE reversal event on its
 *     voidedAt date, each into whichever month it falls in.
 *
 * The tricky part is the month boundary: when a payout is paid in month A and
 * voided in a later month B, the money must leave the ledger in A (A's
 * paidInMonth is positive) and be added back in B (B's paidInMonth is negative).
 * Nothing currently verifies the two views still reconcile across that boundary.
 *
 * This test seeds:
 *   - a JANUARY session/billing with a single earning row (+100) — the prior
 *     activity that establishes a non-zero balance carried forward; and
 *   - a payout of $40 PAID on 2026-02-15 but VOIDED on 2026-04-10 (a later
 *     month). It is inserted directly with status='voided' + voidedAt so the
 *     void lands in a deterministic later month (voidTherapistPayout would stamp
 *     voidedAt = now).
 *
 * and asserts:
 *   1. The running statement keeps BOTH the +40 payment line (Feb) and the −40
 *      reversal adjustment line (Apr), netting totalPaid to 0.
 *   2. FEBRUARY (the payment month) has paidInMonth == +40.
 *   3. APRIL (the void month) has paidInMonth == −40 (the reversal adds back).
 *   4. The interim month MARCH sees neither event (paidInMonth == 0).
 *   5. opening + earned − paid == closing for EVERY month, and the months chain
 *      (each month's closing == the next month's opening).
 *   6. The final (void) month's closing balance equals the running statement's
 *      currentOwed — the two views agree after the void.
 *
 * Run with: npx tsx test/therapist-statement-voided-payout-agree.test.ts
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

const SUFFIX = `tvoidpayout-${Date.now()}`;

async function run() {
  console.log("\n🧪 Therapist voided-payout statement reconciliation\n");

  let therapistId: number | undefined;
  let clientId: number | undefined;
  let serviceId: number | undefined;
  let janSessionId: number | undefined;
  let janBillingId: number | undefined;
  let payoutId: number | undefined;

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

    // --- JANUARY session/billing: the prior activity ----------------------
    // collected $200 * 50% = $100 computed; a single $100 ledger earning row so
    // the pre-read syncTherapistEarnings stays a no-op (delta 0).
    const [janSession] = await db
      .insert(sessions)
      .values({
        clientId,
        therapistId,
        serviceId,
        sessionDate: new Date("2026-01-10T10:00:00.000Z"),
        sessionType: "individual",
        status: "completed",
      })
      .returning();
    janSessionId = janSession.id;

    const [janBilling] = await db
      .insert(sessionBilling)
      .values({
        sessionId: janSessionId,
        serviceCode: service.serviceCode,
        units: 1,
        ratePerUnit: "200.00",
        totalAmount: "200.00",
        clientPaidAmount: "200.00",
        insurancePaidAmount: "0.00",
        billingDate: "2026-01-10",
        paymentStatus: "paid",
      })
      .returning();
    janBillingId = janBilling.id;

    await db.insert(therapistEarnings).values({
      therapistId,
      sessionBillingId: janBillingId,
      sessionId: janSessionId,
      clientId,
      clientName: client.fullName,
      serviceCode: service.serviceCode,
      serviceName: service.serviceName,
      entryType: "earning",
      amountEarned: "100.00",
      collectedSnapshot: "200.00",
      earnedDate: "2026-01-10",
    });

    // --- A payout PAID in February but VOIDED in April --------------------
    // Inserted directly (not via voidTherapistPayout) so voidedAt lands in a
    // deterministic later month; voidTherapistPayout would stamp it with now().
    const [payout] = await db
      .insert(therapistPayouts)
      .values({
        therapistId,
        totalAmount: "40.00",
        paymentDate: "2026-02-15",
        paymentType: "itemized",
        status: "voided",
        voidedAt: new Date("2026-04-10T12:00:00.000Z"),
        voidedBy: therapistId,
        voidReason: `void ${SUFFIX}`,
      })
      .returning();
    payoutId = payout.id;

    // --- Read the running statement + four monthly statements --------------
    const running = await storage.getTherapistStatement(therapistId);
    const jan = await storage.getTherapistMonthlyStatement(therapistId, "2026-01");
    const feb = await storage.getTherapistMonthlyStatement(therapistId, "2026-02");
    const mar = await storage.getTherapistMonthlyStatement(therapistId, "2026-03");
    const apr = await storage.getTherapistMonthlyStatement(therapistId, "2026-04");

    // Sync must NOT have appended any delta row (ledger net already matches the
    // computed earning), so the hand-seeded $100 row is the whole earning.
    const janRows = await db
      .select()
      .from(therapistEarnings)
      .where(eq(therapistEarnings.sessionBillingId, janBillingId));
    assertEqual(janRows.length, 1, "January billing still has its single hand-seeded earning row (sync was a no-op)");

    // (1) The running statement keeps BOTH the payment line and the reversal.
    const payLine = running.entries.find(
      (e) => e.type === "payment" && (e as any).payoutId === payoutId,
    );
    const reversalLine = running.entries.find(
      (e) => e.type === "adjustment" && (e as any).payoutId === payoutId,
    );
    assertEqual(payLine?.paid, 40, "Running statement keeps the original +40 payment line for the voided payout");
    assertEqual(payLine?.date, "2026-02-15", "The payment line sits on the payout's paymentDate (Feb 15)");
    assertEqual(reversalLine?.paid, -40, "Running statement adds a −40 reversal adjustment line for the void");
    assertEqual(reversalLine?.date, "2026-04-10", "The reversal line sits on the payout's voidedAt date (Apr 10)");
    assertEqual(running.totalPaid, 0, "The +40 payment and −40 reversal net totalPaid back to 0");
    assertEqual(running.totalEarned, 100, "Running totalEarned is just the January earning (100)");
    assertEqual(running.currentOwed, 100, "Running currentOwed is 100 (earned 100, net paid 0)");

    // (2) FEBRUARY — the payment month — sees the +40 payment.
    assertEqual(feb.openingBalance, 100, "Feb opening carries January's earning (100)");
    assertEqual(feb.earnedInMonth, 0, "Feb earned nothing");
    assertEqual(feb.paidInMonth, 40, "Feb paidInMonth includes the +40 payment");
    assertEqual(feb.closingBalance, 60, "Feb closing is 100 + 0 − 40 == 60");

    // (3) APRIL — the void month — sees the −40 reversal (money added back).
    assertEqual(apr.earnedInMonth, 0, "Apr earned nothing");
    assertEqual(apr.paidInMonth, -40, "Apr paidInMonth reflects the −40 void reversal (money added back)");

    // (4) The interim month MARCH sees neither the payment nor the reversal.
    assertEqual(mar.paidInMonth, 0, "Mar sees neither the payment nor the void reversal (paidInMonth 0)");
    assertEqual(mar.earnedInMonth, 0, "Mar earned nothing");

    // (5) opening + earned − paid == closing for every month.
    for (const [name, st] of [
      ["Jan", jan],
      ["Feb", feb],
      ["Mar", mar],
      ["Apr", apr],
    ] as const) {
      assertEqual(
        Math.round((st.openingBalance + st.earnedInMonth - st.paidInMonth) * 100) / 100,
        st.closingBalance,
        `${name}: opening + earned − paid == closing`,
      );
    }

    // ...and the months chain: each month's closing == next month's opening.
    assertEqual(jan.closingBalance, feb.openingBalance, "Jan closing chains into Feb opening");
    assertEqual(feb.closingBalance, mar.openingBalance, "Feb closing chains into Mar opening");
    assertEqual(mar.closingBalance, apr.openingBalance, "Mar closing chains into Apr opening");

    // (6) The void month closes exactly on the running balance — the views agree.
    assertEqual(apr.closingBalance, 100, "Apr (void month) closing is back to 100");
    assertEqual(
      apr.closingBalance,
      running.currentOwed,
      "April closing balance equals the running statement's currentOwed (100) — the views agree after the void",
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
      if (janBillingId != null) {
        await db.delete(therapistEarnings).where(eq(therapistEarnings.sessionBillingId, janBillingId));
      }
      if (therapistId != null) {
        await db.delete(therapistPayRules).where(eq(therapistPayRules.therapistId, therapistId));
        await db
          .delete(auditLogs)
          .where(eq(auditLogs.resourceType, "therapist_earning"))
          .catch(() => {});
      }
      if (janBillingId != null) {
        await db.delete(sessionBilling).where(eq(sessionBilling.id, janBillingId));
      }
      if (janSessionId != null) {
        await db.delete(sessions).where(eq(sessions.id, janSessionId));
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
