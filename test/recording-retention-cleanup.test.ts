/**
 * Regression coverage for the separately authorized recording cleanup path.
 *
 * Run with: npx tsx test/recording-retention-cleanup.test.ts
 */
import { and, eq, inArray, or } from "drizzle-orm";
import { db, closeDb } from "../server/db";
import { storage } from "../server/storage";
import { ensureAuditEnumsAtStartup } from "../server/audit-enum-check";
import {
  auditLogs,
  clients,
  recordingRetentionDecisions,
  services,
  sessions,
  sessionTranscripts,
  users,
} from "../shared/schema";

const suffix = `cleanup-${Date.now()}-${Math.random().toString(16).slice(2)}`;
const createdUserIds: number[] = [];
const createdClientIds: number[] = [];
const createdServiceIds: number[] = [];
const createdSessionIds: number[] = [];
const createdAttemptIds: number[] = [];

function audit(
  userId: number,
  clientId: number,
  action: "recording_retention_decision_recorded" | "recording_retention_cleanup_performed",
  attemptId: number,
) {
  return {
    userId,
    username: "recording-cleanup-test",
    action,
    result: "success" as const,
    resourceType: "session_transcript",
    resourceId: String(attemptId),
    clientId,
    ipAddress: "127.0.0.1",
    userAgent: "recording-retention-cleanup.test",
    hipaaRelevant: true,
    riskLevel: "high",
    details: JSON.stringify({ attemptId }),
    accessReason: "Recording cleanup regression test",
  };
}

async function run() {
  await ensureAuditEnumsAtStartup();

  const admin = await storage.createUser({
    username: `cleanup-admin-${suffix}`,
    password: "x",
    fullName: `Cleanup Admin ${suffix}`,
    email: `cleanup-admin-${suffix}@example.test`,
    role: "admin",
  } as any);
  createdUserIds.push(admin.id);

  const therapist = await storage.createUser({
    username: `cleanup-therapist-${suffix}`,
    password: "x",
    fullName: `Cleanup Therapist ${suffix}`,
    email: `cleanup-therapist-${suffix}@example.test`,
    role: "therapist",
  } as any);
  createdUserIds.push(therapist.id);

  const client = await storage.createClient({
    fullName: `Recording Cleanup Client ${suffix}`,
    assignedTherapistId: therapist.id,
  } as any);
  createdClientIds.push(client.id);

  const service = await storage.createService({
    serviceCode: `CLEANUP-${suffix}`,
    serviceName: `Cleanup Test Service ${suffix}`,
    duration: 60,
    baseRate: "100.00",
  } as any);
  createdServiceIds.push(service.id);

  const session = await storage.createSession({
    clientId: client.id,
    therapistId: therapist.id,
    serviceId: service.id,
    sessionDate: new Date(),
    sessionType: "individual",
    status: "scheduled",
  } as any);
  createdSessionIds.push(session.id);

  const makeAttempt = async (label: string) => {
    const attempt = await storage.createSessionTranscript({
      sessionId: session.id,
      clientId: client.id,
      therapistId: therapist.id,
      content: `Buffered content ${label}`,
      rawContent: `Raw buffered content ${label}`,
      durationSeconds: 15,
      chunkCount: 1,
      wordCount: 4,
      uploadId: `srv-${label}-${suffix}`,
      chunks: { "0": { text: `Buffered chunk ${label}`, durationSeconds: 15 } },
      status: "recording",
    } as any);
    createdAttemptIds.push(attempt.id);
    return attempt;
  };

  const makeCleanupDecision = async (attemptId: number) => {
    await storage.createRecordingRetentionDecisionWithAudit(
      {
        attemptId,
        sessionId: session.id,
        clientId: client.id,
        decision: "cleanup_authorized",
        rationale: "Approved cleanup for regression test",
        decidedById: admin.id,
        decidedByName: admin.username,
      },
      audit(admin.id, client.id, "recording_retention_decision_recorded", attemptId),
    );
  };

  // A decision is only a ledger entry; it does not remove the attempt.
  const decisionOnlyAttempt = await makeAttempt("decision-only");
  await makeCleanupDecision(decisionOnlyAttempt.id);
  const stillPresentAfterDecision = await storage.getSessionTranscriptById(
    decisionOnlyAttempt.id,
    session.id,
  );
  if (!stillPresentAfterDecision) {
    throw new Error("A cleanup-authorized decision removed content without confirmation");
  }

  // A newer retain decision overrides an older cleanup authorization.
  const retainedAttempt = await makeAttempt("newer-retain");
  await makeCleanupDecision(retainedAttempt.id);
  await storage.createRecordingRetentionDecisionWithAudit(
    {
      attemptId: retainedAttempt.id,
      sessionId: session.id,
      clientId: client.id,
      decision: "retain",
      rationale: "Keep the recording",
      decidedById: admin.id,
      decidedByName: admin.username,
    },
    audit(admin.id, client.id, "recording_retention_decision_recorded", retainedAttempt.id),
  );
  const retainedResult = await storage.cleanupRecordingAttemptWithAudit(
    retainedAttempt.id,
    audit(admin.id, client.id, "recording_retention_cleanup_performed", retainedAttempt.id),
  );
  if (retainedResult.status !== "not_authorized") {
    throw new Error("A newer retain decision did not block cleanup");
  }

  // Approved cleanup removes only the selected attempt, preserves its
  // append-only decisions, and writes the dedicated audit action.
  const cleanupAttempt = await makeAttempt("approved");
  await makeCleanupDecision(cleanupAttempt.id);
  const cleanupResult = await storage.cleanupRecordingAttemptWithAudit(
    cleanupAttempt.id,
    audit(admin.id, client.id, "recording_retention_cleanup_performed", cleanupAttempt.id),
  );
  if (cleanupResult.status !== "deleted") {
    throw new Error(`Expected approved cleanup to delete the attempt, got ${cleanupResult.status}`);
  }
  const deletedAttempt = await storage.getSessionTranscriptById(cleanupAttempt.id, session.id);
  if (deletedAttempt) throw new Error("Approved cleanup left the recording attempt behind");

  const [decision] = await db
    .select({ id: recordingRetentionDecisions.id })
    .from(recordingRetentionDecisions)
    .where(eq(recordingRetentionDecisions.attemptId, cleanupAttempt.id))
    .limit(1);
  if (!decision) throw new Error("Cleanup removed the append-only retention decision history");

  const [cleanupAudit] = await db
    .select({ id: auditLogs.id })
    .from(auditLogs)
    .where(
      and(
        eq(auditLogs.userId, admin.id),
        eq(auditLogs.clientId, client.id),
        eq(auditLogs.action, "recording_retention_cleanup_performed"),
        eq(auditLogs.resourceId, String(cleanupAttempt.id)),
      ),
    )
    .limit(1);
  if (!cleanupAudit) throw new Error("Approved cleanup did not write its dedicated audit event");

  // If the audit insert fails, the deletion transaction must roll back.
  const auditFailureAttempt = await makeAttempt("audit-failure");
  await makeCleanupDecision(auditFailureAttempt.id);
  let rejected = false;
  try {
    await storage.cleanupRecordingAttemptWithAudit(
      auditFailureAttempt.id,
      audit(-1, client.id, "recording_retention_cleanup_performed", auditFailureAttempt.id),
    );
  } catch {
    rejected = true;
  }
  if (!rejected) throw new Error("Expected an invalid audit user to reject cleanup");
  const presentAfterAuditFailure = await storage.getSessionTranscriptById(
    auditFailureAttempt.id,
    session.id,
  );
  if (!presentAfterAuditFailure) {
    throw new Error("Cleanup was not rolled back when its audit insert failed");
  }

  console.log("PASS: retention cleanup requires authorization and preserves audit history");
}

