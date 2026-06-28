/**
 * Automated Tests for the Insurance Double-Payment Guard (adoption + void→repost)
 *
 * Background
 * ----------
 * Staff can record an insurance payment two ways for the SAME real-world money:
 *   1. Manually keying a payment_transactions row (source='insurance').
 *   2. Posting a line from an uploaded insurance statement (EOB/ERA).
 * Without protection, doing both would count the insurer's payment TWICE,
 * inflating "collected" — and therefore therapist pay, which is computed from
 * collections.
 *
 * The guard in storage.postInsuranceStatement "adopts" any matching manual
 * insurance payment (stamping it with the posting line's id so no later
 * statement can re-claim it) and posts only the SHORTFALL (line amount minus
 * what the adopted manual rows already cover). storage.voidInsuranceStatement
 * reverses exactly the posted shortfall and releases the adoption so a re-post
 * re-adopts instead of stacking a duplicate.
 *
 * This suite proves that invariant end-to-end through a full void→repost cycle,
 * for two scenarios:
 *   A. Manual payment FULLY covers the statement line (shortfall = 0).
 *   B. Manual payment PARTIALLY covers the line (a real shortfall is posted).
 *
 * In both, the test asserts that after post, void, and re-post the billing's
 * collected insurance never doubles or re-stacks, the manual row is adopted
 * (and released on void), and only the shortfall is ever posted.
 *
 * Run with: npx tsx test/insurance-statement-double-payment.test.ts
 *
 * NOTES:
 * - Exercises the real storage layer against the live database (no mocks).
 * - Seeds dedicated, uniquely-named test user/client/service/session/billing
 *   and removes them (and every row they generate) at the end.
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
  insuranceStatements,
  insuranceStatementLines,
} from "../shared/schema";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";

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

const SUFFIX = `ins-dbl-${Date.now()}`;

// Tracking for cleanup
const createdUserIds: number[] = [];
const createdClientIds: number[] = [];
const createdServiceIds: number[] = [];
const createdBillingIds: number[] = [];
const createdStatementIds: number[] = [];

// ---------------------------------------------------------------------------
// Helpers — read the authoritative "collected" numbers off the billing row,
// and cross-check against the live (non-voided) payment_transactions ledger.
// Therapist pay reads sessionBilling.{client,insurance}PaidAmount, so that is
// the number that must never double.
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
// ledger view of collected insurance. Must always agree with the column above.
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

// The manual insurance rows (keyed by staff, not created by posting a line):
// source='insurance' AND sourceStatementLineId IS NULL.
async function manualInsuranceRows(billingId: number) {
  return db
    .select()
    .from(paymentTransactions)
    .where(
      and(
        eq(paymentTransactions.sessionBillingId, billingId),
        eq(paymentTransactions.source, "insurance"),
        isNull(paymentTransactions.sourceStatementLineId),
      ),
    );
}

async function getLine(statementId: number) {
  const [line] = await db
    .select()
    .from(insuranceStatementLines)
    .where(eq(insuranceStatementLines.statementId, statementId))
    .limit(1);
  return line;
}

// Seed a billing record (user → client → service → session → billing) and
// return the ids needed to drive the scenario.
async function seedBilling(label: string) {
  const therapist = await storage.createUser({
    username: `${label}-${SUFFIX}`,
    password: "x",
    fullName: `${label} ${SUFFIX}`,
    email: `${label}-${SUFFIX}@example.test`,
    role: "therapist",
  } as any);
  createdUserIds.push(therapist.id);

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
// so it is ready to post.
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
        clientNameRaw: `Patient ${label} ${SUFFIX}`,
        serviceCode: `SVC-${label}-${SUFFIX}`,
        insurancePaidAmount,
      } as any,
    ],
  );
  createdStatementIds.push(stmt.id);

  const line = await getLine(stmt.id);
  // Explicitly bind + confirm against our billing (overriding whatever
  // auto-match decided), so the post path is deterministic.
  await storage.updateStatementLineMatch(line.id, {
    matchStatus: "confirmed",
    matchedSessionBillingId: billingId,
  });

  return { statementId: stmt.id, lineId: line.id };
}

// ---------------------------------------------------------------------------
// Scenario A: manual payment FULLY covers the statement line (shortfall = 0)
// ---------------------------------------------------------------------------
async function scenarioFullCover(userId: number) {
  console.log("\n🧪 Scenario A: manual payment fully covers the line (shortfall = 0)\n");

  const { billing } = await seedBilling("A");

  // 1. Staff manually records the $100 insurance payment.
  await storage.recordPayment(billing.id, {
    status: "billed",
    amount: 100,
    date: new Date().toISOString().slice(0, 10),
    method: "insurance",
    source: "insurance",
    recordedBy: userId,
    notes: "Manual insurance entry",
  });

  let b = await getBilling(billing.id);
  assertEqual(Number(b.insurancePaidAmount), 100, "A: manual entry sets collected insurance to 100");

  // 2. Post a matching $100 statement line.
  const { statementId, lineId } = await createConfirmedStatement(billing.id, "100.00", "A");
  const postRes = await storage.postInsuranceStatement(statementId, userId);

  b = await getBilling(billing.id);
  assertEqual(Number(b.insurancePaidAmount), 100, "A: collected is NOT doubled after posting (stays 100)");
  assertEqual(await ledgerInsurance(billing.id), 100, "A: live ledger insurance also stays 100");

  const [postedLine] = await db
    .select()
    .from(insuranceStatementLines)
    .where(eq(insuranceStatementLines.id, lineId))
    .limit(1);
  assertEqual(postedLine.matchStatus, "posted", "A: line is marked posted");
  assertEqual(Number(postedLine.postedAmount), 0, "A: only the shortfall (0) is posted");

  let manual = await manualInsuranceRows(billing.id);
  assertEqual(manual.length, 1, "A: exactly one manual insurance row exists (not duplicated)");
  assertEqual(Number(manual[0].amount), 100, "A: manual row amount unchanged at 100");
  assertEqual(manual[0].adoptedByLineId, lineId, "A: manual row is adopted by the posting line");

  // No statement-sourced payment row should have been created (shortfall was 0).
  const sourced = await db
    .select()
    .from(paymentTransactions)
    .where(
      and(
        eq(paymentTransactions.sessionBillingId, billing.id),
        eq(paymentTransactions.sourceStatementLineId, lineId),
      ),
    );
  assertEqual(sourced.length, 0, "A: no statement-sourced payment row created for a zero shortfall");
  assertEqual(postRes.postedCount, 1, "A: postedCount reflects the one handled line");

  // 3. Void, then re-post — must not re-stack.
  await storage.voidInsuranceStatement(statementId, userId, "test void cycle");

  b = await getBilling(billing.id);
  assertEqual(Number(b.insurancePaidAmount), 100, "A: collected stays 100 after void (manual untouched)");
  manual = await manualInsuranceRows(billing.id);
  assertEqual(manual[0].adoptedByLineId, null, "A: void releases the manual row's adoption");
  const [voidedLine] = await db
    .select()
    .from(insuranceStatementLines)
    .where(eq(insuranceStatementLines.id, lineId))
    .limit(1);
  assertEqual(
    voidedLine.matchStatus,
    "reversed",
    "A: void moves the line to the terminal 'reversed' state (not the re-postable 'confirmed')",
  );

  // Re-post is a FRESH statement against the same billing (a voided statement
  // can never be posted again). The released manual row must be re-adopted by
  // the new line without re-stacking collections.
  const second = await createConfirmedStatement(billing.id, "100.00", "A2");
  await storage.postInsuranceStatement(second.statementId, userId);
  b = await getBilling(billing.id);
  assertEqual(Number(b.insurancePaidAmount), 100, "A: collected stays 100 after re-post (no re-stacking)");
  assertEqual(await ledgerInsurance(billing.id), 100, "A: live ledger insurance stays 100 after re-post");
  manual = await manualInsuranceRows(billing.id);
  assertEqual(manual.length, 1, "A: still exactly one manual insurance row after re-post");
  assertEqual(
    manual[0].adoptedByLineId,
    second.lineId,
    "A: manual row is re-adopted by the new line (not duplicated) on re-post",
  );
}

// ---------------------------------------------------------------------------
// Scenario B: manual payment PARTIALLY covers the line (a real shortfall posts)
// ---------------------------------------------------------------------------
async function scenarioShortfall(userId: number) {
  console.log("\n🧪 Scenario B: manual payment partially covers the line (real shortfall)\n");

  const { billing } = await seedBilling("B");

  // 1. Staff manually records only $60 of the eventual $100 insurer payment.
  await storage.recordPayment(billing.id, {
    status: "billed",
    amount: 60,
    date: new Date().toISOString().slice(0, 10),
    method: "insurance",
    source: "insurance",
    recordedBy: userId,
    notes: "Manual insurance entry (partial)",
  });

  let b = await getBilling(billing.id);
  assertEqual(Number(b.insurancePaidAmount), 60, "B: manual entry sets collected insurance to 60");

  // 2. Post a $100 statement line — only the $40 shortfall should be added.
  const { statementId, lineId } = await createConfirmedStatement(billing.id, "100.00", "B");
  await storage.postInsuranceStatement(statementId, userId);

  b = await getBilling(billing.id);
  assertEqual(Number(b.insurancePaidAmount), 100, "B: collected is the line total 100, NOT 160 (no double count)");
  assertEqual(await ledgerInsurance(billing.id), 100, "B: live ledger insurance equals 100");

  const [postedLine] = await db
    .select()
    .from(insuranceStatementLines)
    .where(eq(insuranceStatementLines.id, lineId))
    .limit(1);
  assertEqual(Number(postedLine.postedAmount), 40, "B: only the 40 shortfall is posted");

  let manual = await manualInsuranceRows(billing.id);
  assertEqual(manual.length, 1, "B: exactly one manual insurance row exists");
  assertEqual(Number(manual[0].amount), 60, "B: manual row amount unchanged at 60 (never inflated)");
  assertEqual(manual[0].adoptedByLineId, lineId, "B: manual row is adopted by the posting line");

  // Exactly one live statement-sourced shortfall row of 40.
  const liveSourced = await db
    .select()
    .from(paymentTransactions)
    .where(
      and(
        eq(paymentTransactions.sessionBillingId, billing.id),
        eq(paymentTransactions.sourceStatementLineId, lineId),
        isNull(paymentTransactions.voidedAt),
      ),
    );
  assertEqual(liveSourced.length, 1, "B: exactly one live statement-sourced shortfall row");
  assertEqual(Number(liveSourced[0].amount), 40, "B: the shortfall row is 40");

  // 3. Void — reverses the 40 shortfall and releases the manual adoption.
  await storage.voidInsuranceStatement(statementId, userId, "test void cycle");

  b = await getBilling(billing.id);
  assertEqual(Number(b.insurancePaidAmount), 60, "B: void drops collected back to the manual 60");
  assertEqual(await ledgerInsurance(billing.id), 60, "B: live ledger insurance back to 60 after void");
  manual = await manualInsuranceRows(billing.id);
  assertEqual(manual[0].adoptedByLineId, null, "B: void releases the manual row's adoption");

  // 4. Re-post a FRESH statement against the same billing — must re-adopt the
  //    60 and post the 40 shortfall again, never stacking collections.
  const second = await createConfirmedStatement(billing.id, "100.00", "B2");
  await storage.postInsuranceStatement(second.statementId, userId);

  b = await getBilling(billing.id);
  assertEqual(Number(b.insurancePaidAmount), 100, "B: re-post returns collected to 100 (not 140/stacked)");
  assertEqual(await ledgerInsurance(billing.id), 100, "B: live ledger insurance is 100 after re-post");
  manual = await manualInsuranceRows(billing.id);
  assertEqual(manual.length, 1, "B: still exactly one manual insurance row after re-post");
  assertEqual(Number(manual[0].amount), 60, "B: manual row still 60 after re-post (never inflated)");
  assertEqual(manual[0].adoptedByLineId, second.lineId, "B: manual row is re-adopted by the new line on re-post");

  const liveSourcedAfter = await db
    .select()
    .from(paymentTransactions)
    .where(
      and(
        eq(paymentTransactions.sessionBillingId, billing.id),
        eq(paymentTransactions.sourceStatementLineId, second.lineId),
        isNull(paymentTransactions.voidedAt),
      ),
    );
  const liveShortfallSum = +liveSourcedAfter
    .reduce((s, r) => s + (Number(r.amount) || 0), 0)
    .toFixed(2);
  assertEqual(liveShortfallSum, 40, "B: net live statement-sourced amount is exactly the 40 shortfall");
}

// ---------------------------------------------------------------------------
// Scenario C: two DIFFERENT statements posted against the SAME billing for the
// SAME real-world insurer payment. The first statement adopts the manual entry;
// the second must NOT re-count it (a duplicate EOB re-uploaded and posted).
// This is the core invariant for this task: a second, still-posted statement
// only ever adds a genuine incremental amount, never re-claims already-counted
// money. We test both a full-cover duplicate (adds 0) and an incremental case
// (a higher second line adds only the difference), and we never void in between
// — both statements stay posted at once.
// ---------------------------------------------------------------------------
async function scenarioTwoStatements(userId: number) {
  console.log(
    "\n🧪 Scenario C: two posted statements, same billing, same payment (no inflation)\n",
  );

  // --- C1: manual fully covers; statement #1 adopts it, statement #2 is a
  //         duplicate of the SAME $100 and must add nothing. -----------------
  const { billing } = await seedBilling("C");

  // Staff manually record the $100 insurer payment.
  await storage.recordPayment(billing.id, {
    status: "billed",
    amount: 100,
    date: new Date().toISOString().slice(0, 10),
    method: "insurance",
    source: "insurance",
    recordedBy: userId,
    notes: "Manual insurance entry",
  });

  // Statement #1 ($100) adopts the manual, posts a 0 shortfall.
  const first = await createConfirmedStatement(billing.id, "100.00", "C1");
  await storage.postInsuranceStatement(first.statementId, userId);

  let b = await getBilling(billing.id);
  assertEqual(Number(b.insurancePaidAmount), 100, "C: collected is 100 after statement #1 (manual adopted)");
  let manual = await manualInsuranceRows(billing.id);
  assertEqual(manual[0].adoptedByLineId, first.lineId, "C: manual row adopted by statement #1's line");

  // Statement #2 — a SECOND, still-posted statement for the SAME $100 payment.
  // It cannot re-adopt the (already adopted) manual row; the guard must still
  // refuse to add the $100 again.
  const second = await createConfirmedStatement(billing.id, "100.00", "C2");
  const res2 = await storage.postInsuranceStatement(second.statementId, userId);

  b = await getBilling(billing.id);
  assertEqual(
    Number(b.insurancePaidAmount),
    100,
    "C: collected stays 100 after statement #2 — NOT inflated to 200",
  );
  assertEqual(await ledgerInsurance(billing.id), 100, "C: live ledger insurance stays 100 after statement #2");

  const [line2] = await db
    .select()
    .from(insuranceStatementLines)
    .where(eq(insuranceStatementLines.id, second.lineId))
    .limit(1);
  assertEqual(line2.matchStatus, "posted", "C: statement #2's line is marked posted");
  assertEqual(Number(line2.postedAmount), 0, "C: statement #2 posts a 0 shortfall (nothing new)");
  assertEqual(res2.postedCount, 1, "C: statement #2 reports the one handled line");

  // The manual row must remain a single row, still owned by statement #1 (the
  // second statement never re-stamped or duplicated it).
  manual = await manualInsuranceRows(billing.id);
  assertEqual(manual.length, 1, "C: exactly one manual insurance row after statement #2 (not duplicated)");
  assertEqual(Number(manual[0].amount), 100, "C: manual row amount unchanged at 100");
  assertEqual(manual[0].adoptedByLineId, first.lineId, "C: manual row still adopted by statement #1 (not re-claimed)");

  // Statement #2 must NOT have created any statement-sourced payment row.
  const sourced2 = await db
    .select()
    .from(paymentTransactions)
    .where(
      and(
        eq(paymentTransactions.sessionBillingId, billing.id),
        eq(paymentTransactions.sourceStatementLineId, second.lineId),
      ),
    );
  assertEqual(sourced2.length, 0, "C: statement #2 created no payment row (fully covered already)");

  // --- C2: NO manual entry. Statement #1 ($100) posts the real $100, then a
  //         duplicate statement #2 ($100) adds nothing; a richer statement #3
  //         ($150) for the same billing adds ONLY the $50 increment. ---------
  console.log(
    "\n🧪 Scenario C (cont.): duplicate then incremental statement, no manual entry\n",
  );
  const { billing: b2 } = await seedBilling("D");

  const d1 = await createConfirmedStatement(b2.id, "100.00", "D1");
  await storage.postInsuranceStatement(d1.statementId, userId);
  let bb = await getBilling(b2.id);
  assertEqual(Number(bb.insurancePaidAmount), 100, "C: statement #1 (no manual) records the real 100");

  // Duplicate of the same $100 — must add nothing.
  const d2 = await createConfirmedStatement(b2.id, "100.00", "D2");
  await storage.postInsuranceStatement(d2.statementId, userId);
  bb = await getBilling(b2.id);
  assertEqual(Number(bb.insurancePaidAmount), 100, "C: duplicate statement #2 adds nothing (stays 100, not 200)");
  assertEqual(await ledgerInsurance(b2.id), 100, "C: live ledger insurance stays 100 after duplicate");
  const [dline2] = await db
    .select()
    .from(insuranceStatementLines)
    .where(eq(insuranceStatementLines.id, d2.lineId))
    .limit(1);
  assertEqual(Number(dline2.postedAmount), 0, "C: duplicate statement #2 posts a 0 shortfall");

  // A genuinely larger statement ($150) for the same billing — adds only the
  // $50 increment over the already-counted $100.
  const d3 = await createConfirmedStatement(b2.id, "150.00", "D3");
  await storage.postInsuranceStatement(d3.statementId, userId);
  bb = await getBilling(b2.id);
  assertEqual(Number(bb.insurancePaidAmount), 150, "C: a larger statement #3 adds only the 50 increment (to 150)");
  assertEqual(await ledgerInsurance(b2.id), 150, "C: live ledger insurance equals 150 after the increment");
  const [dline3] = await db
    .select()
    .from(insuranceStatementLines)
    .where(eq(insuranceStatementLines.id, d3.lineId))
    .limit(1);
  assertEqual(Number(dline3.postedAmount), 50, "C: statement #3 posts exactly the 50 incremental shortfall");
}

// ---------------------------------------------------------------------------
// Scenario D: a voided statement is terminal. Once voided:
//   1. postInsuranceStatement must REFUSE to post it again ("Cannot post a
//      voided statement.") — it can never be resurrected, only a fresh upload
//      can re-post.
//   2. autoMatchStatementLines (the /rematch path) must leave 'reversed' lines
//      untouched — never flipping them back to a re-postable 'suggested'/
//      'confirmed'/'unmatched' status.
// Together these prove the terminal-void invariant that the existing scenarios
// only assert indirectly (they re-post a FRESH statement instead of the voided
// one, and never re-run auto-match over a reversed line).
// ---------------------------------------------------------------------------
async function scenarioVoidIsTerminal(userId: number) {
  console.log(
    "\n🧪 Scenario D: a voided statement is terminal (no re-post, no re-match)\n",
  );

  const { billing } = await seedBilling("E");

  // Post a confirmed $100 line, then void it.
  const { statementId, lineId } = await createConfirmedStatement(billing.id, "100.00", "E");
  await storage.postInsuranceStatement(statementId, userId);
  await storage.voidInsuranceStatement(statementId, userId, "test terminal void");

  // Precondition: the void left the line in the terminal 'reversed' state.
  const [voidedLine] = await db
    .select()
    .from(insuranceStatementLines)
    .where(eq(insuranceStatementLines.id, lineId))
    .limit(1);
  assertEqual(
    voidedLine.matchStatus,
    "reversed",
    "D: void leaves the line in the terminal 'reversed' state",
  );

  // 1. Re-posting the SAME voided statement must throw and change nothing.
  let threw = false;
  let message = "";
  try {
    await storage.postInsuranceStatement(statementId, userId);
  } catch (err: any) {
    threw = true;
    message = err?.message ?? String(err);
  }
  assert(threw, "D: postInsuranceStatement on a voided statement throws");
  assertEqual(
    message,
    "Cannot post a voided statement.",
    "D: the refusal message is exactly 'Cannot post a voided statement.'",
  );

  // Collections must be unchanged by the rejected re-post (void already
  // reversed the posted shortfall back to 0).
  const b = await getBilling(billing.id);
  assertEqual(
    Number(b.insurancePaidAmount),
    0,
    "D: collected insurance stays 0 after the refused re-post",
  );
  assertEqual(await ledgerInsurance(billing.id), 0, "D: live ledger insurance stays 0 after the refused re-post");

  // 2. Re-running auto-match (the /rematch path) on a voided statement must be
  //    REFUSED outright. The whole statement is terminal, so the guard throws
  //    rather than silently walking its (reversed) lines — this is the surest
  //    way to guarantee a reversed line can never be flipped back to a
  //    re-postable ('suggested'/'confirmed'/'unmatched') status.
  let rematchThrew = false;
  let rematchMessage = "";
  try {
    await storage.autoMatchStatementLines(statementId);
  } catch (err: any) {
    rematchThrew = true;
    rematchMessage = err?.message ?? String(err);
  }
  assert(rematchThrew, "D: autoMatchStatementLines on a voided statement throws");
  assertEqual(
    rematchMessage,
    "Cannot rematch a voided statement.",
    "D: the refusal message is exactly 'Cannot rematch a voided statement.'",
  );

  const [afterRematch] = await db
    .select()
    .from(insuranceStatementLines)
    .where(eq(insuranceStatementLines.id, lineId))
    .limit(1);
  assertEqual(
    afterRematch.matchStatus,
    "reversed",
    "D: the reversed line is left untouched after the refused rematch",
  );
  // The billing link is irrelevant to the guarantee, but the refused rematch
  // must not have re-pointed or cleared it either.
  assertEqual(
    afterRematch.matchedSessionBillingId,
    voidedLine.matchedSessionBillingId,
    "D: auto-match did not disturb the reversed line's matched billing",
  );
}

// ---------------------------------------------------------------------------
// Scenario E: void ONE of TWO posted statements for the SAME billing/payment.
// Scenario C proves two posted statements never INFLATE collected. This proves
// the inverse correction: when both are posted and the one that ACTUALLY posted
// the money is voided, the still-posted sibling must keep the real payment
// reflected — collected must NOT wrongly drop to $0 (or be left orphaned), and
// the surviving statement must re-absorb the coverage so a later void of IT
// reverses the right amount. We cover three realistic shapes:
//   E1: no manual entry, two duplicate $100 statements; void the one that
//       posted the $100 → collected stays $100 via the survivor.
//   E2: void the OTHER (the $0-shortfall) statement instead → collected stays
//       $100, untouched (the real poster keeps it).
//   E3: incremental — $100 then $150 statement; void the $100 one → the $150
//       survivor re-absorbs the FULL $150 (collected stays $150, not $50).
// ---------------------------------------------------------------------------
async function scenarioVoidOneOfTwo(userId: number) {
  console.log(
    "\n🧪 Scenario E: void one of two posted statements; sibling keeps the payment\n",
  );

  // --- E1: void the statement that actually posted the money ----------------
  {
    const { billing } = await seedBilling("F");

    // No manual entry. Statement #1 ($100) posts the real $100.
    const first = await createConfirmedStatement(billing.id, "100.00", "F1");
    await storage.postInsuranceStatement(first.statementId, userId);
    // Statement #2 ($100) is a duplicate of the same payment — posts $0.
    const second = await createConfirmedStatement(billing.id, "100.00", "F2");
    await storage.postInsuranceStatement(second.statementId, userId);

    let b = await getBilling(billing.id);
    assertEqual(Number(b.insurancePaidAmount), 100, "E1: collected is 100 with both statements posted");

    const [l1] = await db.select().from(insuranceStatementLines).where(eq(insuranceStatementLines.id, first.lineId)).limit(1);
    const [l2] = await db.select().from(insuranceStatementLines).where(eq(insuranceStatementLines.id, second.lineId)).limit(1);
    assertEqual(Number(l1.postedAmount), 100, "E1: statement #1's line holds the 100 (postedAmount)");
    assertEqual(Number(l2.postedAmount), 0, "E1: statement #2's line posted a 0 shortfall");

    // Void statement #1 — the one that actually posted the money.
    await storage.voidInsuranceStatement(first.statementId, userId, "void the real poster");

    b = await getBilling(billing.id);
    assertEqual(
      Number(b.insurancePaidAmount),
      100,
      "E1: collected stays 100 after voiding the real poster — NOT dropped to 0",
    );
    assertEqual(await ledgerInsurance(billing.id), 100, "E1: live ledger insurance stays 100 after the void");

    const [l1after] = await db.select().from(insuranceStatementLines).where(eq(insuranceStatementLines.id, first.lineId)).limit(1);
    const [l2after] = await db.select().from(insuranceStatementLines).where(eq(insuranceStatementLines.id, second.lineId)).limit(1);
    assertEqual(l1after.matchStatus, "reversed", "E1: the voided statement's line is reversed");
    assertEqual(l2after.matchStatus, "posted", "E1: the surviving statement's line is still posted");
    assertEqual(
      Number(l2after.postedAmount),
      100,
      "E1: the surviving statement re-absorbs the 100 (postedAmount restored)",
    );

    // And a later void of the SURVIVOR must now cleanly reverse the 100 to 0.
    await storage.voidInsuranceStatement(second.statementId, userId, "void the survivor too");
    b = await getBilling(billing.id);
    assertEqual(Number(b.insurancePaidAmount), 0, "E1: collected drops to 0 only once the LAST statement is voided");
    assertEqual(await ledgerInsurance(billing.id), 0, "E1: live ledger insurance is 0 after both are voided");
  }

  // --- E2: void the OTHER statement (the $0-shortfall duplicate) -------------
  {
    const { billing } = await seedBilling("G");

    const first = await createConfirmedStatement(billing.id, "100.00", "G1");
    await storage.postInsuranceStatement(first.statementId, userId);
    const second = await createConfirmedStatement(billing.id, "100.00", "G2");
    await storage.postInsuranceStatement(second.statementId, userId);

    // Void statement #2 — the duplicate that posted $0. The real poster keeps
    // the money; collected must be untouched.
    await storage.voidInsuranceStatement(second.statementId, userId, "void the duplicate");

    let b = await getBilling(billing.id);
    assertEqual(Number(b.insurancePaidAmount), 100, "E2: collected stays 100 after voiding the $0 duplicate");
    assertEqual(await ledgerInsurance(billing.id), 100, "E2: live ledger insurance stays 100");

    const [l1after] = await db.select().from(insuranceStatementLines).where(eq(insuranceStatementLines.id, first.lineId)).limit(1);
    assertEqual(Number(l1after.postedAmount), 100, "E2: the real poster still holds the 100");
    assertEqual(l1after.matchStatus, "posted", "E2: the real poster is still posted");
  }

  // --- E3: incremental statements ($100 then $150); void the $100 one -------
  {
    const { billing } = await seedBilling("H");

    const first = await createConfirmedStatement(billing.id, "100.00", "H1");
    await storage.postInsuranceStatement(first.statementId, userId);
    const second = await createConfirmedStatement(billing.id, "150.00", "H2");
    await storage.postInsuranceStatement(second.statementId, userId);

    let b = await getBilling(billing.id);
    assertEqual(Number(b.insurancePaidAmount), 150, "E3: collected is 150 (100 + 50 increment) with both posted");

    // Void the $100 statement — the richer $150 survivor must re-absorb the full
    // 150, not leave collected at the residual 50.
    await storage.voidInsuranceStatement(first.statementId, userId, "void the smaller statement");

    b = await getBilling(billing.id);
    assertEqual(
      Number(b.insurancePaidAmount),
      150,
      "E3: collected stays 150 after voiding the smaller statement (survivor re-absorbs full 150)",
    );
    assertEqual(await ledgerInsurance(billing.id), 150, "E3: live ledger insurance stays 150");

    const [l2after] = await db.select().from(insuranceStatementLines).where(eq(insuranceStatementLines.id, second.lineId)).limit(1);
    assertEqual(Number(l2after.postedAmount), 150, "E3: the surviving 150 statement now holds the full 150");

    // Void the survivor → collected finally drops to 0.
    await storage.voidInsuranceStatement(second.statementId, userId, "void the survivor");
    b = await getBilling(billing.id);
    assertEqual(Number(b.insurancePaidAmount), 0, "E3: collected drops to 0 once the last statement is voided");
    assertEqual(await ledgerInsurance(billing.id), 0, "E3: live ledger insurance is 0 after both are voided");
  }
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------
async function run() {
  console.log("\n🧪 Insurance double-payment guard: adoption + void→repost\n");

  // A system user to attribute the test payments to.
  const sysUser = await storage.createUser({
    username: `sys-${SUFFIX}`,
    password: "x",
    fullName: `Sys ${SUFFIX}`,
    email: `sys-${SUFFIX}@example.test`,
    role: "admin",
  } as any);
  createdUserIds.push(sysUser.id);

  try {
    await scenarioFullCover(sysUser.id);
    await scenarioShortfall(sysUser.id);
    await scenarioTwoStatements(sysUser.id);
    await scenarioVoidIsTerminal(sysUser.id);
    await scenarioVoidOneOfTwo(sysUser.id);
  } catch (error) {
    console.error("\n❌ Test suite error:", error);
    testsFailed++;
  } finally {
    // --- Cleanup -----------------------------------------------------------
    try {
      if (createdBillingIds.length > 0) {
        await db
          .delete(paymentTransactions)
          .where(inArray(paymentTransactions.sessionBillingId, createdBillingIds));
      }
      if (createdStatementIds.length > 0) {
        // Cascades insurance_statement_lines.
        await db
          .delete(insuranceStatements)
          .where(inArray(insuranceStatements.id, createdStatementIds));
      }
      if (createdBillingIds.length > 0) {
        await db.delete(sessionBilling).where(inArray(sessionBilling.id, createdBillingIds));
      }
      if (createdClientIds.length > 0) {
        // Cascades sessions.
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

  // --- Summary -------------------------------------------------------------
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
