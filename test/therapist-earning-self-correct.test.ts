/**
 * Regression test: an over-collected session self-corrects therapist pay.
 *
 * Therapist pay is a percentage of what was *collected* on a session's billing.
 * When a billing is over-collected — e.g. a manual insurance payment AND an
 * insurance-statement post stack on the same billing (the same double-count that
 * inflates collections) — the therapist's earning is materialized too high.
 *
 * The fix is upstream: correct the collected amount, and earnings must
 * self-correct on the NEXT statement read. `therapist_earnings` is append-only,
 * so `syncTherapistEarnings` appends a NEGATIVE `entryType='adjustment'` delta
 * row (it never mutates the original 'earning' row) so the session nets back to
 * the correct earning. Sibling test `therapist-statement-earning-dedup.test.ts`
 * proves how a statement DISPLAYS a session that already has such a correction;
 * this test proves the upstream cleanup path that actually CREATES it.
 *
 * Flow under test:
 *   1. Seed a session/billing collected at an INFLATED $200 (client $100 +
 *      insurance $100 stacked). With a 50% rule the first read materializes a
 *      single 'earning' row of $100 — pay is overstated.
 *   2. Correct the collected amount down to $100 (drop the bogus insurance $100).
 *   3. Read the statement again. sync must append exactly one 'adjustment' row of
 *      -$50, leaving the ledger at net $50 == corrected collected ($100) * 50%.
 *
 * Run with: npx tsx test/therapist-earning-self-correct.test.ts
 *
 * NOTES:
 * - Uses the LIVE database. Seeds dedicated, uniquely-named rows and removes them
 *   (and anything derived) in a finally block.
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

const SUFFIX = `tearn-sc-${Date.now()}`;

async function run() {
  console.log("\n🧪 Over-collected session self-corrects therapist pay\n");

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

    // Over-collected billing: a real client payment of $100 PLUS a bogus
    // insurance $100 stacked on the same billing => collected $200. With the
    // 50% rule below the first read will materialize an earning of $100, which
    // overstates what the therapist should actually be paid.
    const [billing] = await db
      .insert(sessionBilling)
      .values({
        sessionId,
        serviceCode: service.serviceCode,
        units: 1,
        ratePerUnit: "100.00",
        totalAmount: "100.00",
        clientPaidAmount: "100.00",
        insurancePaidAmount: "100.00",
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

    // --- 1. First read materializes the INFLATED earning -------------------
    const inflatedStatement = await storage.getTherapistStatement(therapistId);

    const rowsAfterFirst = await db
      .select()
      .from(therapistEarnings)
      .where(eq(therapistEarnings.sessionBillingId, billingId));
    assertEqual(
      rowsAfterFirst.length,
      1,
      "First read materializes exactly one 'earning' row for the billing",
    );
    assertEqual(
      rowsAfterFirst[0]?.entryType,
      "earning",
      "The first materialized row is an 'earning' row (not an adjustment)",
    );
    assertEqual(
      Number(rowsAfterFirst[0]?.amountEarned),
      100,
      "The materialized earning is inflated to $100 (50% of the over-collected $200)",
    );

    const inflatedLines = inflatedStatement.entries.filter(
      (e) => e.type === "earning" && e.sessionId === sessionId,
    );
    assertEqual(inflatedLines.length, 1, "Statement shows one earning line for the session before correction");
    assertEqual(inflatedLines[0]?.earned, 100, "Statement earning line is inflated to $100 before correction");
    assertEqual(inflatedStatement.currentOwed, 100, "currentOwed is inflated to $100 before correction");

    // --- 2. Correct the over-collection -----------------------------------
    // Remove the bogus insurance $100 so collected drops to the real $100.
    await db
      .update(sessionBilling)
      .set({ insurancePaidAmount: "0.00" })
      .where(eq(sessionBilling.id, billingId));

    // --- 3. Next read must self-correct via a negative adjustment ----------
    const correctedStatement = await storage.getTherapistStatement(therapistId);

    const rowsAfterCorrection = await db
      .select()
      .from(therapistEarnings)
      .where(eq(therapistEarnings.sessionBillingId, billingId));
    assertEqual(
      rowsAfterCorrection.length,
      2,
      "Correcting collected appends exactly one new ledger row (append-only, original untouched)",
    );

    const adjustments = rowsAfterCorrection.filter((r) => r.entryType === "adjustment");
    assertEqual(adjustments.length, 1, "The appended row is an 'adjustment' delta row");
    assertEqual(
      Number(adjustments[0]?.amountEarned),
      -50,
      "The adjustment is a NEGATIVE delta of -$50 (corrects the $100 earning down to $50)",
    );

    // Net of all ledger rows for the billing == corrected collected * rule.
    const netEarned =
      Math.round(
        rowsAfterCorrection.reduce((sum, r) => sum + Number(r.amountEarned), 0) * 100,
      ) / 100;
    assertEqual(netEarned, 50, "Net ledger earning for the session is $50 (corrected collected $100 * 50%)");

    // Original 'earning' row is preserved unchanged (history is never mutated).
    const original = rowsAfterCorrection.find((r) => r.entryType === "earning");
    assertEqual(
      Number(original?.amountEarned),
      100,
      "The original 'earning' row is left at $100 (append-only ledger, never mutated)",
    );

    // And the statement now nets to the corrected pay.
    const correctedLines = correctedStatement.entries.filter(
      (e) => e.type === "earning" && e.sessionId === sessionId,
    );
    assertEqual(
      correctedLines.length,
      1,
      "After correction the statement still shows ONE consolidated earning line for the session",
    );
    assertEqual(correctedLines[0]?.earned, 50, "The consolidated earning line nets to the corrected $50");
    assertEqual(correctedStatement.totalEarned, 50, "totalEarned self-corrects to $50");
    assertEqual(correctedStatement.currentOwed, 50, "currentOwed self-corrects to $50 (pay is no longer inflated)");
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
        // Audit rows sync wrote for the earning + adjustment.
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
