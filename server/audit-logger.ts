import { db } from './db';
import { auditLogs, loginAttempts, userSessions } from '@shared/schema';
import type { InsertAuditLog, InsertLoginAttempt, InsertUserSession } from '@shared/schema';

export class AuditLogger {
  /**
   * Log any user action for HIPAA compliance
   */
  static async logAction(data: InsertAuditLog) {
    try {
      await db.insert(auditLogs).values({
        ...data,
        timestamp: new Date(),
      });
    } catch (error) {
      // Critical: Audit logging should never fail silently
      console.error('CRITICAL: Audit log failed to record:', error);
      // Could implement backup logging to file system here
    }
  }

  /**
   * Log client data access (PHI access tracking)
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
      riskLevel: 'medium',
      details: JSON.stringify(details || {}),
      accessReason: 'Clinical care and treatment',
    });
  }

  /**
   * Log session data access
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
      riskLevel: 'medium',
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
    action: 'document_viewed' | 'document_uploaded' | 'document_downloaded' | 'document_deleted' | 'document_shared' | 'document_modified',
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
    let query = db
      .select()
      .from(auditLogs)
      .where(
        // Add date filtering here when we implement it
      );

    // Add filters based on options
    // This would be expanded with actual filtering logic

    return await query.execute();
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