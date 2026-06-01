import { promises as fs } from 'fs';
import path from 'path';
import { db } from './db';
import { auditLogs, loginAttempts, userSessions } from '@shared/schema';
import type { InsertAuditLog, InsertLoginAttempt, InsertUserSession } from '@shared/schema';

// Append-only fallback so a failed DB audit write is never silently lost. The
// directory is configurable for deploy environments; it defaults to a folder in
// the project root. Each line is a self-contained JSON record (JSONL) tagged
// with the original DB error so the entry can be replayed / reconciled later.
const AUDIT_FALLBACK_DIR =
  process.env.AUDIT_FALLBACK_DIR || path.join(process.cwd(), 'audit-fallback');
const AUDIT_FALLBACK_FILE = path.join(AUDIT_FALLBACK_DIR, 'audit-fallback.jsonl');

export class AuditLogger {
  /**
   * Persist an audit record that could not be written to the database to an
   * append-only fallback file so the audit trail is preserved. Throws if even
   * the fallback write fails, so the loss can never go unnoticed.
   */
  private static async persistFallback(data: InsertAuditLog, dbError: unknown) {
    const line =
      JSON.stringify({
        ...data,
        timestamp: new Date().toISOString(),
        _fallbackReason:
          dbError instanceof Error ? dbError.message : String(dbError),
        _recordedAt: new Date().toISOString(),
      }) + '\n';
    await fs.mkdir(AUDIT_FALLBACK_DIR, { recursive: true });
    await fs.appendFile(AUDIT_FALLBACK_FILE, line, 'utf8');
  }

  /**
   * Log any user action for HIPAA compliance.
   *
   * Audit writes must never fail silently. If the database insert fails we
   * (1) loudly log the failure, (2) persist the record to an append-only
   * fallback file so it is not lost, and (3) re-throw if even the fallback
   * write fails so the request surfaces the problem instead of swallowing it.
   */
  static async logAction(data: InsertAuditLog) {
    try {
      await db.insert(auditLogs).values({
        ...data,
        timestamp: new Date(),
      });
    } catch (error) {
      // Critical: Audit logging must never fail silently.
      console.error('CRITICAL: Audit log failed to record (DB write failed):', error);
      try {
        await this.persistFallback(data, error);
        console.error(
          `CRITICAL: Audit record persisted to fallback file ${AUDIT_FALLBACK_FILE} (action=${data.action}, result=${data.result}). Investigate and reconcile.`,
        );
      } catch (fallbackError) {
        // Both the DB and the durable fallback failed: this is an audit-trail
        // loss. Surface it loudly by throwing so callers/requests don't proceed
        // as if the event was recorded.
        console.error(
          'CRITICAL: Audit log failed to record AND fallback persistence failed — audit entry lost:',
          fallbackError,
        );
        throw new Error(
          `Audit log could not be recorded (DB and fallback both failed) for action=${data.action}`,
        );
      }
    }
  }

  /**
   * Log client data access (PHI access tracking - expanded)
   */
  static async logClientAccess(
    userId: number,
    username: string,
    clientId: number,
    action: 'client_viewed' | 'client_created' | 'client_updated' | 'client_deleted' | 'client_status_changed' | 'client_assigned' | 'client_transferred',
    ipAddress: string,
    userAgent: string,
    details?: any
  ) {
    // Determine risk level based on action
    const riskLevel = action === 'client_deleted' ? 'high' : 'medium';
    
    return this.logAction({
      userId,
      username,
      action,
      result: 'success',
      resourceType: 'client',
      resourceId: clientId.toString(),
      clientId,
      ipAddress,
      userAgent,
      hipaaRelevant: true, // Client data is always PHI
      riskLevel,
      details: JSON.stringify(details || {}),
      accessReason: 'Clinical care and treatment',
    });
  }

  /**
   * Log session data access (expanded with all operations)
   */
  static async logSessionAccess(
    userId: number,
    username: string,
    sessionId: number,
    clientId: number,
    action: 'session_viewed' | 'session_created' | 'session_updated' | 'session_deleted' | 'session_cancelled' | 'session_rescheduled' | 'session_completed' | 'session_no_show',
    ipAddress: string,
    userAgent: string,
    details?: any
  ) {
    // Determine risk level based on action
    const riskLevel = action === 'session_deleted' ? 'high' : 'medium';
    
    return this.logAction({
      userId,
      username,
      action,
      result: 'success',
      resourceType: 'session',
      resourceId: sessionId.toString(),
      clientId,
      ipAddress,
      userAgent,
      hipaaRelevant: true,
      riskLevel,
      details: JSON.stringify(details || {}),
      accessReason: 'Clinical documentation and care',
    });
  }

  /**
   * Log document access (high risk due to sensitive content)
   */
  static async logDocumentAccess(
    userId: number,
    username: string,
    documentId: number,
    clientId: number,
    action: 'document_viewed' | 'document_uploaded' | 'document_downloaded' | 'document_deleted' | 'document_shared' | 'document_modified' | 'document_shared_in_portal' | 'document_unshared_from_portal',
    ipAddress: string,
    userAgent: string,
    details?: any
  ) {
    return this.logAction({
      userId,
      username,
      action,
      result: 'success',
      resourceType: 'document',
      resourceId: documentId.toString(),
      clientId,
      ipAddress,
      userAgent,
      hipaaRelevant: true,
      riskLevel: 'high', // Documents are high risk
      details: JSON.stringify(details || {}),
      accessReason: 'Clinical documentation review',
    });
  }

