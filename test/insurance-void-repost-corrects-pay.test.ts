/**
 * Regression test: the REAL insurance void → reset → re-post cleanup of an
 * over-collected billing makes therapist pay self-correct.
 *
 * Sibling test `therapist-earning-self-correct.test.ts` proves earnings
 * self-correct when the *collected* amount is corrected by a RAW column edit.
 * But the real-world cleanup of an over-collected billing never edits the
 * column directly — it goes through the insurance-statement operational flow:
 *   void the statement  →  reset its line back to 'confirmed' (clear the void
 *   fields)  →  re-post through the ADOPTION path (adoptedByLineId).
 * This test proves that end-to-end flow lands `collected` on the correct single
 * amount AND that the next therapist-statement read appends the correcting
 * negative 'adjustment' so pay nets back to the truth.
 *
 * Flow under test:
 *   1. Seed a session/billing. Post a $100 insurance statement (collected = $100,
 *      correct). Then staff, not realizing it was already posted, MANUALLY key
 *      the same $100 EOB again — stacking a manual insurance row on top so
 *      collected inflates to $200 (the classic double-count). With a 50% rule the
 *      first statement read materializes a single 'earning' row of $100 — pay is
 *      overstated (should be $50).
 *   2. CLEAN UP via the operational flow (no raw column edit):
 *        a. voidInsuranceStatement — reverses the statement's posted shortfall,
 *           dropping collected back to the lone manual $100, and moves the line
 *           to the terminal 'reversed' state.
 *        b. Reset the line to 'confirmed' and clear the statement's void fields
 *           so it is re-postable.
 *        c. postInsuranceStatement again — the guard ADOPTS the still-unadopted
 *           manual $100 (stamping adoptedByLineId) and posts only the $0
 *           shortfall, so collected stays on the correct single $100 (never
 *           re-stacks to $200).
 *   3. Read the statement again. sync must append exactly one 'adjustment' row of
 *      -$50, leaving the ledger at net $50 == corrected collected ($100) * 50%.
 *
 * Run with: npx tsx test/insurance-void-repost-corrects-pay.test.ts
 *
 * NOTES:
 * - Uses the LIVE database and the real storage layer (no mocks). Seeds
 *   dedicated, uniquely-named rows and removes them (and anything derived) in a
 *   finally block.
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
  insuranceStatements,
  insuranceStatementLines,
  paymentTransactions,
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

const SUFFIX = `ins-vr-${Date.now()}`;

async function getBilling(billingId: number) {
  const [b] = await db
    .select()
    .from(sessionBilling)
    .where(eq(sessionBilling.id, billingId))
    .limit(1);
  return b;
}

async function run() {
  console.log(
    "\n🧪 Insurance void→reset→re-post cleanup self-corrects therapist pay\n",
  );

  let therapistId: number | undefined;
  let sysUserId: number | undefined;
  let clientId: number | undefined;
  let serviceId: number | undefined;
  let sessionId: number | undefined;
  let billingId: number | undefined;
  let statementId: number | undefined;
  let lineId: number | undefined;

  try {
    // --- Seed therapist, system actor, client, service, session, billing ----
    const therapist = await storage.createUser({
      username: `therapist-${SUFFIX}`,
      password: "x",
      fullName: `Therapist ${SUFFIX}`,
      email: `therapist-${SUFFIX}@example.test`,
      role: "therapist",
    } as any);
    therapistId = therapist.id;

    const sysUser = await storage.createUser({
      username: `sys-${SUFFIX}`,
      password: "x",
      fullName: `Sys ${SUFFIX}`,
      email: `sys-${SUFFIX}@example.test`,
      role: "admin",
    } as any);
    sysUserId = sysUser.id;

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
        sessionDate: new Date("2026-04-12T10:00:00.000Z"),
        sessionType: "individual",
        status: "completed",
      })
      .returning();
    sessionId = session.id;

    // Billing starts with NOTHING collected. All collection below flows through
    // the real payment/statement paths so the double-count is genuine.
    const [billing] = await db
      .insert(sessionBilling)
      .values({
        sessionId,
        serviceCode: service.serviceCode,
        units: 1,
        ratePerUnit: "100.00",
        totalAmount: "100.00",
        clientPaidAmount: "0.00",
        insurancePaidAmount: "0.00",
        billingDate: "2026-04-12",
        paymentStatus: "pending",
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

    // --- 1. Build the over-collected ($200) state operationally ------------
    // 1a. Create + confirm a $100 statement line bound to our billing, then post
    //     it. This records the REAL insurer $100 — collected becomes $100.
    const stmt = await storage.createInsuranceStatement(
      {
        fileName: `stmt-${SUFFIX}.pdf`,
        sourceType: "pdf",
        payerName: `Test Payer ${SUFFIX}`,
        statementDate: "2026-04-15",
        status: "draft",
      } as any,
      [
        {
          clientNameRaw: `Client ${SUFFIX}`,
          serviceCode: `SVC-${SUFFIX}`.slice(0, 50),
          insurancePaidAmount: "100.00",
        } as any,
      ],
    );
    statementId = stmt.id;

    const [createdLine] = await db
      .select()
      .from(insuranceStatementLines)
      .where(eq(insuranceStatementLines.statementId, stmt.id))
      .limit(1);
    lineId = createdLine.id;
    // Bind + confirm against our billing explicitly so posting is deterministic.
    await storage.updateStatementLineMatch(lineId, {
      matchStatus: "confirmed",
      matchedSessionBillingId: billingId,
    });

    await storage.postInsuranceStatement(statementId, sysUserId);

    let b = await getBilling(billingId);
    assertEqual(
      Number(b.insurancePaidAmount),
      100,
      "After posting the statement, collected insurance is the real $100",
    );

    // 1b. Staff, not realizing the EOB was already posted, MANUALLY key the same
    //     $100 again. recordPayment's amount is the new CUMULATIVE for the
    //     source, so 200 means "add another $100 manual row on top". This stacks
    //     a second, unadopted manual insurance row → collected inflates to $200.
    await storage.recordPayment(billingId, {
      status: "billed",
      amount: 200,
      date: "2026-04-16",
      method: "insurance",
      source: "insurance",
      recordedBy: sysUserId,
      notes: "Manual insurance entry (duplicate of already-posted EOB)",
    });

    b = await getBilling(billingId);
    assertEqual(
      Number(b.insurancePaidAmount),
      200,
      "Stacking the manual $100 inflates collected insurance to $200 (double count)",
    );

    // --- First statement read materializes the INFLATED earning ------------
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
    assertEqual(inflatedLines.length, 1, "Statement shows one earning line for the session before cleanup");
    assertEqual(inflatedLines[0]?.earned, 100, "Statement earning line is inflated to $100 before cleanup");
    assertEqual(inflatedStatement.currentOwed, 100, "currentOwed is inflated to $100 before cleanup");

    // --- 2. Clean up via the REAL operational flow (no raw column edit) -----
    // 2a. Void the statement. This reverses the posted shortfall and drops
    //     collected back to the lone manual $100, and moves the line to the
    //     terminal 'reversed' state.
    await storage.voidInsuranceStatement(statementId, sysUserId, "duplicate EOB cleanup");

    b = await getBilling(billingId);
    assertEqual(
      Number(b.insurancePaidAmount),
      100,
      "Voiding the statement drops collected back to the lone manual $100",
    );
    const [voidedLine] = await db
      .select()
      .from(insuranceStatementLines)
      .where(eq(insuranceStatementLines.id, lineId))
      .limit(1);
    assertEqual(
      voidedLine.matchStatus,
      "reversed",
      "Void moves the line to the terminal 'reversed' state",
    );

    // 2b. Reset the line back to 'confirmed' and clear the statement's void
    //     fields so it is re-postable (the real cleanup recipe). There is no
    //     storage method for this reset, so it is a direct edit of the
    //     statement/line bookkeeping state — NOT of the collected amount.
    await db
      .update(insuranceStatementLines)
      .set({ matchStatus: "confirmed", postedAmount: null })
      .where(eq(insuranceStatementLines.id, lineId));
    await db
      .update(insuranceStatements)
      .set({ status: "draft", voidedAt: null, voidedBy: null, voidReason: null })
      .where(eq(insuranceStatements.id, statementId));

    // 2c. Re-post. The guard ADOPTS the still-unadopted manual $100 and posts a
    //     $0 shortfall, so collected stays on the correct single $100.
    await storage.postInsuranceStatement(statementId, sysUserId);

    b = await getBilling(billingId);
    assertEqual(
      Number(b.insurancePaidAmount),
      100,
      "Re-post keeps collected on the correct single $100 (never re-stacks to $200)",
    );

    const [repostedLine] = await db
      .select()
      .from(insuranceStatementLines)
      .where(eq(insuranceStatementLines.id, lineId))
      .limit(1);
    assertEqual(repostedLine.matchStatus, "posted", "Re-post marks the line 'posted' again");
    assertEqual(Number(repostedLine.postedAmount), 0, "Re-post posts a $0 shortfall (manual already covers it)");

    const manualRows = await db
      .select()
      .from(paymentTransactions)
      .where(
        and(
          eq(paymentTransactions.sessionBillingId, billingId),
          eq(paymentTransactions.source, "insurance"),
          isNull(paymentTransactions.sourceStatementLineId),
        ),
      );
    assertEqual(manualRows.length, 1, "Exactly one manual insurance row exists (not duplicated)");
    assertEqual(
      manualRows[0]?.adoptedByLineId,
      lineId,
      "The manual row is now ADOPTED by the re-posting line (so no later statement re-counts it)",
    );

    // --- 3. Next statement read must self-correct via a negative adjustment -
    const correctedStatement = await storage.getTherapistStatement(therapistId);

    const rowsAfterCorrection = await db
      .select()
      .from(therapistEarnings)
      .where(eq(therapistEarnings.sessionBillingId, billingId));
    assertEqual(
      rowsAfterCorrection.length,
      2,
      "The cleanup appends exactly one new ledger row (append-only, original untouched)",
    );

    const adjustments = rowsAfterCorrection.filter((r) => r.entryType === "adjustment");
    assertEqual(adjustments.length, 1, "The appended row is an 'adjustment' delta row");
    assertEqual(
      Number(adjustments[0]?.amountEarned),
      -50,
      "The adjustment is a NEGATIVE delta of -$50 (corrects the $100 earning down to $50)",
    );

    // Original 'earning' row preserved unchanged (history is never mutated).
    const original = rowsAfterCorrection.find((r) => r.entryType === "earning");
    assertEqual(
      Number(original?.amountEarned),
      100,
      "The original 'earning' row is left at $100 (append-only ledger, never mutated)",
    );

    // Net of all ledger rows for the billing == corrected collected * rule.
    const netEarned =
      Math.round(
        rowsAfterCorrection.reduce((sum, r) => sum + Number(r.amountEarned), 0) * 100,
      ) / 100;
    assertEqual(
      netEarned,
      50,
      "Net ledger earning for the session is $50 (corrected collected $100 * 50%)",
    );

    const correctedLines = correctedStatement.entries.filter(
      (e) => e.type === "earning" && e.sessionId === sessionId,
    );
    assertEqual(
      correctedLines.length,
      1,
      "After cleanup the statement still shows ONE consolidated earning line for the session",
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
        await db.delete(paymentTransactions).where(eq(paymentTransactions.sessionBillingId, billingId));
        await db.delete(therapistEarnings).where(eq(therapistEarnings.sessionBillingId, billingId));
      }
      if (statementId != null) {
        // Cascades insurance_statement_lines.
        await db.delete(insuranceStatements).where(eq(insuranceStatements.id, statementId));
      }
      if (therapistId != null) {
        await db.delete(therapistPayRules).where(eq(therapistPayRules.therapistId, therapistId));
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
      const userIds = [therapistId, sysUserId].filter((x): x is number => x != null);
      if (userIds.length > 0) {
        await db.delete(users).where(inArray(users.id, userIds));
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
