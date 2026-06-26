/**
 * Automated Tests: a VOIDED insurance statement is locked — it cannot be edited
 * via the real HTTP API, nor via the storage layer directly.
 *
 * Background
 * ----------
 * Voiding an insurance statement is terminal: every posted line is moved to the
 * 'reversed' state and the statement's status becomes 'voided'. If a future
 * refactor let a direct API call edit one of those lines (or re-run auto-match
 * over the statement), a 'reversed' line could be flipped back to a re-postable
 * status — resurrecting the misleading "re-postable" appearance the terminal
 * state was designed to remove, and risking a double-count of the insurer's
 * payment (which inflates therapist pay).
 *
 * Two server-side guards prevent this:
 *   - storage.updateStatementLineMatch throws "Cannot change a line on a voided
 *     statement." when the parent statement is 'voided'.
 *   - storage.autoMatchStatementLines throws "Cannot rematch a voided
 *     statement." when the statement is 'voided'.
 * Both surface as HTTP 400 through the routes that call them.
 *
 * This suite locks that behavior in at TWO layers:
 *   1. HTTP API (the path a real client/attacker uses), through the production
 *      middleware chain (express.json → cookieParser → optionalAuth → /api CSRF
 *      guard → all routes via registerRoutes), authenticated as a billing-role
 *      user with a genuine session token + matching CSRF cookie/header:
 *        - PATCH /api/insurance/lines/:id  ⇒ 400, line status unchanged.
 *        - POST  /api/insurance/statements/:id/rematch ⇒ 400, lines unchanged.
 *   2. Storage layer directly:
 *        - updateStatementLineMatch throws the exact refusal message.
 *        - autoMatchStatementLines throws the exact refusal message.
 *
 * Run with: npx tsx test/insurance-voided-statement-locked.test.ts
 *
 * NOTES:
 * - Exercises the real storage layer + real routes against the live database
 *   (no mocks). Seeds dedicated, uniquely-named test user/client/service/
 *   session/billing/statement and removes them (and every row they generate)
 *   at the end.
 * - Must run serially with the other app-level tests (shared dev DB races on
 *   generated identifiers when run concurrently — see
 *   .agents/memory/privacy-test-concurrency.md). It is chained into the
 *   `test-privacy` validation.
 */

import express from "express";
import cookieParser from "cookie-parser";
import { createServer, type Server } from "http";
import { AddressInfo } from "net";
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
import {
  createSessionToken,
  optionalAuth,
  csrfProtection,
} from "../server/auth-middleware";
import { registerRoutes } from "../server/routes";
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

const SUFFIX = `ins-voidlock-${Date.now()}`;

// Tracking for cleanup
const createdUserIds: number[] = [];
const createdClientIds: number[] = [];
const createdServiceIds: number[] = [];
const createdBillingIds: number[] = [];
const createdStatementIds: number[] = [];

// ---------------------------------------------------------------------------
// In-process app mirroring the production middleware chain (server/index.ts),
// with ALL routes registered (insurance routes live inside registerRoutes).
// ---------------------------------------------------------------------------
let server: Server;
let baseUrl: string;

async function startServer() {
  const app = express();
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ extended: false, limit: "50mb" }));
  app.use(cookieParser());
  app.use(optionalAuth);
  // CSRF guard for /api, matching server/index.ts (no public path applies here).
  app.use("/api", (req, res, next) => csrfProtection(req as any, res, next));
  // Registers every route (including the insurance line/rematch endpoints) and
  // returns an http.Server we listen on.
  server = await registerRoutes(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
}

async function stopServer() {
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
}

// Authenticated fetch helper: presents a genuine session token plus a matching
// CSRF cookie/header pair, exactly like a logged-in browser session.
const CSRF_TOKEN = "test-csrf-token";
function authHeaders(token: string) {
  return {
    "content-type": "application/json",
    "x-csrf-token": CSRF_TOKEN,
    cookie: `sessionToken=${token}; csrfToken=${CSRF_TOKEN}`,
  };
}