run()
  .catch((error) => {
    console.error("FAIL:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      if (createdUserIds.length || createdClientIds.length) {
        const auditConditions = [];
        if (createdUserIds.length) auditConditions.push(inArray(auditLogs.userId, createdUserIds));
        if (createdClientIds.length) auditConditions.push(inArray(auditLogs.clientId, createdClientIds));
        await db.delete(auditLogs).where(or(...auditConditions));
      }
      if (createdAttemptIds.length) {
        await db
          .delete(recordingRetentionDecisions)
          .where(inArray(recordingRetentionDecisions.attemptId, createdAttemptIds));
        await db
          .delete(sessionTranscripts)
          .where(inArray(sessionTranscripts.id, createdAttemptIds));
      }
      if (createdSessionIds.length) {
        await db.delete(sessionTranscripts).where(inArray(sessionTranscripts.sessionId, createdSessionIds));
      }
      if (createdClientIds.length) {
        await db.delete(recordingRetentionDecisions).where(inArray(recordingRetentionDecisions.clientId, createdClientIds));
        await db.delete(sessionTranscripts).where(inArray(sessionTranscripts.clientId, createdClientIds));
      }
      if (createdSessionIds.length) {
        await db.delete(sessions).where(inArray(sessions.id, createdSessionIds));
      }
      if (createdClientIds.length) {
        await db.delete(clients).where(inArray(clients.id, createdClientIds));
      }
      if (createdServiceIds.length) {
        await db.delete(services).where(inArray(services.id, createdServiceIds));
      }
      if (createdUserIds.length) {
        await db.delete(users).where(inArray(users.id, createdUserIds));
      }
    } catch (cleanupError) {
      console.error("Cleanup failed:", cleanupError);
      process.exitCode = 1;
    } finally {
      await closeDb();
    }
  });