  /**
   * Log authentication events
   */
  static async logAuthEvent(
    userId: number | null,
    username: string,
    action: 'login' | 'logout' | 'login_failed' | 'password_changed' | 'account_locked',
    ipAddress: string,
    userAgent: string,
    result: 'success' | 'failure' | 'blocked',
    details?: any
  ) {
    return this.logAction({
      userId,
      username,
      action,
      result,
      resourceType: 'authentication',
      resourceId: username,
      ipAddress,
      userAgent,
      hipaaRelevant: false,
      riskLevel: result === 'failure' ? 'high' : 'low',
      details: JSON.stringify(details || {}),
    });
  }

  /**
   * Log unauthorized access attempts (critical security events)
   */
  static async logUnauthorizedAccess(
    userId: number | null,
    username: string,
    resourceType: string,
    resourceId: string,
    ipAddress: string,
    userAgent: string,
    details?: any
  ) {
    return this.logAction({
      userId,
      username,
      action: 'unauthorized_access',
      result: 'blocked',
      resourceType,
      resourceId,
      ipAddress,
      userAgent,
      hipaaRelevant: true,
      riskLevel: 'critical',
      details: JSON.stringify({
        ...details,
        blocked_at: new Date(),
        requires_review: true,
      }),
    });
  }

  /**
   * Log data export events (high risk - PHI leaving system)
   */
  static async logDataExport(
    userId: number,
    username: string,
    exportType: string,
    clientIds: number[],
    ipAddress: string,
    userAgent: string,
    details?: any
  ) {
    return this.logAction({
      userId,
      username,
      action: 'data_exported',
      result: 'success',
      resourceType: 'export',
      resourceId: `${exportType}_${Date.now()}`,
      ipAddress,
      userAgent,
      hipaaRelevant: true,
      riskLevel: 'critical', // Data export is always critical
      details: JSON.stringify({
        ...details,
        export_type: exportType,
        client_count: clientIds.length,
        client_ids: clientIds,
        export_timestamp: new Date(),
      }),
      accessReason: 'Authorized data export for clinical purposes',
    });
  }

  /**
   * Log session note operations (high risk - clinical documentation)
   */
  static async logSessionNoteAccess(
    userId: number,
    username: string,
    noteId: number,
    clientId: number,
    action: 'note_created' | 'note_updated' | 'note_viewed' | 'note_deleted' | 'note_ai_generated' | 'voice_transcription_processed' | 'voice_transcription_failed',
    ipAddress: string,
    userAgent: string,
    details?: any
  ) {
    return this.logAction({
      userId,
      username,
      action,
      result: 'success',
      resourceType: 'session_note',
      resourceId: noteId.toString(),
      clientId,
      ipAddress,
      userAgent,
      hipaaRelevant: true,
      riskLevel: 'high', // Clinical notes are high risk
      details: JSON.stringify(details || {}),
      accessReason: 'Clinical documentation and care',
    });
  }

  /**
   * Log assessment operations
   */
  static async logAssessmentAccess(
    userId: number,
    username: string,
    assessmentId: number,
    clientId: number,
    action: 'assessment_assigned' | 'assessment_completed' | 'assessment_viewed' | 'assessment_report_generated',
    ipAddress: string,
    userAgent: string,
    details?: any
  ) {
    return this.logAction({
      userId,
      username,
      action,
      result: 'success',
      resourceType: 'assessment',
      resourceId: assessmentId.toString(),
      clientId,
      ipAddress,
      userAgent,
      hipaaRelevant: true,
      riskLevel: 'high', // Assessments contain sensitive clinical data
      details: JSON.stringify(details || {}),
      accessReason: 'Clinical assessment and evaluation',
    });
  }

  /**
   * Log billing operations (financial PHI)
   */
  static async logBillingAccess(
    userId: number,
    username: string,
    billingId: number,
    clientId: number,
    action: 'billing_created' | 'billing_updated' | 'billing_status_changed' | 'payment_recorded' | 'invoice_sent',
    ipAddress: string,
    userAgent: string,
    details?: any
  ) {
    return this.logAction({
      userId,
      username,
      action,
      result: 'success',
      resourceType: 'billing',
      resourceId: billingId.toString(),
      clientId,
      ipAddress,
      userAgent,
      hipaaRelevant: true,
      riskLevel: 'medium', // Financial data is medium risk
      details: JSON.stringify(details || {}),
      accessReason: 'Billing and financial services',
    });
  }

  /**
   * Record login attempts for security monitoring
   */
  static async recordLoginAttempt(data: InsertLoginAttempt) {
    try {
      await db.insert(loginAttempts).values({
        ...data,
        timestamp: new Date(),
      });
    } catch (error) {
      console.error('Failed to record login attempt:', error);
    }
  }

  /**
   * Create user session tracking
   */
  static async createSession(data: InsertUserSession) {
    try {
      const [session] = await db.insert(userSessions).values({
        ...data,
        createdAt: new Date(),
        lastActivity: new Date(),
      }).returning();
      return session;
    } catch (error) {
      console.error('Failed to create user session:', error);
      throw error;
    }
  }

  /**
   * Get audit reports for compliance
   */
  static async getAuditReport(
    startDate: Date,
    endDate: Date,
    options?: {
      userId?: number;
      clientId?: number;
      hipaaOnly?: boolean;
      riskLevel?: string;
    }
  ) {
    // TODO: Implement date filtering and options
    return await db
      .select()
      .from(auditLogs)
      .execute();
  }
}

// Middleware function to extract client request info
export function getRequestInfo(req: any) {
  return {
    ipAddress: req.ip || req.connection.remoteAddress || '127.0.0.1',
    userAgent: req.get('User-Agent') || 'Unknown',
    sessionId: req.sessionID || 'no-session',
  };
}