// ---------------------------------------------------------------------------
// Seed helpers
// ---------------------------------------------------------------------------
async function getLine(statementId: number) {
  const [line] = await db
    .select()
    .from(insuranceStatementLines)
    .where(eq(insuranceStatementLines.statementId, statementId))
    .limit(1);
  return line;
}

// Seed a billing record (therapist → client → service → session → billing).
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

// Create a draft statement with a single $100 line, confirm it against
// `billingId`, post it, then VOID it. Returns the (now voided) statement id and
// the (now 'reversed') line id.
async function seedVoidedStatement(
  billingId: number,
  label: string,
  userId: number,
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
        insurancePaidAmount: "100.00",
      } as any,
    ],
  );
  createdStatementIds.push(stmt.id);

  const line = await getLine(stmt.id);
  await storage.updateStatementLineMatch(line.id, {
    matchStatus: "confirmed",
    matchedSessionBillingId: billingId,
  });
  await storage.postInsuranceStatement(stmt.id, userId);
  await storage.voidInsuranceStatement(stmt.id, userId, "test void — lock check");

  return { statementId: stmt.id, lineId: line.id };
}

// ---------------------------------------------------------------------------
// Scenario 1: the HTTP API rejects edits to a voided statement.
// ---------------------------------------------------------------------------
async function scenarioApiRejects(billingUserId: number, token: string) {
  console.log("\n🧪 Scenario 1: HTTP API rejects edits to a voided statement\n");

  const { billing } = await seedBilling("api");
  const { statementId, lineId } = await seedVoidedStatement(
    billing.id,
    "api",
    billingUserId,
  );

  // Precondition: void left the statement 'voided' and the line 'reversed'.
  const [stmtBefore] = await db
    .select()
    .from(insuranceStatements)
    .where(eq(insuranceStatements.id, statementId))
    .limit(1);
  assertEqual(stmtBefore.status, "voided", "1: precondition — statement is voided");
  const [lineBefore] = await db
    .select()
    .from(insuranceStatementLines)
    .where(eq(insuranceStatementLines.id, lineId))
    .limit(1);
  assertEqual(
    lineBefore.matchStatus,
    "reversed",
    "1: precondition — line is in the terminal 'reversed' state",
  );

  // --- PATCH /api/insurance/lines/:id — attacker tries to flip the reversed
  //     line back to a re-postable 'confirmed'. Must be rejected with 400 and
  //     leave the line untouched. -------------------------------------------
  const patchRes = await fetch(`${baseUrl}/api/insurance/lines/${lineId}`, {
    method: "PATCH",
    headers: authHeaders(token),
    body: JSON.stringify({
      matchStatus: "confirmed",
      matchedSessionBillingId: billing.id,
    }),
  });
  assertEqual(
    patchRes.status,
    400,
    "1: PATCH a line on a voided statement is rejected with 400",
  );
  const patchBody = (await patchRes.json()) as any;
  assertEqual(
    patchBody.message,
    "Cannot change a line on a voided statement.",
    "1: PATCH refusal message is exactly 'Cannot change a line on a voided statement.'",
  );

  const [lineAfterPatch] = await db
    .select()
    .from(insuranceStatementLines)
    .where(eq(insuranceStatementLines.id, lineId))
    .limit(1);
  assertEqual(
    lineAfterPatch.matchStatus,
    "reversed",
    "1: the line stays 'reversed' after the rejected PATCH (not flipped to 'confirmed')",
  );

  // --- POST /api/insurance/statements/:id/rematch — attacker tries to re-run
  //     auto-match over the voided statement. Must be rejected with 400 and
  //     leave every line untouched. ------------------------------------------
  const linesBefore = await db
    .select()
    .from(insuranceStatementLines)
    .where(eq(insuranceStatementLines.statementId, statementId));

  const rematchRes = await fetch(
    `${baseUrl}/api/insurance/statements/${statementId}/rematch`,
    { method: "POST", headers: authHeaders(token), body: JSON.stringify({}) },
  );
  assertEqual(
    rematchRes.status,
    400,
    "1: POST rematch on a voided statement is rejected with 400",
  );
  const rematchBody = (await rematchRes.json()) as any;
  assertEqual(
    rematchBody.message,
    "Cannot rematch a voided statement.",
    "1: rematch refusal message is exactly 'Cannot rematch a voided statement.'",
  );

  const linesAfter = await db
    .select()
    .from(insuranceStatementLines)
    .where(eq(insuranceStatementLines.statementId, statementId));
  const beforeSnap = linesBefore
    .map((l) => `${l.id}:${l.matchStatus}:${l.matchedSessionBillingId ?? "-"}`)
    .sort()
    .join("|");
  const afterSnap = linesAfter
    .map((l) => `${l.id}:${l.matchStatus}:${l.matchedSessionBillingId ?? "-"}`)
    .sort()
    .join("|");
  assertEqual(
    afterSnap,
    beforeSnap,
    "1: every line is untouched after the rejected rematch (status + match unchanged)",
  );
}

