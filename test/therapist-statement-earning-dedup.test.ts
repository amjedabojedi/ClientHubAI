/**
 * Regression test: therapist running statement de-duplicates earning rows.
 *
 * The `therapist_earnings` ledger is append-only. A single session's earning can
 * therefore be represented by MULTIPLE rows for the same session_billing:
 *   - an original `entryType='earning'` row, plus
 *   - one or more later `entryType='adjustment'` delta rows (written when the
 *     collected amount changed — e.g. an over-collected billing inflated
 *     "collected", appending an extra positive adjustment, later corrected by a
 *     negative adjustment).
 *
 * `getTherapistStatement` must CONSOLIDATE all ledger rows for the same
 * session_billing into ONE net earning line (display concern only — the ledger
 * rows are never mutated). This test seeds exactly that situation:
 *   earning +50, adjustment +25, adjustment -25  (net 50)
 * and proves the statement shows a single earning line of 50, with totalEarned
 * and the running balance unchanged. Without consolidation the statement would
 * show three separate earning lines for one session.
 *
 * Run with: npx tsx test/therapist-statement-earning-dedup.test.ts
 *
 * NOTES:
 * - Uses the LIVE database. Seeds dedicated, uniquely-named rows and removes them
 *   (and anything derived) in a finally block.
 * - The seeded ledger's NET earning (50) is made to equal what the billing would
 *   compute (collected 100 * 50% rule = 50), so the pre-read syncTherapistEarnings
 *   is a no-op (delta 0) and leaves the three hand-seeded rows untouched.
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
  therapistEarnings,
  auditLogs,
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

const SUFFIX = `tearn-${Date.now()}`;

async function run() {
  console.log("\n🧪 Therapist statement earning de-duplication\n");

  let therapistId: number | undefined;
  let clientId: number | undefined;
  let serviceId: number | undefined;
  let sessionId: number | undefined;
  let billingId: number | undefined;

  try {
    // --- Seed a therapist, client, service, session and billing ------------
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

    const [session] = await db
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
    sessionId = session.id;

    // Billing collected = $100 (client paid). With the 50% rule below, the
    // computed earning is $50 — exactly the NET of the three seeded ledger rows,
    // so syncTherapistEarnings finds delta 0 and does not touch the ledger.
    const [billing] = await db
      .insert(sessionBilling)
      .values({
        sessionId,
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
    billingId = billing.id;

    // Default percentage pay rule: 50% of collected.
    await db.insert(therapistPayRules).values({
      therapistId,
      serviceId: null,
      payType: "percentage",
      payValue: "50.00",
    });

    // --- Seed the append-only ledger: earning + two adjustments ------------
    // earning +50, adjustment +25 (over-collection inflated), adjustment -25
    // (correction). Net = 50. These are THREE separate rows for one billing.
    const earnedDate = "2026-03-15";
    await db.insert(therapistEarnings).values([
      {
        therapistId,
        sessionBillingId: billingId,
        sessionId,
        clientId,
        clientName: client.fullName,
        serviceCode: service.serviceCode,
        serviceName: service.serviceName,
        entryType: "earning",
        amountEarned: "50.00",
        collectedSnapshot: "100.00",
        earnedDate,
      },
      {
        therapistId,
        sessionBillingId: billingId,
        sessionId,
        clientId,
        clientName: client.fullName,
        serviceCode: service.serviceCode,
        serviceName: service.serviceName,
        entryType: "adjustment",
        amountEarned: "25.00",
        collectedSnapshot: "150.00",
        earnedDate,
      },
      {
        therapistId,
        sessionBillingId: billingId,
        sessionId,
        clientId,
        clientName: client.fullName,
        serviceCode: service.serviceCode,
        serviceName: service.serviceName,
        entryType: "adjustment",
        amountEarned: "-25.00",
        collectedSnapshot: "100.00",
        earnedDate,
      },
    ]);

    // Sanity: there really are THREE raw ledger rows for this billing.
    const rawRows = await db
      .select()
      .from(therapistEarnings)
      .where(eq(therapistEarnings.sessionBillingId, billingId));
    assertEqual(rawRows.length, 3, "Ledger has 3 raw earning rows for the billing before reading the statement");

    // --- The behaviour under test -----------------------------------------
    const statement = await storage.getTherapistStatement(therapistId);

    // sync must not have appended a 4th delta row (net already matches computed).
    const rawAfter = await db
      .select()
      .from(therapistEarnings)
      .where(eq(therapistEarnings.sessionBillingId, billingId));
    assertEqual(rawAfter.length, 3, "Reading the statement does not mutate the append-only ledger (still 3 rows)");

    const earningLines = statement.entries.filter(
      (e) => e.type === "earning" && e.sessionId === sessionId,
    );
    assertEqual(
      earningLines.length,
      1,
      "Three ledger rows for one session render as ONE consolidated earning line",
    );
    assertEqual(earningLines[0]?.earned, 50, "The consolidated earning line shows the NET amount (50)");
    assertEqual(
      earningLines[0]?.runningBalance,
      50,
      "Running balance after the consolidated earning line is the net (50)",
    );

    // No payouts seeded, so totals reflect only this session's net earning.
    assertEqual(statement.totalEarned, 50, "totalEarned equals the net earning (50), not 50+25-25 across stacked lines");
    assertEqual(statement.totalPaid, 0, "totalPaid is 0 (no payouts seeded)");
    assertEqual(statement.currentOwed, 50, "currentOwed equals the net earning (50)");
  } catch (error) {
    console.error("\n❌ Test suite error:", error);
    testsFailed++;
  } finally {
    // Cleanup in FK-safe order.
    try {
      if (billingId != null) {
        await db.delete(therapistEarnings).where(eq(therapistEarnings.sessionBillingId, billingId));
      }
      if (therapistId != null) {
        await db.delete(therapistPayRules).where(eq(therapistPayRules.therapistId, therapistId));
        // Any audit rows sync may have written (defensive; expected none here).
        await db
          .delete(auditLogs)
          .where(eq(auditLogs.resourceType, "therapist_earning"))
          .catch(() => {});
      }
      if (billingId != null) {
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
