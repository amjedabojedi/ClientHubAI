import { Request, Response, NextFunction } from 'express';
import { AuditLogger, getRequestInfo } from './audit-logger';

// Extend Express Request to include user info for audit logging
declare global {
  namespace Express {
    interface Request {
      auditUser?: {
        id: number;
        username: string;
      };
    }
  }
}

/**
 * Middleware to automatically log PHI access and high-risk actions
 */
export function auditMiddleware(action: string, resourceType: string, options?: {
  hipaaRelevant?: boolean;
  riskLevel?: 'low' | 'medium' | 'high' | 'critical';
  extractClientId?: (req: Request) => number | null;
  extractResourceId?: (req: Request) => string;
}) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      // Skip audit if no user context (public endpoints)
      if (!req.auditUser) {
        return next();
      }

      const { ipAddress, userAgent } = getRequestInfo(req);
      const clientId = options?.extractClientId ? options.extractClientId(req) : null;
      const resourceId = options?.extractResourceId ? options.extractResourceId(req) : 
                        req.params.id || req.params.clientId || req.params.sessionId || 'unknown';

      // Log the access attempt
      await AuditLogger.logAction({
        userId: req.auditUser.id,
        username: req.auditUser.username,
        action: action as any,
        result: 'success', // Will be updated if request fails
        resourceType,
        resourceId: resourceId.toString(),
        clientId,
        ipAddress,
        userAgent,
        hipaaRelevant: options?.hipaaRelevant || false,
        riskLevel: options?.riskLevel || 'low',
        details: JSON.stringify({
          method: req.method,
          url: req.url,
          timestamp: new Date(),
        }),
      });

      next();
    } catch (error) {
      console.error('Audit middleware error:', error);
      // Continue with request - audit should not block operations
      next();
    }
  };
}

/**
 * Middleware to set audit user context from session
 */
export function setAuditContext(req: Request, res: Response, next: NextFunction) {
  // This would be set by your authentication middleware
  // For now, we'll check if user is authenticated and set context
  if (req.user && (req.user as any).id) {
    req.auditUser = {
      id: (req.user as any).id,
      username: (req.user as any).username || 'unknown',
    };
  }
  next();
}

/**
 * Specific audit middleware for client data access
 */
export const auditClientAccess = (action: 'client_viewed' | 'client_created' | 'client_updated' | 'client_deleted') => {
  return auditMiddleware(action, 'client', {
    hipaaRelevant: true,
    riskLevel: 'medium',
    extractClientId: (req) => parseInt(req.params.id || req.params.clientId) || null,
  });
};

/**
 * Specific audit middleware for session data access
 */
export const auditSessionAccess = (action: 'session_viewed' | 'session_created' | 'session_updated' | 'session_deleted') => {
  return auditMiddleware(action, 'session', {
    hipaaRelevant: true,
    riskLevel: 'medium',
    extractResourceId: (req) => req.params.id || req.params.sessionId,
  });
};

/**
 * Specific audit middleware for document access
 */
export const auditDocumentAccess = (action: 'document_viewed' | 'document_uploaded' | 'document_downloaded' | 'document_deleted') => {
  return auditMiddleware(action, 'document', {
    hipaaRelevant: true,
    riskLevel: 'high',
    extractResourceId: (req) => req.params.id || req.params.documentId,
    extractClientId: (req) => parseInt(req.params.clientId) || null,
  });
};

/**
 * Audit middleware for data export (critical risk)
 */
export const auditDataExport = (exportType: string) => {
  return auditMiddleware('data_exported', 'export', {
    hipaaRelevant: true,
    riskLevel: 'critical',
    extractResourceId: (req) => `${exportType}_${Date.now()}`,
  });
};

/**
 * Audit middleware for assessment access
 */
export const auditAssessmentAccess = (action: 'assessment_viewed' | 'assessment_created' | 'assessment_updated' | 'assessment_completed') => {
  return auditMiddleware(action, 'assessment', {
    hipaaRelevant: true,
    riskLevel: 'medium',
    extractResourceId: (req) => req.params.id || req.params.assessmentId,
    extractClientId: (req) => parseInt(req.params.clientId) || null,
  });
};