// ---------------------------------------------------------------------------
// Scenario 2: the storage-layer guards throw directly (defense in depth — a
// caller that bypasses the route still cannot mutate a voided statement).
// ---------------------------------------------------------------------------
async function scenarioStorageGuards(billingUserId: number) {
  console.log("\n🧪 Scenario 2: storage-layer guards throw on a voided statement\n");

  const { billing } = await seedBilling("store");
  const { statementId, lineId } = await seedVoidedStatement(
    billing.id,
    "store",
    billingUserId,
  );

  // updateStatementLineMatch must refuse.
  let updateThrew = false;
  let updateMsg = "";
  try {
    await storage.updateStatementLineMatch(lineId, {
      matchStatus: "confirmed",
      matchedSessionBillingId: billing.id,
    });
  } catch (err: any) {
    updateThrew = true;
    updateMsg = err?.message ?? String(err);
  }
  assert(updateThrew, "2: updateStatementLineMatch on a voided statement's line throws");
  assertEqual(
    updateMsg,
    "Cannot change a line on a voided statement.",
    "2: updateStatementLineMatch message is exactly 'Cannot change a line on a voided statement.'",
  );

  // autoMatchStatementLines must refuse.
  let rematchThrew = false;
  let rematchMsg = "";
  try {
    await storage.autoMatchStatementLines(statementId);
  } catch (err: any) {
    rematchThrew = true;
    rematchMsg = err?.message ?? String(err);
  }
  assert(rematchThrew, "2: autoMatchStatementLines on a voided statement throws");
  assertEqual(
    rematchMsg,
    "Cannot rematch a voided statement.",
    "2: autoMatchStatementLines message is exactly 'Cannot rematch a voided statement.'",
  );

  // The line is unchanged by either refused storage call.
  const [lineAfter] = await db
    .select()
    .from(insuranceStatementLines)
    .where(eq(insuranceStatementLines.id, lineId))
    .limit(1);
  assertEqual(
    lineAfter.matchStatus,
    "reversed",
    "2: the line stays 'reversed' after both refused storage calls",
  );
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------
async function run() {
  console.log("\n🧪 Voided insurance statement is locked (API + storage)\n");

  await startServer();

  // A billing-role user authorized for the insurance routes (requireTherapistPayAccess).
  const billingUser = await storage.createUser({
    username: `billing-${SUFFIX}`,
    password: "x",
    fullName: `Billing ${SUFFIX}`,
    email: `billing-${SUFFIX}@example.test`,
    role: "billing",
  } as any);
  createdUserIds.push(billingUser.id);
  const token = createSessionToken({
    id: billingUser.id,
    username: billingUser.username,
    role: billingUser.role,
  });

  try {
    await scenarioApiRejects(billingUser.id, token);
    await scenarioStorageGuards(billingUser.id);
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
    await stopServer();
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
