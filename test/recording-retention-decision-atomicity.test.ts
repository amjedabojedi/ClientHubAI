/**
 * Regression test: a retention decision must not remain in the ledger when
 * its required audit insert fails.
 *
 * Run with: npx tsx test/recording-retention-decision-atomicity.test.ts
 */
import { and, eq } from "drizzle-orm";
import { db, closeDb } from "../server/db";
import { storage } from "../server/storage";
import { auditLogs, recordingRetentionDecisions } from "../shared/schema";

const attemptId = 1_700_000_000 + (Date.now() % 100_000_000);
const auditAction = "recording_retention_decision_recorded";

async function run() {
  let rejected = false;
  try {
    await storage.createRecordingRetentionDecisionWithAudit(
      {
        attemptId,
        sessionId: -1,
        clientId: -1,
        decision: "retain",
        rationale: "Atomicity regression test",
        decidedById: -1,
        decidedByName: "atomicity-test",
      },
      {
        // This deliberately violates the audit user foreign key. The
        // transaction must roll back the preceding ledger insert.
        userId: -1,
        username: "atomicity-test",
        action: auditAction,
        result: "success",
        resourceType: "session_transcript",
        resourceId: String(attemptId),
        clientId: -1,
        hipaaRelevant: true,
        riskLevel: "high",
        details: JSON.stringify({ attemptId }),
        accessReason: "Atomicity regression test",
      },
    );
  } catch {
    rejected = true;
  }

  const [decision] = await db
    .select({ id: recordingRetentionDecisions.id })
    .from(recordingRetentionDecisions)
    .where(eq(recordingRetentionDecisions.attemptId, attemptId))
    .limit(1);

  if (!rejected) throw new Error("Expected the invalid audit insert to be rejected");
  if (decision) throw new Error("An unaudited retention decision remained after rollback");

  // Defensive cleanup in case this test is run against a database without the
  // expected audit foreign key.
  await db
    .delete(recordingRetentionDecisions)
    .where(eq(recordingRetentionDecisions.attemptId, attemptId));
  await db
    .delete(auditLogs)
    .where(
      and(
        eq(auditLogs.action, auditAction),
        eq(auditLogs.resourceId, String(attemptId)),
      ),
    );

  console.log("PASS: retention decision and audit insert are atomic");
}

run()
  .catch((error) => {
    console.error("FAIL:", error);
    process.exitCode = 1;
  })
  .finally(() => closeDb());