// Core Express and Node.js
import type { Express, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import multer from "multer";
import bcrypt from "bcrypt";
import SparkPost from "sparkpost";
import puppeteer from "puppeteer";
import { execSync } from "child_process";
import { format } from "date-fns";
import { toZonedTime, fromZonedTime, formatInTimeZone } from "date-fns-tz";
import { utcDateMatchesLocalDate, localTimeToUtc, utcToLocalDateString } from "./practiceTime";
import Stripe from "stripe";

// Validation
import { z } from "zod";

// Internal Services
import { storage, type TaskQueryParams } from "./storage";
import { buildTherapistCalendar } from "./ics-service";
import { clientInitials } from "@shared/privacy";
// Auth will be implemented later, for now removing to test audit logging
import { generateSessionNoteSummary, generateSmartSuggestions, generateClinicalReport, transcribeAndMapAudio, transcribeAssessmentAudio } from "./ai/openai";
import { parseInsuranceUpload } from "./insurance/parse";
import notificationRoutes from "./notification-routes";
import { NotificationService } from "./notification-service";
import { classifyInboundSms, validateTwilioSignature, normalizePhoneE164 } from "./sms-service";
import { db } from "./db";

// Shared, module-level helper functions (email senders, privacy redaction, GDPR
// consent checks, id generation, request helpers, calendar-feed rate limiter).
import {
  getEmailFromAddress,
  getChromiumExecutablePath,
  convertESTToUTC,
  generateClientId,
  sanitizeUser,
  sanitizeUsers,
  calendarFeedRateLimited,
  getBaseUrl,
  checkAIProcessingConsent,
  sendActivationEmail,
  sendPasswordResetEmail,
  sendAppointmentConfirmationEmail,
  trackClientHistory,
  checkAssessmentResponsePermission,
  checkAssessmentEditPermission,
  formatClientInitial,
  redactClientData,
  redactSessionClient,
  redactBillingClient,
} from "./routes-helpers";
import { users, auditLogs, loginAttempts, clients, sessionBilling, sessions, sessionNotes, clientHistory, services, documents, formTemplates, formFields, formAssignments, formResponses, formSignatures, patientConsents, scheduledNotifications, roomBookings, sessionRatings, AUDIT_ACTIONS, type AuditAction } from "@shared/schema";
import { eq, and, or, gte, lte, desc, asc, sql, ilike, inArray, count } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { AuditLogger, getRequestInfo } from "./audit-logger";
import { setAuditContext, auditClientAccess, auditSessionAccess, auditDocumentAccess, auditAssessmentAccess, auditDataExport } from "./audit-middleware";
import { AzureBlobStorage } from "./azure-blob-storage";
import { zoomService } from "./zoom-service";
import type { AuthenticatedRequest } from "./auth-middleware";
import { requireAuth, blockAccountant } from "./auth-middleware";
import { sanitizeHtml } from "./lib/sanitize";

// Database Schemas
import { 
  insertClientSchema, 
  insertUserSchema,
  insertUserProfileSchema,
  insertTherapistBlockedTimeSchema,
  insertSupervisorAssignmentSchema,
  insertUserActivityLogSchema,
  insertSessionSchema, 
  insertTaskSchema, 
  insertTaskCommentSchema,
  insertNoteSchema, 
  insertDocumentSchema, 
  insertSessionNoteSchema, 
  insertLibraryCategorySchema, 
  insertLibraryEntrySchema, 
  insertAssessmentTemplateSchema, 
  insertAssessmentSectionSchema, 
  insertAssessmentQuestionSchema, 
  insertAssessmentQuestionOptionSchema, 
  insertAssessmentAssignmentSchema, 
  insertAssessmentResponseSchema, 
  insertAssessmentReportSchema,
  insertReportTemplateSchema,
  insertReportSupportingFileSchema,
  insertClientReportSchema,
  insertServiceSchema,
  insertRoomSchema,
  insertRoomBookingSchema,
  insertSessionBillingSchema,
  insertTherapistPayoutSchema,
  insertRoleSchema,
  insertPermissionSchema,
  insertRolePermissionSchema,
  insertOptionCategorySchema,
  insertSystemOptionSchema,
  insertClientHistorySchema,
  insertFormTemplateSchema,
  insertFormFieldSchema,
  updateFormFieldSchema,
  insertFormAssignmentSchema,
  insertFormResponseSchema,
  insertFormSignatureSchema
} from "@shared/schema";


// Initialize Stripe
if (!process.env.STRIPE_SECRET_KEY) {
  console.warn('STRIPE_SECRET_KEY not found - payment functionality will be disabled');
}
const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2023-10-16" as any,
}) : null;

// Initialize Azure Blob Storage
const azureStorage = new AzureBlobStorage(
  process.env.AZURE_STORAGE_CONNECTION_STRING || '',
  process.env.AZURE_BLOB_CONTAINER_NAME || 'documents'
);

// Restrict therapist-payment management (pay rules + payouts) to admin and
// billing roles. Therapists must not see or edit compensation settings here.
function requireTherapistPayAccess(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const role = req.user?.role?.toLowerCase();
  if (role === 'admin' || role === 'administrator' || role === 'billing') {
    return next();
  }
  return res.status(403).json({ message: "Access denied. Admin or billing privileges required." });
}


export async function registerRoutes(app: Express): Promise<Server> {
  // Initialize notification service
  const notificationService = new NotificationService();
  
  // User profile routes - working version
  app.get("/api/users/me", async (req, res) => {
    try {
      // Get authenticated user from request
      const authenticatedUser = (req as any).user;
      if (!authenticatedUser?.id) {
        return res.status(401).json({ message: "Authentication required" });
      }
      
      const [user] = await db.select().from(users).where(eq(users.id, authenticatedUser.id));
      
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }
      
      res.json(sanitizeUser(user));
    } catch (error) {
      console.error("Error fetching user:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.put("/api/users/me", async (req, res) => {
    try {
      // Get authenticated user from request
      const authenticatedUser = (req as any).user;
      if (!authenticatedUser?.id) {
        return res.status(401).json({ message: "Authentication required" });
      }
      const currentUserId = authenticatedUser.id;
      
      // Get current user data to check email
      const [currentUser] = await db.select().from(users).where(eq(users.id, currentUserId));
      if (!currentUser) {
        return res.status(404).json({ message: "User not found" });
      }
      
      // If email is being changed, check if new email already exists
      if (req.body.email && req.body.email !== currentUser.email) {
        const [existingUser] = await db.select()
          .from(users)
          .where(eq(users.email, req.body.email));
        
        if (existingUser) {
          return res.status(400).json({ 
            message: "Email address is already in use by another account" 
          });
        }
      }
      
      const updateData: any = {
        fullName: req.body.fullName,
        email: req.body.email,
        updatedAt: new Date()
      };

      // Keep the typed phone verbatim and derive the SMS-only E.164 copy alongside it.
      if (req.body.phone !== undefined) {
        updateData.phone = req.body.phone;
        updateData.phoneE164 = normalizePhoneE164(req.body.phone);
      }

      const [updatedUser] = await db.update(users)
        .set(updateData)
        .where(eq(users.id, currentUserId))
        .returning();
      
      if (!updatedUser) {
        return res.status(404).json({ message: "User not found" });
      }
      
      res.json(sanitizeUser(updatedUser));
    } catch (error) {
      console.error("Error updating user:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // ===== CALENDAR FEED (per-therapist read-only iCal subscription) =====
  //
  // PRIVACY: the .ics feed leaves SmartHub, so events only ever carry the
  // client's two initials (e.g. "J.D.") — never the full name, notes, diagnosis
  // or any other PHI (see shared/privacy.ts + server/ics-service.ts).

  // Status of the signed-in user's own calendar feed (returns the secret link
  // only to its owner).
  app.get("/api/calendar/feed", requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const userId = req.user!.id;
      const user = await storage.getUser(userId);
      if (!user) return res.status(404).json({ message: "User not found" });

      if (!user.calendarFeedToken) {
        return res.json({ enabled: false, url: null });
      }

      const url = `${getBaseUrl(req)}/api/calendar/feed/${user.calendarFeedToken}.ics`;
      res.json({ enabled: true, url, enabledAt: user.calendarFeedEnabledAt });
    } catch (error) {
      console.error("Error fetching calendar feed status:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Create or regenerate the feed link. Regenerating mints a brand new token,
  // which immediately invalidates any previously shared link.
  app.post("/api/calendar/feed/regenerate", requireAuth, async (req: AuthenticatedRequest, res) => {
    const { ipAddress, userAgent } = getRequestInfo(req);
    try {
      const userId = req.user!.id;
      const token = crypto.randomBytes(24).toString("hex");

      await storage.updateUser(userId, {
        calendarFeedToken: token,
        calendarFeedEnabledAt: new Date(),
      });

      try {
        await AuditLogger.logAction({
          userId,
          username: req.user!.username,
          action: "calendar_feed_token_generated",
          result: "success",
          resourceType: "calendar_feed",
          resourceId: String(userId),
          ipAddress,
          userAgent,
          hipaaRelevant: true,
          riskLevel: "medium",
          details: JSON.stringify({
            note: "New calendar feed link generated; any previous link is now invalid.",
          }),
        });
      } catch (auditErr) {
        console.error("Failed to audit calendar feed token generation:", auditErr);
      }

      const url = `${getBaseUrl(req)}/api/calendar/feed/${token}.ics`;
      res.json({ enabled: true, url });
    } catch (error) {
      console.error("Error regenerating calendar feed:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Turn the feed off and invalidate the current link.
  app.delete("/api/calendar/feed", requireAuth, async (req: AuthenticatedRequest, res) => {
    const { ipAddress, userAgent } = getRequestInfo(req);
    try {
      const userId = req.user!.id;

      await storage.updateUser(userId, {
        calendarFeedToken: null,
        calendarFeedEnabledAt: null,
      });

      try {
        await AuditLogger.logAction({
          userId,
          username: req.user!.username,
          action: "calendar_feed_token_revoked",
          result: "success",
          resourceType: "calendar_feed",
          resourceId: String(userId),
          ipAddress,
          userAgent,
          hipaaRelevant: true,
          riskLevel: "medium",
          details: JSON.stringify({ note: "Calendar feed disabled; link no longer works." }),
        });
      } catch (auditErr) {
        console.error("Failed to audit calendar feed token revocation:", auditErr);
      }

      res.json({ enabled: false, url: null });
    } catch (error) {
      console.error("Error disabling calendar feed:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // PUBLIC, token-authenticated .ics feed. No cookie/session auth: the secret
  // token in the URL is the only credential. Fails closed (404) on any bad or
  // missing token so it never reveals whether a token exists.
  app.get("/api/calendar/feed/:filename", async (req, res) => {
    try {
      const clientIp =
        req.headers["x-forwarded-for"]?.toString().split(",")[0].trim() ||
        req.ip ||
        req.socket?.remoteAddress ||
        "unknown";
      if (calendarFeedRateLimited(clientIp)) {
        res.setHeader("Retry-After", "600");
        return res.status(429).type("text/plain").send("Too many requests");
      }

      const token = String(req.params.filename || "").replace(/\.ics$/i, "");
      if (!token) {
        return res.status(404).type("text/plain").send("Calendar not found");
      }

      const user = await storage.getUserByCalendarFeedToken(token);
      if (!user) {
        return res.status(404).type("text/plain").send("Calendar not found");
      }

      // Bounded window so the feed stays small: recent past + a year ahead.
      const now = new Date();
      const startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      const endDate = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);

      const { sessions: rows } = await storage.getSessionsWithFiltering({
        therapistId: user.id,
        startDate,
        endDate,
        page: 1,
        limit: 5000,
        includeHiddenServices: true,
      });

      // Active statuses show as live events; cancelled/no-show are still emitted
      // (with STATUS:CANCELLED) so calendars that previously synced them reliably
      // clear the slot rather than leaving a stale event behind.
      const allowedStatuses = new Set([
        "scheduled",
        "confirmed",
        "in-progress",
        "in_progress",
        "cancelled",
        "canceled",
        "no_show",
      ]);

      const events = rows
        .filter((s: any) => allowedStatuses.has(String(s.status || "").toLowerCase()))
        .map((s: any) => {
          const durationMinutes = Number(s.duration) || 50;
          const telehealth = !!s.zoomEnabled;

          let location: string | undefined;
          if (s.room?.roomName) {
            location = s.room.roomNumber
              ? `${s.room.roomName} (${s.room.roomNumber})`
              : s.room.roomName;
          } else if (telehealth) {
            location = "Telehealth (Zoom)";
          }

          return {
            id: s.id,
            start: new Date(s.sessionDate),
            durationMinutes,
            initials: clientInitials(s.client?.fullName),
            status: String(s.status || ""),
            sessionType: s.service?.serviceName || undefined,
            location,
            joinUrl: telehealth ? s.zoomJoinUrl || undefined : undefined,
          };
        });

      const host = (req.headers["x-forwarded-host"] || req.headers.host || "smarthub")
        .toString()
        .split(":")[0];

      const ics = buildTherapistCalendar({
        calendarName: "SmartHub Schedule",
        host,
        events,
      });

      try {
        const { ipAddress, userAgent } = getRequestInfo(req);
        await AuditLogger.logAction({
          userId: user.id,
          username: user.username,
          action: "calendar_feed_accessed",
          result: "success",
          resourceType: "calendar_feed",
          resourceId: String(user.id),
          ipAddress,
          userAgent,
          hipaaRelevant: true,
          riskLevel: "medium",
          details: JSON.stringify({ eventCount: events.length }),
        });
      } catch (auditErr) {
        // Never break feed delivery on an audit failure (it is already logged
        // loudly and written to the fallback file by AuditLogger).
        console.error("Failed to audit calendar feed access:", auditErr);
      }

      res.setHeader("Content-Type", "text/calendar; charset=utf-8");
      res.setHeader("Content-Disposition", 'inline; filename="smarthub-schedule.ics"');
      res.setHeader("Cache-Control", "private, max-age=300");
      res.send(ics);
    } catch (error) {
      console.error("Error generating calendar feed:", error);
      res.status(500).type("text/plain").send("Unable to generate calendar");
    }
  });

  // Add audit context middleware to all routes
  app.use(setAuditContext);
  // Authentication routes with audit logging
  app.post("/api/auth/login", async (req, res) => {
    const { ipAddress, userAgent } = getRequestInfo(req);
    
    try {
      const { username, password } = req.body;
      
      if (!username || !password) {
        // Log failed login attempt
        await AuditLogger.recordLoginAttempt({
          username: username || 'unknown',
          ipAddress,
          userAgent,
          success: false,
          failureReason: 'missing_credentials',
        });
        return res.status(400).json({ error: "Username and password are required" });
      }

      // Authentication with bcrypt password verification
      const users = await storage.getUsers();
      const user = users.find(u => u.username === username);
      
      // Handle both bcrypt hashed and plain text passwords
      let passwordMatch = false;
      if (user) {
        if (user.password.startsWith('$2b$') || user.password.startsWith('$2a$')) {
          // Bcrypt hashed password
          passwordMatch = await bcrypt.compare(password, user.password);
        } else {
          // Plain text password (temporary compatibility)
          passwordMatch = password === user.password;
        }
      }
      
      if (!user || !passwordMatch) {
        // Log failed login attempt
        await AuditLogger.recordLoginAttempt({
          username,
          ipAddress,
          userAgent,
          success: false,
          failureReason: 'invalid_credentials',
        });
        return res.status(401).json({ error: "Invalid credentials" });
      }

      // Log successful login attempt
      await AuditLogger.recordLoginAttempt({
        username,
        ipAddress,
        userAgent,
        success: true,
      });

      // Create secure session token
      const { createSessionToken } = await import('./auth-middleware');
      const sessionToken = createSessionToken({
        id: user.id,
        username: user.username,
        role: user.role
      });

      // Generate CSRF token
      const crypto = await import('crypto');
      const csrfToken = crypto.randomBytes(32).toString('hex');

      // Set secure cookies with proper environment-based configuration
      const isProduction = process.env.NODE_ENV === 'production';
      const useSecure = process.env.USE_SECURE_COOKIES === 'true';
      const isReplit = process.env.REPLIT_ENVIRONMENT === 'true';
      
      // Use appropriate settings based on environment
      const cookieSecure = isProduction || useSecure;
      const cookieSameSite = isReplit && isProduction ? 'none' : 'strict';
      
      res.cookie('sessionToken', sessionToken, {
        httpOnly: true,
        secure: cookieSecure,
        sameSite: cookieSameSite,
        path: '/',
        maxAge: 24 * 60 * 60 * 1000 // 24 hours
      });
      res.cookie('csrfToken', csrfToken, {
        httpOnly: false, // Accessible to JS for header
        secure: cookieSecure,
        sameSite: cookieSameSite,
        path: '/',
        maxAge: 24 * 60 * 60 * 1000 // 24 hours
      });

      // Return user data without password
      res.json(sanitizeUser(user));
    } catch (error) {
      console.error("Login error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Client routes with role-based access control
  app.get("/api/clients", requireAuth, blockAccountant, async (req: AuthenticatedRequest, res) => {
    try {
      if (!req.user) {
        return res.status(401).json({ message: "Authentication required" });
      }

      const {
        page = "1",
        pageSize = "25",
        search,
        status,
        stage,
        therapistId,
        clientType,
        hasPortalAccess,
        hasPendingTasks,
        hasNoSessions,
        needsFollowUp,
        unassigned,
        checklistTemplateId,
        checklistItemIds,
        sortBy = "createdAt",
        sortOrder = "desc"
      } = req.query;

      const params = {
        page: parseInt(page as string),
        pageSize: parseInt(pageSize as string),
        search: search as string,
        status: status as string,
        stage: stage as string,
        therapistId: therapistId ? parseInt(therapistId as string) : undefined,
        clientType: clientType as string,
        hasPortalAccess: hasPortalAccess === "true" ? true : hasPortalAccess === "false" ? false : undefined,
        hasPendingTasks: hasPendingTasks === "true" ? true : hasPendingTasks === "false" ? false : undefined,
        hasNoSessions: hasNoSessions === "true" ? true : hasNoSessions === "false" ? false : undefined,
        needsFollowUp: needsFollowUp === "true" ? true : needsFollowUp === "false" ? false : undefined,
        unassigned: unassigned === "true" ? true : unassigned === "false" ? false : undefined,
        checklistTemplateId: checklistTemplateId ? parseInt(checklistTemplateId as string) : undefined,
        checklistItemIds: checklistItemIds ? (Array.isArray(checklistItemIds) ? checklistItemIds.map(id => parseInt(id as string)) : [parseInt(checklistItemIds as string)]) : undefined,
        sortBy: sortBy as string,
        sortOrder: sortOrder as "asc" | "desc"
      };

      // SECURITY: Use authenticated user's role and ID from session, NOT from query params
      if (req.user.role === "supervisor") {
        // Get therapists supervised by this supervisor
        const supervisorAssignments = await storage.getSupervisorAssignments(req.user.id);
        const supervisedTherapistIds = supervisorAssignments.map(assignment => assignment.therapistId);
        
        if (supervisedTherapistIds.length === 0) {
          // Supervisor has no assigned therapists, return empty result
          return res.json({ clients: [], totalCount: 0, page: 1, pageSize: 25, totalPages: 0 });
        }
        
        // Filter clients to only those assigned to supervised therapists
        (params as any).supervisedTherapistIds = supervisedTherapistIds;
      } else if (req.user.role === "therapist") {
        // Therapists can only see their own clients
        params.therapistId = req.user.id;
      }
      // Admins can see all clients (no filtering needed)

      const result = await storage.getClients(params);
      res.json(result);
    } catch (error) {

      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Client stats - moved before the :id route to avoid conflicts
  app.get("/api/clients/stats", requireAuth, blockAccountant, async (req: AuthenticatedRequest, res) => {
    try {
      if (!req.user) {
        return res.status(401).json({ message: "Authentication required" });
      }
      
      // Role-based filtering for stats
      let therapistId: number | undefined;
      let supervisedTherapistIds: number[] | undefined;
      
      // SECURITY: Use authenticated user's role and ID from session, NOT from query params
      if (req.user.role === "therapist") {
        // Therapists can only see stats for their own clients
        therapistId = req.user.id;
      } else if (req.user.role === "supervisor") {
        // Supervisors can only see stats for their supervised therapists' clients
        const supervisorAssignments = await storage.getSupervisorAssignments(req.user.id);
        supervisedTherapistIds = supervisorAssignments.map(assignment => assignment.therapistId);
        
        if (supervisedTherapistIds.length === 0) {
          return res.json({ totalClients: 0, activeClients: 0, pendingClients: 0, completedClients: 0 });
        }
      }
      // Admins can see all stats (no filtering needed)
      
      const stats = await storage.getClientStats(therapistId, supervisedTherapistIds);
      res.json(stats);
    } catch (error) {
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Client export endpoint - moved before the :id route to avoid conflicts  
  app.get("/api/clients/export", requireAuth, blockAccountant, async (req: AuthenticatedRequest, res) => {
    const { ipAddress, userAgent } = getRequestInfo(req);
    
    if (!req.user) {
      return res.status(401).json({ message: "Authentication required" });
    }
    
    // Log data export (critical HIPAA activity)
    await AuditLogger.logDataExport(
      req.user.id,
      req.user.username,
      'client_export',
      [], // No specific clients
      ipAddress,
      userAgent,
      { export_type: 'clients_csv', timestamp: new Date() }
    );
    try {
      const allClients = await storage.getAllClientsForExport();
      
      // Set CSV headers
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename="clients_export.csv"');
      
      // Create CSV header
      const csvHeader = [
        'Client ID', 'Full Name', 'Email', 'Phone', 'Date of Birth', 'Gender',
        'Address', 'Postal Code', 'Emergency Contact', 'Emergency Contact Phone',
        'Status', 'Stage', 'Client Type', 'Start Date', 'Assigned Therapist',
        'Insurance Provider', 'Policy Number', 'Copay Amount', 'Deductible',
        'Referral Source', 'Referral Date', 'Reference Number', 'Has Portal Access',
        'Email Notifications', 'Created At'
      ].join(',') + '\n';
      
      // Create CSV rows
      const csvRows = allClients.map(client => [
        client.clientId || '',
        `"${client.fullName || ''}"`,
        client.email || '',
        client.phone || '',
        client.dateOfBirth || '',
        client.gender || '',
        `"${client.address || ''}"`,
        client.postalCode || '',
        `"${client.emergencyContactName || ''}"`,
        client.emergencyContactPhone || '',
        client.status || '',
        client.stage || '',
        client.clientType || '',
        client.startDate || '',
        client.assignedTherapist || '',
        client.insuranceProvider || '',
        client.policyNumber || '',
        client.copayAmount || '',
        client.deductible || '',
        client.referralSource || '',
        client.referralDate || '',
        client.referenceNumber || '',
        client.hasPortalAccess ? 'true' : 'false',
        client.emailNotifications ? 'true' : 'false',
        client.createdAt ? new Date(client.createdAt).toISOString().split('T')[0] : ''
      ].join(','));
      
      const csvContent = csvHeader + csvRows.join('\n');
      res.send(csvContent);
    } catch (error) {
      res.status(500).json({ message: "Failed to export clients" });
    }
  });

  // Helper function to determine which client to keep based on scoring
  function determineWhichToKeep(client1: any, client2: any) {
    let score1 = 0;
    let score2 = 0;
    let keepClient = client1;
    let deleteClient = client2;
    const reasons: string[] = [];

    // Session count (40 points max)
    const sessionDiff = client1.sessionCount - client2.sessionCount;
    if (sessionDiff > 0) {
      score1 += Math.min(40, sessionDiff * 2);
      reasons.push(`${client1.sessionCount} sessions vs ${client2.sessionCount}`);
    } else if (sessionDiff < 0) {
      score2 += Math.min(40, Math.abs(sessionDiff) * 2);
    }

    // Document count (30 points max)
    const docDiff = client1.documentCount - client2.documentCount;
    if (docDiff > 0) {
      score1 += Math.min(30, docDiff * 3);
      if (client1.documentCount > 0) {
        reasons.push(`${client1.documentCount} documents vs ${client2.documentCount}`);
      }
    } else if (docDiff < 0) {
      score2 += Math.min(30, Math.abs(docDiff) * 3);
    }

    // Billing records (20 points max)
    const billingDiff = client1.billingCount - client2.billingCount;
    if (billingDiff > 0) {
      score1 += Math.min(20, billingDiff * 4);
      if (client1.billingCount > 0) {
        reasons.push(`${client1.billingCount} billing records vs ${client2.billingCount}`);
      }
    } else if (billingDiff < 0) {
      score2 += Math.min(20, Math.abs(billingDiff) * 4);
    }

    // Profile age (10 points for older)
    const age1 = new Date(client1.createdAt).getTime();
    const age2 = new Date(client2.createdAt).getTime();
    if (age1 < age2) {
      score1 += 10;
      reasons.push('Older profile');
    } else if (age2 < age1) {
      score2 += 10;
    }

    // Last activity (10 points for more recent)
    const lastDate1 = client1.lastSessionDate ? new Date(client1.lastSessionDate) : null;
    const lastDate2 = client2.lastSessionDate ? new Date(client2.lastSessionDate) : null;
    if (lastDate1 && lastDate2) {
      if (lastDate1 > lastDate2) {
        score1 += 10;
        reasons.push(`More recent activity (${lastDate1.toLocaleDateString()})`);
      } else if (lastDate2 > lastDate1) {
        score2 += 10;
      }
    } else if (client1.lastSessionDate) {
      score1 += 10;
      reasons.push('Has session history');
    } else if (client2.lastSessionDate) {
      score2 += 10;
    }

    // Determine which to keep
    if (score2 > score1) {
      keepClient = client2;
      deleteClient = client1;
    }

    return {
      keepClientId: keepClient.id,
      deleteClientId: deleteClient.id,
      reasons: reasons.length > 0 ? reasons : ['Both records similar - choose based on preference']
    };
  }

  // Duplicate Detection API endpoints
  app.get("/api/clients/duplicates", requireAuth, blockAccountant, async (req: AuthenticatedRequest, res) => {
    try {
      if (!req.user) {
        return res.status(401).json({ message: "Authentication required" });
      }
      
      // Only admin and supervisor can access duplicate detection
      if (req.user.role !== 'admin' && req.user.role !== 'administrator' && req.user.role !== 'supervisor') {
        return res.status(403).json({ message: "Access denied" });
      }

      // Get all clients that are not marked as duplicate
      const basicClients = await db.select().from(clients).where(eq(clients.isDuplicate, false));
      
      // Get all client IDs for bulk querying
      const clientIds = basicClients.map(c => c.id);
      
      // Bulk query: Get session counts for all clients
      const sessionCounts = await db
        .select({
          clientId: sessions.clientId,
          count: count()
        })
        .from(sessions)
        .where(inArray(sessions.clientId, clientIds))
        .groupBy(sessions.clientId);
      
      // Bulk query: Get document counts for all clients
      const documentCounts = await db
        .select({
          clientId: documents.clientId,
          count: count()
        })
        .from(documents)
        .where(inArray(documents.clientId, clientIds))
        .groupBy(documents.clientId);
      
      // Bulk query: Get billing counts for all clients (via sessions JOIN)
      const billingCounts = await db
        .select({
          clientId: sessions.clientId,
          count: count()
        })
        .from(sessionBilling)
        .innerJoin(sessions, eq(sessionBilling.sessionId, sessions.id))
        .where(inArray(sessions.clientId, clientIds))
        .groupBy(sessions.clientId);
      
      // Bulk query: Get last session dates for all clients
      const lastSessionDates = await db
        .select({
          clientId: sessions.clientId,
          lastDate: sql<Date>`MAX(${sessions.sessionDate})`
        })
        .from(sessions)
        .where(inArray(sessions.clientId, clientIds))
        .groupBy(sessions.clientId);
      
      // Create lookup maps for O(1) access
      const sessionCountMap = new Map(sessionCounts.map(r => [r.clientId, Number(r.count)]));
      const documentCountMap = new Map(documentCounts.map(r => [r.clientId, Number(r.count)]));
      const billingCountMap = new Map(billingCounts.map(r => [r.clientId, Number(r.count)]));
      const lastSessionMap = new Map(lastSessionDates.map(r => [r.clientId, r.lastDate]));
      
      // Enrich client data using the lookup maps
      type EnrichedClient = typeof basicClients[0] & {
        sessionCount: number;
        documentCount: number;
        billingCount: number;
        lastSessionDate: Date | null;
      };
      
      const allClientsData: EnrichedClient[] = basicClients.map(client => ({
        ...client,
        sessionCount: sessionCountMap.get(client.id) || 0,
        documentCount: documentCountMap.get(client.id) || 0,
        billingCount: billingCountMap.get(client.id) || 0,
        lastSessionDate: lastSessionMap.get(client.id) || null
      }));
      
      // Find potential duplicates with multiple confidence levels
      const duplicateGroups: Array<{
        clients: any[];
        confidenceLevel: 'high' | 'medium';
        confidenceScore: number;
        matchType: string;
        recommendation?: {
          keepClientId: number;
          deleteClientId: number;
          reasons: string[];
        };
      }> = [];
      
      const processedPairs = new Set<string>();
      
      for (let i = 0; i < allClientsData.length; i++) {
        for (let j = i + 1; j < allClientsData.length; j++) {
          const client1 = allClientsData[i];
          const client2 = allClientsData[j];
          
          const pairKey = [client1.id, client2.id].sort().join('-');
          if (processedPairs.has(pairKey)) continue;
          
          const name1 = client1.fullName?.toLowerCase().trim() || '';
          const name2 = client2.fullName?.toLowerCase().trim() || '';
          const phone1 = client1.phone?.replace(/\D/g, '') || '';
          const phone2 = client2.phone?.replace(/\D/g, '') || '';
          const email1 = client1.email?.toLowerCase().trim() || '';
          const email2 = client2.email?.toLowerCase().trim() || '';
          
          let isDuplicate = false;
          let confidenceLevel: 'high' | 'medium' = 'medium';
          let confidenceScore = 0;
          let matchType = '';
          
          // High confidence: Matching name AND (phone OR email)
          if (name1 && name2 && name1 === name2) {
            if ((phone1 && phone2 && phone1 === phone2) || (email1 && email2 && email1 === email2)) {
              isDuplicate = true;
              confidenceLevel = 'high';
              confidenceScore = 99;
              matchType = 'Name + Contact';
            }
          }
          
          // Medium confidence: Same phone OR same email (without matching names)
          if (!isDuplicate) {
            if (phone1 && phone2 && phone1 === phone2 && phone1.length >= 10) {
              isDuplicate = true;
              confidenceLevel = 'medium';
              confidenceScore = 85;
              matchType = 'Phone Match';
            } else if (email1 && email2 && email1 === email2) {
              isDuplicate = true;
              confidenceLevel = 'medium';
              confidenceScore = 85;
              matchType = 'Email Match';
            }
          }
          
          if (isDuplicate) {
            processedPairs.add(pairKey);
            
            const recommendation = determineWhichToKeep(client1, client2);
            
            duplicateGroups.push({
              clients: [client1, client2],
              confidenceLevel,
              confidenceScore,
              matchType,
              recommendation
            });
          }
        }
      }
      
      res.json({ duplicateGroups });
    } catch (error) {
      console.error('Duplicate detection error:', error);
      res.status(500).json({ message: "Failed to detect duplicates" });
    }
  });

  // Unmark duplicate endpoint
  app.post("/api/clients/:id/unmark-duplicate", requireAuth, blockAccountant, async (req: AuthenticatedRequest, res) => {
    try {
      if (!req.user) {
        return res.status(401).json({ message: "Authentication required" });
      }
      
      // Only admin and supervisor can unmark duplicates
      if (req.user.role !== 'admin' && req.user.role !== 'administrator' && req.user.role !== 'supervisor') {
        return res.status(403).json({ message: "Access denied" });
      }

      const id = parseInt(req.params.id);
      
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid client ID" });
      }

      // Update client to unmark as duplicate
      await storage.updateClient(id, { isDuplicate: false });
      
      res.json({ message: "Client unmarked as duplicate successfully" });
    } catch (error) {
      console.error('Unmark duplicate error:', error);
      res.status(500).json({ message: "Failed to unmark duplicate" });
    }
  });

  app.get("/api/clients/:id", requireAuth, blockAccountant, auditClientAccess('client_viewed'), async (req: AuthenticatedRequest, res) => {
    try {
      const id = parseInt(req.params.id);
      
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid client ID" });
      }
      
      const client = await storage.getClient(id);
      
      if (!client) {
        return res.status(404).json({ message: "Client not found" });
      }
      
      // Role-based authorization: therapists can only view their assigned clients
      if (req.user && req.user.role === 'therapist') {
        if (client.assignedTherapistId !== req.user.id) {
          return res.status(403).json({ message: "Access denied. You can only view your assigned clients." });
        }
      } else if (req.user && req.user.role === 'supervisor') {
        // Supervisors can only view clients of therapists they supervise
        const supervisorAssignments = await storage.getSupervisorAssignments(req.user.id);
        const supervisedTherapistIds = supervisorAssignments.map(a => a.therapistId);
        if (client.assignedTherapistId && !supervisedTherapistIds.includes(client.assignedTherapistId)) {
          return res.status(403).json({ message: "Access denied. You can only view clients of therapists you supervise." });
        }
      }
      // Administrators can view all clients (no restriction)

      // "New" badge tracking: stamp firstViewedByTherapistAt the first time
      // the currently-assigned therapist opens the profile. Supervisors and
      // admins viewing the file do NOT consume the badge — only the
      // assigned therapist's own view counts.
      if (
        req.user &&
        client.assignedTherapistId === req.user.id &&
        !client.firstViewedByTherapistAt
      ) {
        try {
          const now = new Date();
          await storage.updateClient(client.id, { firstViewedByTherapistAt: now } as any);
          (client as any).firstViewedByTherapistAt = now;
        } catch (e) {
          console.error('[NewBadge] Failed to stamp firstViewedByTherapistAt:', e);
        }
      }

      res.json(client);
    } catch (error) {
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post("/api/clients", requireAuth, blockAccountant, auditClientAccess('client_created'), async (req: AuthenticatedRequest, res) => {
    try {
      const clientData = { ...req.body };
      delete clientData.id; // Remove any id field if present
      
      // Clean up empty strings to undefined to prevent PostgreSQL date errors
      Object.keys(clientData).forEach(key => {
        if (clientData[key] === "" || clientData[key] === null) {
          clientData[key] = undefined;
        }
      });
      
      const validatedData = insertClientSchema.parse(clientData);
      
      const client = await storage.createClient(validatedData);
      
      // Track file creation in history
      await trackClientHistory({
        clientId: client.id,
        eventType: 'file_created',
        description: 'Client file created',
        fromValue: null,
        toValue: client.stage || 'intake',
        createdBy: req.user?.id
      });
      
      // Handle portal access activation if enabled during creation
      console.log(`[PORTAL] Client ${client.id} created - checking portal access:`, {
        hasPortalAccess: client.hasPortalAccess,
        email: client.email || null,
        portalEmail: client.portalEmail || null,
        hasEmail: !!(client.email || client.portalEmail)
      });
      
      if (client.hasPortalAccess && 
          (client.email || client.portalEmail)) {
        // Portal access was enabled during creation - generate activation token and send email
        try {
          const activationToken = crypto.randomBytes(32).toString('hex');
          const emailToUse = client.portalEmail || client.email!;
          
          // Update client with activation token
          await storage.updateClient(client.id, { activationToken });
          
          // Send activation email
          await sendActivationEmail(emailToUse, client.fullName, activationToken, getBaseUrl(req));
          
          console.log(`[PORTAL] Activation email sent to ${emailToUse} for client ${client.fullName} (during creation)`);
          
          // Track portal activation in history
          await trackClientHistory({
            clientId: client.id,
            eventType: 'portal_activated',
            fromValue: 'disabled',
            toValue: 'activation_sent',
            description: `Portal access enabled during creation. Activation email sent to ${emailToUse}`,
            createdBy: req.user?.id,
            createdByName: req.user?.username,
          });
        } catch (activationError) {
          console.error('[PORTAL] Failed to send activation email during client creation:', activationError);
        }
      }

      // Trigger client created notification
      try {
        await notificationService.processEvent('client_created', {
          id: client.id,
          clientName: client.fullName,
          fullName: client.fullName,
          assignedTherapistId: client.assignedTherapistId,
          // Always use the human-readable case ID (e.g. CL-2026-0184) for
          // emails. The optional referenceNumber field is internal-only.
          clientCaseId: client.clientId,
          referenceNumber: client.referenceNumber || client.clientId,
          stage: client.stage || 'initial',
          createdAt: client.createdAt
        });
      } catch (notificationError) {
        console.error('Client created notification failed:', notificationError);
      }

      // Also fire client_assigned when the new client already has a
      // therapist set at creation time, so the assigned therapist gets
      // the proper named "Client Assigned" email (not just the generic
      // intake notice).
      if (client.assignedTherapistId) {
        try {
          const assignedTherapist = await storage.getUser(client.assignedTherapistId);
          await notificationService.processEvent('client_assigned', {
            id: client.id,
            clientName: client.fullName,
            fullName: client.fullName,
            clientId: client.id,
            // The recipient calculator looks up the assigned therapist via
            // `therapistId`/`assignedToId`. Provide both so the email
            // actually reaches the therapist.
            therapistId: client.assignedTherapistId,
            assignedToId: client.assignedTherapistId,
            therapistName: assignedTherapist?.fullName || 'Unknown Therapist',
            assignedTherapist: assignedTherapist?.fullName || 'Unknown Therapist',
            assignedTherapistId: client.assignedTherapistId,
            clientCaseId: client.clientId,
            referenceNumber: client.referenceNumber || client.clientId,
            assignmentDate: new Date(),
            priority: 'medium',
            previousTherapistId: null,
          });
        } catch (notificationError) {
          console.error('Client assigned-on-create notification failed:', notificationError);
        }
      }

      res.status(201).json(client);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid client data", errors: error.errors });
      }
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.put("/api/clients/:id", requireAuth, blockAccountant, auditClientAccess('client_updated'), async (req: AuthenticatedRequest, res) => {
    try {
      if (!req.user) {
        return res.status(401).json({ message: "Authentication required" });
      }

      const id = parseInt(req.params.id);
      
      // Get original client data to check for therapist assignment changes
      const originalClient = await storage.getClient(id);
      if (!originalClient) {
        return res.status(404).json({ message: "Client not found" });
      }
      
      const clientData = { ...req.body };
      
      // SECURITY: Only administrators can change therapist assignments
      // Prevent therapists from stealing/reassigning clients
      if (req.user.role !== 'administrator' && req.user.role !== 'admin') {
        // Remove assignedTherapistId from update data for non-admins
        delete clientData.assignedTherapistId;
      }
      
      // Clean up empty strings to undefined to prevent PostgreSQL date errors
      Object.keys(clientData).forEach(key => {
        if (clientData[key] === "" || clientData[key] === null) {
          clientData[key] = undefined;
        }
      });
      
      const validatedData = insertClientSchema.partial().parse(clientData);
      
      // AUTO-UPDATE: When closing a file (status = 'inactive'), automatically set stage to 'closed'
      if (validatedData.status === 'inactive' && !validatedData.stage) {
        validatedData.stage = 'closed';
      }
      
      // SYNC PORTAL EMAIL: If client has portal access and email is being updated,
      // also update the portalEmail to keep login credentials in sync
      if (validatedData.email && originalClient.hasPortalAccess && originalClient.portalEmail) {
        // Only sync if the original portalEmail matched the old email (i.e., they were using their main email for portal)
        if (originalClient.portalEmail === originalClient.email) {
          (validatedData as any).portalEmail = validatedData.email;
          console.log(`[PORTAL_SYNC] Syncing portalEmail for client ${id}: ${originalClient.portalEmail} -> ${validatedData.email}`);
        }
      }
      
      const client = await storage.updateClient(id, validatedData);
      
      // Track client history for important changes
      
      // 1. Track status changes (active/inactive)
      if (validatedData.status && validatedData.status !== originalClient.status) {
        await trackClientHistory({
          clientId: client.id,
          eventType: validatedData.status === 'inactive' ? 'file_closed' : 'file_reopened',
          fromValue: originalClient.status || 'unknown',
          toValue: validatedData.status,
          description: validatedData.status === 'inactive' 
            ? 'Client file closed and set to inactive' 
            : 'Client file reopened and reactivated',
          createdBy: req.user.id,
          createdByName: req.user.username,
        });
      }
      
      // 2. Track stage changes
      if (validatedData.stage && validatedData.stage !== originalClient.stage) {
        await trackClientHistory({
          clientId: client.id,
          eventType: 'stage_change',
          fromValue: originalClient.stage || 'none',
          toValue: validatedData.stage,
          description: `Client stage changed from ${originalClient.stage || 'none'} to ${validatedData.stage}`,
          createdBy: req.user.id,
          createdByName: req.user.username,
        });
      }
      
      // 3. Track therapist assignment changes
      if (validatedData.assignedTherapistId && 
          validatedData.assignedTherapistId !== originalClient.assignedTherapistId) {
        // Reset the "New" badge stamp so the newly-assigned therapist sees
        // the badge until they open the profile themselves.
        try {
          await storage.updateClient(client.id, { firstViewedByTherapistAt: null } as any);
          (client as any).firstViewedByTherapistAt = null;
        } catch (e) {
          console.error('[NewBadge] Failed to reset firstViewedByTherapistAt on reassignment:', e);
        }

        // Trigger client assigned notification
        try {
          const assignedTherapist = await storage.getUser(client.assignedTherapistId!);
          const previousTherapist = originalClient.assignedTherapistId 
            ? await storage.getUser(originalClient.assignedTherapistId) 
            : null;
          
          await notificationService.processEvent('client_assigned', {
            id: client.id,
            clientName: client.fullName,
            fullName: client.fullName,
            clientId: client.id,
            // Required so the recipient calculator selects the therapist.
            therapistId: client.assignedTherapistId,
            assignedToId: client.assignedTherapistId,
            therapistName: assignedTherapist?.fullName || 'Unknown Therapist',
            assignedTherapist: assignedTherapist?.fullName || 'Unknown Therapist',
            assignedTherapistId: client.assignedTherapistId,
            clientCaseId: client.clientId,
            referenceNumber: client.referenceNumber || client.clientId,
            assignmentDate: new Date(),
            priority: 'medium',
            previousTherapistId: originalClient.assignedTherapistId
          });
          
          // Track therapist assignment in history
          await trackClientHistory({
            clientId: client.id,
            eventType: 'therapist_assignment',
            fromValue: previousTherapist?.fullName || 'Unassigned',
            toValue: assignedTherapist?.fullName || 'Unknown',
            description: `Therapist assignment changed from ${previousTherapist?.fullName || 'Unassigned'} to ${assignedTherapist?.fullName}`,
            createdBy: req.user.id,
            createdByName: req.user.username,
          });
        } catch (notificationError) {
          console.error('Client assigned notification failed:', notificationError);
        }
      }
      
      // 4. Handle portal access activation
      if (validatedData.hasPortalAccess && 
          !originalClient.hasPortalAccess && 
          (client.email || client.portalEmail) && 
          !client.portalPassword) {
        // Portal access was just enabled - generate activation token and send email
        try {
          const activationToken = crypto.randomBytes(32).toString('hex');
          const emailToUse = client.portalEmail || client.email!;
          
          // Update client with activation token
          await storage.updateClient(client.id, { activationToken });
          
          // Send activation email
          await sendActivationEmail(emailToUse, client.fullName, activationToken, getBaseUrl(req));
          
          console.log(`[PORTAL] Activation email sent to ${emailToUse} for client ${client.fullName}`);
                    // Track portal activation in history
          await trackClientHistory({
            clientId: client.id,
            eventType: 'portal_activated',
            fromValue: 'disabled',
            toValue: 'activation_sent',
            description: `Portal access enabled. Activation email sent to ${emailToUse}`,
            createdBy: req.user.id,
            createdByName: req.user.username,
          });
        } catch (activationError) {
          console.error('[PORTAL] Failed to send activation email:', activationError);
        }
      }
      
      res.json(client);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid client data", errors: error.errors });
      }
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.delete("/api/clients/:id", requireAuth, blockAccountant, async (req: AuthenticatedRequest, res) => {
    const { ipAddress, userAgent } = getRequestInfo(req);
    const clientId = parseInt(req.params.id);
    
    if (!req.user) {
      return res.status(401).json({ message: "Authentication required" });
    }
    
    // Log client deletion (high risk activity)
    await AuditLogger.logClientAccess(
      req.user.id, req.user.username, clientId, 'client_deleted',
      ipAddress, userAgent, { deleted_at: new Date() }
    );
    try {
      const id = parseInt(req.params.id);
      
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid client ID" });
      }
      
      await storage.deleteClient(id);
      res.status(204).send();
    } catch (error: any) {

      res.status(500).json({ 
        message: "Failed to delete client. Client may have related records (sessions, tasks, documents, etc.)",
        details: error.message 
      });
    }
  });

  // Staff-recorded GDPR/AI Consent (paper / in-clinic consent form pathway)

  // GET current consents for a client (admin/therapist view)
  app.get("/api/clients/:id/consents", requireAuth, blockAccountant, async (req: AuthenticatedRequest, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid client ID" });
      const consents = await storage.getClientConsents(id);
      res.json(consents);
    } catch (error: any) {
      console.error("Error fetching client consents:", error);
      res.status(500).json({ message: "Failed to fetch consents", details: error.message });
    }
  });

  // POST a staff-recorded consent (e.g., from a signed paper consent form)
  app.post("/api/clients/:id/consents", requireAuth, blockAccountant, async (req: AuthenticatedRequest, res) => {
    const { ipAddress, userAgent } = getRequestInfo(req);
    try {
      if (!req.user) return res.status(401).json({ message: "Authentication required" });

      const clientId = parseInt(req.params.id);
      if (isNaN(clientId)) return res.status(400).json({ message: "Invalid client ID" });

      const { consentType, granted, consentVersion, notes, source } = req.body as {
        consentType?: string;
        granted?: boolean;
        consentVersion?: string;
        notes?: string;
        source?: string;
      };

      if (!consentType || typeof granted !== "boolean") {
        return res.status(400).json({ message: "consentType and granted (boolean) are required" });
      }

      const client = await storage.getClient(clientId);
      if (!client) return res.status(404).json({ message: "Client not found" });

      const recordedSource = source || "signed_consent_form";
      const action = granted ? "granted" : "withdrawn";
      const noteText = notes && notes.trim().length > 0
        ? notes.trim()
        : `Consent ${action} on behalf of client by ${req.user.username} (source: ${recordedSource})`;

      const consent = await storage.createClientConsent({
        clientId,
        consentType,
        granted,
        consentVersion: consentVersion || "1.0.0",
        ipAddress: ipAddress || "",
        userAgent: userAgent || "",
        notes: noteText,
      });

      await AuditLogger.logAction({
        userId: req.user.id,
        username: req.user.username,
        action: granted ? "consent_granted" : "consent_withdrawn",
        result: "success",
        resourceType: "patient_consent",
        resourceId: consent.id.toString(),
        clientId,
        ipAddress: ipAddress || "",
        userAgent: userAgent || "",
        hipaaRelevant: true,
        riskLevel: "high",
        details: JSON.stringify({
          consentType,
          granted,
          withdrawn: !granted,
          consentVersion: consent.consentVersion,
          consentId: consent.id,
          source: recordedSource,
          recordedByStaff: true,
          recordedByUserId: req.user.id,
          recordedByUsername: req.user.username,
        }),
        accessReason: "Staff recorded GDPR consent on behalf of client (signed consent form)",
      });

      res.json(consent);
    } catch (error: any) {
      console.error("Error recording staff consent:", error);
      res.status(500).json({ message: "Failed to record consent", details: error.message });
    }
  });


  // Portal Access Management Endpoints
  
  // PUT /api/clients/:id/portal-access - Enable/disable portal access
  app.put("/api/clients/:id/portal-access", requireAuth, blockAccountant, async (req: AuthenticatedRequest, res) => {
    try {
      if (!req.user) {
        return res.status(401).json({ message: "Authentication required" });
      }

      const id = parseInt(req.params.id);
      const { enable, email } = req.body;

      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid client ID" });
      }

      const client = await storage.getClient(id);
      if (!client) {
        return res.status(404).json({ message: "Client not found" });
      }

      if (enable && !email) {
        return res.status(400).json({ message: "Email address required to enable portal access" });
      }

      // Update portal access
      const updateData: any = {
        hasPortalAccess: enable,
      };

      if (enable) {
        updateData.portalEmail = email;
        
        // Generate activation token
        const activationToken = crypto.randomBytes(32).toString('hex');
        updateData.activationToken = activationToken;

        // Update client
        await storage.updateClient(id, updateData);

        // Send activation email
        try {
          await sendActivationEmail(email, client.fullName, activationToken, getBaseUrl(req));
          console.log(`[PORTAL] Activation email sent to ${email} for client ${client.fullName}`);

          // Track portal activation in history
          await trackClientHistory({
            clientId: id,
            eventType: 'portal_activated',
            fromValue: 'disabled',
            toValue: 'enabled',
            description: `Portal access enabled. Activation email sent to ${email}`,
            createdBy: req.user.id,
            createdByName: req.user.username,
          });

          res.json({ message: "Portal access enabled and activation email sent", activationSent: true });
        } catch (emailError) {
          console.error('[PORTAL] Failed to send activation email:', emailError);
          res.json({ message: "Portal access enabled but activation email failed to send", activationSent: false });
        }
      } else {
        // Disable portal access
        updateData.activationToken = null;
        updateData.passwordResetToken = null;

        await storage.updateClient(id, updateData);

        // Track portal deactivation in history
        await trackClientHistory({
          clientId: id,
          eventType: 'portal_deactivated',
          fromValue: 'enabled',
          toValue: 'disabled',
          description: 'Portal access disabled',
          createdBy: req.user.id,
          createdByName: req.user.username,
        });

        res.json({ message: "Portal access disabled" });
      }
    } catch (error) {
      console.error('[PORTAL] Portal access toggle error:', error);
      res.status(500).json({ message: "Failed to update portal access" });
    }
  });

  // POST /api/clients/:id/send-portal-activation - Resend activation email
  app.post("/api/clients/:id/send-portal-activation", requireAuth, blockAccountant, async (req: AuthenticatedRequest, res) => {
    try {
      if (!req.user) {
        return res.status(401).json({ message: "Authentication required" });
      }

      const id = parseInt(req.params.id);

      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid client ID" });
      }

      const client = await storage.getClient(id);
      if (!client) {
        return res.status(404).json({ message: "Client not found" });
      }

      if (!client.hasPortalAccess) {
        return res.status(400).json({ message: "Portal access is not enabled for this client" });
      }

      if (!client.portalEmail && !client.email) {
        return res.status(400).json({ message: "No email address on file for this client" });
      }

      const email = client.portalEmail || client.email!;

      // Generate new activation token
      const activationToken = crypto.randomBytes(32).toString('hex');
      await storage.updateClient(id, { activationToken });

      // Send activation email
      try {
        await sendActivationEmail(email, client.fullName, activationToken, getBaseUrl(req));
        console.log(`[PORTAL] Activation email resent to ${email} for client ${client.fullName}`);

        // Track in history
        await trackClientHistory({
          clientId: id,
          eventType: 'portal_activation_resent',
          fromValue: '',
          toValue: '',
          description: `Portal activation email resent to ${email}`,
          createdBy: req.user.id,
          createdByName: req.user.username,
        });

        res.json({ message: "Activation email sent successfully", email });
      } catch (emailError) {
        console.error('[PORTAL] Failed to send activation email:', emailError);
        res.status(500).json({ message: "Failed to send activation email" });
      }
    } catch (error) {
      console.error('[PORTAL] Send activation error:', error);
      res.status(500).json({ message: "Failed to send activation email" });
    }
  });

  // Client History Endpoints
  
  // GET /api/clients/:id/history - Fetch client history timeline
  app.get("/api/clients/:id/history", requireAuth, blockAccountant, async (req: AuthenticatedRequest, res) => {
    try {
      const clientId = parseInt(req.params.id);
      
      if (isNaN(clientId)) {
        return res.status(400).json({ message: "Invalid client ID" });
      }
      
      // Fetch history events ordered by most recent first (truncated to second), then by ID ascending
      // This ensures events in the same second appear in chronological insertion order
      const history = await db
        .select()
        .from(clientHistory)
        .where(eq(clientHistory.clientId, clientId))
        .orderBy(
          desc(sql`date_trunc('second', ${clientHistory.createdAt})`),
          asc(clientHistory.id)
        );
      
      res.json(history);
    } catch (error) {
      console.error('Error fetching client history:', error);
      res.status(500).json({ message: "Failed to fetch client history" });
    }
  });
  
  // GET /api/clients/:id/stage-durations - Calculate time spent in each stage
  app.get("/api/clients/:id/stage-durations", requireAuth, blockAccountant, async (req: AuthenticatedRequest, res) => {
    try {
      const clientId = parseInt(req.params.id);
      
      if (isNaN(clientId)) {
        return res.status(400).json({ message: "Invalid client ID" });
      }
      
      // Get client info
      const client = await storage.getClient(clientId);
      if (!client) {
        return res.status(404).json({ message: "Client not found" });
      }
      
      // Get file creation event
      const [fileCreated] = await db
        .select()
        .from(clientHistory)
        .where(and(
          eq(clientHistory.clientId, clientId),
          eq(clientHistory.eventType, 'file_created')
        ))
        .limit(1);
      
      // Get all stage change events
      const stageChanges = await db
        .select()
        .from(clientHistory)
        .where(and(
          eq(clientHistory.clientId, clientId),
          eq(clientHistory.eventType, 'stage_change')
        ))
        .orderBy(clientHistory.createdAt);
      
      // Calculate durations
      const durations: { [key: string]: number } = {};
      
      // Start from file creation if available
      if (fileCreated) {
        const initialStage = fileCreated.toValue || 'intake';
        let currentStageStart = new Date(fileCreated.createdAt).getTime();
        let currentStage = initialStage;
        
        // Process each stage change
        for (const change of stageChanges) {
          // Calculate duration for the stage we're leaving
          const changeTime = new Date(change.createdAt).getTime();
          const durationMs = changeTime - currentStageStart;
          const durationDays = Math.floor(durationMs / (1000 * 60 * 60 * 24));
          
          if (currentStage && currentStage !== 'none') {
            durations[currentStage] = (durations[currentStage] || 0) + durationDays;
          }
          
          // Move to next stage
          currentStage = change.toValue || currentStage;
          currentStageStart = changeTime;
        }
        
        // Add duration for current stage (from last change or creation to now)
        if (currentStage) {
          const nowTime = Date.now();
          const durationMs = nowTime - currentStageStart;
          const durationDays = Math.floor(durationMs / (1000 * 60 * 60 * 24));
          durations[currentStage] = (durations[currentStage] || 0) + durationDays;
        }
      } else if (client.stage && client.startDate) {
        // Fallback: No history yet - calculate from start date to now
        const startTime = new Date(client.startDate).getTime();
        const nowTime = Date.now();
        const durationMs = nowTime - startTime;
        const durationDays = Math.floor(durationMs / (1000 * 60 * 60 * 24));
        durations[client.stage] = durationDays;
      } else if (client.stage && client.createdAt) {
        // Fallback: use createdAt if no startDate
        const startTime = new Date(client.createdAt).getTime();
        const nowTime = Date.now();
        const durationMs = nowTime - startTime;
        const durationDays = Math.floor(durationMs / (1000 * 60 * 60 * 24));
        durations[client.stage] = durationDays;
      }
      
      res.json({
        clientId,
        currentStage: client.stage,
        durations,
        totalEvents: stageChanges.length
      });
    } catch (error) {
      console.error('Error calculating stage durations:', error);
      res.status(500).json({ message: "Failed to calculate stage durations" });
    }
  });

  // Session bulk upload endpoint - OPTIMIZED VERSION
  app.post("/api/sessions/bulk-upload", requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const { sessions } = req.body;
      
      if (!Array.isArray(sessions)) {
        return res.status(400).json({ message: "Invalid input: sessions must be an array" });
      }

      const results = {
        total: sessions.length,
        successful: 0,
        failed: 0,
        errors: [] as any[]
      };

      // OPTIMIZATION: Pre-fetch all lookup data to avoid repeated database calls
      
      // Get all clients and create clientId -> client mapping
      const allClients = await storage.getAllClientsForExport();
      const clientLookup = new Map<string, any>();
      allClients.forEach((client: any) => {
        if (client.clientId) {
          clientLookup.set(client.clientId.trim(), client);
        }
      });
      
      // Get all users and create username -> user mapping for therapists
      const allUsers = await storage.getUsers();
      const therapistLookup = new Map<string, any>();
      allUsers.forEach((user: any) => {
        if (user.username) {
          therapistLookup.set(user.username.trim(), user);
        }
      });
      
      // Get all services and create code -> service mapping
      const allServices = await storage.getServices();
      const serviceLookup = new Map<string, any>();
      allServices.forEach((service: any) => {
        if (service.serviceCode) {
          serviceLookup.set(service.serviceCode.trim(), service);
        }
      });
      
      // Get all rooms and create number -> room mapping
      const allRooms = await storage.getRooms();
      const roomLookup = new Map<string, any>();
      allRooms.forEach((room: any) => {
        if (room.roomNumber) {
          roomLookup.set(room.roomNumber.trim(), room);
        }
      });
      
      
      // Process sessions in batches for better performance
      const BATCH_SIZE = 100;
      const validatedSessions = [];
      
      for (let i = 0; i < sessions.length; i++) {
        const sessionData = sessions[i];
        
        try {
          // Clean and prepare session data using cached lookups
          const cleanData: any = {};

          // Handle required fields - clean and normalize client ID
          if (!sessionData.clientId || sessionData.clientId.trim() === '') {
            throw new Error('Client ID is required');
          }
          
          // Clean client ID and lookup using cache
          const cleanClientId = sessionData.clientId.trim();
          const client = clientLookup.get(cleanClientId);
          if (!client) {
            throw new Error(`Client with ID '${cleanClientId}' not found`);
          }
          cleanData.clientId = client.id;

          // Handle therapist using cached lookup
          if (sessionData.therapistUsername && sessionData.therapistUsername.trim() !== '') {
            const therapist = therapistLookup.get(sessionData.therapistUsername.trim());
            if (!therapist) {
              throw new Error(`Therapist with username '${sessionData.therapistUsername}' not found`);
            }
            cleanData.therapistId = therapist.id;
          } else if (client.assignedTherapistId) {
            cleanData.therapistId = client.assignedTherapistId;
          } else {
            cleanData.therapistId = null;
          }

          // Handle date and time
          if (!sessionData.sessionDate) {
            throw new Error('Session date is required');
          }
          
          // Convert Excel serial date to proper date format with EST timezone
          let sessionDateTime;
          const rawDate = sessionData.sessionDate;
          const timeStr = sessionData.sessionTime && sessionData.sessionTime.trim() !== '' 
            ? (sessionData.sessionTime.includes(':') ? sessionData.sessionTime : `${sessionData.sessionTime}:00`)
            : '00:00';
          
          // Check if it's an Excel serial number (typically > 1000 for recent dates)
          if (typeof rawDate === 'number' && rawDate > 1000) {
            // Excel serial date conversion (days since January 1, 1900)
            const excelEpoch = new Date(1899, 11, 30); // December 30, 1899 (Excel day 0)
            const dateFromSerial = new Date(excelEpoch.getTime() + rawDate * 24 * 60 * 60 * 1000);
            const dateStr = dateFromSerial.toISOString().split('T')[0]; // YYYY-MM-DD
            sessionDateTime = convertESTToUTC(dateStr, timeStr);
          } else if (typeof rawDate === 'string') {
            // Handle string dates
            const cleanDate = rawDate.trim();
            let dateStr: string;
            
            // Convert to YYYY-MM-DD format
            if (/^\d{4}-\d{2}-\d{2}$/.test(cleanDate)) {
              dateStr = cleanDate;
            } else if (/^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(cleanDate)) {
              // MM/DD/YY or MM/DD/YYYY format
              const [month, day, year] = cleanDate.split('/');
              const fullYear = year.length === 2 ? (parseInt(year) < 50 ? `20${year}` : `19${year}`) : year;
              dateStr = `${fullYear}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
            } else {
              // Try parsing and converting to YYYY-MM-DD
              const parsed = new Date(cleanDate);
              if (isNaN(parsed.getTime())) {
                throw new Error(`Invalid date format: ${cleanDate}`);
              }
              dateStr = parsed.toISOString().split('T')[0];
            }
            
            sessionDateTime = convertESTToUTC(dateStr, timeStr);
          } else {
            throw new Error('Invalid session date format');
          }
          
          if (isNaN(sessionDateTime.getTime())) {
            throw new Error('Invalid session date and time');
          }
          
          cleanData.sessionDate = sessionDateTime;

          // Handle session type - normalize case
          if (!sessionData.sessionType) {
            throw new Error('Session type is required');
          }
          const cleanSessionType = sessionData.sessionType.trim().toLowerCase();
          const validSessionTypes = ['assessment', 'psychotherapy', 'consultation'];
          if (!validSessionTypes.includes(cleanSessionType)) {
            throw new Error(`Invalid session type '${sessionData.sessionType}'. Must be one of: assessment, psychotherapy, consultation`);
          }
          cleanData.sessionType = cleanSessionType;

          // Look up service using cached lookup
          if (!sessionData.serviceCode) {
            throw new Error('Service code is required');
          }
          const cleanServiceCode = sessionData.serviceCode.trim();
          const service = serviceLookup.get(cleanServiceCode);
          if (!service) {
            throw new Error(`Service code '${cleanServiceCode}' not found in services`);
          }
          cleanData.serviceId = service.id;
          cleanData.calculatedRate = service.baseRate || '0.00';

          // Look up room using cached lookup
          if (!sessionData.roomNumber) {
            throw new Error('Room number is required');
          }
          const room = roomLookup.get(sessionData.roomNumber.trim());
          if (!room) {
            throw new Error(`Room with number '${sessionData.roomNumber}' not found`);
          }
          cleanData.roomId = room.id;

          // Optional fields
          if (sessionData.notes) {
            cleanData.notes = sessionData.notes;
          }

          // Handle session mode (optional)
          if (sessionData.sessionMode && sessionData.sessionMode.trim() !== '') {
            const cleanSessionMode = sessionData.sessionMode.trim().toLowerCase().replace('-', '_');
            const validSessionModes = ['in_person', 'virtual', 'phone'];
            if (validSessionModes.includes(cleanSessionMode)) {
              cleanData.sessionMode = cleanSessionMode;
            } else {
              cleanData.sessionMode = 'in_person'; // Default if invalid
            }
          } else {
            cleanData.sessionMode = 'in_person'; // Default mode
          }

          // Handle session status
          if (sessionData.status && sessionData.status.trim() !== '') {
            const cleanStatus = sessionData.status.trim().toLowerCase();
            const validStatuses = ['scheduled', 'completed', 'cancelled', 'no_show', 'rescheduled'];
            if (validStatuses.includes(cleanStatus)) {
              cleanData.status = cleanStatus;
            } else {
              cleanData.status = 'scheduled'; // Default if invalid
            }
          } else {
            cleanData.status = 'scheduled'; // Default status
          }

          // Validate session data
          const validatedData = insertSessionSchema.parse(cleanData);
          validatedSessions.push({ data: validatedData, rowIndex: i });
          
        } catch (error) {
          results.failed++;
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';

          results.errors.push({
            row: i + 1,
            data: sessionData,
            message: errorMessage
          });
        }
      }
      
      // OPTIMIZATION: Bulk insert validated sessions in batches
      
      for (let batchStart = 0; batchStart < validatedSessions.length; batchStart += BATCH_SIZE) {
        const batchEnd = Math.min(batchStart + BATCH_SIZE, validatedSessions.length);
        const batch = validatedSessions.slice(batchStart, batchEnd);
        
        try {
          // Extract just the session data for bulk insert
          const sessionDataBatch = batch.map(item => item.data);
          await storage.createSessionsBulk(sessionDataBatch);
          results.successful += batch.length;
        } catch (error) {
          // If batch fails, try individual inserts to identify specific failures
          
          for (const item of batch) {
            try {
              await storage.createSession(item.data);
              results.successful++;
            } catch (individualError) {
              results.failed++;
              const errorMessage = individualError instanceof Error ? individualError.message : 'Unknown error';
              results.errors.push({
                row: item.rowIndex + 1,
                data: sessions[item.rowIndex],
                message: errorMessage
              });
            }
          }
        }
      }
      
      res.json(results);
    } catch (error: any) {
      res.status(500).json({ 
        message: "Session bulk upload failed", 
        details: error.message || "Internal server error" 
      });
    }
  });

  // Bulk upload endpoint
  app.post("/api/clients/bulk-upload", requireAuth, blockAccountant, async (req: AuthenticatedRequest, res) => {
    try {
      const { clients } = req.body;
      
      if (!Array.isArray(clients)) {
        return res.status(400).json({ message: "Invalid input: clients must be an array" });
      }

      const results = {
        total: clients.length,
        successful: 0,
        failed: 0,
        errors: [] as any[]
      };

      for (let i = 0; i < clients.length; i++) {
        const clientData = clients[i];
        
        try {
          // Clean and prepare client data - only keep non-empty values
          const cleanData: any = {
            // Required field
            fullName: clientData.fullName || '',
            // Generate unique client ID if not provided
            clientId: clientData.clientId || await generateClientId(),
          };

          // Only add fields that have actual values (not null, undefined, or empty strings)
          Object.keys(clientData).forEach(key => {
            if (key !== 'fullName' && key !== 'clientId' && clientData[key] != null && clientData[key] !== '') {
              let value = clientData[key];
              
              // Handle therapist assignment by username
              if (key === 'assignedTherapist') {
                // Look up therapist by username and get their ID
                // This will be handled after the loop
                cleanData['_therapistUsername'] = value;
              }
              // Handle gender field - convert uppercase to lowercase
              else if (key === 'gender') {
                const genderValue = String(value).toLowerCase();
                if (['male', 'female', 'non_binary', 'prefer_not_to_say'].includes(genderValue)) {
                  cleanData[key] = genderValue;
                }
              }
              // Handle string fields that might come as numbers from Excel
              else if (['phone', 'referenceNumber', 'emergencyContactPhone', 'postalCode', 'policyNumber'].includes(key)) {
                cleanData[key] = String(value);
              }
              // Handle date fields - convert Date objects, ISO strings, or Excel serial dates to YYYY-MM-DD format
              else if (['dateOfBirth', 'startDate', 'referralDate', 'lastSessionDate', 'nextAppointmentDate'].includes(key)) {
                if (value instanceof Date) {
                  cleanData[key] = value.toISOString().split('T')[0]; // Convert to YYYY-MM-DD format
                } else if (typeof value === 'string' && value.includes('T')) {
                  // Handle ISO date strings (like "2024-01-15T00:00:00.000Z")
                  cleanData[key] = new Date(value).toISOString().split('T')[0];
                } else if (typeof value === 'number' && value > 1) {
                  // Handle Excel serial date numbers (days since January 1, 1900)
                  // Excel considers 1900 as a leap year (which it wasn't), so we need to adjust
                  const excelEpoch = new Date(1900, 0, 1); // January 1, 1900
                  const adjustedDays = value > 59 ? value - 1 : value; // Adjust for Excel's leap year bug
                  const date = new Date(excelEpoch.getTime() + (adjustedDays - 1) * 24 * 60 * 60 * 1000);
                  cleanData[key] = date.toISOString().split('T')[0];
                } else if (typeof value === 'string') {
                  // Try to parse as a regular date string
                  const parsedDate = new Date(value);
                  if (!isNaN(parsedDate.getTime())) {
                    cleanData[key] = parsedDate.toISOString().split('T')[0];
                  } else {
                    cleanData[key] = String(value);
                  }
                } else {
                  cleanData[key] = String(value);
                }
              }
              // Handle decimal fields - Drizzle decimal fields expect strings
              else if (['copayAmount', 'deductible'].includes(key)) {
                cleanData[key] = String(parseFloat(value));
              }
              else if (['dependents', 'assignedTherapistId'].includes(key)) {
                cleanData[key] = parseInt(value);
              }
              // Handle boolean fields
              else if (['emailNotifications', 'hasPortalAccess'].includes(key)) {
                cleanData[key] = Boolean(value);
              }
              // Handle all other fields as strings
              else {
                cleanData[key] = String(value);
              }
            }
          });

          // Handle therapist assignment if provided
          if (cleanData['_therapistUsername']) {
            try {
              // Try to find therapist by username first, then by full name
              let therapist = await storage.getUserByUsername(cleanData['_therapistUsername']);
              
              if (!therapist) {
                // Try to find by full name (supports names from Excel)
                therapist = await storage.getUserByName(cleanData['_therapistUsername']);
              }
              
              if (therapist) {
                cleanData.assignedTherapistId = therapist.id;
              } else {
                results.errors.push({
                  row: i + 1,
                  data: clientData,
                  message: `Warning: Therapist '${cleanData['_therapistUsername']}' not found. Client created without therapist assignment.`
                });
              }
              delete cleanData['_therapistUsername'];
            } catch (error) {
              results.errors.push({
                row: i + 1,
                data: clientData,
                message: `Warning: Therapist '${cleanData['_therapistUsername']}' not found. Client created without therapist assignment.`
              });
              delete cleanData['_therapistUsername'];
            }
          }
          // No auto-assignment if no therapist is specified - leave unassigned
          
          // Skip empty rows and validate required fields
          if (!cleanData.fullName || cleanData.fullName.trim() === '') {
            results.failed++;
            results.errors.push({
              row: i + 1,
              data: clientData,
              message: 'Missing required field: fullName'
            });
            continue;
          }
          
          // Validate and create client
          const validatedData = insertClientSchema.parse(cleanData);
          await storage.createClient(validatedData);
          results.successful++;
        } catch (error) {
          results.failed++;
          results.errors.push({
            row: i + 1,
            data: clientData,
            message: error instanceof z.ZodError ? 
              error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ') :
              error instanceof Error ? error.message : 'Unknown error'
          });
        }
      }

      res.json(results);
    } catch (error: any) {

      res.status(500).json({ 
        message: "Bulk upload failed", 
        details: error.message || "Internal server error" 
      });
    }
  });

  // Bulk update stage endpoint
  app.post("/api/clients/bulk-update-stage", requireAuth, blockAccountant, async (req: AuthenticatedRequest, res) => {
    try {
      if (!req.user) {
        return res.status(401).json({ message: "Authentication required" });
      }

      // Only admin and supervisor can perform bulk updates
      if (req.user.role !== 'admin' && req.user.role !== 'administrator' && req.user.role !== 'supervisor') {
        return res.status(403).json({ message: "Access denied. Only administrators and supervisors can perform bulk updates." });
      }

      const { clientIds, stage } = req.body;

      if (!Array.isArray(clientIds) || clientIds.length === 0) {
        return res.status(400).json({ message: "Invalid input: clientIds must be a non-empty array" });
      }

      if (!['intake', 'assessment', 'psychotherapy', 'maintenance', 'discharged'].includes(stage)) {
        return res.status(400).json({ message: "Invalid stage value" });
      }

      // For supervisors, verify they can only update clients assigned to their supervised therapists
      if (req.user.role === 'supervisor') {
        const supervisorAssignments = await storage.getSupervisorAssignments(req.user.id);
        const supervisedTherapistIds = supervisorAssignments.map(a => a.therapistId);

        if (supervisedTherapistIds.length === 0) {
          return res.status(403).json({ message: "You have no supervised therapists" });
        }

        // Get all clients and verify they belong to supervised therapists
        const clients = await Promise.all(clientIds.map(id => storage.getClient(id)));
        const unauthorizedClients = clients.filter(c => 
          c && c.assignedTherapistId && !supervisedTherapistIds.includes(c.assignedTherapistId)
        );

        if (unauthorizedClients.length > 0) {
          return res.status(403).json({ 
            message: "You can only update clients assigned to therapists you supervise",
            unauthorizedClientIds: unauthorizedClients.map(c => c?.id)
          });
        }
      }

      const results = {
        total: clientIds.length,
        successful: 0,
        failed: 0,
        errors: [] as any[]
      };

      for (const clientId of clientIds) {
        try {
          await storage.updateClient(clientId, { stage });
          results.successful++;
        } catch (error) {
          results.failed++;
          results.errors.push({
            clientId,
            message: error instanceof Error ? error.message : 'Unknown error'
          });
        }
      }

      // Audit log
      await storage.logUserActivity({
        userId: req.user.id,
        action: 'bulk_update_stage',
        resourceType: 'client',
        resourceId: null,
        details: `Updated stage to "${stage}" for ${results.successful} clients`,
        ipAddress: req.ip || '',
        userAgent: req.get('user-agent') || ''
      });

      res.json(results);
    } catch (error: any) {
      res.status(500).json({ 
        message: "Bulk stage update failed", 
        details: error.message || "Internal server error" 
      });
    }
  });

  // Bulk reassign therapist endpoint
  app.post("/api/clients/bulk-reassign-therapist", requireAuth, blockAccountant, async (req: AuthenticatedRequest, res) => {
    try {
      if (!req.user) {
        return res.status(401).json({ message: "Authentication required" });
      }

      // Only admin and supervisor can perform bulk reassignment
      if (req.user.role !== 'admin' && req.user.role !== 'administrator' && req.user.role !== 'supervisor') {
        return res.status(403).json({ message: "Access denied. Only administrators and supervisors can perform bulk updates." });
      }

      const { clientIds, therapistIds, distribution } = req.body;

      if (!Array.isArray(clientIds) || clientIds.length === 0) {
        return res.status(400).json({ message: "Invalid input: clientIds must be a non-empty array" });
      }

      if (!Array.isArray(therapistIds) || therapistIds.length === 0) {
        return res.status(400).json({ message: "Invalid input: therapistIds must be a non-empty array" });
      }

      // For supervisors, verify scope
      if (req.user.role === 'supervisor') {
        const supervisorAssignments = await storage.getSupervisorAssignments(req.user.id);
        const supervisedTherapistIds = supervisorAssignments.map(a => a.therapistId);

        if (supervisedTherapistIds.length === 0) {
          return res.status(403).json({ message: "You have no supervised therapists" });
        }

        // Verify all target therapists are supervised by this supervisor
        const unauthorizedTherapists = therapistIds.filter(id => !supervisedTherapistIds.includes(id));
        if (unauthorizedTherapists.length > 0) {
          return res.status(403).json({ 
            message: "You can only reassign to therapists you supervise",
            unauthorizedTherapistIds: unauthorizedTherapists
          });
        }

        // Verify all clients belong to supervised therapists
        const clients = await Promise.all(clientIds.map(id => storage.getClient(id)));
        const unauthorizedClients = clients.filter(c => 
          c && c.assignedTherapistId && !supervisedTherapistIds.includes(c.assignedTherapistId)
        );

        if (unauthorizedClients.length > 0) {
          return res.status(403).json({ 
            message: "You can only reassign clients assigned to therapists you supervise",
            unauthorizedClientIds: unauthorizedClients.map(c => c?.id)
          });
        }
      }

      const results = {
        total: clientIds.length,
        successful: 0,
        failed: 0,
        errors: [] as any[],
        distribution: {} as Record<number, number>
      };

      // Initialize distribution counter
      therapistIds.forEach(id => results.distribution[id] = 0);

      // Helper: reassign one client, reset NEW-badge stamp so the new
      // therapist sees it, and fire the `client_assigned` notification so
      // the assigned therapist receives the named "Client Assigned" email.
      const reassignOne = async (clientId: number, therapistId: number) => {
        const original = await storage.getClient(clientId);
        const previousTherapistId = original?.assignedTherapistId ?? null;
        const updated = await storage.updateClient(clientId, {
          assignedTherapistId: therapistId,
          firstViewedByTherapistAt: null,
        } as any);
        if (previousTherapistId !== therapistId) {
          try {
            const assignedTherapist = await storage.getUser(therapistId);
            await notificationService.processEvent('client_assigned', {
              id: updated.id,
              clientName: updated.fullName,
              fullName: updated.fullName,
              clientId: updated.id,
              // Required so the recipient calculator selects the therapist.
              therapistId: therapistId,
              assignedToId: therapistId,
              therapistName: assignedTherapist?.fullName || 'Unknown Therapist',
              assignedTherapist: assignedTherapist?.fullName || 'Unknown Therapist',
              assignedTherapistId: therapistId,
              clientCaseId: updated.clientId,
              referenceNumber: updated.referenceNumber || updated.clientId,
              assignmentDate: new Date(),
              priority: 'medium',
              previousTherapistId,
            });
          } catch (notifyErr) {
            console.error('[BulkReassign] client_assigned notification failed:', notifyErr);
          }
        }
      };

      // Distribute clients evenly or to single therapist
      if (distribution === 'even') {
        // Sort therapists by current workload
        const therapistWorkloads = await Promise.all(
          therapistIds.map(async (id) => {
            const result = await storage.getClients({ therapistId: id, pageSize: 9999 });
            return { therapistId: id, currentCount: result.total };
          })
        );
        therapistWorkloads.sort((a, b) => a.currentCount - b.currentCount);

        let therapistIndex = 0;
        for (const clientId of clientIds) {
          try {
            const therapistId = therapistWorkloads[therapistIndex].therapistId;
            await reassignOne(clientId, therapistId);
            results.successful++;
            results.distribution[therapistId]++;
            therapistWorkloads[therapistIndex].currentCount++;

            // Re-sort to keep balanced
            therapistWorkloads.sort((a, b) => a.currentCount - b.currentCount);
            therapistIndex = 0; // Always assign to therapist with lowest count
          } catch (error) {
            results.failed++;
            results.errors.push({
              clientId,
              message: error instanceof Error ? error.message : 'Unknown error'
            });
          }
        }
      } else {
        // Assign all to single therapist (first in array)
        const therapistId = therapistIds[0];
        for (const clientId of clientIds) {
          try {
            await reassignOne(clientId, therapistId);
            results.successful++;
            results.distribution[therapistId]++;
          } catch (error) {
            results.failed++;
            results.errors.push({
              clientId,
              message: error instanceof Error ? error.message : 'Unknown error'
            });
          }
        }
      }

      // Audit log
      await storage.logUserActivity({
        userId: req.user.id,
        action: 'bulk_reassign_therapist',
        resourceType: 'client',
        resourceId: null,
        details: `Reassigned ${results.successful} clients to ${therapistIds.length} therapist(s)`,
        ipAddress: req.ip || '',
        userAgent: req.get('user-agent') || ''
      });

      res.json(results);
    } catch (error: any) {
      console.error('[Bulk Reassign Error]', error);
      res.status(500).json({ 
        message: "Bulk therapist reassignment failed", 
        details: error.message || "Internal server error" 
      });
    }
  });

  // Bulk portal access toggle endpoint
  app.post("/api/clients/bulk-portal-access", requireAuth, blockAccountant, async (req: AuthenticatedRequest, res) => {
    try {
      if (!req.user) {
        return res.status(401).json({ message: "Authentication required" });
      }

      // Only admin can modify portal access (security concern)
      if (req.user.role !== 'admin' && req.user.role !== 'administrator') {
        return res.status(403).json({ message: "Access denied. Only administrators can modify portal access." });
      }

      const { clientIds, enable } = req.body;

      if (!Array.isArray(clientIds) || clientIds.length === 0) {
        return res.status(400).json({ message: "Invalid input: clientIds must be a non-empty array" });
      }

      if (typeof enable !== 'boolean') {
        return res.status(400).json({ message: "Invalid input: enable must be a boolean" });
      }

      const results = {
        total: clientIds.length,
        successful: 0,
        failed: 0,
        skipped: 0,
        errors: [] as any[]
      };

      for (const clientId of clientIds) {
        try {
          const client = await storage.getClient(clientId);
          
          if (!client) {
            results.failed++;
            results.errors.push({
              clientId,
              message: 'Client not found'
            });
            continue;
          }

          // Skip if enabling portal but no email
          if (enable && !client.email) {
            results.skipped++;
            results.errors.push({
              clientId,
              message: 'Skipped: No email address'
            });
            continue;
          }

          await storage.updateClient(clientId, { hasPortalAccess: enable });
          results.successful++;
        } catch (error) {
          results.failed++;
          results.errors.push({
            clientId,
            message: error instanceof Error ? error.message : 'Unknown error'
          });
        }
      }

      // Audit log
      await storage.logUserActivity({
        userId: req.user.id,
        action: 'bulk_portal_access',
        resourceType: 'client',
        resourceId: null,
        details: `${enable ? 'Enabled' : 'Disabled'} portal access for ${results.successful} clients`,
        ipAddress: req.ip || '',
        userAgent: req.get('user-agent') || ''
      });

      res.json(results);
    } catch (error: any) {
      res.status(500).json({ 
        message: "Bulk portal access update failed", 
        details: error.message || "Internal server error" 
      });
    }
  });

  // Bulk status update endpoint
  app.post("/api/clients/bulk-update-status", requireAuth, blockAccountant, async (req: AuthenticatedRequest, res) => {
    try {
      if (!req.user) {
        return res.status(401).json({ message: "Authentication required" });
      }

      // Only admin and supervisor can perform bulk updates
      if (req.user.role !== 'admin' && req.user.role !== 'administrator' && req.user.role !== 'supervisor') {
        return res.status(403).json({ message: "Access denied. Only administrators and supervisors can perform bulk updates." });
      }

      const { clientIds, status } = req.body;

      if (!Array.isArray(clientIds) || clientIds.length === 0) {
        return res.status(400).json({ message: "Invalid input: clientIds must be a non-empty array" });
      }

      if (!['active', 'inactive', 'pending', 'discharged'].includes(status)) {
        return res.status(400).json({ message: "Invalid status value" });
      }

      // For supervisors, verify scope
      if (req.user.role === 'supervisor') {
        const supervisorAssignments = await storage.getSupervisorAssignments(req.user.id);
        const supervisedTherapistIds = supervisorAssignments.map(a => a.therapistId);

        if (supervisedTherapistIds.length === 0) {
          return res.status(403).json({ message: "You have no supervised therapists" });
        }

        // Verify all clients belong to supervised therapists
        const clients = await Promise.all(clientIds.map(id => storage.getClient(id)));
        const unauthorizedClients = clients.filter(c => 
          c && c.assignedTherapistId && !supervisedTherapistIds.includes(c.assignedTherapistId)
        );

        if (unauthorizedClients.length > 0) {
          return res.status(403).json({ 
            message: "You can only update clients assigned to therapists you supervise",
            unauthorizedClientIds: unauthorizedClients.map(c => c?.id)
          });
        }
      }

      const results = {
        total: clientIds.length,
        successful: 0,
        failed: 0,
        errors: [] as any[]
      };

      for (const clientId of clientIds) {
        try {
          await storage.updateClient(clientId, { status });
          results.successful++;
        } catch (error) {
          results.failed++;
          results.errors.push({
            clientId,
            message: error instanceof Error ? error.message : 'Unknown error'
          });
        }
      }

      // Audit log
      await storage.logUserActivity({
        userId: req.user.id,
        action: 'bulk_update_status',
        resourceType: 'client',
        resourceId: null,
        details: `Updated status to "${status}" for ${results.successful} clients`,
        ipAddress: req.ip || '',
        userAgent: req.get('user-agent') || ''
      });

      res.json(results);
    } catch (error: any) {
      res.status(500).json({ 
        message: "Bulk status update failed", 
        details: error.message || "Internal server error" 
      });
    }
  });

  // Sessions routes with pagination and filtering - SECURE: Uses authenticated user context
  app.get("/api/sessions", requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      if (!req.user) {
        return res.status(401).json({ message: "Authentication required" });
      }
      
      const { 
        page = 1, 
        limit = 50,
        startDate,
        endDate,
        therapistId,
        status,
        serviceCode,
        clientId,
        clientType
      } = req.query;
      
      // Default to current month if no date filters provided
      const now = new Date();
      const defaultStartDate = new Date(now.getFullYear(), now.getMonth(), 1);
      const defaultEndDate = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      
      const filters = {
        startDate: startDate ? new Date(startDate as string) : defaultStartDate,
        endDate: endDate ? new Date(endDate as string) : defaultEndDate,
        therapistId: therapistId && therapistId !== 'all' ? parseInt(therapistId as string) : undefined,
        status: status as string,
        serviceCode: serviceCode as string,
        clientId: clientId ? parseInt(clientId as string) : undefined,
        clientType: clientType && clientType !== 'all' ? (clientType as string) : undefined,
        page: parseInt(page as string),
        limit: parseInt(limit as string)
      };
      
      // SECURITY: Use authenticated user context instead of query parameters
      let therapistIdFilter: number | undefined;
      let supervisedTherapistIds: number[] | undefined;
      const userRole = req.user.role;
      const userId = req.user.id;

      if (userRole === "therapist") {
        therapistIdFilter = userId;
      } else if (userRole === "supervisor") {
        const supervisorAssignments = await storage.getSupervisorAssignments(userId);
        
        if (supervisorAssignments.length === 0) {
          return res.json({ sessions: [], total: 0, totalPages: 0, currentPage: 1 });
        }
        
        supervisedTherapistIds = supervisorAssignments.map(assignment => assignment.therapistId);
      } else if (userRole === "administrator" || userRole === "admin") {
        // Admins can filter by specific therapist from UI
        therapistIdFilter = filters.therapistId;
      } else if (userRole === "accountant") {
        // Accountant can see all sessions (no therapist filter) for scheduling purposes
        therapistIdFilter = filters.therapistId;
      }

      // PERFORMANCE: Database-level filtering with service visibility
      const isAdmin = userRole === "administrator" || userRole === "admin";
      let sessions = await storage.getSessionsWithFiltering({
        therapistId: therapistIdFilter,
        supervisedTherapistIds,
        startDate: filters.startDate,
        endDate: filters.endDate,
        status: filters.status,
        serviceCode: filters.serviceCode,
        clientId: filters.clientId,
        clientType: filters.clientType,
        page: filters.page,
        limit: filters.limit,
        includeHiddenServices: isAdmin
      });
      
      // Redact client names for accountant role
      if (userRole === "accountant") {
        sessions.sessions = sessions.sessions.map((s: any) => redactSessionClient(s));
      }
      
      // Return database-filtered results with pagination already applied
      res.json({
        sessions: sessions.sessions,
        total: sessions.total,
        totalPages: sessions.totalPages,
        currentPage: filters.page,
        limit: filters.limit,
        appliedFilters: {
          startDate: filters.startDate.toISOString().split('T')[0],
          endDate: filters.endDate.toISOString().split('T')[0],
          therapistId: filters.therapistId,
          status: filters.status,
          clientId: filters.clientId
        }
      });
    } catch (error) {
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Conflict detection helper function
  function checkTimeConflict(
    newSessionDate: Date, 
    duration: number, 
    existingSessionDate: Date, 
    existingDuration: number
  ): boolean {
    const newStart = newSessionDate.getTime();
    const newEnd = newStart + (duration * 60 * 1000); // duration in minutes
    const existingStart = existingSessionDate.getTime();
    const existingEnd = existingStart + (existingDuration * 60 * 1000);
    
    return (newStart < existingEnd && newEnd > existingStart);
  }

  // ===== RECURRING (WEEKLY) BOOKING HELPERS =====
  const RECURRENCE_PRACTICE_TZ = 'America/New_York';
  const RECURRENCE_MAX_SESSIONS = 60; // safety cap on a single series
  const RECURRENCE_MAX_DAYS = 730; // never look more than ~2 years ahead

  // Zod schema for an incoming weekly recurrence rule
  const recurrenceRuleSchema = z.object({
    clientId: z.coerce.number().int().min(1),
    therapistId: z.coerce.number().int().min(1),
    serviceId: z.coerce.number().int().min(1),
    roomId: z.coerce.number().int().min(1).optional(),
    sessionType: z.enum(["assessment", "psychotherapy", "consultation"]),
    notes: z.string().optional(),
    zoomEnabled: z.boolean().optional().default(false),
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "startDate must be yyyy-MM-dd"),
    sessionTime: z.string().regex(/^\d{2}:\d{2}$/, "sessionTime must be HH:mm"),
    daysOfWeek: z.array(z.number().int().min(0).max(6)).min(1, "Pick at least one day"),
    interval: z.coerce.number().int().min(1).max(8).optional().default(1), // every N weeks
    endMode: z.enum(["count", "until"]),
    count: z.coerce.number().int().min(1).max(RECURRENCE_MAX_SESSIONS).optional(),
    untilDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  }).refine(
    (r) => (r.endMode === "count" ? !!r.count : !!r.untilDate),
    { message: "Provide a count for 'count' mode or untilDate for 'until' mode" },
  );

  type RecurrenceRule = z.infer<typeof recurrenceRuleSchema>;

  // Expand a weekly recurrence rule into concrete UTC session datetimes.
  function expandRecurrenceDates(rule: RecurrenceRule): { localDate: string; utcDate: Date }[] {
    const results: { localDate: string; utcDate: Date }[] = [];
    const [sy, sm, sd] = rule.startDate.split("-").map((n) => parseInt(n, 10));
    // Iterate using a UTC-based calendar cursor to avoid timezone drift in day math
    let cursor = new Date(Date.UTC(sy, sm - 1, sd));
    const startWeekMs = Date.UTC(sy, sm - 1, sd);
    const untilMs = rule.untilDate
      ? (() => {
          const [uy, um, ud] = rule.untilDate.split("-").map((n) => parseInt(n, 10));
          return Date.UTC(uy, um - 1, ud);
        })()
      : null;
    const targetCount = rule.endMode === "count" ? (rule.count || 0) : Infinity;
    const days = new Set(rule.daysOfWeek);

    let dayOffset = 0;
    while (
      results.length < targetCount &&
      results.length < RECURRENCE_MAX_SESSIONS &&
      dayOffset <= RECURRENCE_MAX_DAYS
    ) {
      const cursorMs = cursor.getTime();
      if (untilMs !== null && cursorMs > untilMs) break;

      const dow = cursor.getUTCDay();
      // Weeks since the start week (interval filter)
      const weekIndex = Math.floor((cursorMs - startWeekMs) / (7 * 24 * 60 * 60 * 1000));
      const onInterval = weekIndex % rule.interval === 0;

      if (days.has(dow) && onInterval) {
        const y = cursor.getUTCFullYear();
        const m = String(cursor.getUTCMonth() + 1).padStart(2, "0");
        const d = String(cursor.getUTCDate()).padStart(2, "0");
        const localDate = `${y}-${m}-${d}`;
        // Interpret the local wall-clock time in the practice timezone -> UTC
        const utcDate = fromZonedTime(`${localDate} ${rule.sessionTime}:00`, RECURRENCE_PRACTICE_TZ);
        results.push({ localDate, utcDate });
      }

      cursor = new Date(cursorMs + 24 * 60 * 60 * 1000);
      dayOffset += 1;
    }

    return results;
  }

  // Enhanced availability checking endpoint with room conflicts
  app.get("/api/sessions/conflicts/check", requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      if (!req.user) {
        return res.status(401).json({ message: "Authentication required" });
      }
      
      const { therapistId, sessionDate, duration = 60, excludeSessionId, roomId } = req.query;
      
      if (!therapistId || !sessionDate) {
        return res.status(400).json({ message: "therapistId and sessionDate are required" });
      }

      // Use getSessionsWithFiltering with proper service visibility control
      const includeHiddenServices = req.user.role === 'admin';
      const sessionResults = await storage.getSessionsWithFiltering({
        includeHiddenServices,
        startDate: new Date(sessionDate as string),
        endDate: new Date(sessionDate as string),
        page: 1,
        limit: 1000 // Get all sessions for the date
      });
      const allSessions = sessionResults.sessions;
      const newSessionDate = new Date(sessionDate as string);
      const sessionDuration = parseInt(duration as string);
      
      // Check for therapist conflicts
      const therapistConflicts = allSessions.filter(session => {
        // Skip the session being edited
        if (excludeSessionId && session.id === parseInt(excludeSessionId as string)) {
          return false;
        }
        
        // Only check sessions for the same therapist
        if (session.therapistId !== parseInt(therapistId as string)) {
          return false;
        }
        
        // Only check on the same date
        const sessionDate = new Date(session.sessionDate);
        const newDate = new Date(newSessionDate);
        if (sessionDate.toDateString() !== newDate.toDateString()) {
          return false;
        }
        
        // Check time overlap using actual service duration
        const existingDuration = (session.service as any)?.duration || 60;
        return checkTimeConflict(newSessionDate, sessionDuration, sessionDate, existingDuration);
      });

      // Check for room conflicts (if roomId provided)
      let roomConflicts: any[] = [];
      if (roomId) {
        roomConflicts = allSessions.filter(session => {
          // Skip the session being edited
          if (excludeSessionId && session.id === parseInt(excludeSessionId as string)) {
            return false;
          }
          
          // Only check sessions for the same room
          if (session.roomId !== parseInt(roomId as string)) {
            return false;
          }
          
          // Only check on the same date
          const sessionDate = new Date(session.sessionDate);
          const newDate = new Date(newSessionDate);
          if (sessionDate.toDateString() !== newDate.toDateString()) {
            return false;
          }
          
          // Check time overlap using actual service duration
          const existingDuration = (session.service as any)?.duration || 60;
          return checkTimeConflict(newSessionDate, sessionDuration, sessionDate, existingDuration);
        });
      }

      // Suggest alternative times if conflicts found
      let suggestedTimes: string[] = [];
      const hasAnyConflict = therapistConflicts.length > 0 || roomConflicts.length > 0;
      
      if (hasAnyConflict) {
        const dateStr = newSessionDate.toISOString().split('T')[0];
        const workingHours = [9, 10, 11, 13, 14, 15, 16, 17, 18, 19, 20, 21]; // 9am-9pm, skip 12pm lunch
        
        for (const hour of workingHours) {
          const suggestedDateTime = new Date(`${dateStr}T${hour.toString().padStart(2, '0')}:00:00`);
          
          // Check both therapist and room availability for suggestions using actual durations
          const hasTherapistConflict = allSessions.some(session => {
            if (session.therapistId !== parseInt(therapistId as string)) return false;
            if (excludeSessionId && session.id === parseInt(excludeSessionId as string)) return false;
            
            const sessionDate = new Date(session.sessionDate);
            if (sessionDate.toDateString() !== suggestedDateTime.toDateString()) return false;
            
            const existingDuration = (session.service as any)?.duration || 60;
            return checkTimeConflict(suggestedDateTime, sessionDuration, sessionDate, existingDuration);
          });

          const hasRoomConflict = roomId ? allSessions.some(session => {
            if (session.roomId !== parseInt(roomId as string)) return false;
            if (excludeSessionId && session.id === parseInt(excludeSessionId as string)) return false;
            
            const sessionDate = new Date(session.sessionDate);
            if (sessionDate.toDateString() !== suggestedDateTime.toDateString()) return false;
            
            const existingDuration = (session.service as any)?.duration || 60;
            return checkTimeConflict(suggestedDateTime, sessionDuration, sessionDate, existingDuration);
          }) : false;
          
          if (!hasTherapistConflict && !hasRoomConflict) {
            suggestedTimes.push(suggestedDateTime.toISOString());
          }
        }
      }

      res.json({
        hasConflict: hasAnyConflict,
        therapistConflicts: therapistConflicts.map(session => ({
          id: session.id,
          clientName: session.client?.fullName || 'Unknown Client',
          sessionDate: session.sessionDate,
          sessionType: session.sessionType,
          type: 'therapist'
        })),
        roomConflicts: roomConflicts.map(session => ({
          id: session.id,
          clientName: 'Private Session', // Hide client details for room conflicts
          sessionDate: session.sessionDate,
          sessionType: session.sessionType,
          therapistName: session.therapist?.fullName || 'Unknown Therapist',
          type: 'room'
        })),
        suggestedTimes: suggestedTimes.slice(0, 3) // Limit to 3 suggestions
      });
    } catch (error) {
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // General availability endpoint (shows busy/free slots without client details)
  app.get("/api/sessions/availability", requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      if (!req.user) {
        return res.status(401).json({ message: "Authentication required" });
      }
      
      const { date, therapistId, roomId } = req.query;
      
      if (!date) {
        return res.status(400).json({ message: "date is required" });
      }

      // Use getSessionsWithFiltering with proper service visibility control
      const includeHiddenServices = req.user.role === 'admin';
      const sessionResults = await storage.getSessionsWithFiltering({
        includeHiddenServices,
        startDate: new Date(date as string),
        endDate: new Date(date as string),
        page: 1,
        limit: 1000 // Get all sessions for the date
      });
      const allSessions = sessionResults.sessions;
      const targetDate = new Date(date as string);
      
      // Generate working hours time slots (9 AM - 9 PM, 30-minute slots)
      const timeSlots = [];
      for (let hour = 9; hour <= 21; hour++) {
        for (let minute = 0; minute < 60; minute += 30) {
          const time = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
          const slotDateTime = new Date(`${targetDate.toISOString().split('T')[0]}T${time}:00`);
          
          // Check availability for this slot
          const isTherapistBusy = therapistId ? allSessions.some(session => {
            if (session.therapistId !== parseInt(therapistId as string)) return false;
            
            const sessionDate = new Date(session.sessionDate);
            if (sessionDate.toDateString() !== targetDate.toDateString()) return false;
            
            return checkTimeConflict(slotDateTime, 60, sessionDate, 60);
          }) : false;

          const isRoomBusy = roomId ? allSessions.some(session => {
            if (session.roomId !== parseInt(roomId as string)) return false;
            
            const sessionDate = new Date(session.sessionDate);
            if (sessionDate.toDateString() !== targetDate.toDateString()) return false;
            
            return checkTimeConflict(slotDateTime, 60, sessionDate, 60);
          }) : false;

          // General room occupancy (for any room if not specified)
          const hasRoomConflicts = !roomId ? allSessions.some(session => {
            const sessionDate = new Date(session.sessionDate);
            if (sessionDate.toDateString() !== targetDate.toDateString()) return false;
            
            return checkTimeConflict(slotDateTime, 60, sessionDate, 60);
          }) : false;

          timeSlots.push({
            time,
            datetime: slotDateTime.toISOString(),
            available: !isTherapistBusy && !isRoomBusy,
            therapistBusy: isTherapistBusy,
            roomBusy: isRoomBusy,
            generallyBusy: hasRoomConflicts
          });
        }
      }

      res.json({
        date: date,
        therapistId: therapistId ? parseInt(therapistId as string) : null,
        roomId: roomId ? parseInt(roomId as string) : null,
        timeSlots
      });
    } catch (error) {
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Acquire transaction-scoped advisory locks that serialize concurrent booking
  // attempts for the same therapist (and room). This is the database-level guard
  // against double-booking races: under READ COMMITTED isolation a plain
  // check-then-insert can let two simultaneous requests both pass their conflict
  // check and insert overlapping rows. Holding a per-therapist / per-room lock
  // forces the second request to wait until the first commits, after which its
  // re-check reads the committed row and correctly rejects the overlap.
  // Locks are always taken therapist-first then room (a fixed global order) so
  // concurrent transactions cannot deadlock, and they release on commit/rollback.
  async function acquireBookingLocks(
    tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
    therapistId: number,
    roomId: number | null,
  ): Promise<void> {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext('session_therapist'), ${therapistId})`,
    );
    if (roomId != null) {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtext('session_room'), ${roomId})`,
      );
    }
  }

  app.post("/api/sessions", requireAuth, async (req: AuthenticatedRequest, res) => {
    const { ipAddress, userAgent } = getRequestInfo(req);
    
    try {
      // Convert sessionDate string to Date object if needed
      const sessionData = {
        ...req.body,
        sessionDate: typeof req.body.sessionDate === 'string' 
          ? new Date(req.body.sessionDate) 
          : req.body.sessionDate
      };
      
      // Allow past dates for session creation (for entering historical sessions)
      // Just log a warning for past dates but allow the creation
      const sessionDate = new Date(sessionData.sessionDate);
      const today = new Date();
      today.setHours(0, 0, 0, 0); // Set to start of today
      
      // BUSINESS HOURS VALIDATION: Reject sessions after 12 AM (24:00) in practice timezone
      const PRACTICE_TIMEZONE = 'America/New_York'; // EST/EDT - should match practice settings
      const BUSINESS_END_HOUR = 24; // 12 AM (midnight) in 24-hour format
      
      // Get actual session duration from service or default to 60 minutes
      let sessionDurationMinutes = 60; // Default fallback
      if (sessionData.serviceId) {
        try {
          const service = await storage.getServiceById(sessionData.serviceId);
          if (service && service.duration) {
            sessionDurationMinutes = service.duration;
          }
        } catch (error) {
          // If service lookup fails, use default duration
          console.warn('Could not fetch service duration, using default 60 minutes');
        }
      }
      
      const sessionInPracticeTz = toZonedTime(sessionDate, PRACTICE_TIMEZONE);
      const sessionHour = sessionInPracticeTz.getHours();
      const sessionMinute = sessionInPracticeTz.getMinutes();
      
      // Calculate session end time
      const sessionStartMinutes = sessionHour * 60 + sessionMinute;
      const sessionEndMinutes = sessionStartMinutes + sessionDurationMinutes;
      const sessionEndHour = Math.floor(sessionEndMinutes / 60);
      const sessionEndMinute = sessionEndMinutes % 60;
      const businessEndMinutes = BUSINESS_END_HOUR * 60; // 24:00 = 1440 minutes
      
      // Check if session starts at or after 12:00 AM (midnight)
      if (sessionStartMinutes >= businessEndMinutes) {
        return res.status(400).json({ 
          message: "Session cannot be scheduled after 12:00 AM (midnight). Business hours end at 12:00 AM.",
          businessHours: "8:00 AM - 12:00 AM"
        });
      }
      
      // Check if session ends after 12:00 AM (midnight)
      if (sessionEndMinutes > businessEndMinutes) {
        const endTimeFormatted = `${sessionEndHour}:${sessionEndMinute.toString().padStart(2, '0')}`;
        return res.status(400).json({ 
          message: `This ${sessionDurationMinutes}-minute session would end at ${endTimeFormatted}, which is past business hours (12:00 AM). Please choose an earlier time.`,
          businessHours: "8:00 AM - 12:00 AM"
        });
      }

      if (!req.user) {
        return res.status(401).json({ message: "Authentication required" });
      }
      
      // Check for scheduling conflicts (therapist + room) with proper service filtering
      const includeHiddenServices = req.user.role === 'admin';
      const sessionResults = await storage.getSessionsWithFiltering({
        includeHiddenServices,
        startDate: sessionDate,
        endDate: sessionDate,
        page: 1,
        limit: 1000 // Get all sessions for the date
      });
      const allSessions = sessionResults.sessions;
      
      // Check therapist conflicts
      const therapistConflicts = allSessions.filter(session => {
        if (session.therapistId !== sessionData.therapistId) return false;
        
        const existingDate = new Date(session.sessionDate);
        if (existingDate.toDateString() !== sessionDate.toDateString()) return false;
        
        return checkTimeConflict(sessionDate, 60, existingDate, 60);
      });

      // Check room conflicts
      const roomConflicts = sessionData.roomId ? allSessions.filter(session => {
        if (session.roomId !== sessionData.roomId) return false;
        
        const existingDate = new Date(session.sessionDate);
        if (existingDate.toDateString() !== sessionDate.toDateString()) return false;
        
        return checkTimeConflict(sessionDate, 60, existingDate, 60);
      }) : [];

      const hasConflicts = therapistConflicts.length > 0 || roomConflicts.length > 0;

      if (hasConflicts && !req.body.ignoreConflicts) {
        // Format conflict times in EST
        const formatSessionTime = (date: Date) => {
          const timeInEst = toZonedTime(date, 'America/New_York');
          const hours = timeInEst.getHours();
          const minutes = timeInEst.getMinutes();
          const ampm = hours >= 12 ? 'PM' : 'AM';
          const displayHours = hours % 12 || 12;
          return `${displayHours}:${minutes.toString().padStart(2, '0')} ${ampm}`;
        };
        
        // Build detailed conflict messages
        const conflicts: string[] = [];
        
        // Get room info for conflicts if needed
        const roomsMap = new Map();
        if (roomConflicts.length > 0) {
          try {
            const rooms = await storage.getRooms();
            rooms.forEach(room => {
              roomsMap.set(room.id, room.roomName || room.roomNumber || `Room ${room.id}`);
            });
          } catch (error) {
            console.warn('Could not fetch rooms for conflict messages');
          }
        }
        
        if (therapistConflicts.length > 0) {
          therapistConflicts.forEach(session => {
            const time = formatSessionTime(new Date(session.sessionDate));
            const therapistName = session.therapist?.fullName || 'Therapist';
            const clientName = session.client?.fullName || 'another client';
            conflicts.push(`${therapistName} is busy at ${time} with ${clientName}`);
          });
        }
        
        if (roomConflicts.length > 0) {
          roomConflicts.forEach(session => {
            const time = formatSessionTime(new Date(session.sessionDate));
            const therapistName = session.therapist?.fullName || 'a therapist';
            const roomInfo = roomsMap.get(session.roomId) || `Room ${session.roomId}`;
            conflicts.push(`${roomInfo} is occupied at ${time} by ${therapistName}`);
          });
        }
        
        const conflictMessage = conflicts.length > 1 
          ? `Scheduling conflict: ${conflicts.join('; ')}`
          : `Scheduling conflict: ${conflicts[0]}`;
        
        return res.status(409).json({ 
          message: conflictMessage.trim(),
          therapistConflicts: therapistConflicts.map(session => ({
            id: session.id,
            clientName: session.client?.fullName || 'Unknown Client',
            sessionDate: session.sessionDate,
            sessionTime: formatSessionTime(new Date(session.sessionDate)),
            sessionType: session.sessionType,
            therapistName: session.therapist?.fullName || 'Unknown Therapist',
            type: 'therapist'
          })),
          roomConflicts: roomConflicts.map(session => ({
            id: session.id,
            clientName: 'Private Session',
            sessionDate: session.sessionDate,
            sessionTime: formatSessionTime(new Date(session.sessionDate)),
            sessionType: session.sessionType,
            therapistName: session.therapist?.fullName || 'Unknown Therapist',
            roomName: roomsMap.get(session.roomId) || `Room ${session.roomId}`,
            roomId: session.roomId,
            type: 'room'
          }))
        });
      }
      
      const validatedData = insertSessionSchema.parse(sessionData);
      
      // ⚡ DATABASE TRANSACTION: Prevent double-booking race conditions
      // This ensures atomic check-and-create for both therapist and room conflicts
      const session = await db.transaction(async (tx) => {
        const sessionDuration = validatedData.duration || 60;
        const sessionEnd = new Date(sessionDate.getTime() + sessionDuration * 60000);

        // CRITICAL: Re-check conflicts INSIDE transaction to prevent race conditions
        // This prevents two therapists from booking the same room simultaneously
        if (!req.body.ignoreConflicts) {
          // DATABASE-LEVEL GUARD: take transaction-scoped advisory locks on the
          // therapist (and room) so two simultaneous booking requests for the
          // same slot are serialized. Postgres' default READ COMMITTED isolation
          // means the re-check below would otherwise not see another in-flight
          // (uncommitted) insert; the lock forces the second request to wait,
          // then re-read committed rows and correctly detect the conflict.
          // Locks are always acquired therapist-first, then room, so concurrent
          // transactions can never deadlock. They release automatically on commit.
          await acquireBookingLocks(tx, validatedData.therapistId, validatedData.roomId ?? null);

          // Check therapist conflicts
          const therapistConflicts = await tx
            .select()
            .from(sessions)
            .where(and(
              eq(sessions.therapistId, validatedData.therapistId),
              inArray(sessions.status, ['scheduled', 'confirmed', 'in-progress'])
            ));

          const hasTherapistConflict = therapistConflicts.some(s => {
            const existingStart = new Date(s.sessionDate);
            const existingEnd = new Date(existingStart.getTime() + (s.duration || 60) * 60000);
            return sessionDate < existingEnd && sessionEnd > existingStart;
          });

          if (hasTherapistConflict) {
            const err: any = new Error("That slot was just taken — this therapist is no longer available at this time. Please refresh and choose another time.");
            err.slotTaken = true;
            throw err;
          }

          // Check room conflicts if room is assigned
          if (validatedData.roomId) {
            const roomConflicts = await tx
              .select()
              .from(sessions)
              .where(and(
                eq(sessions.roomId, validatedData.roomId),
                inArray(sessions.status, ['scheduled', 'confirmed', 'in-progress'])
              ));

            const hasRoomConflict = roomConflicts.some(s => {
              const existingStart = new Date(s.sessionDate);
              const existingEnd = new Date(existingStart.getTime() + (s.duration || 60) * 60000);
              return sessionDate < existingEnd && sessionEnd > existingStart;
            });

            if (hasRoomConflict) {
              const err: any = new Error("That slot was just taken — this room is no longer available at this time. Please refresh and choose another room.");
              err.slotTaken = true;
              throw err;
            }
          }
        }

        // Create session atomically within transaction
        const [createdSession] = await tx
          .insert(sessions)
          .values(validatedData)
          .returning();

        return createdSession;
      });
      
      // Handle Zoom meeting creation if enabled
      let zoomMeetingData = null;
      let zoomWarning = null;
      if (sessionData.zoomEnabled) {
        try {
          
          // Get client and therapist for Zoom meeting
          const client = await storage.getClient(session.clientId);
          const therapist = await storage.getUser(session.therapistId);
          
          // Get therapist's Zoom credentials
          const [therapistWithZoom] = await db.select({
            zoomAccountId: users.zoomAccountId,
            zoomClientId: users.zoomClientId,
            zoomClientSecret: users.zoomClientSecret,
            zoomAccessToken: users.zoomAccessToken,
            zoomTokenExpiry: users.zoomTokenExpiry,
          }).from(users).where(eq(users.id, session.therapistId));
          
          // Check if therapist has Zoom configured
          const hasTherapistZoom = therapistWithZoom?.zoomAccountId && 
                                    therapistWithZoom?.zoomClientId && 
                                    therapistWithZoom?.zoomClientSecret;
          
          if (!hasTherapistZoom) {
            throw new Error('ZOOM_NOT_CONFIGURED: Please configure your Zoom OAuth credentials in your profile. The client has been notified that you will send the Zoom link separately.');
          }
          
          // Use therapist's own Zoom credentials (required)
          const zoomCredentials = {
            accountId: therapistWithZoom.zoomAccountId!,
            clientId: therapistWithZoom.zoomClientId!,
            clientSecret: therapistWithZoom.zoomClientSecret!,
            accessToken: therapistWithZoom.zoomAccessToken,
            tokenExpiry: therapistWithZoom.zoomTokenExpiry,
          };
          
          const zoomMeeting = await zoomService.createMeeting({
            clientName: client?.fullName || 'Unknown Client',
            therapistName: therapist?.fullName || 'Unknown Therapist',
            sessionDate: sessionDate,
            duration: 60 // Default session duration
          }, zoomCredentials);
          
          // Update session with Zoom meeting details
          const updatedSession = await storage.updateSession(session.id, {
            zoomMeetingId: zoomMeeting.id.toString(),
            zoomJoinUrl: zoomMeeting.join_url,
            zoomPassword: zoomMeeting.password || '',
          });
          
          zoomMeetingData = zoomService.formatMeetingInfo(zoomMeeting);
        } catch (zoomError) {
          console.error('Zoom meeting creation failed:', zoomError);
          zoomWarning = zoomError instanceof Error ? zoomError.message : 'Failed to create Zoom meeting';
          // Continue with session creation even if Zoom fails
        }
      }
      
      // Log session creation with actual authenticated user
      await AuditLogger.logSessionAccess(
        req.user!.id, req.user!.username, session.id, session.clientId,
        'session_created', ipAddress, userAgent,
        { session_date: session.sessionDate, session_type: session.sessionType, is_historical: sessionDate < today, zoom_enabled: sessionData.zoomEnabled }
      );
      
      // Trigger session scheduled notification
      try {
        // Get client and therapist names for notification template
        const client = await storage.getClient(session.clientId);
        const therapist = await storage.getUser(session.therapistId);
        
        // Get room name if room is assigned
        let roomName = null;
        if (session.roomId) {
          try {
            const rooms = await storage.getRooms();
            const room = rooms.find(r => r.id === session.roomId);
            roomName = room?.roomName || room?.roomNumber || `Room ${session.roomId}`;
          } catch (error) {
            console.warn('Could not fetch room name for notification');
            roomName = `Room ${session.roomId}`;
          }
        }
        
        const notificationData = {
          id: session.id,
          clientId: session.clientId,
          therapistId: session.therapistId,
          clientName: client?.fullName || 'Unknown Client',
          therapistName: therapist?.fullName || 'Unknown Therapist',
          sessionDate: session.sessionDate,
          sessionType: session.sessionType,
          roomId: session.roomId,
          roomName: roomName,
          duration: 60, // Default session duration
          createdAt: session.createdAt,
          // Zoom meeting details - flatten to top level for email template
          zoomEnabled: !!zoomMeetingData,
          zoomJoinUrl: zoomMeetingData?.joinUrl || null,
          zoomMeetingId: zoomMeetingData?.meetingId || null,
          zoomPassword: zoomMeetingData?.password || null
        };
        
        await notificationService.processEvent('session_scheduled', notificationData);
      } catch (notificationError) {
        console.error('[SESSION CREATE] Session scheduled notification failed:', notificationError);
      }
      
      res.status(201).json({ 
        ...session, 
        warning: zoomWarning || undefined 
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid session data", errors: error.errors });
      }
      // A concurrent request grabbed the slot during the in-transaction re-check.
      if ((error as any)?.slotTaken) {
        return res.status(409).json({ message: (error as Error).message });
      }
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Evaluate therapist + room conflicts for a set of candidate session datetimes.
  // Fetches existing sessions across the whole span once, then checks each date
  // in memory. Returns a per-candidate verdict.
  async function evaluateRecurrenceConflicts(
    candidates: { localDate: string; utcDate: Date }[],
    rule: RecurrenceRule,
    sessionDurationMinutes: number,
    includeHiddenServices: boolean,
  ): Promise<Array<{ localDate: string; utcDate: Date; hasConflict: boolean; reasons: string[] }>> {
    if (candidates.length === 0) return [];

    const sortedMs = candidates.map((c) => c.utcDate.getTime()).sort((a, b) => a - b);
    const rangeStart = new Date(sortedMs[0] - 24 * 60 * 60 * 1000);
    const rangeEnd = new Date(sortedMs[sortedMs.length - 1] + 24 * 60 * 60 * 1000);

    const existing = await storage.getSessionsWithFiltering({
      includeHiddenServices,
      startDate: rangeStart,
      endDate: rangeEnd,
      page: 1,
      limit: 5000,
    });
    const allSessions = existing.sessions.filter((s: any) =>
      ['scheduled', 'confirmed', 'in-progress'].includes(s.status),
    );

    return candidates.map((cand) => {
      const reasons: string[] = [];
      const candDate = cand.utcDate;

      const therapistConflict = allSessions.some((s: any) => {
        if (s.therapistId !== rule.therapistId) return false;
        const existingDate = new Date(s.sessionDate);
        const existingDuration = (s.service as any)?.duration || s.duration || 60;
        return checkTimeConflict(candDate, sessionDurationMinutes, existingDate, existingDuration);
      });
      if (therapistConflict) reasons.push('Therapist is busy');

      if (rule.roomId) {
        const roomConflict = allSessions.some((s: any) => {
          if (s.roomId !== rule.roomId) return false;
          const existingDate = new Date(s.sessionDate);
          const existingDuration = (s.service as any)?.duration || s.duration || 60;
          return checkTimeConflict(candDate, sessionDurationMinutes, existingDate, existingDuration);
        });
        if (roomConflict) reasons.push('Room is occupied');
      }

      return { localDate: cand.localDate, utcDate: cand.utcDate, hasConflict: reasons.length > 0, reasons };
    });
  }

  // Preview a recurring series: expand the rule into dates and flag conflicts.
  app.post("/api/sessions/recurring/preview", requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      if (!req.user) return res.status(401).json({ message: "Authentication required" });

      const rule = recurrenceRuleSchema.parse(req.body);
      const candidates = expandRecurrenceDates(rule);

      if (candidates.length === 0) {
        return res.json({ sessions: [], totalRequested: 0, freeCount: 0, conflictCount: 0 });
      }

      // Resolve service duration for accurate overlap math
      let sessionDurationMinutes = 60;
      try {
        const service = await storage.getServiceById(rule.serviceId);
        if (service?.duration) sessionDurationMinutes = service.duration;
      } catch {}

      const includeHiddenServices = req.user.role === 'admin';
      const evaluated = await evaluateRecurrenceConflicts(
        candidates,
        rule,
        sessionDurationMinutes,
        includeHiddenServices,
      );

      const sessions = evaluated.map((e) => ({
        sessionDate: e.utcDate.toISOString(),
        localDate: e.localDate,
        sessionTime: rule.sessionTime,
        hasConflict: e.hasConflict,
        reasons: e.reasons,
      }));

      res.json({
        sessions,
        totalRequested: sessions.length,
        freeCount: sessions.filter((s) => !s.hasConflict).length,
        conflictCount: sessions.filter((s) => s.hasConflict).length,
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid recurrence rule", errors: error.errors });
      }
      console.error('[RECURRING PREVIEW] Error:', error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Create a recurring series: book all non-conflicting dates, skip conflicts.
  app.post("/api/sessions/recurring", requireAuth, async (req: AuthenticatedRequest, res) => {
    const { ipAddress, userAgent } = getRequestInfo(req);
    try {
      if (!req.user) return res.status(401).json({ message: "Authentication required" });

      const rule = recurrenceRuleSchema.parse(req.body);
      const candidates = expandRecurrenceDates(rule);
      if (candidates.length === 0) {
        return res.status(400).json({ message: "The recurrence rule produced no dates." });
      }

      let sessionDurationMinutes = 60;
      let serviceName: string | null = null;
      try {
        const service = await storage.getServiceById(rule.serviceId);
        if (service?.duration) sessionDurationMinutes = service.duration;
        serviceName = service?.serviceName || null;
      } catch {}

      // Business-hours guard (8:00 AM - 12:00 AM practice time) applied to the
      // common wall-clock time once, since every session shares the same time.
      const [hh, mm] = rule.sessionTime.split(':').map((n) => parseInt(n, 10));
      const startMinutes = hh * 60 + mm;
      const endMinutes = startMinutes + sessionDurationMinutes;
      if (startMinutes >= 24 * 60 || endMinutes > 24 * 60) {
        return res.status(400).json({
          message: "Session time is outside business hours (8:00 AM - 12:00 AM).",
        });
      }

      const includeHiddenServices = req.user.role === 'admin';
      const evaluated = await evaluateRecurrenceConflicts(
        candidates,
        rule,
        sessionDurationMinutes,
        includeHiddenServices,
      );

      const free = evaluated.filter((e) => !e.hasConflict);
      const skipped = evaluated.filter((e) => e.hasConflict);

      if (free.length === 0) {
        return res.status(409).json({
          message: "All requested dates conflict with existing bookings.",
          created: [],
          skipped: skipped.map((s) => ({ sessionDate: s.utcDate.toISOString(), reasons: s.reasons })),
        });
      }

      const groupId = `rec-${crypto.randomUUID()}`;

      // Atomic batch create with a final in-transaction conflict re-check.
      const txResult = await db.transaction(async (tx) => {
        const created: any[] = [];
        const txSkipped: { utcDate: Date; reasons: string[] }[] = [];

        // DATABASE-LEVEL GUARD: serialize concurrent bookings for this therapist
        // (and room) via transaction-scoped advisory locks so the re-check below
        // sees committed rows from any simultaneous request, preventing
        // double-booking races. Locks release automatically on commit.
        await acquireBookingLocks(tx, rule.therapistId, rule.roomId ?? null);

        // Pull therapist + room sessions once inside the tx for race-safe checks
        const txExisting = await tx
          .select()
          .from(sessions)
          .where(inArray(sessions.status, ['scheduled', 'confirmed', 'in-progress']));

        for (const cand of free) {
          const candStart = cand.utcDate;
          const candEnd = new Date(candStart.getTime() + sessionDurationMinutes * 60000);

          const therapistBusy = txExisting.some((s) => {
            if (s.therapistId !== rule.therapistId) return false;
            const exStart = new Date(s.sessionDate);
            const exEnd = new Date(exStart.getTime() + (s.duration || 60) * 60000);
            return candStart < exEnd && candEnd > exStart;
          });
          if (therapistBusy) {
            txSkipped.push({ utcDate: candStart, reasons: ['Therapist is busy'] });
            continue;
          }

          if (rule.roomId) {
            const roomBusy = txExisting.some((s) => {
              if (s.roomId !== rule.roomId) return false;
              const exStart = new Date(s.sessionDate);
              const exEnd = new Date(exStart.getTime() + (s.duration || 60) * 60000);
              return candStart < exEnd && candEnd > exStart;
            });
            if (roomBusy) {
              txSkipped.push({ utcDate: candStart, reasons: ['Room is occupied'] });
              continue;
            }
          }

          const insertData = {
            clientId: rule.clientId,
            therapistId: rule.therapistId,
            serviceId: rule.serviceId,
            roomId: rule.roomId ?? null,
            sessionDate: candStart,
            sessionType: rule.sessionType,
            notes: rule.notes || null,
            zoomEnabled: rule.zoomEnabled ?? false,
            recurrenceGroupId: groupId,
          };
          const validated = insertSessionSchema.parse(insertData);
          const [row] = await tx.insert(sessions).values(validated).returning();
          created.push(row);
          // Track in the in-memory set so later iterations see this booking
          txExisting.push(row as any);
        }

        return { created, txSkipped };
      });

      const createdSessions = txResult.created;
      // Dates that were free in the pre-check but lost a race during the tx re-check
      const allSkipped = [
        ...skipped.map((s) => ({ sessionDate: s.utcDate.toISOString(), reasons: s.reasons })),
        ...txResult.txSkipped.map((s) => ({ sessionDate: s.utcDate.toISOString(), reasons: s.reasons })),
      ];

      // Best-effort Zoom meeting per session (mirrors single-create behaviour)
      let zoomWarning: string | null = null;
      if (rule.zoomEnabled && createdSessions.length > 0) {
        try {
          const [therapistWithZoom] = await db.select({
            zoomAccountId: users.zoomAccountId,
            zoomClientId: users.zoomClientId,
            zoomClientSecret: users.zoomClientSecret,
            zoomAccessToken: users.zoomAccessToken,
            zoomTokenExpiry: users.zoomTokenExpiry,
          }).from(users).where(eq(users.id, rule.therapistId));

          const hasZoom = therapistWithZoom?.zoomAccountId && therapistWithZoom?.zoomClientId && therapistWithZoom?.zoomClientSecret;
          if (!hasZoom) {
            zoomWarning = "Zoom is not configured on your profile, so no meeting links were created.";
          } else {
            const client = await storage.getClient(rule.clientId);
            const therapist = await storage.getUser(rule.therapistId);
            const creds = {
              accountId: therapistWithZoom!.zoomAccountId!,
              clientId: therapistWithZoom!.zoomClientId!,
              clientSecret: therapistWithZoom!.zoomClientSecret!,
              accessToken: therapistWithZoom!.zoomAccessToken,
              tokenExpiry: therapistWithZoom!.zoomTokenExpiry,
            };
            for (const s of createdSessions) {
              try {
                const meeting = await zoomService.createMeeting({
                  clientName: client?.fullName || 'Unknown Client',
                  therapistName: therapist?.fullName || 'Unknown Therapist',
                  sessionDate: new Date(s.sessionDate),
                  duration: sessionDurationMinutes,
                }, creds);
                await storage.updateSession(s.id, {
                  zoomMeetingId: meeting.id.toString(),
                  zoomJoinUrl: meeting.join_url,
                  zoomPassword: meeting.password || '',
                });
              } catch (e) {
                console.error('[RECURRING] Zoom creation failed for session', s.id, e);
              }
            }
          }
        } catch (e) {
          console.error('[RECURRING] Zoom setup failed:', e);
          zoomWarning = "Some Zoom meeting links could not be created.";
        }
      }

      // Resolve room name once for notification text
      let roomName: string | null = null;
      if (rule.roomId) {
        try {
          const rooms = await storage.getRooms();
          const room = rooms.find((r) => r.id === rule.roomId);
          roomName = room?.roomName || room?.roomNumber || `Room ${rule.roomId}`;
        } catch {}
      }

      const client = await storage.getClient(rule.clientId);
      const therapist = await storage.getUser(rule.therapistId);

      // Audit each created session
      for (const s of createdSessions) {
        try {
          await AuditLogger.logSessionAccess(
            req.user!.id, req.user!.username, s.id, s.clientId,
            'session_created', ipAddress, userAgent,
            { session_date: s.sessionDate, session_type: s.sessionType, recurrence_group: groupId },
          );
        } catch (e) {
          console.error('[RECURRING] Audit log failed for session', s.id, e);
        }
      }

      // Schedule per-session reminders ONLY (no per-session confirmation email)
      for (const s of createdSessions) {
        try {
          await notificationService.processEvent('session_scheduled', {
            id: s.id,
            clientId: s.clientId,
            therapistId: s.therapistId,
            clientName: client?.fullName || 'Unknown Client',
            therapistName: therapist?.fullName || 'Unknown Therapist',
            sessionDate: s.sessionDate,
            sessionType: s.sessionType,
            roomId: s.roomId,
            roomName,
            duration: sessionDurationMinutes,
            createdAt: s.createdAt,
            zoomEnabled: !!s.zoomJoinUrl,
            zoomJoinUrl: s.zoomJoinUrl || null,
          }, { scheduledOnly: true });
        } catch (e) {
          console.error('[RECURRING] Reminder scheduling failed for session', s.id, e);
        }
      }

      // Send ONE combined confirmation for the whole series
      try {
        await notificationService.sendSeriesScheduledConfirmation({
          clientId: rule.clientId,
          therapistId: rule.therapistId,
          clientName: client?.fullName || 'Unknown Client',
          therapistName: therapist?.fullName || 'Unknown Therapist',
          serviceName,
          roomName,
          sessionDates: createdSessions.map((s) => s.sessionDate),
          skippedCount: allSkipped.length,
        });
      } catch (e) {
        console.error('[RECURRING] Series confirmation failed:', e);
      }

      res.status(201).json({
        groupId,
        created: createdSessions,
        createdCount: createdSessions.length,
        skipped: allSkipped,
        skippedCount: allSkipped.length,
        warning: zoomWarning || undefined,
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid recurrence rule", errors: error.errors });
      }
      console.error('[RECURRING CREATE] Error:', error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Cancel an entire recurring series (future sessions only) and their reminders.
  app.delete("/api/sessions/recurring/:groupId", requireAuth, async (req: AuthenticatedRequest, res) => {
    const { ipAddress, userAgent } = getRequestInfo(req);
    try {
      if (!req.user) return res.status(401).json({ message: "Authentication required" });

      const role = req.user.role?.toLowerCase() || '';
      const allowedRoles = ['admin', 'administrator', 'supervisor', 'therapist'];
      if (!allowedRoles.includes(role)) {
        return res.status(403).json({ message: "You do not have permission to cancel sessions" });
      }

      const groupId = req.params.groupId;
      if (!groupId || !groupId.startsWith('rec-')) {
        return res.status(400).json({ message: "Invalid series id" });
      }

      const now = new Date();
      // Only future, still-active sessions in this series
      const seriesSessions = await db
        .select()
        .from(sessions)
        .where(and(
          eq(sessions.recurrenceGroupId, groupId),
          gte(sessions.sessionDate, now),
          inArray(sessions.status, ['scheduled', 'confirmed']),
        ));

      if (seriesSessions.length === 0) {
        return res.status(404).json({ message: "No upcoming sessions found for this series" });
      }

      // Therapists may only cancel their own sessions
      if (role === 'therapist' && seriesSessions.some((s) => s.therapistId !== req.user!.id)) {
        return res.status(403).json({ message: "You can only cancel your own sessions" });
      }

      const ids = seriesSessions.map((s) => s.id);
      await db.transaction(async (tx) => {
        await tx.delete(sessionBilling).where(inArray(sessionBilling.sessionId, ids));
        await tx.delete(sessionNotes).where(inArray(sessionNotes.sessionId, ids));
        await tx.delete(scheduledNotifications).where(inArray(scheduledNotifications.sessionId, ids));
        await tx.delete(roomBookings).where(inArray(roomBookings.sessionId, ids));
        await tx.delete(sessions).where(inArray(sessions.id, ids));
      });

      await AuditLogger.logAction({
        userId: req.user.id,
        action: 'session_deleted',
        result: 'success',
        resourceType: 'session',
        resourceId: groupId,
        details: `Cancelled recurring series ${groupId} (${ids.length} upcoming sessions)`,
        ipAddress,
        userAgent,
      });

      res.json({ message: "Series cancelled", cancelledCount: ids.length });
    } catch (error) {
      console.error('[RECURRING CANCEL] Error:', error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Edit "this and all future" sessions in a recurring series at once.
  // Applies the anchor session's edits (time-of-day, room, notes, service,
  // therapist, type, zoom) to every still-active occurrence on or after the
  // anchor's date, then reschedules their reminders.
  app.put("/api/sessions/recurring/:groupId/future", requireAuth, async (req: AuthenticatedRequest, res) => {
    const { ipAddress, userAgent } = getRequestInfo(req);
    try {
      if (!req.user) return res.status(401).json({ message: "Authentication required" });

      const role = req.user.role?.toLowerCase() || '';
      const allowedRoles = ['admin', 'administrator', 'supervisor', 'therapist'];
      if (!allowedRoles.includes(role)) {
        return res.status(403).json({ message: "You do not have permission to edit sessions" });
      }

      const groupId = req.params.groupId;
      if (!groupId || !groupId.startsWith('rec-')) {
        return res.status(400).json({ message: "Invalid series id" });
      }

      const bodySchema = z.object({
        anchorId: z.coerce.number().int().min(1),
        sessionDate: z.string().min(1),
        roomId: z.coerce.number().int().min(1).nullable().optional(),
        notes: z.string().nullable().optional(),
        serviceId: z.coerce.number().int().min(1).optional(),
        therapistId: z.coerce.number().int().min(1).optional(),
        sessionType: z.enum(["assessment", "psychotherapy", "consultation"]).optional(),
        zoomEnabled: z.boolean().optional(),
        ignoreConflicts: z.boolean().optional(),
      });
      const body = bodySchema.parse(req.body);

      const newAnchorDate = new Date(body.sessionDate);
      if (isNaN(newAnchorDate.getTime())) {
        return res.status(400).json({ message: "Invalid session date format" });
      }

      // Load the anchor and verify it belongs to this series
      const [anchor] = await db.select().from(sessions).where(eq(sessions.id, body.anchorId));
      if (!anchor) {
        return res.status(404).json({ message: "Session not found" });
      }
      if (anchor.recurrenceGroupId !== groupId) {
        return res.status(400).json({ message: "Session is not part of this series" });
      }

      const originalAnchorDate = new Date(anchor.sessionDate);

      // All still-active occurrences on or after the anchor's original date
      const futureSessions = await db
        .select()
        .from(sessions)
        .where(and(
          eq(sessions.recurrenceGroupId, groupId),
          gte(sessions.sessionDate, originalAnchorDate),
          inArray(sessions.status, ['scheduled', 'confirmed']),
        ));

      if (futureSessions.length === 0) {
        return res.status(404).json({ message: "No upcoming sessions found for this series" });
      }

      // Therapists may only edit their own sessions
      if (role === 'therapist' && futureSessions.some((s) => s.therapistId !== req.user!.id)) {
        return res.status(403).json({ message: "You can only edit your own sessions" });
      }

      const effectiveTherapistId = body.therapistId ?? anchor.therapistId;
      const effectiveServiceId = body.serviceId ?? anchor.serviceId;
      const effectiveRoomId = body.roomId === undefined ? anchor.roomId : body.roomId;
      const effectiveSessionType = body.sessionType ?? (anchor.sessionType as any);

      // Resolve duration from the effective service for business-hours + conflict math
      let durationMinutes = 60;
      try {
        const svc = await storage.getServiceById(effectiveServiceId);
        if (svc?.duration) durationMinutes = svc.duration;
      } catch {}

      // Compute day shift + new wall-clock time in the practice timezone (DST-safe)
      const toLocalMs = (d: Date) => {
        const [y, m, day] = formatInTimeZone(d, RECURRENCE_PRACTICE_TZ, 'yyyy-MM-dd')
          .split('-').map((n) => parseInt(n, 10));
        return Date.UTC(y, m - 1, day);
      };
      const dayDelta = Math.round((toLocalMs(newAnchorDate) - toLocalMs(originalAnchorDate)) / 86400000);
      const newTimeOfDay = formatInTimeZone(newAnchorDate, RECURRENCE_PRACTICE_TZ, 'HH:mm');

      const shiftLocalDate = (utcDate: Date): string => {
        const [y, m, day] = formatInTimeZone(utcDate, RECURRENCE_PRACTICE_TZ, 'yyyy-MM-dd')
          .split('-').map((n) => parseInt(n, 10));
        const shifted = new Date(Date.UTC(y, m - 1, day) + dayDelta * 86400000);
        const ny = shifted.getUTCFullYear();
        const nm = String(shifted.getUTCMonth() + 1).padStart(2, '0');
        const nd = String(shifted.getUTCDate()).padStart(2, '0');
        return `${ny}-${nm}-${nd}`;
      };

      // Business-hours guard (8:00 AM - 12:00 AM practice time). Every occurrence
      // shares the same wall-clock time so this only needs checking once.
      const [hh, mm] = newTimeOfDay.split(':').map((n) => parseInt(n, 10));
      const startMinutes = hh * 60 + mm;
      const endMinutes = startMinutes + durationMinutes;
      if (startMinutes >= 24 * 60 || endMinutes > 24 * 60) {
        return res.status(400).json({
          message: "Session time is outside business hours (8:00 AM - 12:00 AM).",
          businessHours: "8:00 AM - 12:00 AM",
        });
      }

      // Build new datetimes for every occurrence
      const groupIds = new Set(futureSessions.map((s) => s.id));
      const updates = futureSessions.map((s) => ({
        session: s,
        newDate: fromZonedTime(`${shiftLocalDate(new Date(s.sessionDate))} ${newTimeOfDay}:00`, RECURRENCE_PRACTICE_TZ),
      }));

      // Conflict check against sessions OUTSIDE this series
      if (!body.ignoreConflicts) {
        const sortedMs = updates.map((u) => u.newDate.getTime()).sort((a, b) => a - b);
        const rangeStart = new Date(sortedMs[0] - 24 * 60 * 60 * 1000);
        const rangeEnd = new Date(sortedMs[sortedMs.length - 1] + 24 * 60 * 60 * 1000);
        const includeHiddenServices = role === 'admin';
        const existing = await storage.getSessionsWithFiltering({
          includeHiddenServices,
          startDate: rangeStart,
          endDate: rangeEnd,
          page: 1,
          limit: 5000,
        });
        const others = existing.sessions.filter((s: any) =>
          ['scheduled', 'confirmed', 'in-progress'].includes(s.status) && !groupIds.has(s.id),
        );

        const conflicts: string[] = [];
        for (const u of updates) {
          const candStart = u.newDate;
          const therapistBusy = others.some((s: any) => {
            if (s.therapistId !== effectiveTherapistId) return false;
            const exStart = new Date(s.sessionDate);
            const exDuration = (s.service as any)?.duration || s.duration || 60;
            return checkTimeConflict(candStart, durationMinutes, exStart, exDuration);
          });
          if (therapistBusy) {
            conflicts.push(`${formatInTimeZone(candStart, RECURRENCE_PRACTICE_TZ, 'MMM d, h:mm a')} — therapist is busy`);
          }
          if (effectiveRoomId) {
            const roomBusy = others.some((s: any) => {
              if (s.roomId !== effectiveRoomId) return false;
              const exStart = new Date(s.sessionDate);
              const exDuration = (s.service as any)?.duration || s.duration || 60;
              return checkTimeConflict(candStart, durationMinutes, exStart, exDuration);
            });
            if (roomBusy) {
              conflicts.push(`${formatInTimeZone(candStart, RECURRENCE_PRACTICE_TZ, 'MMM d, h:mm a')} — room is occupied`);
            }
          }
        }

        if (conflicts.length > 0) {
          return res.status(409).json({
            message: `Scheduling conflict on ${conflicts.length} session(s): ${conflicts.join('; ')}`,
            conflicts,
          });
        }
      }

      // Apply the updates atomically and clear pending reminders for these sessions
      const updatedIds = updates.map((u) => u.session.id);
      const serviceChanged = body.serviceId !== undefined && body.serviceId !== anchor.serviceId;
      await db.transaction(async (tx) => {
        for (const u of updates) {
          await tx.update(sessions).set({
            sessionDate: u.newDate,
            roomId: effectiveRoomId ?? null,
            notes: body.notes === undefined ? u.session.notes : (body.notes || null),
            serviceId: effectiveServiceId,
            therapistId: effectiveTherapistId,
            sessionType: effectiveSessionType,
            zoomEnabled: body.zoomEnabled === undefined ? u.session.zoomEnabled : body.zoomEnabled,
          }).where(eq(sessions.id, u.session.id));
        }
        await tx.delete(scheduledNotifications).where(inArray(scheduledNotifications.sessionId, updatedIds));
      });

      // Update billing where the service changed and a billing record exists
      if (serviceChanged) {
        try {
          const newService = await storage.getServiceById(effectiveServiceId);
          if (newService) {
            for (const u of updates) {
              try {
                const existingBilling = await storage.getSessionBilling(u.session.id);
                if (existingBilling) {
                  const units = existingBilling.units ?? 1;
                  const totalAmount = (parseFloat(newService.baseRate) * units).toFixed(2);
                  await db.update(sessionBilling).set({
                    serviceCode: newService.serviceCode,
                    ratePerUnit: newService.baseRate,
                    totalAmount,
                  }).where(eq(sessionBilling.sessionId, u.session.id));
                }
              } catch (e) {
                console.error('[RECURRING EDIT] Billing update failed for session', u.session.id, e);
              }
            }
          }
        } catch (e) {
          console.error('[RECURRING EDIT] Billing service lookup failed:', e);
        }
      }

      // Reschedule reminders for each occurrence (scheduled reminders only — no
      // per-session immediate emails, matching how the series was created).
      let roomName: string | null = null;
      if (effectiveRoomId) {
        try {
          const rooms = await storage.getRooms();
          const room = rooms.find((r) => r.id === effectiveRoomId);
          roomName = room?.roomName || room?.roomNumber || `Room ${effectiveRoomId}`;
        } catch {}
      }
      const client = await storage.getClient(anchor.clientId);
      const therapist = await storage.getUser(effectiveTherapistId);
      for (const u of updates) {
        try {
          await notificationService.processEvent('session_scheduled', {
            id: u.session.id,
            clientId: anchor.clientId,
            therapistId: effectiveTherapistId,
            clientName: client?.fullName || 'Unknown Client',
            therapistName: therapist?.fullName || 'Unknown Therapist',
            sessionDate: u.newDate,
            sessionType: effectiveSessionType,
            roomId: effectiveRoomId,
            roomName,
            duration: durationMinutes,
          }, { scheduledOnly: true });
        } catch (e) {
          console.error('[RECURRING EDIT] Reminder reschedule failed for session', u.session.id, e);
        }
      }

      // Audit
      try {
        await AuditLogger.logAction({
          userId: req.user.id,
          action: 'session_updated',
          result: 'success',
          resourceType: 'session',
          resourceId: groupId,
          details: `Edited recurring series ${groupId} (this and ${updatedIds.length} future session(s))`,
          ipAddress,
          userAgent,
        });
      } catch (e) {
        console.error('[RECURRING EDIT] Audit log failed:', e);
      }

      res.json({ message: "Series updated", updatedCount: updatedIds.length, sessionIds: updatedIds });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid request", errors: error.errors });
      }
      console.error('[RECURRING EDIT] Error:', error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.put("/api/sessions/:id", requireAuth, async (req: AuthenticatedRequest, res) => {
    const { ipAddress, userAgent } = getRequestInfo(req);
    
    try {
      const id = parseInt(req.params.id);
      
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid session ID" });
      }
      
      // Get original session data before update (for rescheduling notification)
      const originalSessionResult = await db.select().from(sessions).where(eq(sessions.id, id));
      if (!originalSessionResult || originalSessionResult.length === 0) {
        return res.status(404).json({ message: "Session not found" });
      }
      const originalSession = originalSessionResult[0];
      
      // Convert sessionDate string to Date object if needed (same as create)
      const sessionData = { ...req.body };
      if (sessionData.sessionDate) {
        const dateValue = typeof sessionData.sessionDate === 'string' 
          ? new Date(sessionData.sessionDate) 
          : sessionData.sessionDate;
        
        // Check if the date conversion was successful
        if (isNaN(dateValue.getTime())) {
          console.error(`Invalid date received: ${sessionData.sessionDate}`);
          return res.status(400).json({ message: "Invalid session date format" });
        }
        
        sessionData.sessionDate = dateValue;
        
        // BUSINESS HOURS VALIDATION: Reject sessions after 12 AM (24:00) in practice timezone
        const PRACTICE_TIMEZONE = 'America/New_York'; // EST/EDT - should match practice settings
        const BUSINESS_END_HOUR = 24; // 12 AM (midnight) in 24-hour format
        
        // Get actual session duration from service or default to 60 minutes
        let sessionDurationMinutes = 60; // Default fallback
        if (sessionData.serviceId) {
          try {
            const service = await storage.getServiceById(sessionData.serviceId);
            if (service && service.duration) {
              sessionDurationMinutes = service.duration;
            }
          } catch (error) {
            // If service lookup fails, use default duration
            console.warn('Could not fetch service duration, using default 60 minutes');
          }
        }
        
        const sessionInPracticeTz = toZonedTime(dateValue, PRACTICE_TIMEZONE);
        const sessionHour = sessionInPracticeTz.getHours();
        const sessionMinute = sessionInPracticeTz.getMinutes();
        
        // Calculate session end time
        const sessionStartMinutes = sessionHour * 60 + sessionMinute;
        const sessionEndMinutes = sessionStartMinutes + sessionDurationMinutes;
        const sessionEndHour = Math.floor(sessionEndMinutes / 60);
        const sessionEndMinute = sessionEndMinutes % 60;
        const businessEndMinutes = BUSINESS_END_HOUR * 60; // 24:00 = 1440 minutes
        
        // Check if session starts at or after 12:00 AM (midnight)
        if (sessionStartMinutes >= businessEndMinutes) {
          return res.status(400).json({ 
            message: "Session cannot be scheduled after 12:00 AM (midnight). Business hours end at 12:00 AM.",
            businessHours: "8:00 AM - 12:00 AM"
          });
        }
        
        // Check if session ends after 12:00 AM (midnight)
        if (sessionEndMinutes > businessEndMinutes) {
          const endTimeFormatted = `${sessionEndHour}:${sessionEndMinute.toString().padStart(2, '0')}`;
          return res.status(400).json({ 
            message: `This ${sessionDurationMinutes}-minute session would end at ${endTimeFormatted}, which is past business hours (12:00 AM). Please choose an earlier time.`,
            businessHours: "8:00 AM - 12:00 AM"
          });
        }

        // Check for conflicts when updating session time/therapist/room
        if (sessionData.therapistId || sessionData.roomId) {
          // Use proper service filtering for conflict checking
          const includeHiddenServices = (req as any).user?.role === 'admin';
          const sessionResults = await storage.getSessionsWithFiltering({
            includeHiddenServices,
            startDate: sessionData.sessionDate,
            endDate: sessionData.sessionDate,
            page: 1,
            limit: 1000
          });
          const allSessions = sessionResults.sessions;
          
          // Check therapist conflicts
          const therapistConflicts = sessionData.therapistId ? allSessions.filter(session => {
            if (session.id === id) return false; // Skip current session
            if (session.therapistId !== sessionData.therapistId) return false;
            
            const existingDate = new Date(session.sessionDate);
            const newDate = new Date(sessionData.sessionDate);
            if (existingDate.toDateString() !== newDate.toDateString()) return false;
            
            return checkTimeConflict(newDate, 60, existingDate, 60);
          }) : [];

          // Check room conflicts
          const roomConflicts = sessionData.roomId ? allSessions.filter(session => {
            if (session.id === id) return false; // Skip current session
            if (session.roomId !== sessionData.roomId) return false;
            
            const existingDate = new Date(session.sessionDate);
            const newDate = new Date(sessionData.sessionDate);
            if (existingDate.toDateString() !== newDate.toDateString()) return false;
            
            return checkTimeConflict(newDate, 60, existingDate, 60);
          }) : [];

          const hasConflicts = therapistConflicts.length > 0 || roomConflicts.length > 0;

          if (hasConflicts && !req.body.ignoreConflicts) {
            // Format conflict times in EST
            const formatSessionTime = (date: Date) => {
              const timeInEst = toZonedTime(date, 'America/New_York');
              const hours = timeInEst.getHours();
              const minutes = timeInEst.getMinutes();
              const ampm = hours >= 12 ? 'PM' : 'AM';
              const displayHours = hours % 12 || 12;
              return `${displayHours}:${minutes.toString().padStart(2, '0')} ${ampm}`;
            };
            
            // Build detailed conflict messages
            const conflicts: string[] = [];
            
            // Get room info for conflicts if needed
            const roomsMap = new Map();
            if (roomConflicts.length > 0) {
              try {
                const rooms = await storage.getRooms();
                rooms.forEach(room => {
                  roomsMap.set(room.id, room.roomName || room.roomNumber || `Room ${room.id}`);
                });
              } catch (error) {
                console.warn('Could not fetch rooms for conflict messages');
              }
            }
            
            if (therapistConflicts.length > 0) {
              therapistConflicts.forEach(session => {
                const time = formatSessionTime(new Date(session.sessionDate));
                const therapistName = session.therapist?.fullName || 'Therapist';
                const clientName = session.client?.fullName || 'another client';
                conflicts.push(`${therapistName} is busy at ${time} with ${clientName}`);
              });
            }
            
            if (roomConflicts.length > 0) {
              roomConflicts.forEach(session => {
                const time = formatSessionTime(new Date(session.sessionDate));
                const therapistName = session.therapist?.fullName || 'a therapist';
                const roomInfo = roomsMap.get(session.roomId) || `Room ${session.roomId}`;
                conflicts.push(`${roomInfo} is occupied at ${time} by ${therapistName}`);
              });
            }
            
            const conflictMessage = conflicts.length > 1 
              ? `Scheduling conflict: ${conflicts.join('; ')}`
              : `Scheduling conflict: ${conflicts[0]}`;
            
            return res.status(409).json({ 
              message: conflictMessage.trim(),
              therapistConflicts: therapistConflicts.map(session => ({
                id: session.id,
                clientName: session.client?.fullName || 'Unknown Client',
                sessionDate: session.sessionDate,
                sessionTime: formatSessionTime(new Date(session.sessionDate)),
                sessionType: session.sessionType,
                therapistName: session.therapist?.fullName || 'Unknown Therapist',
                type: 'therapist'
              })),
              roomConflicts: roomConflicts.map(session => ({
                id: session.id,
                clientName: 'Private Session',
                sessionDate: session.sessionDate,
                sessionTime: formatSessionTime(new Date(session.sessionDate)),
                sessionType: session.sessionType,
                therapistName: session.therapist?.fullName || 'Unknown Therapist',
                roomName: roomsMap.get(session.roomId) || `Room ${session.roomId}`,
                roomId: session.roomId,
                type: 'room'
              }))
            });
          }
        }
      }
      
      const validatedData = insertSessionSchema.partial().parse(sessionData);
      const session = await storage.updateSession(id, validatedData);
      
      // Update billing if service changed and billing record exists
      if (sessionData.serviceId && sessionData.serviceId !== originalSession.serviceId) {
        try {
          const existingBilling = await storage.getSessionBilling(id);
          if (existingBilling) {
            const newService = await storage.getServiceById(sessionData.serviceId);
            if (newService) {
              const units = existingBilling.units ?? 1;
              const ratePerUnit = newService.baseRate;
              const totalAmount = (parseFloat(ratePerUnit) * units).toFixed(2);
              
              await db.update(sessionBilling)
                .set({
                  serviceCode: newService.serviceCode,
                  ratePerUnit: ratePerUnit,
                  totalAmount: totalAmount
                })
                .where(eq(sessionBilling.sessionId, id));
            }
          }
        } catch (billingUpdateError) {
          console.error(`Error updating billing for changed service in session ${id}:`, billingUpdateError);
        }
      }
      
      // Handle Zoom meeting creation if enabled and no existing meeting
      let zoomWarning = null;
      if (sessionData.zoomEnabled && !session.zoomMeetingId) {
        try {
          
          // Get client and therapist for Zoom meeting
          const client = await storage.getClient(session.clientId);
          const therapist = await storage.getUser(session.therapistId);
          
          // Get therapist's Zoom credentials
          const [therapistWithZoom] = await db.select({
            zoomAccountId: users.zoomAccountId,
            zoomClientId: users.zoomClientId,
            zoomClientSecret: users.zoomClientSecret,
            zoomAccessToken: users.zoomAccessToken,
            zoomTokenExpiry: users.zoomTokenExpiry,
          }).from(users).where(eq(users.id, session.therapistId));
          
          // Check if therapist has Zoom configured
          const hasTherapistZoom = therapistWithZoom?.zoomAccountId && 
                                    therapistWithZoom?.zoomClientId && 
                                    therapistWithZoom?.zoomClientSecret;
          
          if (!hasTherapistZoom) {
            throw new Error('ZOOM_NOT_CONFIGURED: Please configure your Zoom OAuth credentials in your profile. The client has been notified that you will send the Zoom link separately.');
          }
          
          // Use therapist's own Zoom credentials (required)
          const zoomCredentials = {
            accountId: therapistWithZoom.zoomAccountId!,
            clientId: therapistWithZoom.zoomClientId!,
            clientSecret: therapistWithZoom.zoomClientSecret!,
            accessToken: therapistWithZoom.zoomAccessToken,
            tokenExpiry: therapistWithZoom.zoomTokenExpiry,
          };
          
          const zoomMeeting = await zoomService.createMeeting({
            clientName: client?.fullName || 'Unknown Client',
            therapistName: therapist?.fullName || 'Unknown Therapist',
            sessionDate: session.sessionDate,
            duration: 60 // Default session duration
          }, zoomCredentials);
          
          // Update session with Zoom meeting details
          await storage.updateSession(session.id, {
            zoomMeetingId: zoomMeeting.id.toString(),
            zoomJoinUrl: zoomMeeting.join_url,
            zoomPassword: zoomMeeting.password || '',
          });
        } catch (zoomError) {
          console.error('Zoom meeting creation failed for updated session:', zoomError);
          zoomWarning = zoomError instanceof Error ? zoomError.message : 'Failed to create Zoom meeting';
        }
      }
      
      // Trigger billing when session status changes to completed or no_show
      if (sessionData.status === 'completed' || sessionData.status === 'no_show') {
        try {
          // Check if billing already exists
          const existingBilling = await storage.getSessionBilling(id);
          if (!existingBilling) {
            await storage.createSessionBilling(id);
          }
        } catch (billingError) {
          console.error(`Error creating billing for session ${id}:`, billingError);
          // Continue with session update even if billing fails
        }
      }
      
      // Trigger session_rescheduled notification if date/time changed
      if (sessionData.sessionDate && originalSession.sessionDate) {
        const originalDate = new Date(originalSession.sessionDate).getTime();
        const newDate = new Date(session.sessionDate).getTime();
        
        if (originalDate !== newDate) {
          try {
            const client = await storage.getClient(session.clientId);
            const therapist = await storage.getUser(session.therapistId);
            
            // Get room name if room is assigned
            let roomName = null;
            if (session.roomId) {
              try {
                const rooms = await storage.getRooms();
                const room = rooms.find(r => r.id === session.roomId);
                roomName = room?.roomName || room?.roomNumber || `Room ${session.roomId}`;
              } catch (error) {
                console.warn('Could not fetch room name for notification');
                roomName = `Room ${session.roomId}`;
              }
            }
            
            const notificationData = {
              id: session.id,
              clientId: session.clientId,
              therapistId: session.therapistId,
              clientName: client?.fullName || 'Unknown Client',
              therapistName: therapist?.fullName || 'Unknown Therapist',
              sessionType: session.sessionType,
              oldSessionDate: originalSession.sessionDate,
              sessionDate: session.sessionDate,
              roomId: session.roomId,
              roomName: roomName,
              duration: 60,
              // Set zoomEnabled based on actual Zoom data presence, not just the flag
              zoomEnabled: !!(session.zoomJoinUrl || session.zoomMeetingId),
              zoomJoinUrl: session.zoomJoinUrl || null,
              zoomMeetingId: session.zoomMeetingId || null,
              zoomPassword: session.zoomPassword || null
            };
            
            await notificationService.processEvent('session_rescheduled', notificationData);
          } catch (notificationError) {
            console.error('Session rescheduled notification failed:', notificationError);
            // Continue with response even if notification fails
          }
        }
      }
      
      // HIPAA Audit Log: Session updated
      if ((req as any).user) {
        const user = (req as any).user;
        await AuditLogger.logSessionAccess(
          user.id,
          user.username,
          id,
          session.clientId,
          'session_updated',
          ipAddress,
          userAgent,
          { 
            fieldsUpdated: Object.keys(validatedData),
            dateChanged: sessionData.sessionDate && originalSession.sessionDate !== sessionData.sessionDate,
            statusChanged: sessionData.status && originalSession.status !== sessionData.status
          }
        );
      }
      
      res.json({ 
        ...session, 
        warning: zoomWarning || undefined 
      });
    } catch (error) {
      console.error(`Error updating session ${req.params.id}:`, error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid session data", errors: error.errors });
      }
      res.status(500).json({ message: "Internal server error", error: (error as any)?.message, stack: (error as any)?.stack });
    }
  });

  app.get("/api/clients/:clientId/sessions", requireAuth, blockAccountant, async (req: AuthenticatedRequest, res) => {
    try {
      if (!req.user) {
        return res.status(401).json({ message: "Authentication required" });
      }
      
      const clientId = parseInt(req.params.clientId);
      
      // Only admins can see sessions with hidden services
      const includeHiddenServices = req.user.role === 'admin' || req.user.role === 'administrator';
      
      const sessions = await storage.getSessionsByClient(clientId, includeHiddenServices);
      res.json(sessions);
    } catch (error) {
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Global document review hub — returns all pending-review documents scoped by role
  app.get("/api/documents/pending-review", requireAuth, blockAccountant, async (req: AuthenticatedRequest, res) => {
    try {
      if (!req.user) return res.status(401).json({ message: "Authentication required" });
      const role = req.user.role?.toLowerCase();
      const userId = req.user.id;

      let conditions: any[] = [eq(documents.reviewStatus, 'pending_review')];

      if (role === 'therapist') {
        // Therapist sees only their own clients' documents flagged for therapist review
        const therapistClients = await db
          .select({ id: clients.id })
          .from(clients)
          .where(eq(clients.assignedTherapistId, userId));
        const clientIds = therapistClients.map(c => c.id);
        if (!clientIds.length) return res.json([]);
        conditions.push(inArray(documents.clientId, clientIds));
        conditions.push(eq(documents.requiresTherapistReview, true));
      } else if (role === 'supervisor') {
        // Supervisor sees documents from supervised therapists' clients flagged for supervisor review
        const assignments = await storage.getSupervisorAssignments(userId);
        const therapistIds = assignments.map(a => a.therapistId);
        if (!therapistIds.length) return res.json([]);
        const supervisedClients = await db
          .select({ id: clients.id })
          .from(clients)
          .where(inArray(clients.assignedTherapistId, therapistIds));
        const clientIds = supervisedClients.map(c => c.id);
        if (!clientIds.length) return res.json([]);
        conditions.push(inArray(documents.clientId, clientIds));
        conditions.push(eq(documents.requiresSupervisorReview, true));
      }
      // admin sees all pending documents (no extra conditions)

      const rows = await db
        .select({
          id: documents.id,
          fileName: documents.fileName,
          originalName: documents.originalName,
          fileSize: documents.fileSize,
          category: documents.category,
          reviewStatus: documents.reviewStatus,
          requiresTherapistReview: documents.requiresTherapistReview,
          requiresSupervisorReview: documents.requiresSupervisorReview,
          createdAt: documents.createdAt,
          clientId: documents.clientId,
          clientFullName: clients.fullName,
          uploadedById: documents.uploadedById,
        })
        .from(documents)
        .leftJoin(clients, eq(documents.clientId, clients.id))
        .where(and(...conditions))
        .orderBy(asc(documents.createdAt));

      // Batch-fetch uploader names
      const uploaderIds = Array.from(new Set(rows.map(r => r.uploadedById).filter(Boolean))) as number[];
      const uploaderMap: Record<number, string> = {};
      if (uploaderIds.length) {
        const uploaders = await db.select({ id: users.id, fullName: users.fullName }).from(users).where(inArray(users.id, uploaderIds));
        uploaders.forEach(u => { uploaderMap[u.id] = u.fullName; });
      }

      const now = new Date();
      const result = rows.map(r => {
        const nameParts = (r.clientFullName || '').trim().split(' ');
        const clientFirstName = nameParts[0] || '';
        const clientLastName = nameParts.slice(1).join(' ') || '';
        return {
          ...r,
          clientFirstName,
          clientLastName,
          uploadedByName: r.uploadedById ? (uploaderMap[r.uploadedById] || null) : null,
          waitingHours: Math.floor((now.getTime() - new Date(r.createdAt).getTime()) / (1000 * 60 * 60)),
          isOverdue: (now.getTime() - new Date(r.createdAt).getTime()) > 24 * 60 * 60 * 1000,
        };
      });

      res.json(result);
    } catch (error) {
      console.error("Pending review fetch error:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Get all SRS ratings for a client's sessions (therapist/supervisor/admin view)
  app.get("/api/clients/:clientId/session-ratings", requireAuth, blockAccountant, async (req: AuthenticatedRequest, res) => {
    try {
      const clientId = parseInt(req.params.clientId);
      const ratings = await db
        .select()
        .from(sessionRatings)
        .where(eq(sessionRatings.clientId, clientId))
        .orderBy(desc(sessionRatings.completedAt));
      res.json(ratings);
    } catch (error) {
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Get session conflicts for a client
  app.get("/api/clients/:clientId/session-conflicts", requireAuth, blockAccountant, async (req: AuthenticatedRequest, res) => {
    try {
      if (!req.user) {
        return res.status(401).json({ message: "Authentication required" });
      }
      
      const clientId = parseInt(req.params.clientId);
      
      // Only admins can see session conflicts with hidden services
      const includeHiddenServices = req.user.role === 'admin';
      
      const conflicts = await storage.getClientSessionConflicts(clientId, includeHiddenServices);
      res.json(conflicts);
    } catch (error) {
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Delete a session - with related data cleanup in a transaction
  app.delete("/api/sessions/:id", requireAuth, async (req: AuthenticatedRequest, res) => {
    const { ipAddress, userAgent } = getRequestInfo(req);
    try {
      if (!req.user) {
        return res.status(401).json({ message: "Authentication required" });
      }

      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid session ID" });
      }

      const role = req.user.role?.toLowerCase();
      const allowedRoles = ['admin', 'administrator', 'supervisor', 'therapist'];
      if (!allowedRoles.includes(role)) {
        return res.status(403).json({ message: "You do not have permission to delete sessions" });
      }

      // Single session lookup
      const sessionResult = await db.select().from(sessions).where(eq(sessions.id, id));
      if (!sessionResult || sessionResult.length === 0) {
        return res.status(404).json({ message: "Session not found" });
      }
      const session = sessionResult[0];

      // Therapists can only delete their own sessions
      if (role === 'therapist' && session.therapistId !== req.user.id) {
        return res.status(403).json({ message: "You can only delete your own sessions" });
      }

      // Transactional deletion of session and all related records
      await db.transaction(async (tx) => {
        await tx.delete(sessionBilling).where(eq(sessionBilling.sessionId, id));
        await tx.delete(sessionNotes).where(eq(sessionNotes.sessionId, id));
        await tx.delete(scheduledNotifications).where(eq(scheduledNotifications.sessionId, id));
        await tx.delete(roomBookings).where(eq(roomBookings.sessionId, id));
        await tx.delete(sessions).where(eq(sessions.id, id));
      });

      // Audit log (outside transaction - non-critical)
      await AuditLogger.logAction({
        userId: req.user.id,
        action: 'session_deleted',
        result: 'success',
        resourceType: 'session',
        resourceId: id.toString(),
        details: `Deleted session #${id} for client ${session.clientId} on ${session.sessionDate}`,
        ipAddress,
        userAgent,
      });

      res.json({ message: "Session deleted successfully" });
    } catch (error) {
      console.error("Error deleting session:", error);
      res.status(500).json({ message: "Failed to delete session" });
    }
  });

  // Monthly sessions route for calendar - SECURE: Uses authenticated user context
  app.get("/api/sessions/:year/:month/month", requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      if (!req.user) {
        return res.status(401).json({ message: "Authentication required" });
      }
      
      const year = parseInt(req.params.year);
      const month = parseInt(req.params.month);
      
      if (isNaN(year) || isNaN(month) || month < 1 || month > 12) {
        return res.status(400).json({ message: "Invalid year or month" });
      }
      
      // SECURITY: Use authenticated user context instead of query params
      let therapistIdFilter: number | undefined;
      let supervisedTherapistIds: number[] | undefined;

      if (req.user.role === "therapist") {
        therapistIdFilter = req.user.id;
      } else if (req.user.role === "supervisor") {
        const supervisorAssignments = await storage.getSupervisorAssignments(req.user.id);
        
        if (supervisorAssignments.length === 0) {
          return res.json([]);
        }
        
        supervisedTherapistIds = supervisorAssignments.map(assignment => assignment.therapistId);
      }

      // Only admins can see sessions with hidden services
      const includeHiddenServices = req.user.role === 'admin' || req.user.role === 'administrator';
      
      let sessions = await storage.getSessionsByMonth(year, month, therapistIdFilter, supervisedTherapistIds, includeHiddenServices);
      
      // Redact client names for accountant role
      if (req.user!.role === "accountant") {
        sessions = sessions.map((s: any) => redactSessionClient(s));
      }
      
      res.json(sessions);
    } catch (error) {

      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Get recent sessions for dashboard
  app.get("/api/sessions/recent", requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      if (!req.user) {
        return res.status(401).json({ message: "Authentication required" });
      }

      const limit = parseInt(req.query.limit as string) || 10;
      
      // Use authenticated user context instead of query params
      let therapistId: number | undefined;
      let supervisedTherapistIds: number[] | undefined;
      
      if (req.user.role === "therapist") {
        therapistId = req.user.id;
      } else if (req.user.role === "supervisor") {
        const supervisorAssignments = await storage.getSupervisorAssignments(req.user.id);
        if (supervisorAssignments.length === 0) return res.json([]);
        supervisedTherapistIds = supervisorAssignments.map(assignment => assignment.therapistId);
      }
      
      // Only admins can see sessions with hidden services
      const includeHiddenServices = req.user.role === 'admin' || req.user.role === 'administrator';
      
      // Call storage method with role-based parameters - storage handles filtering
      let recentSessions = await storage.getRecentSessions(limit, therapistId, supervisedTherapistIds, includeHiddenServices);
      
      if (req.user!.role === "accountant") {
        recentSessions = recentSessions.map((s: any) => redactSessionClient(s));
      }
      
      res.json(recentSessions);
    } catch (error) {
      console.error("Error fetching recent sessions:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Get upcoming sessions for dashboard
  app.get("/api/sessions/upcoming", requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      if (!req.user) {
        return res.status(401).json({ message: "Authentication required" });
      }

      const limit = parseInt(req.query.limit as string) || 10;
      
      // Use authenticated user context instead of query params
      let therapistId: number | undefined;
      let supervisedTherapistIds: number[] | undefined;
      
      if (req.user.role === "therapist") {
        therapistId = req.user.id;
      } else if (req.user.role === "supervisor") {
        const supervisorAssignments = await storage.getSupervisorAssignments(req.user.id);
        supervisedTherapistIds = supervisorAssignments.map(assignment => assignment.therapistId);
      }
      
      // Only admins can see sessions with hidden services
      const includeHiddenServices = req.user.role === 'admin' || req.user.role === 'administrator';
      
      // Call storage method with role-based parameters - storage handles filtering
      let upcomingSessions = await storage.getUpcomingSessions(limit, therapistId, supervisedTherapistIds, includeHiddenServices);
      
      if (req.user!.role === "accountant") {
        upcomingSessions = upcomingSessions.map((s: any) => redactSessionClient(s));
      }
      
      res.json(upcomingSessions);
    } catch (error) {
      console.error("Error fetching upcoming sessions:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Get overdue sessions for dashboard - SECURE: Uses authenticated user context
  app.get("/api/sessions/overdue", requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      if (!req.user) {
        return res.status(401).json({ message: "Authentication required" });
      }
      
      const limit = parseInt(req.query.limit as string) || 10;
      
      // SECURITY: Use authenticated user context instead of query params
      let therapistId: number | undefined;
      let supervisedTherapistIds: number[] | undefined;
      
      if (req.user.role === "therapist") {
        therapistId = req.user.id;
      } else if (req.user.role === "supervisor") {
        const supervisorAssignments = await storage.getSupervisorAssignments(req.user.id);
        if (supervisorAssignments.length === 0) return res.json([]);
        supervisedTherapistIds = supervisorAssignments.map(assignment => assignment.therapistId);
      }
      
      // Only admins can see sessions with hidden services
      const includeHiddenServices = req.user.role === 'admin' || req.user.role === 'administrator';
      
      // Call storage method with role-based parameters - storage handles filtering
      let overdueSessions = await storage.getOverdueSessions(limit, therapistId, supervisedTherapistIds, includeHiddenServices);
      
      if (req.user!.role === "accountant") {
        overdueSessions = overdueSessions.map((s: any) => redactSessionClient(s));
      }
      
      res.json(overdueSessions);
    } catch (error) {
      console.error("Error fetching overdue sessions:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Check for overdue sessions and trigger notifications
  app.post("/api/sessions/check-overdue", requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      if (!req.user) {
        return res.status(401).json({ message: "Authentication required" });
      }
      
      const limit = Number(req.body?.limit ?? 10);
      
      // Start background processing immediately
      setImmediate(async () => {
        try {
          // Only admins can trigger checks on sessions with hidden services
          const includeHiddenServices = req.user?.role === 'admin';
          const overdueSessions = await storage.getOverdueSessions(undefined, undefined, undefined, includeHiddenServices);
          const sessionsToProcess = overdueSessions.slice(0, limit);
          
          let processed = 0;
          for (const session of sessionsToProcess) {
            try {
              await notificationService.processEvent('session_overdue', {
                id: session.id,
                clientId: session.clientId,
                clientCaseId: session.client?.clientId,
                clientName: session.client!.fullName,
                therapistId: session.therapistId,
                therapistName: session.therapist.fullName,
                sessionDate: session.sessionDate,
                status: session.status,
                sessionType: session.sessionType,
                overdueBy: Math.floor((Date.now() - new Date(session.sessionDate).getTime()) / (1000 * 60 * 60 * 24))
              });
              processed++;
            } catch (notificationError) {
              console.error(`Error processing overdue session notification ${session.id}:`, notificationError);
            }
          }
        } catch (error) {
          console.error('Background processing error:', error);
        }
      });
      
      // Return immediate response
      return res.status(202).json({
        message: "Overdue session notifications processing started",
        limit,
        status: "accepted"
      });
    } catch (error) {
      console.error('Error starting overdue sessions check:', error);
      return res.status(500).json({ message: "Internal server error" });
    }
  });

  // Check for overdue tasks and trigger notifications
  app.post("/api/tasks/check-overdue", requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const limit = Number(req.body?.limit ?? 10);
      
      // Start background processing immediately
      setImmediate(async () => {
        try {
          const overdueTasks = await storage.getOverdueTasks();
          const tasksToProcess = overdueTasks.slice(0, limit);
          
          let processed = 0;
          for (const task of tasksToProcess) {
            try {
              await notificationService.processEvent('task_overdue', {
                id: task.id,
                title: task.title,
                description: task.description,
                clientId: task.clientId,
                clientName: task.client.fullName,
                assignedToId: task.assignedToId,
                assignedToName: task.assignedTo.fullName,
                dueDate: task.dueDate,
                status: task.status,
                priority: task.priority,
                overdueBy: Math.floor((Date.now() - new Date(task.dueDate!).getTime()) / (1000 * 60 * 60 * 24))
              });
              processed++;
            } catch (notificationError) {
              console.error(`Error processing overdue task notification ${task.id}:`, notificationError);
            }
          }
        } catch (error) {
          console.error('Background task processing error:', error);
        }
      });
      
      // Return immediate response
      return res.status(202).json({
        message: "Overdue task notifications processing started",
        limit,
        status: "accepted"
      });
    } catch (error) {
      console.error('Error starting overdue tasks check:', error);
      return res.status(500).json({ message: "Internal server error" });
    }
  });

  // Tasks routes
  app.get("/api/clients/:clientId/tasks", requireAuth, blockAccountant, async (req: AuthenticatedRequest, res) => {
    try {
      const clientId = parseInt(req.params.clientId);
      const tasks = await storage.getTasksByClient(clientId);
      
      // Add comment counts and recent comments to each task
      const tasksWithComments = await Promise.all(tasks.map(async (task) => {
        const comments = await storage.getTaskComments(task.id);
        return {
          ...task,
          commentCount: comments.length,
          recentComments: comments.slice(-2).reverse() // Last 2 comments, newest first
        };
      }));
      
      res.json(tasksWithComments);
    } catch (error) {
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Enhanced Task Management Routes
  app.get("/api/tasks", requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      if (!req.user) {
        return res.status(401).json({ message: "Authentication required" });
      }

      const {
        page = "1",
        pageSize = "25",
        search,
        status,
        priority,
        assignedToId,
        clientId,
        sortBy = "createdAt",
        sortOrder = "desc",
        includeCompleted = "false",
        // New date filtering parameters
        dueDateFrom,
        dueDateTo,
        createdDateFrom,
        createdDateTo
      } = req.query;

      let filteredAssignedToId = assignedToId ? parseInt(assignedToId as string) : undefined;

      // SECURITY: Use authenticated user's role and ID from session, NOT from query params
      if (req.user.role === "therapist") {
        // Therapists can only see tasks assigned to them
        filteredAssignedToId = req.user.id;
      } else if (req.user.role === "supervisor") {
        // Supervisors can only see tasks for their supervised therapists
        const supervisorAssignments = await storage.getSupervisorAssignments(req.user.id);
        
        if (supervisorAssignments.length === 0) {
          return res.json({ tasks: [], total: 0, totalPages: 0 });
        }
        
        const supervisedTherapistIds = supervisorAssignments.map(assignment => assignment.therapistId);
        
        if (assignedToId) {
          const requestedTherapistId = parseInt(assignedToId as string);
          if (!supervisedTherapistIds.includes(requestedTherapistId)) {
            return res.json({ tasks: [], total: 0, totalPages: 0 });
          }
        }
      }

      const params: TaskQueryParams = {
        page: parseInt(page as string),
        pageSize: parseInt(pageSize as string),
        search: search as string,
        status: status as string,
        priority: priority as string,
        assignedToId: filteredAssignedToId,
        clientId: clientId ? parseInt(clientId as string) : undefined,
        sortBy: sortBy as string,
        sortOrder: sortOrder as "asc" | "desc",
        includeCompleted: includeCompleted === "true",
        // Date filtering parameters
        dueDateFrom: dueDateFrom ? new Date(dueDateFrom as string) : undefined,
        dueDateTo: dueDateTo ? new Date(dueDateTo as string) : undefined,
        createdDateFrom: createdDateFrom ? new Date(createdDateFrom as string) : undefined,
        createdDateTo: createdDateTo ? new Date(createdDateTo as string) : undefined
      };

      // SECURITY: Add role-based parameters to params using authenticated user
      if (req.user.role === "therapist") {
        params.therapistId = req.user.id;
      } else if (req.user.role === "supervisor") {
        const supervisorAssignments = await storage.getSupervisorAssignments(req.user.id);
        params.supervisedTherapistIds = supervisorAssignments.map(assignment => assignment.therapistId);
      }
      
      // Storage method now handles role-based filtering
      const result = await storage.getAllTasks(params);
      
      // Add comment counts and recent comments to each task
      const tasksWithComments = await Promise.all(result.tasks.map(async (task) => {
        const comments = await storage.getTaskComments(task.id);
        return {
          ...task,
          commentCount: comments.length,
          recentComments: comments.slice(-2).reverse() // Last 2 comments, newest first
        };
      }));
      
      // Redact client data for accountant role
      let finalTasks = tasksWithComments;
      if (req.user!.role === "accountant") {
        finalTasks = tasksWithComments.map((task: any) => ({
          ...task,
          client: redactClientData(task.client),
        }));
      }
      
      res.json({
        ...result,
        tasks: finalTasks
      });
    } catch (error) {

      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/tasks/stats", requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      if (!req.user) {
        return res.status(401).json({ message: "Authentication required" });
      }
      
      // Role-based filtering for task stats
      let therapistId: number | undefined;
      let supervisedTherapistIds: number[] | undefined;
      
      // SECURITY: Use authenticated user's role and ID from session
      if (req.user.role === "therapist") {
        therapistId = req.user.id;
      } else if (req.user.role === "supervisor") {
        const supervisorAssignments = await storage.getSupervisorAssignments(req.user.id);
        if (supervisorAssignments.length === 0) return res.json({ total: 0, pending: 0, inProgress: 0, completed: 0, overdue: 0 });
        supervisedTherapistIds = supervisorAssignments.map(assignment => assignment.therapistId);
      }
      
      const stats = await storage.getTaskStats(therapistId, supervisedTherapistIds);
      res.json(stats);
    } catch (error) {
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/tasks/recent", requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      if (!req.user) {
        return res.status(401).json({ message: "Authentication required" });
      }

      const limit = req.query.limit ? parseInt(req.query.limit as string) : 10;
      
      // Use authenticated user context instead of query params for security
      let therapistId: number | undefined;
      let supervisedTherapistIds: number[] | undefined;
      
      if (req.user.role === "therapist") {
        therapistId = req.user.id;
      } else if (req.user.role === "supervisor" || req.user.role === "clinical_supervisor") {
        const supervisorAssignments = await storage.getSupervisorAssignments(req.user.id);
        if (supervisorAssignments.length === 0) return res.json([]);
        supervisedTherapistIds = supervisorAssignments.map(assignment => assignment.therapistId);
      }
      
      // Call storage method with role-based parameters - storage handles filtering
      const recentTasks = await storage.getRecentTasks(limit, therapistId, supervisedTherapistIds);
      
      if (req.user!.role === "accountant") {
        res.json(recentTasks.map((task: any) => ({ ...task, client: redactClientData(task.client) })));
      } else {
        res.json(recentTasks);
      }
    } catch (error) {
      console.error("Error fetching recent tasks:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/tasks/upcoming", requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      if (!req.user) {
        return res.status(401).json({ message: "Authentication required" });
      }

      const limit = req.query.limit ? parseInt(req.query.limit as string) : 10;
      
      let therapistId: number | undefined;
      let supervisedTherapistIds: number[] | undefined;
      
      // SECURITY: Use authenticated user's role and ID from session
      if (req.user.role === "therapist") {
        therapistId = req.user.id;
      } else if (req.user.role === "supervisor") {
        const supervisorAssignments = await storage.getSupervisorAssignments(req.user.id);
        if (supervisorAssignments.length === 0) return res.json([]);
        supervisedTherapistIds = supervisorAssignments.map(assignment => assignment.therapistId);
      }
      
      // Call storage method with role-based parameters - storage handles filtering
      const upcomingTasks = await storage.getUpcomingTasks(limit, therapistId, supervisedTherapistIds);
      
      if (req.user!.role === "accountant") {
        res.json(upcomingTasks.map((task: any) => ({ ...task, client: redactClientData(task.client) })));
      } else {
        res.json(upcomingTasks);
      }
    } catch (error) {
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/tasks/:id", requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const id = parseInt(req.params.id);
      const task = await storage.getTask(id);
      
      if (!task) {
        return res.status(404).json({ message: "Task not found" });
      }
      
      if (req.user!.role === "accountant") {
        res.json({ ...task, client: redactClientData((task as any).client) });
      } else {
        res.json(task);
      }
    } catch (error) {
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post("/api/tasks", requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const taskData = { ...req.body };
      
      // Validate that clientId is provided and is a valid number
      if (!taskData.clientId || taskData.clientId === null || taskData.clientId === undefined || isNaN(parseInt(taskData.clientId))) {
        return res.status(400).json({ 
          message: "Client ID is required", 
          errors: [{ path: ["clientId"], message: "Client must be selected" }] 
        });
      }
      
      // Ensure clientId is converted to integer
      taskData.clientId = parseInt(taskData.clientId);
      
      // Clean up empty strings to undefined to prevent PostgreSQL date errors
      Object.keys(taskData).forEach(key => {
        if (taskData[key] === "" || taskData[key] === null) {
          taskData[key] = undefined;
        }
      });
      
      const validatedData = insertTaskSchema.parse(taskData);
      const task = await storage.createTask(validatedData);
      
      // Trigger task created notification for ALL new tasks
      try {
        // Get client details for proper notification rendering
        const client = await storage.getClient(task.clientId);
        
        await notificationService.processEvent('task_created', {
          id: task.id,
          title: task.title,
          description: task.description,
          clientId: task.clientId,
          clientName: client?.fullName || 'Unknown Client',
          clientReference: client?.referenceNumber || '',
          assignedToId: task.assignedToId,
          priority: task.priority,
          dueDate: task.dueDate,
          createdAt: task.createdAt
        });
      } catch (notificationError) {
        console.error('Task created notification failed:', notificationError);
      }
      
      // Trigger task assigned notification if task has an assignee
      if (task.assignedToId) {
        try {
          // Get client details for proper notification rendering
          const client = await storage.getClient(task.clientId);
          const assignedUser = await storage.getUser(task.assignedToId);
          
          await notificationService.processEvent('task_assigned', {
            id: task.id,
            title: task.title,
            description: task.description,
            clientId: task.clientId,
            clientCaseId: client?.clientId,
            clientName: client?.fullName || 'Unknown Client',
            clientReference: client?.referenceNumber || '',
            assignedToId: task.assignedToId,
            assignedToName: assignedUser?.fullName || 'Unknown User',
            priority: task.priority,
            dueDate: task.dueDate,
            createdAt: task.createdAt
          });
        } catch (notificationError) {
          console.error('Task assigned notification failed:', notificationError);
        }
      }
      
      res.status(201).json(task);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid task data", errors: error.errors });
      }
      if ((error as any).code === '23502') {
        return res.status(400).json({ 
          message: "Client ID is required", 
          errors: [{ path: ["clientId"], message: "Client must be selected" }] 
        });
      }
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.put("/api/tasks/:id", requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const id = parseInt(req.params.id);
      
      const taskData = { ...req.body };
      // Clean up empty strings to undefined to prevent PostgreSQL date errors
      Object.keys(taskData).forEach(key => {
        if (taskData[key] === "" || taskData[key] === null) {
          taskData[key] = undefined;
        }
      });
      
      const validatedData = insertTaskSchema.partial().parse(taskData);
      const task = await storage.updateTask(id, validatedData);
      res.json(task);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid task data", errors: error.errors });
      }
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.delete("/api/tasks/:id", requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const id = parseInt(req.params.id);
      await storage.deleteTask(id);
      res.status(204).send();
    } catch (error) {
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // ===== TASK COMMENTS API ROUTES =====
  // Get all comments for a specific task
  app.get("/api/tasks/:taskId/comments", requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const taskId = parseInt(req.params.taskId);
      const comments = await storage.getTaskComments(taskId);
      res.json(comments);
    } catch (error) {
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Create a new task comment
  app.post("/api/tasks/:taskId/comments", requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const taskId = parseInt(req.params.taskId);
      const commentData = { ...req.body, taskId };
      const validatedData = insertTaskCommentSchema.parse(commentData);
      const comment = await storage.createTaskComment(validatedData);
      res.status(201).json(comment);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid comment data", errors: error.errors });
      }
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Update a task comment
  app.put("/api/tasks/:taskId/comments/:commentId", requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const commentId = parseInt(req.params.commentId);
      const validatedData = insertTaskCommentSchema.partial().parse(req.body);
      const comment = await storage.updateTaskComment(commentId, validatedData);
      res.json(comment);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid comment data", errors: error.errors });
      }
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Delete a task comment
  app.delete("/api/tasks/:taskId/comments/:commentId", requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const commentId = parseInt(req.params.commentId);
      await storage.deleteTaskComment(commentId);
      res.status(204).send();
    } catch (error) {
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Notes routes
  app.get("/api/clients/:clientId/notes", requireAuth, blockAccountant, async (req: AuthenticatedRequest, res) => {
    try {
      const clientId = parseInt(req.params.clientId);
      const { noteType, startDate, endDate } = req.query;
      
      const params: any = { clientId };
      if (noteType) params.noteType = noteType as string;
      if (startDate) params.startDate = new Date(startDate as string);
      if (endDate) params.endDate = new Date(endDate as string);
      
      const notes = await storage.getNotesByClient(params);
      
      // HIPAA audit trail for accessing client notes
      await AuditLogger.logAction({
        userId: req.user!.id,
        action: 'notes_viewed',
        result: 'success',
        resourceType: 'client_notes',
        resourceId: clientId.toString(),
        details: `Viewed notes for client ${clientId}`,
        ...getRequestInfo(req),
      });
      
      res.json(notes);
    } catch (error) {
      console.error('Error fetching client notes:', error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/notes/:id", requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const noteId = parseInt(req.params.id);
      const note = await storage.getNote(noteId);
      
      if (!note) {
        return res.status(404).json({ message: "Note not found" });
      }
      
      // HIPAA audit trail for accessing specific note
      await AuditLogger.logAction({
        userId: req.user!.id,
        action: 'note_viewed',
        result: 'success',
        resourceType: 'note',
        resourceId: noteId.toString(),
        clientId: note.clientId,
        details: `Viewed note ${noteId} for client ${note.clientId}`,
        ...getRequestInfo(req),
      });
      
      res.json(note);
    } catch (error) {
      console.error('Error fetching note:', error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post("/api/notes", requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const validatedData = insertNoteSchema.parse(req.body);
      
      // Security: Derive authorId from authenticated user, never trust client
      const noteData = {
        ...validatedData,
        authorId: req.user!.id,
      };
      
      const note = await storage.createNote(noteData);
      
      // Log audit trail
      await AuditLogger.logAction({
        userId: req.user!.id,
        action: 'note_created',
        result: 'success',
        resourceType: 'note',
        resourceId: note.id.toString(),
        clientId: validatedData.clientId,
        details: `Created ${validatedData.noteType} note for client ${validatedData.clientId}`,
        ...getRequestInfo(req),
      });
      
      res.status(201).json(note);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid note data", errors: error.errors });
      }
      console.error('Error creating note:', error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.patch("/api/notes/:id", requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const noteId = parseInt(req.params.id);
      const validatedData = insertNoteSchema.partial().parse(req.body);
      
      // Security: Prevent client from changing authorId
      const { authorId, ...safeData } = validatedData as any;
      
      const note = await storage.updateNote(noteId, safeData);
      
      // Log audit trail
      await AuditLogger.logAction({
        userId: req.user!.id,
        action: 'note_updated',
        result: 'success',
        resourceType: 'note',
        resourceId: note.id.toString(),
        clientId: note.clientId,
        details: `Updated note ${note.id}`,
        ...getRequestInfo(req),
      });
      
      res.json(note);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid note data", errors: error.errors });
      }
      console.error('Error updating note:', error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.delete("/api/notes/:id", requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const noteId = parseInt(req.params.id);
      const note = await storage.getNote(noteId);
      
      if (!note) {
        return res.status(404).json({ message: "Note not found" });
      }
      
      await storage.deleteNote(noteId);
      
      // Log audit trail
      await AuditLogger.logAction({
        userId: req.user!.id,
        action: 'note_deleted',
        result: 'success',
        resourceType: 'note',
        resourceId: noteId.toString(),
        clientId: note.clientId,
        details: `Deleted note ${noteId} for client ${note.clientId}`,
        ...getRequestInfo(req),
      });
      
      res.status(204).send();
    } catch (error) {
      console.error('Error deleting note:', error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Documents routes
  app.get("/api/clients/:clientId/documents", requireAuth, blockAccountant, async (req: AuthenticatedRequest, res) => {
    try {
      const clientId = parseInt(req.params.clientId);
      const documents = await storage.getDocumentsByClient(clientId);
      res.json(documents);
    } catch (error) {
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Client Assessment Assignment routes
  app.get("/api/clients/:clientId/assessments", requireAuth, blockAccountant, async (req: AuthenticatedRequest, res) => {
    try {
      const clientId = parseInt(req.params.clientId);
      const assessments = await storage.getClientAssessments(clientId);
      res.json(assessments);
    } catch (error) {
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post("/api/clients/:clientId/assessments", requireAuth, blockAccountant, async (req: AuthenticatedRequest, res) => {
    try {
      const clientId = parseInt(req.params.clientId);
      const { templateId, assignedBy, status = 'assigned' } = req.body;
      
      
      const assessmentData = {
        clientId,
        templateId,
        assignedBy: assignedBy || ((req as any).user?.id || null),
        assignedDate: new Date(),
        status,
        responses: null,
        completedDate: null
      };
      
      const assessment = await storage.assignAssessmentToClient(assessmentData);
      res.status(201).json(assessment);
    } catch (error) {
      console.error('Assessment assignment error:', error);
      res.status(500).json({ message: "Internal server error", error: error instanceof Error ? error.message : 'Unknown error' });
    }
  });

  app.post("/api/clients/:clientId/documents", requireAuth, blockAccountant, async (req: AuthenticatedRequest, res) => {
    try {

      const clientId = parseInt(req.params.clientId);
      const { fileContent, requiresTherapistReview, requiresSupervisorReview, ...documentData } = req.body;
      
      // Get authenticated user from request
      const authenticatedUser = req.user;
      if (!authenticatedUser?.id) {
        return res.status(401).json({ message: "Authentication required for document upload" });
      }

      const needsReview = !!requiresTherapistReview || !!requiresSupervisorReview;

      const validatedData = insertDocumentSchema.parse({
        ...documentData,
        clientId,
        uploadedById: authenticatedUser.id,
        requiresTherapistReview: !!requiresTherapistReview,
        requiresSupervisorReview: !!requiresSupervisorReview,
        reviewStatus: needsReview ? 'pending_review' : null,
      });

      
      // Create document record
      const document = await storage.createDocument(validatedData);

      
      // Store file content in Azure Blob Storage
      if (fileContent) {
        try {
          const fileBuffer = Buffer.from(fileContent, 'base64');
          const uploadResult = await azureStorage.uploadFile(
            fileBuffer,
            document.fileName,
            document.mimeType,
            document.id,
            {
              clientId: document.clientId.toString(),
              uploadedById: document.uploadedById ? document.uploadedById.toString() : 'null',
              category: document.category
            }
          );
          
          if (!uploadResult.success) {
            // Delete document record if storage upload fails
            await storage.deleteDocument(document.id);
            throw new Error(`Azure Blob Storage upload failed: ${uploadResult.error}`);
          }
        } catch (error) {
          // Delete document record if upload fails
          await storage.deleteDocument(document.id);
          throw error;
        }
      }

      // Get client data for notification
      const client = await storage.getClient(clientId);
      if (client) {
        const clientName = client.fullName;
        const docName = document.originalName || document.fileName;
        const actionUrl = `/clients/${clientId}?tab=documents`;

        // Notify therapist if requested
        if (requiresTherapistReview && client.assignedTherapistId) {
          await storage.createNotification({
            userId: client.assignedTherapistId,
            type: 'document_review',
            title: 'Document Needs Your Review',
            message: `A new document "${docName}" has been uploaded for ${clientName} and requires your review.`,
            priority: 'high',
            actionUrl,
            actionLabel: 'Review Document',
            relatedEntityType: 'document',
            relatedEntityId: document.id,
          });
        }

        // Notify supervisor(s) if requested
        if (requiresSupervisorReview && client.assignedTherapistId) {
          const supervisorAssignment = await storage.getTherapistSupervisor(client.assignedTherapistId);
          if (supervisorAssignment) {
            await storage.createNotification({
              userId: supervisorAssignment.supervisorId,
              type: 'document_review',
              title: 'Document Pending Supervisor Review',
              message: `Document "${docName}" for ${clientName} requires your supervisor review.`,
              priority: 'high',
              actionUrl,
              actionLabel: 'Review Document',
              relatedEntityType: 'document',
              relatedEntityId: document.id,
            });
          }
        }

        // Always fire the generic document_uploaded event for audit/history
        await notificationService.processEvent('document_uploaded', {
          id: document.id,
          clientId: client.id,
          clientName,
          documentType: document.category || 'Document',
          documentId: document.id,
          assignedTherapistId: client.assignedTherapistId,
          uploadedBy: document.uploadedById,
          fileName: document.fileName
        });
      }
      
      res.status(201).json(document);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid document data", errors: error.errors });
      }
      console.error('Document upload error:', error);
      res.status(500).json({ message: "Internal server error", error: error instanceof Error ? error.message : 'Unknown error' });
    }
  });

  // Review a document (mark as reviewed or rejected)
  app.patch("/api/clients/:clientId/documents/:id/review", requireAuth, blockAccountant, async (req: AuthenticatedRequest, res) => {
    try {
      const clientId = parseInt(req.params.clientId);
      const docId = parseInt(req.params.id);
      const { action, reviewNotes, reviewChecklist } = req.body;
      const userId = req.user?.id;

      if (!userId) return res.status(401).json({ message: "Authentication required" });
      if (!['reviewed', 'rejected'].includes(action)) {
        return res.status(400).json({ message: "Action must be 'reviewed' or 'rejected'" });
      }

      const existing = await db.select().from(documents).where(and(eq(documents.id, docId), eq(documents.clientId, clientId))).limit(1);
      if (!existing.length) return res.status(404).json({ message: "Document not found" });
      const previousStatus = existing[0].reviewStatus;

      const updated = await db
        .update(documents)
        .set({
          reviewStatus: action,
          reviewedById: userId,
          reviewedAt: new Date(),
          reviewNotes: reviewNotes || null,
          reviewChecklist: reviewChecklist || null,
        })
        .where(and(eq(documents.id, docId), eq(documents.clientId, clientId)))
        .returning();

      if (!updated.length) return res.status(404).json({ message: "Document not found" });

      const reviewer = await db.select({ username: users.username }).from(users).where(eq(users.id, userId)).limit(1);
      const reviewerName = reviewer[0]?.username || 'unknown';

      await db.insert(auditLogs).values({
        userId,
        username: reviewerName,
        action: action === 'reviewed' ? 'document_approved' : 'document_rejected',
        result: 'success',
        resourceType: 'document',
        resourceId: String(docId),
        clientId,
        details: JSON.stringify({
          documentName: existing[0].originalName || existing[0].fileName,
          previousStatus,
          newStatus: action,
          reviewNotes: reviewNotes || null,
          checklistCompleted: reviewChecklist ? Object.values(reviewChecklist as Record<string, boolean>).every(Boolean) : false,
          checklistItems: reviewChecklist || null,
        }),
        ipAddress: req.ip || null,
        userAgent: req.get('user-agent') || null,
        riskLevel: 'low',
        hipaaRelevant: true,
      });

      res.json(updated[0]);
    } catch (error) {
      console.error('Document review error:', error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Get supervisors assigned to a therapist
  app.get("/api/users/:therapistId/supervisors", requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const therapistId = parseInt(req.params.therapistId);
      const assignment = await storage.getTherapistSupervisor(therapistId);
      if (!assignment) return res.json([]);
      const supervisor = await storage.getUser(assignment.supervisorId);
      res.json(supervisor ? [supervisor] : []);
    } catch (error) {
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/clients/:clientId/documents/:id/preview", requireAuth, blockAccountant, async (req: AuthenticatedRequest, res) => {
    const { ipAddress, userAgent } = getRequestInfo(req);
    
    try {
      const id = parseInt(req.params.id);
      const clientId = parseInt(req.params.clientId);
      
      // Validate parameters
      if (isNaN(id) || isNaN(clientId)) {
        return res.status(400).json({ message: "Invalid document or client ID" });
      }
      
      // Query document directly by ID and clientId for better reliability
      // This ensures we get the document even if it was just created
      const results = await db
        .select({
          document: documents,
          uploadedBy: users
        })
        .from(documents)
        .leftJoin(users, eq(documents.uploadedById, users.id))
        .where(and(
          eq(documents.id, id),
          eq(documents.clientId, clientId)
        ))
        .limit(1);
      
      if (results.length === 0) {
        console.warn(`[Document Preview] Document not found:`, { documentId: id, clientId });
        return res.status(404).json({ message: "Document not found" });
      }
      
      const document = {
        ...results[0].document,
        uploadedBy: results[0].uploadedBy || null
      };
      
      // HIPAA Audit Log: Document viewed
      if (req.user) {
        await AuditLogger.logDocumentAccess(
          req.user.id,
          req.user.username,
          id,
          clientId,
          'document_viewed',
          ipAddress,
          userAgent,
          { fileName: document.originalName, fileType: document.mimeType }
        );
      }
      
      // Generate a proper preview based on file type
      const isPDF = document.mimeType === 'application/pdf';
      const isImage = document.mimeType?.startsWith('image/');
      const isText = document.mimeType?.startsWith('text/');
      
      if (isPDF) {
        // For PDFs, check if file exists in Azure Blob Storage
        try {
          // Try to find the blob using multiple name variations
          const blobName = await azureStorage.findBlobName(document.id, document.fileName, document.originalName);
          
          if (blobName) {
            // File exists in Azure - return PDF URL for the browser to display
            res.setHeader('Content-Type', 'application/json');
            res.json({
              type: 'pdf',
              content: null,
              fileName: document.fileName,
              fileSize: document.fileSize,
              pages: 1,
              pdfUrl: `/api/clients/${clientId}/documents/${id}/file`,
              viewerUrl: `/api/clients/${clientId}/documents/${id}/viewer`
            });
          } else {
            // Log the issue for debugging
            console.warn(`[Document Preview] PDF not found in Azure Storage:`, {
              documentId: document.id,
              fileName: document.fileName,
              originalName: document.originalName,
              expectedBlobName: azureStorage.generateBlobName(document.id, document.fileName)
            });
            
            // File doesn't exist in storage - return helpful message
            const pdfContent = `PDF file not found in storage.

The file "${document.originalName}" (${Math.round(document.fileSize / 1024)} KB) was uploaded but the actual file content is not available in cloud storage.

This may have happened because:
• The file upload to cloud storage was interrupted
• The file was uploaded before cloud storage was configured
• The file was deleted from storage but the database record remains

To fix this:
1. Re-upload the file to restore it
2. Or contact your system administrator

You can download a copy if you have it saved locally and re-upload it.`;
            
            res.setHeader('Content-Type', 'application/json');
            res.json({
              type: 'pdf',
              content: pdfContent,
              fileName: document.fileName,
              fileSize: document.fileSize,
              pages: 1
            });
          }
        } catch (error) {
          console.error('[Document Preview] Error processing PDF:', error);
          res.status(500).json({ error: 'Failed to process PDF content: ' + (error instanceof Error ? error.message : 'Unknown error') });
        }
      } else if (isImage) {
        // For images, serve from Azure Blob Storage
        try {
          // Try to find the blob using multiple name variations
          const blobName = await azureStorage.findBlobName(document.id, document.fileName, document.originalName);
          
          if (blobName) {
            const downloadResult = await azureStorage.downloadFile(blobName);
            
            if (downloadResult.success) {
              res.setHeader('Content-Type', document.mimeType || 'image/jpeg');
              res.send(downloadResult.data);
            } else {
              // Fallback to icon if file not found
              console.warn(`[Document Preview] Image download failed:`, {
                documentId: document.id,
                fileName: document.fileName,
                blobName: blobName
              });
              res.setHeader('Content-Type', 'image/svg+xml');
              res.send(`
                <svg width="400" height="300" viewBox="0 0 400 300" xmlns="http://www.w3.org/2000/svg">
                  <rect width="400" height="300" fill="#ffffff" stroke="#d1d5db" stroke-width="2" rx="8"/>
                  <rect x="20" y="20" width="360" height="220" fill="#f3f4f6" rx="4"/>
                  
                  <!-- Image Icon -->
                  <circle cx="120" cy="80" r="15" fill="#10b981"/>
                  <rect x="150" y="120" width="100" height="60" fill="#34d399" rx="8"/>
                  <polygon points="200,140 220,120 240,140 240,160 200,160" fill="#059669"/>
                  
                  <!-- File Info -->
                  <text x="200" y="270" text-anchor="middle" font-family="Arial, sans-serif" font-size="12" fill="#374151">${document.fileName}</text>
                  <text x="200" y="285" text-anchor="middle" font-family="Arial, sans-serif" font-size="10" fill="#6b7280">${Math.round(document.fileSize / 1024)} KB • Image (File Not Found)</text>
                </svg>
              `);
            }
          } else {
            // Blob not found - show placeholder
            console.warn(`[Document Preview] Image not found in Azure Storage:`, {
              documentId: document.id,
              fileName: document.fileName,
              originalName: document.originalName
            });
            res.setHeader('Content-Type', 'image/svg+xml');
            res.send(`
              <svg width="400" height="300" viewBox="0 0 400 300" xmlns="http://www.w3.org/2000/svg">
                <rect width="400" height="300" fill="#ffffff" stroke="#d1d5db" stroke-width="2" rx="8"/>
                <rect x="20" y="20" width="360" height="220" fill="#f3f4f6" rx="4"/>
                
                <!-- Image Icon -->
                <circle cx="120" cy="80" r="15" fill="#10b981"/>
                <rect x="150" y="120" width="100" height="60" fill="#34d399" rx="8"/>
                <polygon points="200,140 220,120 240,140 240,160 200,160" fill="#059669"/>
                
                <!-- File Info -->
                <text x="200" y="270" text-anchor="middle" font-family="Arial, sans-serif" font-size="12" fill="#374151">${document.fileName}</text>
                <text x="200" y="285" text-anchor="middle" font-family="Arial, sans-serif" font-size="10" fill="#6b7280">${Math.round(document.fileSize / 1024)} KB • Image (File Not Found)</text>
              </svg>
            `);
          }
        } catch (error) {
          console.error('Image serving error:', error);
          res.status(500).json({ error: 'Failed to serve image: ' + (error instanceof Error ? error.message : 'Unknown error') });
        }
      } else if (isText) {
        // For text files, serve from filesystem (reliable approach)
        const filePath = path.join(process.cwd(), 'uploads', `${document.id}-${document.fileName}`);
        
        if (fs.existsSync(filePath)) {
          try {
            const textContent = fs.readFileSync(filePath, 'utf-8');
            res.setHeader('Content-Type', 'application/json');
            res.json({
              type: 'text',
              content: textContent,
              fileName: document.fileName,
              fileSize: document.fileSize
            });
          } catch (error) {
            res.setHeader('Content-Type', 'application/json');
            res.json({
              type: 'text',
              content: `Error reading text file: ${error instanceof Error ? error.message : 'Unknown error'}`,
              fileName: document.fileName,
              fileSize: document.fileSize
            });
          }
        } else {
          res.setHeader('Content-Type', 'application/json');
          res.json({
            type: 'text',
            content: `Text file not found on server.\n\nThe file ${document.fileName} was uploaded but the content is not available for preview.`,
            fileName: document.fileName,
            fileSize: document.fileSize
          });
        }
      } else {
        // For other files, show generic document preview
        res.setHeader('Content-Type', 'image/svg+xml');
        res.send(`
          <svg width="400" height="300" viewBox="0 0 400 300" xmlns="http://www.w3.org/2000/svg">
            <rect width="400" height="300" fill="#ffffff" stroke="#d1d5db" stroke-width="2" rx="8"/>
            <rect x="20" y="20" width="360" height="260" fill="#f9fafb" rx="4"/>
            
            <!-- Document Icon -->
            <rect x="160" y="80" width="80" height="100" fill="#e5e7eb" stroke="#9ca3af" stroke-width="2" rx="4"/>
            <polygon points="240,80 240,100 220,100" fill="#9ca3af"/>
            <line x1="170" y1="110" x2="220" y2="110" stroke="#9ca3af" stroke-width="2"/>
            <line x1="170" y1="125" x2="230" y2="125" stroke="#9ca3af" stroke-width="2"/>
            <line x1="170" y1="140" x2="215" y2="140" stroke="#9ca3af" stroke-width="2"/>
            
            <!-- File Info -->
            <text x="200" y="220" text-anchor="middle" font-family="Arial, sans-serif" font-size="12" fill="#374151">${document.fileName}</text>
            <text x="200" y="235" text-anchor="middle" font-family="Arial, sans-serif" font-size="10" fill="#6b7280">${Math.round(document.fileSize / 1024)} KB</text>
          </svg>
        `);
      }
    } catch (error) {
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Serve PDF file directly for viewing  
  app.get("/api/clients/:clientId/documents/:id/file", requireAuth, blockAccountant, async (req: AuthenticatedRequest, res) => {
    const { ipAddress, userAgent } = getRequestInfo(req);
    
    try {
      const id = parseInt(req.params.id);
      const clientId = parseInt(req.params.clientId);
      
      // Validate parameters
      if (isNaN(id) || isNaN(clientId)) {
        return res.status(400).json({ message: "Invalid document or client ID" });
      }
      
      // Query document directly by ID and clientId for better reliability
      const results = await db
        .select({
          document: documents,
          uploadedBy: users
        })
        .from(documents)
        .leftJoin(users, eq(documents.uploadedById, users.id))
        .where(and(
          eq(documents.id, id),
          eq(documents.clientId, clientId)
        ))
        .limit(1);
      
      if (results.length === 0) {
        console.warn(`[Document File] Document not found:`, { documentId: id, clientId });
        return res.status(404).json({ message: "Document not found" });
      }
      
      const document = {
        ...results[0].document,
        uploadedBy: results[0].uploadedBy || null
      };
      
      // Only serve PDF files through this endpoint
      if (document.mimeType !== 'application/pdf') {
        return res.status(400).json({ message: "This endpoint only serves PDF files" });
      }
      
      // Download from Azure Blob Storage (only)
      // Try to find the blob using multiple name variations
      let blobName = await azureStorage.findBlobName(document.id, document.fileName, document.originalName);
      
      // Fallback to standard blob name if findBlobName didn't find it
      if (!blobName) {
        blobName = azureStorage.generateBlobName(document.id, document.fileName);
      }
      
      const downloadResult = await azureStorage.downloadFile(blobName);
      
      if (downloadResult.success) {
        // HIPAA Audit Log: Document viewed (PDF file access)
        if (req.user) {
          await AuditLogger.logDocumentAccess(
            req.user.id,
            req.user.username,
            id,
            clientId,
            'document_viewed',
            ipAddress,
            userAgent,
            { fileName: document.originalName, fileType: document.mimeType, accessType: 'pdf_view', storageLocation: 'Azure Blob Storage' }
          );
        }
        
        const buffer = downloadResult.data!;
        
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename="${document.originalName}"`);
        res.setHeader('X-Frame-Options', 'SAMEORIGIN');
        res.setHeader('Content-Security-Policy', "frame-ancestors 'self'");
        res.send(buffer);
      } else {
        res.status(404).json({ message: "File not found in storage" });
      }
    } catch (error) {
      console.error('File serving error:', error);
      res.status(500).json({ message: "Error serving PDF file" });
    }
  });

  // PDF viewer endpoint
  app.get("/api/clients/:clientId/documents/:id/viewer", requireAuth, blockAccountant, async (req: AuthenticatedRequest, res) => {
    try {
      const id = parseInt(req.params.id);
      const clientId = parseInt(req.params.clientId);
      
      // Validate parameters
      if (isNaN(id) || isNaN(clientId)) {
        return res.status(400).json({ message: "Invalid document or client ID" });
      }
      
      // Get document info from database
      const documents = await storage.getDocumentsByClient(clientId);
      const document = documents.find(doc => Number(doc.id) === id);
      
      if (!document) {
        return res.status(404).json({ message: "Document not found" });
      }
      
      // Only serve PDF files through this endpoint
      if (document.mimeType !== 'application/pdf') {
        return res.status(400).json({ message: "This endpoint only serves PDF files" });
      }
      
      // Development: Use filesystem directly
      const filePath = path.join(process.cwd(), 'uploads', `${document.id}-${document.fileName}`);
      
      if (fs.existsSync(filePath)) {
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename="${document.originalName}"`);
        res.setHeader('X-Frame-Options', 'SAMEORIGIN');
        res.setHeader('Content-Security-Policy', "frame-ancestors 'self'");
        res.sendFile(path.resolve(filePath));
      } else {
        res.status(404).json({ message: "File not found on server" });
      }
    } catch (error) {
      res.status(500).json({ message: "Error serving PDF file" });
    }
  });

  // Docx viewer endpoint
  app.get("/api/clients/:clientId/documents/:id/docx-viewer", requireAuth, blockAccountant, async (req: AuthenticatedRequest, res) => {
    try {
      const id = parseInt(req.params.id);
      const clientId = parseInt(req.params.clientId);
      
      // Validate parameters
      if (isNaN(id) || isNaN(clientId)) {
        return res.status(400).json({ message: "Invalid document or client ID" });
      }
      
      // Query document directly by ID and clientId for better reliability
      const results = await db
        .select({
          document: documents,
          uploadedBy: users
        })
        .from(documents)
        .leftJoin(users, eq(documents.uploadedById, users.id))
        .where(and(
          eq(documents.id, id),
          eq(documents.clientId, clientId)
        ))
        .limit(1);
      
      if (results.length === 0) {
        console.warn(`[Document DOCX Viewer] Document not found:`, { documentId: id, clientId });
        return res.status(404).json({ message: "Document not found" });
      }
      
      const document = {
        ...results[0].document,
        uploadedBy: results[0].uploadedBy || null
      };
      
      // Only serve Word documents through this endpoint
      const isDocx = document.mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || 
                     document.fileName?.toLowerCase().endsWith('.docx') || 
                     document.fileName?.toLowerCase().endsWith('.doc');
      
      if (!isDocx) {
        return res.status(400).json({ message: "This endpoint only serves Word documents" });
      }
      
      // Download from Azure Blob Storage
      // Try to find the blob using multiple name variations
      let blobName = await azureStorage.findBlobName(document.id, document.fileName, document.originalName);
      
      // Fallback to standard blob name if findBlobName didn't find it
      if (!blobName) {
        blobName = azureStorage.generateBlobName(document.id, document.fileName);
      }
      
      const downloadResult = await azureStorage.downloadFile(blobName);
      
      if (downloadResult.success) {
        // Convert docx to HTML using mammoth
        const mammoth = await import('mammoth');
        const buffer = downloadResult.data!;
        const result = await mammoth.convertToHtml({ buffer: buffer });
        
        res.json({ 
          html: result.value,
          messages: result.messages 
        });
      } else {
        res.status(404).json({ message: "File not found in storage" });
      }
    } catch (error) {
      console.error('Docx conversion error:', error);
      res.status(500).json({ message: "Error converting Word document" });
    }
  });

  app.get("/api/clients/:clientId/documents/:id/download", requireAuth, blockAccountant, async (req: AuthenticatedRequest, res) => {
    const { ipAddress, userAgent } = getRequestInfo(req);
    
    try {
      const id = parseInt(req.params.id);
      const clientId = parseInt(req.params.clientId);
      
      // Validate parameters
      if (isNaN(id) || isNaN(clientId)) {
        return res.status(400).json({ message: "Invalid document or client ID" });
      }
      
      // Query document directly by ID and clientId for better reliability
      const results = await db
        .select({
          document: documents,
          uploadedBy: users
        })
        .from(documents)
        .leftJoin(users, eq(documents.uploadedById, users.id))
        .where(and(
          eq(documents.id, id),
          eq(documents.clientId, clientId)
        ))
        .limit(1);
      
      if (results.length === 0) {
        console.warn(`[Document Download] Document not found:`, { documentId: id, clientId });
        return res.status(404).json({ message: "Document not found" });
      }
      
      const document = {
        ...results[0].document,
        uploadedBy: results[0].uploadedBy || null
      };
      
      // Download from Azure Blob Storage (only)
      // Try to find the blob using multiple name variations
      let blobName = await azureStorage.findBlobName(document.id, document.fileName, document.originalName);
      
      // Fallback to standard blob name if findBlobName didn't find it
      if (!blobName) {
        blobName = azureStorage.generateBlobName(document.id, document.fileName);
      }
      
      const downloadResult = await azureStorage.downloadFile(blobName);
      
      if (downloadResult.success) {
        // HIPAA Audit Log: Document downloaded
        if (req.user) {
          await AuditLogger.logDocumentAccess(
            req.user.id,
            req.user.username,
            id,
            clientId,
            'document_downloaded',
            ipAddress,
            userAgent,
            { fileName: document.originalName, fileType: document.mimeType, storageLocation: 'Azure Blob Storage' }
          );
        }
        
        const fileBuffer = downloadResult.data;
        
        res.setHeader('Content-Type', document.mimeType || 'application/octet-stream');
        res.setHeader('Content-Disposition', `attachment; filename="${document.originalName}"`);
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
        res.send(fileBuffer);
      } else {
        res.status(404).json({ message: "File not found in storage" });
      }
    } catch (error) {
      console.error('Download error:', error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.delete("/api/clients/:clientId/documents/:id", requireAuth, blockAccountant, async (req: AuthenticatedRequest, res) => {
    const { ipAddress, userAgent } = getRequestInfo(req);
    
    try {
      const id = parseInt(req.params.id);
      const clientId = parseInt(req.params.clientId);
      
      if (!req.user) {
        return res.status(401).json({ message: "Authentication required" });
      }
      
      // Get document info before deleting from database
      const documents = await storage.getDocumentsByClient(clientId);
      const document = documents.find(doc => Number(doc.id) === id);
      
      if (!document) {
        return res.status(404).json({ message: "Document not found" });
      }
      
      // Log deletion to audit trail BEFORE deleting
      await AuditLogger.logDocumentAccess(
        req.user.id,
        req.user.username,
        id,
        clientId,
        'document_deleted',
        ipAddress,
        userAgent,
        { 
          fileName: document.originalName,
          fileType: document.mimeType,
          category: document.category,
          fileSize: document.fileSize,
          deletedAt: new Date()
        }
      );
      
      // Delete from database first
      await storage.deleteDocument(id);
      
      // Then delete the physical file if it exists
      const filePath = path.join(process.cwd(), 'uploads', `${document.id}-${document.fileName}`);
      if (fs.existsSync(filePath)) {
        try {
          fs.unlinkSync(filePath);
        } catch (fileError) {
          // Log file deletion error but don't fail the request since DB deletion succeeded
        }
      }
      
      res.status(204).send();
    } catch (error) {
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Toggle document sharing in portal
  app.patch("/api/clients/:clientId/documents/:id/share", requireAuth, blockAccountant, async (req: AuthenticatedRequest, res) => {
    const { ipAddress, userAgent } = getRequestInfo(req);
    
    try {
      const id = parseInt(req.params.id);
      const clientId = parseInt(req.params.clientId);
      const { isSharedInPortal } = req.body;

      if (!req.user) {
        return res.status(401).json({ message: "Authentication required" });
      }

      // Get all documents for this client and find the specific one
      const documents = await storage.getDocumentsByClient(clientId);
      const document = documents.find(doc => Number(doc.id) === id);
      
      if (!document) {
        return res.status(404).json({ message: "Document not found" });
      }

      // Update the sharing status
      await storage.updateDocument(id, { isSharedInPortal });

      // Audit log
      if (req.user) {
        await AuditLogger.logDocumentAccess(
          req.user.id,
          req.user.username,
          id,
          clientId,
          isSharedInPortal ? 'document_shared_in_portal' : 'document_unshared_from_portal',
          ipAddress,
          userAgent,
          { fileName: document.originalName, isSharedInPortal }
        );
      }

      res.json({ success: true, isSharedInPortal });
    } catch (error) {
      console.error('Document share toggle error:', error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Therapists route
  app.get("/api/therapists", requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      if (!req.user) {
        return res.status(401).json({ message: "Authentication required" });
      }
      
      // SECURITY: Use authenticated user's role and ID from session
      if (req.user.role === "supervisor") {
        // Get only therapists supervised by this supervisor
        const supervisorAssignments = await storage.getSupervisorAssignments(req.user.id);
        
        if (supervisorAssignments.length === 0) {
          return res.json([]);
        }
        
        const users = await storage.getUsers();
        const supervisedTherapistIds = supervisorAssignments.map(assignment => assignment.therapistId);
        const supervisedTherapists = users.filter(u => 
          u.role === 'therapist' && supervisedTherapistIds.includes(u.id)
        );
        
        return res.json(sanitizeUsers(supervisedTherapists));
      } else if (req.user.role === "therapist") {
        // Therapists can only see themselves
        const users = await storage.getUsers();
        const therapist = users.find(u => u.id === req.user!.id && u.role === 'therapist');
        return res.json(therapist ? [sanitizeUser(therapist)] : []);
      }
      
      // Admins can see all therapists
      const users = await storage.getUsers();
      const therapists = users.filter(u => u.role === 'therapist');
      res.json(sanitizeUsers(therapists));
    } catch (error) {

      res.status(500).json({ message: "Internal server error" });
    }
  });

  // User Management Routes
  app.get("/api/users", async (req, res) => {
    try {
      const users = await storage.getUsers();
      res.json(sanitizeUsers(users));
    } catch (error) {
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/users/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const user = await storage.getUser(id);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }
      res.json(sanitizeUser(user));
    } catch (error) {
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post("/api/users", requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      // Check if user has admin privileges to create users
      if (req.user?.role !== 'administrator' && req.user?.role !== 'admin') {
        return res.status(403).json({ message: "Access denied. Admin privileges required to create users." });
      }

      const validatedData = insertUserSchema.parse(req.body);
      const user = await storage.createUser(validatedData);
      res.status(201).json(sanitizeUser(user));
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid user data", errors: error.errors });
      }
      
      // Handle database constraint violations
      if (error.code === '23505') {
        if (error.constraint === 'users_email_unique') {
          return res.status(400).json({ message: "Email address already exists. Please use a different email." });
        }
        if (error.constraint === 'users_username_unique') {
          return res.status(400).json({ message: "Username already exists. Please choose a different username." });
        }
        return res.status(400).json({ message: "A user with these details already exists." });
      }
      
      console.error('Create user error:', error?.message || error);
      res.status(500).json({ message: error?.message || "Failed to create user. Please try again." });
    }
  });

  app.put("/api/users/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const validatedData = insertUserSchema.partial().parse(req.body);
      const user = await storage.updateUser(id, validatedData);
      res.json(sanitizeUser(user));
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid user data", errors: error.errors });
      }
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.delete("/api/users/:id", requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      // Check if user has admin privileges to delete users
      if (req.user?.role !== 'administrator' && req.user?.role !== 'admin') {
        return res.status(403).json({ message: "Access denied. Admin privileges required to delete users." });
      }

      const id = parseInt(req.params.id);
      
      // Prevent self-deletion
      if (req.user.id === id) {
        return res.status(400).json({ message: "Cannot delete your own user account." });
      }
      
      await storage.deleteUser(id);
      res.status(204).send();
    } catch (error) {
      // Error logged
      res.status(500).json({ message: "Failed to delete user." });
    }
  });




  app.get("/api/users/me/profile", requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      // Get authenticated user from request
      const currentUserId = req.user?.id;
      if (!currentUserId) {
        return res.status(401).json({ message: "Authentication required" });
      }
      const profile = await storage.getUserProfile(currentUserId);
      res.json(profile);
    } catch (error) {
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post("/api/users/me/profile", requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      // Get authenticated user from request
      const currentUserId = req.user?.id;
      if (!currentUserId) {
        return res.status(401).json({ message: "Authentication required" });
      }
      
      // Clean up date fields - convert empty strings to undefined
      const cleanedData = { ...req.body };
      if (cleanedData.licenseExpiry === '') {
        cleanedData.licenseExpiry = undefined;
      }
      
      const validatedData = insertUserProfileSchema.parse({
        ...cleanedData,
        userId: currentUserId
      });
      const profile = await storage.createUserProfile(validatedData);
      res.status(201).json(profile);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid profile data", errors: error.errors });
      }
      console.error('[PROFILE CREATE ERROR]', error);
      res.status(500).json({ message: "Internal server error", error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.put("/api/users/me/profile", requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      // Get authenticated user from request
      const currentUserId = req.user?.id;
      if (!currentUserId) {
        return res.status(401).json({ message: "Authentication required" });
      }
      
      // Clean up date fields - convert empty strings to undefined
      const cleanedData = { ...req.body };
      if (cleanedData.licenseExpiry === '') {
        cleanedData.licenseExpiry = undefined;
      }
      
      const validatedData = insertUserProfileSchema.partial().parse(cleanedData);
      const profile = await storage.updateUserProfile(currentUserId, validatedData);
      res.json(profile);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid profile data", errors: error.errors });
      }
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Password change endpoint
  app.post("/api/users/me/change-password", requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      // Get authenticated user from request
      const currentUserId = req.user?.id;
      if (!currentUserId) {
        return res.status(401).json({ message: "Authentication required" });
      }
      
      const { currentPassword, newPassword } = req.body;
      
      if (!currentPassword || !newPassword) {
        return res.status(400).json({ error: "Current password and new password are required" });
      }
      
      if (newPassword.length < 6) {
        return res.status(400).json({ error: "New password must be at least 6 characters" });
      }
      
      // Get current user using direct database query
      const [user] = await db.select().from(users).where(eq(users.id, currentUserId));
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }
      
      // Check current password (for now, plain text comparison)
      // TODO: In production, use bcrypt for password hashing
      if (currentPassword !== user.password) {
        return res.status(401).json({ error: "Current password is incorrect" });
      }
      
      // Update password using direct database query
      await db.update(users).set({ password: newPassword }).where(eq(users.id, currentUserId));
      
      res.json({ message: "Password changed successfully" });
    } catch (error) {
      console.error("Error changing password:", error);
      res.status(500).json({ error: "Failed to change password" });
    }
  });

  // Zoom Credentials Management Routes
  app.put("/api/users/me/zoom-credentials", requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const currentUserId = req.user?.id;
      if (!currentUserId) {
        return res.status(401).json({ message: "Authentication required" });
      }

      const { zoomAccountId, zoomClientId, zoomClientSecret } = req.body;

      if (!zoomAccountId || !zoomClientId || !zoomClientSecret) {
        return res.status(400).json({ 
          message: "All Zoom credentials are required (Account ID, Client ID, Client Secret)" 
        });
      }

      await db.update(users)
        .set({
          zoomAccountId,
          zoomClientId,
          zoomClientSecret,
          zoomAccessToken: null,
          zoomTokenExpiry: null,
          updatedAt: new Date()
        })
        .where(eq(users.id, currentUserId));

      res.json({ message: "Zoom credentials saved successfully" });
    } catch (error) {
      console.error("Error saving Zoom credentials:", error);
      res.status(500).json({ message: "Failed to save Zoom credentials" });
    }
  });

  app.delete("/api/users/me/zoom-credentials", requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const currentUserId = req.user?.id;
      if (!currentUserId) {
        return res.status(401).json({ message: "Authentication required" });
      }

      await db.update(users)
        .set({
          zoomAccountId: null,
          zoomClientId: null,
          zoomClientSecret: null,
          zoomAccessToken: null,
          zoomTokenExpiry: null,
          updatedAt: new Date()
        })
        .where(eq(users.id, currentUserId));

      res.json({ message: "Zoom credentials removed successfully" });
    } catch (error) {
      console.error("Error removing Zoom credentials:", error);
      res.status(500).json({ message: "Failed to remove Zoom credentials" });
    }
  });

  app.post("/api/users/me/zoom-credentials/test", requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const currentUserId = req.user?.id;
      if (!currentUserId) {
        return res.status(401).json({ message: "Authentication required" });
      }

      const [user] = await db.select().from(users).where(eq(users.id, currentUserId));
      if (!user || !user.zoomAccountId || !user.zoomClientId || !user.zoomClientSecret) {
        return res.status(400).json({ message: "Zoom credentials not configured" });
      }

      try {
        const credentials = Buffer.from(`${user.zoomClientId}:${user.zoomClientSecret}`).toString('base64');
        
        const response = await fetch('https://zoom.us/oauth/token', {
          method: 'POST',
          headers: {
            'Authorization': `Basic ${credentials}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({
            grant_type: 'account_credentials',
            account_id: user.zoomAccountId,
          }),
        });

        if (!response.ok) {
          const errorData = await response.text();
          return res.status(400).json({ 
            message: "Zoom credentials test failed",
            error: `Status ${response.status}: ${errorData}` 
          });
        }

        const tokenData = await response.json();
        if (tokenData.access_token) {
          res.json({ 
            message: "Zoom credentials verified successfully",
            success: true 
          });
        } else {
          res.status(400).json({ 
            message: "Invalid response from Zoom",
            success: false 
          });
        }
      } catch (error) {
        console.error("Zoom test error:", error);
        res.status(400).json({ 
          message: "Failed to connect to Zoom",
          error: error instanceof Error ? error.message : "Unknown error"
        });
      }
    } catch (error) {
      console.error("Error testing Zoom credentials:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Get logged-in user's own Zoom credentials
  app.get("/api/users/me/zoom-credentials/status", requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const currentUserId = req.user?.id;
      if (!currentUserId) {
        return res.status(401).json({ message: "Authentication required" });
      }

      const [user] = await db.select({
        zoomAccountId: users.zoomAccountId,
        zoomClientId: users.zoomClientId,
        hasZoomClientSecret: users.zoomClientSecret,
      }).from(users).where(eq(users.id, currentUserId));

      const isConfigured = !!(user?.zoomAccountId && user?.zoomClientId && user?.hasZoomClientSecret);

      const response = { 
        isConfigured,
        zoomAccountId: user?.zoomAccountId || null,
        zoomClientId: user?.zoomClientId || null
      };

      res.json(response);
    } catch (error) {
      console.error("Error checking Zoom credentials status:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Get specific user's Zoom credentials (admin only)
  app.get("/api/users/:userId/zoom-credentials/status", requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const currentUser = req.user;
      if (!currentUser) {
        return res.status(401).json({ message: "Authentication required" });
      }

      const targetUserId = parseInt(req.params.userId);
      if (isNaN(targetUserId)) {
        return res.status(400).json({ message: "Invalid user ID" });
      }

      // Only allow viewing own credentials or admin viewing others
      if (currentUser.id !== targetUserId && currentUser.role !== 'administrator') {
        return res.status(403).json({ message: "Not authorized to view this user's Zoom credentials" });
      }

      const [user] = await db.select({
        zoomAccountId: users.zoomAccountId,
        zoomClientId: users.zoomClientId,
        hasZoomClientSecret: users.zoomClientSecret,
      }).from(users).where(eq(users.id, targetUserId));

      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      const isConfigured = !!(user.zoomAccountId && user.zoomClientId && user.hasZoomClientSecret);

      res.json({ 
        isConfigured,
        zoomAccountId: user.zoomAccountId || null,
        zoomClientId: user.zoomClientId || null
      });
    } catch (error) {
      console.error("Error checking user Zoom credentials status:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // User Profile Routes
  app.get("/api/users/:userId/profile", async (req, res) => {
    try {
      const userId = parseInt(req.params.userId);
      const profile = await storage.getUserProfile(userId);
      if (!profile) {
        return res.status(404).json({ message: "User profile not found" });
      }
      res.json(profile);
    } catch (error) {
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post("/api/users/:userId/profile", async (req, res) => {
    try {
      const userId = parseInt(req.params.userId);
      
      // Clean up date fields - convert empty strings to undefined
      const cleanedData = { ...req.body };
      if (cleanedData.licenseExpiry === '') {
        cleanedData.licenseExpiry = undefined;
      }
      if (cleanedData.dateOfBirth === '') {
        cleanedData.dateOfBirth = undefined;
      }
      
      // Check if profile already exists
      const existingProfile = await storage.getUserProfile(userId);
      
      if (existingProfile) {
        // Profile exists, update it instead
        const validatedData = insertUserProfileSchema.partial().parse(cleanedData);
        const profile = await storage.updateUserProfile(userId, validatedData);
        return res.json(profile);
      }
      
      // Create new profile
      const validatedData = insertUserProfileSchema.parse({
        ...cleanedData,
        userId
      });
      const profile = await storage.createUserProfile(validatedData);
      res.status(201).json(profile);
    } catch (error) {
      if (error instanceof z.ZodError) {
        console.error('[USER PROFILE POST ERROR - Validation]', error.errors);
        return res.status(400).json({ message: "Invalid profile data", errors: error.errors });
      }
      console.error('[USER PROFILE POST ERROR]', error);
      res.status(500).json({ message: "Internal server error", error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.put("/api/users/:userId/profile", async (req, res) => {
    try {
      const userId = parseInt(req.params.userId);
      const validatedData = insertUserProfileSchema.partial().parse(req.body);
      const profile = await storage.updateUserProfile(userId, validatedData);
      res.json(profile);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid profile data", errors: error.errors });
      }
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.patch("/api/users/:userId/profile", async (req, res) => {
    try {
      const userId = parseInt(req.params.userId);
      const validatedData = insertUserProfileSchema.partial().parse(req.body);
      const profile = await storage.updateUserProfile(userId, validatedData);
      res.json(profile);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid profile data", errors: error.errors });
      }
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.delete("/api/users/:userId/profile", async (req, res) => {
    try {
      const userId = parseInt(req.params.userId);
      await storage.deleteUserProfile(userId);
      res.status(204).send();
    } catch (error) {
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Therapist Blocked Times Routes
  app.get("/api/therapist-blocked-times", async (req, res) => {
    try {
      const therapistId = parseInt(req.query.therapistId as string);
      if (!therapistId) {
        return res.status(400).json({ message: "therapistId is required" });
      }
      const blockedTimes = await storage.getTherapistBlockedTimes(therapistId);
      res.json(blockedTimes);
    } catch (error) {
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post("/api/therapist-blocked-times", async (req, res) => {
    try {
      const validatedData = insertTherapistBlockedTimeSchema.parse(req.body);
      const blockedTime = await storage.createTherapistBlockedTime(validatedData);
      res.status(201).json(blockedTime);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid blocked time data", errors: error.errors });
      }
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.patch("/api/therapist-blocked-times/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const validatedData = insertTherapistBlockedTimeSchema.partial().parse(req.body);
      const blockedTime = await storage.updateTherapistBlockedTime(id, validatedData);
      res.json(blockedTime);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid blocked time data", errors: error.errors });
      }
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.delete("/api/therapist-blocked-times/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      await storage.deleteTherapistBlockedTime(id);
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Therapist Availability Calculation Route
  app.get("/api/availability/slots", async (req, res) => {
    try {
      const therapistId = parseInt(req.query.therapistId as string);
      const dateStr = req.query.date as string;
      const serviceId = parseInt(req.query.serviceId as string);

      if (!therapistId || !dateStr || !serviceId) {
        return res.status(400).json({ 
          message: "therapistId, date, and serviceId are required" 
        });
      }

      const date = new Date(dateStr);
      if (isNaN(date.getTime())) {
        return res.status(400).json({ message: "Invalid date format" });
      }

      const slots = await storage.getAvailableTimeSlots(therapistId, date, serviceId);
      res.json(slots);
    } catch (error) {
      console.error('Error calculating available slots:', error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Supervisor Assignment Routes
  app.get("/api/supervisors/:supervisorId/assignments", async (req, res) => {
    try {
      const supervisorId = parseInt(req.params.supervisorId);
      const assignments = await storage.getSupervisorAssignments(supervisorId);
      res.json(assignments);
    } catch (error) {
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/supervisor-assignments", async (req, res) => {
    try {
      const assignments = await storage.getAllSupervisorAssignments();
      res.json(assignments);
    } catch (error) {
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/therapists/:therapistId/supervisor", async (req, res) => {
    try {
      const therapistId = parseInt(req.params.therapistId);
      const supervisor = await storage.getTherapistSupervisor(therapistId);
      if (!supervisor) {
        return res.status(404).json({ message: "No supervisor assigned" });
      }
      res.json(supervisor);
    } catch (error) {
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post("/api/supervisor-assignments", async (req, res) => {
    try {
      const validatedData = insertSupervisorAssignmentSchema.parse(req.body);
      const assignment = await storage.createSupervisorAssignment(validatedData);
      res.status(201).json(assignment);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid assignment data", errors: error.errors });
      }
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.put("/api/supervisor-assignments/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const validatedData = insertSupervisorAssignmentSchema.partial().parse(req.body);
      const assignment = await storage.updateSupervisorAssignment(id, validatedData);
      res.json(assignment);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid assignment data", errors: error.errors });
      }
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.delete("/api/supervisor-assignments/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      await storage.deleteSupervisorAssignment(id);
      res.status(204).send();
    } catch (error) {
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // User Activity Log Routes
  app.post("/api/users/:userId/activity", async (req, res) => {
    try {
      const userId = parseInt(req.params.userId);
      const validatedData = insertUserActivityLogSchema.parse({
        ...req.body,
        userId
      });
      const activity = await storage.logUserActivity(validatedData);
      res.status(201).json(activity);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid activity data", errors: error.errors });
      }
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/users/:userId/activity", async (req, res) => {
    try {
      const userId = parseInt(req.params.userId);
      const limit = req.query.limit ? parseInt(req.query.limit as string) : 50;
      const activities = await storage.getUserActivityHistory(userId, limit);
      res.json(activities);
    } catch (error) {
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Pending tasks count
  app.get("/api/tasks/pending/count", requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const count = await storage.getPendingTasksCount();
      res.json({ count });
    } catch (error) {
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Session Notes routes
  app.get("/api/sessions/:sessionId/notes", requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      if (!req.user) {
        return res.status(401).json({ message: "Authentication required" });
      }
      
      const sessionId = parseInt(req.params.sessionId);
      
      // First check if user can access this session (via service visibility)
      const sessionResults = await storage.getSessionsWithFiltering({
        includeHiddenServices: req.user.role === 'admin',
        page: 1,
        limit: 1000
      });
      
      // Check if the requested session is in the filtered results
      const hasAccess = sessionResults.sessions.some(session => session.id === sessionId);
      if (!hasAccess) {
        return res.status(404).json({ message: "Session not found" });
      }
      
      const sessionNotes = await storage.getSessionNotesBySession(sessionId);
      res.json(sessionNotes);
    } catch (error) {
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/clients/:clientId/session-notes", requireAuth, blockAccountant, async (req: AuthenticatedRequest, res) => {
    try {
      if (!req.user) {
        return res.status(401).json({ message: "Authentication required" });
      }
      
      const clientId = parseInt(req.params.clientId);
      
      // Get session notes but filter out notes from sessions with hidden services
      const sessionNotes = await storage.getSessionNotesByClient(clientId);
      
      // Filter out session notes where the related session uses a hidden service
      const includeHiddenServices = req.user.role === 'admin';
      if (!includeHiddenServices) {
        // Get all sessions for this client with service visibility filtering
        const visibleSessions = await storage.getSessionsByClient(clientId, false);
        const visibleSessionIds = new Set(visibleSessions.map(s => s.id));
        
        // Filter session notes to only include those from visible sessions
        const filteredNotes = sessionNotes.filter(note => visibleSessionIds.has(note.sessionId));
        res.json(filteredNotes);
      } else {
        res.json(sessionNotes);
      }
    } catch (error) {
      console.error('Error fetching session notes for client:', error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/session-notes/:id", requireAuth, blockAccountant, async (req: AuthenticatedRequest, res) => {
    try {
      if (!req.user) {
        return res.status(401).json({ message: "Authentication required" });
      }
      
      const id = parseInt(req.params.id);
      const sessionNote = await storage.getSessionNote(id);
      
      if (!sessionNote) {
        return res.status(404).json({ message: "Session note not found" });
      }
      
      // Check if user can access the session related to this note (service visibility check)
      const includeHiddenServices = req.user.role === 'admin';
      if (!includeHiddenServices) {
        const visibleSessions = await storage.getSessionsByClient(sessionNote.clientId, false);
        const hasAccess = visibleSessions.some(session => session.id === sessionNote.sessionId);
        if (!hasAccess) {
          return res.status(404).json({ message: "Session note not found" });
        }
      }
      
      res.json(sessionNote);
    } catch (error) {
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post("/api/session-notes", requireAuth, blockAccountant, async (req: AuthenticatedRequest, res) => {
    try {
      if (!req.user) {
        return res.status(401).json({ message: "Authentication required" });
      }
      
      const validatedData = insertSessionNoteSchema.parse(req.body);
      
      // Check if user can access the session for this note (service visibility check)
      const includeHiddenServices = req.user.role === 'admin';
      if (!includeHiddenServices && validatedData.sessionId) {
        const sessionResults = await storage.getSessionsWithFiltering({
          includeHiddenServices: false,
          page: 1,
          limit: 1000
        });
        const hasAccess = sessionResults.sessions.some(session => session.id === validatedData.sessionId);
        if (!hasAccess) {
          return res.status(403).json({ message: "Cannot create notes for this session" });
        }
      }
      
      const sessionNote = await storage.createSessionNote(validatedData);
      
      // HIPAA Audit Log: Session note created
      const { ipAddress, userAgent } = getRequestInfo(req);
      await AuditLogger.logSessionNoteAccess(
        req.user.id,
        req.user.username,
        sessionNote.id,
        validatedData.clientId,
        'note_created',
        ipAddress,
        userAgent,
        { sessionId: validatedData.sessionId, aiEnabled: validatedData.aiEnabled }
      );
      
      // Generate AI content if enabled
      if (validatedData.aiEnabled && process.env.OPENAI_API_KEY) {
        try {
          // Update status to processing
          await storage.updateSessionNote(sessionNote.id, { aiProcessingStatus: 'processing' });
          
          // Get session and client details for AI context
          const { sessions: sessionsTable } = await import("@shared/schema");
          const [session] = await db.select().from(sessionsTable).where(eq(sessionsTable.id, validatedData.sessionId));
          const client = await storage.getClient(validatedData.clientId);
          
          const aiContent = await generateSessionNoteSummary({
            sessionFocus: validatedData.sessionFocus || undefined,
            symptoms: validatedData.symptoms || undefined,
            shortTermGoals: validatedData.shortTermGoals || undefined,
            intervention: validatedData.intervention || undefined,
            progress: validatedData.progress || undefined,
            remarks: validatedData.remarks || undefined,
            recommendations: validatedData.recommendations || undefined,
            customPrompt: validatedData.customAiPrompt || undefined,
            sessionType: session?.sessionType || 'therapy session',
            sessionDate: session?.sessionDate ? formatInTimeZone(new Date(session.sessionDate), 'America/New_York', "MMM dd, yyyy 'at' h:mm a") : undefined,
            clientName: client?.fullName
          });
          
          // Update with generated content
          await storage.updateSessionNote(sessionNote.id, {
            generatedContent: aiContent.generatedContent,
            draftContent: aiContent.generatedContent,
            aiProcessingStatus: 'completed'
          });
          
          // HIPAA Audit Log: AI content generated
          await AuditLogger.logSessionNoteAccess(
            req.user.id,
            req.user.username,
            sessionNote.id,
            validatedData.clientId,
            'note_ai_generated',
            ipAddress,
            userAgent,
            { sessionId: validatedData.sessionId }
          );
        } catch (aiError) {
          await storage.updateSessionNote(sessionNote.id, { aiProcessingStatus: 'error' });
        }
      }
      
      res.status(201).json(sessionNote);
    } catch (error) {
      if (error instanceof z.ZodError) {
        console.error('[SESSION NOTE API] Validation failed:', JSON.stringify(error.errors, null, 2));
        return res.status(400).json({ message: "Invalid session note data", errors: error.errors });
      }
      console.error('[SESSION NOTE API] Error:', error);
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.put("/api/session-notes/:id", requireAuth, blockAccountant, async (req: AuthenticatedRequest, res) => {
    try {
      if (!req.user) {
        return res.status(401).json({ message: "Authentication required" });
      }
      
      const id = parseInt(req.params.id);
      
      // Check if user can access this session note first
      const existingNote = await storage.getSessionNote(id);
      if (!existingNote) {
        return res.status(404).json({ message: "Session note not found" });
      }
      
      // Check service visibility for the existing note's session
      const includeHiddenServices = req.user.role === 'admin';
      if (!includeHiddenServices) {
        const visibleSessions = await storage.getSessionsByClient(existingNote.clientId, false);
        const hasAccess = visibleSessions.some(session => session.id === existingNote.sessionId);
        if (!hasAccess) {
          return res.status(404).json({ message: "Session note not found" });
        }
      }
      
      const validatedData = insertSessionNoteSchema.partial().parse(req.body);
      const sessionNote = await storage.updateSessionNote(id, validatedData);
      
      // HIPAA Audit Log: Session note updated
      const { ipAddress, userAgent } = getRequestInfo(req);
      await AuditLogger.logSessionNoteAccess(
        req.user.id,
        req.user.username,
        id,
        existingNote.clientId,
        'note_updated',
        ipAddress,
        userAgent,
        { sessionId: existingNote.sessionId, fieldsUpdated: Object.keys(validatedData) }
      );
      
      res.json(sessionNote);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid session note data", errors: error.errors });
      }
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.delete("/api/session-notes/:id", requireAuth, blockAccountant, async (req: AuthenticatedRequest, res) => {
    try {
      if (!req.user) {
        return res.status(401).json({ message: "Authentication required" });
      }
      
      const id = parseInt(req.params.id);
      
      // Check if user can access this session note first
      const existingNote = await storage.getSessionNote(id);
      if (!existingNote) {
        return res.status(404).json({ message: "Session note not found" });
      }
      
      // Check service visibility for the existing note's session
      const includeHiddenServices = req.user.role === 'admin';
      if (!includeHiddenServices) {
        const visibleSessions = await storage.getSessionsByClient(existingNote.clientId, false);
        const hasAccess = visibleSessions.some(session => session.id === existingNote.sessionId);
        if (!hasAccess) {
          return res.status(404).json({ message: "Session note not found" });
        }
      }
      
      await storage.deleteSessionNote(id);
      
      // HIPAA Audit Log: Session note deleted
      const { ipAddress, userAgent } = getRequestInfo(req);
      await AuditLogger.logSessionNoteAccess(
        req.user.id,
        req.user.username,
        id,
        existingNote.clientId,
        'note_deleted',
        ipAddress,
        userAgent,
        { sessionId: existingNote.sessionId }
      );
      
      res.status(204).send();
    } catch (error) {
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Finalize session note
  app.post("/api/session-notes/:id/finalize", requireAuth, blockAccountant, async (req: AuthenticatedRequest, res) => {
    try {
      if (!req.user) {
        return res.status(401).json({ message: "Authentication required" });
      }
      
      const id = parseInt(req.params.id);
      const note = await storage.getSessionNote(id);
      
      if (!note) {
        return res.status(404).json({ message: "Session note not found" });
      }
      
      // Check if note is already finalized
      if (note.isFinalized) {
        return res.status(400).json({ message: "Session note is already finalized" });
      }
      
      // Permission check: Only assigned therapist, supervisor with rights, or admin can finalize
      const isAssignedTherapist = note.therapistId === req.user.id;
      const isAdmin = req.user.role === 'administrator';
      
      // Check if user is a supervisor of the assigned therapist
      let isSupervisor = false;
      if (!isAssignedTherapist && !isAdmin) {
        const supervisorAssignments = await storage.getSupervisorAssignments(req.user.id);
        isSupervisor = supervisorAssignments.some(
          assignment => assignment.therapistId === note.therapistId
        );
      }
      
      if (!isAssignedTherapist && !isAdmin && !isSupervisor) {
        return res.status(403).json({ message: "You do not have permission to finalize this session note" });
      }
      
      // Update note to finalized status
      const updatedNote = await storage.updateSessionNote(id, { 
        isFinalized: true,
        isDraft: false,
        finalContent: note.generatedContent || note.draftContent || '',
        finalizedAt: new Date()
      });
      
      // Log audit trail for HIPAA compliance
      await storage.logUserActivity({
        userId: req.user.id,
        action: 'finalize_session_note',
        resourceType: 'session_note',
        resourceId: id,
        details: `Finalized session note for client ${note.clientId}`,
        ipAddress: req.ip || req.connection.remoteAddress || 'unknown',
        userAgent: req.get('user-agent') || 'unknown'
      });
      
      res.json(updatedNote);
    } catch (error) {
      console.error('Error finalizing session note:', error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Reopen (unfinalize) a session note. Same permission model as
  // finalize — only the assigned therapist, a supervisor of that
  // therapist, or an admin may reopen. HIPAA-audited via AuditLogger
  // (high risk — modifies finalized clinical documentation).
  app.post("/api/session-notes/:id/unfinalize", requireAuth, blockAccountant, async (req: AuthenticatedRequest, res) => {
    const { ipAddress, userAgent } = getRequestInfo(req);
    try {
      if (!req.user) {
        return res.status(401).json({ message: "Authentication required" });
      }

      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid session note ID" });
      }

      const note = await storage.getSessionNote(id);
      if (!note) {
        return res.status(404).json({ message: "Session note not found" });
      }

      if (!note.isFinalized) {
        return res.status(400).json({ message: "Session note is not finalized" });
      }

      // Permission check: assigned therapist, admin, or supervisor of the therapist
      const isAssignedTherapist = note.therapistId === req.user.id;
      const isAdmin = req.user.role === 'administrator';
      let isSupervisor = false;
      if (!isAssignedTherapist && !isAdmin) {
        const supervisorAssignments = await storage.getSupervisorAssignments(req.user.id);
        isSupervisor = supervisorAssignments.some(
          assignment => assignment.therapistId === note.therapistId
        );
      }
      if (!isAssignedTherapist && !isAdmin && !isSupervisor) {
        await AuditLogger.logAction({
          userId: req.user.id,
          username: req.user.username,
          action: 'note_updated',
          result: 'failure',
          resourceType: 'session_note',
          resourceId: id.toString(),
          clientId: note.clientId,
          ipAddress,
          userAgent,
          hipaaRelevant: true,
          riskLevel: 'high',
          details: JSON.stringify({ operation: 'note_reopened', reason: 'permission_denied' }),
          accessReason: 'Clinical documentation and care',
        });
        return res.status(403).json({ message: "You do not have permission to reopen this session note" });
      }

      // Move final content back to draft so the editor opens with the
      // last-finalized text and the user can keep editing where they
      // left off. Clear the finalization timestamp.
      const draftContent = note.finalContent || note.generatedContent || note.draftContent || '';
      const updatedNote = await storage.updateSessionNote(id, {
        isFinalized: false,
        isDraft: true,
        finalContent: null,
        finalizedAt: null,
        generatedContent: note.generatedContent ?? draftContent,
        draftContent,
      } as any);

      // HIPAA audit trail — high-risk modification of finalized clinical doc
      await AuditLogger.logAction({
        userId: req.user.id,
        username: req.user.username,
        action: 'note_updated',
        result: 'success',
        resourceType: 'session_note',
        resourceId: id.toString(),
        clientId: note.clientId,
        ipAddress,
        userAgent,
        hipaaRelevant: true,
        riskLevel: 'high',
        details: JSON.stringify({
          operation: 'note_reopened',
          previouslyFinalizedAt: note.finalizedAt,
          sessionId: note.sessionId,
        }),
        accessReason: 'Clinical documentation and care',
      });

      res.json(updatedNote);
    } catch (error) {
      console.error('Error reopening session note:', error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Voice transcription endpoint for session notes
  const audioUpload = multer({ 
    storage: multer.memoryStorage(),
    limits: {
      fileSize: 25 * 1024 * 1024 // 25MB max (OpenAI Whisper limit)
    },
    fileFilter: (req, file, cb) => {
      // Accept audio files only
      if (file.mimetype.startsWith('audio/') || file.mimetype === 'video/webm') {
        cb(null, true);
      } else {
        cb(new Error('Only audio files are allowed'));
      }
    }
  });

  // ===================================================================
  // SESSION TRANSCRIPT (chunked recording for hour-long therapy sessions)
  // ===================================================================

  // Authorization helper: only the assigned therapist, an admin, or a
  // supervisor of that therapist may touch a session's transcript.
  async function assertSessionAccess(
    req: AuthenticatedRequest,
    session: { id: number; therapistId: number; clientId: number },
  ): Promise<{ ok: true } | { ok: false; status: number; message: string }> {
    if (!req.user) return { ok: false, status: 401, message: "Unauthorized" };
    const role = req.user.role;
    if (role === 'admin' || role === 'administrator') return { ok: true };
    if (role === 'therapist') {
      if (session.therapistId === req.user.id) return { ok: true };
      return { ok: false, status: 403, message: "You can only access transcripts for your own sessions" };
    }
    if (role === 'supervisor') {
      const supervised = await storage.getSupervisorAssignments(req.user.id);
      const supervisedIds = supervised.map((a) => a.therapistId);
      if (supervisedIds.includes(session.therapistId)) return { ok: true };
      return { ok: false, status: 403, message: "You can only access transcripts for therapists you supervise" };
    }
    return { ok: false, status: 403, message: "You do not have permission to access session transcripts" };
  }

  // Phase 3 (security): the recorder must call POST /transcribe-start to mint
  // a server-side opaque uploadId bound to the calling user + session BEFORE
  // sending any chunks. Client-generated uploadIds are rejected by the chunk
  // endpoint. This prevents a different user from guessing/hijacking an
  // upload ID and uploading audio under another therapist's identity.

  // POST /api/sessions/:sessionId/transcribe-start
  // No body. Returns { uploadId } that the recorder uses for all subsequent
  // /transcribe-chunk and /transcribe-finalize calls for this recording.
  app.post(
    "/api/sessions/:sessionId/transcribe-start",
    requireAuth,
    blockAccountant,
    async (req: AuthenticatedRequest, res) => {
      try {
        const sessionId = parseInt(req.params.sessionId);
        if (isNaN(sessionId)) {
          return res.status(400).json({ message: "Invalid session id" });
        }
        const session = await storage.getSession(sessionId);
        if (!session) {
          return res.status(404).json({ message: "Session not found" });
        }
        const accessCheck = await assertSessionAccess(req, session);
        if (!accessCheck.ok) {
          return res.status(accessCheck.status).json({ message: accessCheck.message });
        }
        const consentCheck = await checkAIProcessingConsent(session.clientId);
        if (!consentCheck.hasConsent) {
          return res.status(403).json({ message: consentCheck.message || "AI processing consent required" });
        }

        // Opaque, unguessable upload id — bound on first creation to the
        // calling user + session in the persisted transcript row.
        const uploadId = `srv-${crypto.randomBytes(16).toString('hex')}`;
        const language = (req.body && typeof req.body.language === 'string') ? req.body.language : 'auto';
        const translateToEnglish = !!(req.body && req.body.translateToEnglish === true);

        const upload = await storage.createSessionTranscript({
          sessionId,
          clientId: session.clientId,
          therapistId: req.user!.id,
          content: '',
          rawContent: null,
          language,
          translatedToEnglish: translateToEnglish,
          durationSeconds: 0,
          chunkCount: 0,
          wordCount: 0,
          uploadId,
          chunks: {},
          status: 'recording',
        });
        return res.json({ uploadId: upload.uploadId });
      } catch (error: any) {
        console.error('[SessionTranscript] transcribe-start error:', error);
        return res.status(500).json({ message: error.message || 'Internal error' });
      }
    },
  );

  // Phase 3 (anti-abuse): per-user-per-session in-memory rate limit on chunk
  // uploads. A runaway client (bug or malicious) cannot flood Whisper with
  // requests and rack up cost. Limit: 120 chunk uploads / 10 minutes per
  // (user, session). Process-local — sufficient for current single-process
  // deployment; revisit if horizontally scaled.
  const CHUNK_RATE_WINDOW_MS = 10 * 60 * 1000;
  const CHUNK_RATE_MAX = 120;
  const chunkRateBuckets = new Map<string, number[]>();
  function checkChunkRate(userId: number, sessionId: number): { ok: true } | { ok: false; retryAfterSec: number } {
    const key = `${userId}:${sessionId}`;
    const now = Date.now();
    const cutoff = now - CHUNK_RATE_WINDOW_MS;
    const arr = (chunkRateBuckets.get(key) || []).filter((t) => t > cutoff);
    if (arr.length >= CHUNK_RATE_MAX) {
      const retryAfterSec = Math.ceil((arr[0] + CHUNK_RATE_WINDOW_MS - now) / 1000);
      chunkRateBuckets.set(key, arr);
      return { ok: false, retryAfterSec: Math.max(1, retryAfterSec) };
    }
    arr.push(now);
    chunkRateBuckets.set(key, arr);
    return { ok: true };
  }

  // POST /api/sessions/:sessionId/transcribe-chunk
  // Body: multipart with 'audio' file + chunkIndex + uploadId + (optional) language + chunkDurationSeconds
  app.post(
    "/api/sessions/:sessionId/transcribe-chunk",
    requireAuth,
    blockAccountant,
    audioUpload.single('audio'),
    async (req: AuthenticatedRequest, res) => {
      // Allow long Whisper calls
      req.setTimeout(10 * 60 * 1000);
      res.setTimeout(10 * 60 * 1000);

      try {
        const sessionId = parseInt(req.params.sessionId);
        if (isNaN(sessionId)) {
          return res.status(400).json({ message: "Invalid session id" });
        }
        if (!req.file) {
          return res.status(400).json({ message: "No audio chunk uploaded" });
        }

        const uploadId = String(req.body.uploadId || '');
        const chunkIndex = parseInt(req.body.chunkIndex);
        const chunkDuration = parseFloat(req.body.chunkDurationSeconds || '0');
        const language = req.body.language || undefined;
        if (!uploadId || uploadId.length > 64 || isNaN(chunkIndex) || chunkIndex < 0) {
          return res.status(400).json({ message: "uploadId and chunkIndex required" });
        }

        // Look up the session and verify it exists
        const session = await storage.getSession(sessionId);
        if (!session) {
          return res.status(404).json({ message: "Session not found" });
        }

        // AuthZ: only assigned therapist / supervisor / admin may record on this session
        const accessCheck = await assertSessionAccess(req, session);
        if (!accessCheck.ok) {
          return res.status(accessCheck.status).json({ message: accessCheck.message });
        }

        // GDPR: AI consent gate
        const consentCheck = await checkAIProcessingConsent(session.clientId);
        if (!consentCheck.hasConsent) {
          return res.status(403).json({ message: consentCheck.message || "AI processing consent required" });
        }

        // Phase 3: uploadId MUST be server-minted (created by /transcribe-start).
        // Reject anything not prefixed with 'srv-' AND not present in the DB.
        // Older client-generated ids are no longer accepted.
        if (!uploadId.startsWith('srv-')) {
          return res.status(400).json({ message: "Invalid uploadId — call /transcribe-start first" });
        }
        const upload = await storage.getSessionTranscriptByUploadId(uploadId);
        if (!upload) {
          return res.status(404).json({ message: "Unknown uploadId — call /transcribe-start first" });
        }
        if (upload.sessionId !== sessionId) {
          return res.status(400).json({ message: "uploadId already bound to a different session" });
        }
        if (upload.therapistId !== req.user!.id) {
          return res.status(403).json({ message: "This upload was started by a different user" });
        }
        if (upload.status !== 'recording') {
          return res.status(409).json({ message: `Upload is no longer accepting chunks (status: ${upload.status})` });
        }

        // Per-user-per-session rate limit (cheap circuit breaker).
        const rate = checkChunkRate(req.user!.id, sessionId);
        if (!rate.ok) {
          res.setHeader('Retry-After', String(rate.retryAfterSec));
          return res.status(429).json({
            message: `Chunk upload rate limit exceeded. Try again in ${rate.retryAfterSec} seconds.`,
          });
        }

        // Transcribe this chunk immediately, then drop the audio buffer.
        // Pass the previous chunk's text as continuity context so Whisper
        // doesn't drop or duplicate words at chunk seams.
        const fileName = req.file.originalname || `chunk-${chunkIndex}.webm`;
        const existingChunks = (upload.chunks as Record<string, { text: string; durationSeconds: number }> | null) || {};
        const previousChunkText = chunkIndex > 0 ? existingChunks[String(chunkIndex - 1)]?.text : undefined;
        console.log(`[SessionTranscript] chunk received uploadId=${uploadId} session=${sessionId} idx=${chunkIndex} bytes=${req.file.size} dur=${chunkDuration}s lang=${language || 'auto'}`);
        let chunkText = '';
        try {
          const { transcribeSessionChunk } = await import('./ai/openai');
          // Use the translateToEnglish flag stored on the upload row (set on
          // transcribe-start) so all chunks of a recording share the same
          // setting — the client can't switch mid-recording.
          chunkText = await transcribeSessionChunk(
            req.file.buffer,
            fileName,
            language,
            previousChunkText,
            !!upload.translatedToEnglish,
          );
        } catch (err: any) {
          console.error('[SessionTranscript] Chunk transcription error:', err);
          return res.status(500).json({ message: `Chunk transcription failed: ${err.message || 'Unknown'}` });
        }

        // Persist this chunk to the DB (atomic JSONB merge so concurrent chunks don't clobber).
        const updated = await storage.appendTranscriptChunk(upload.id, chunkIndex, chunkText, chunkDuration);
        const allChunks = (updated.chunks as Record<string, unknown>) || {};
        console.log(`[SessionTranscript] chunk stored uploadId=${uploadId} idx=${chunkIndex} textLen=${chunkText.length} totalChunks=${Object.keys(allChunks).length}`);

        return res.json({
          uploadId,
          chunkIndex,
          chunkText,
          chunksReceived: Object.keys(allChunks).length,
        });
      } catch (error: any) {
        console.error('[SessionTranscript] transcribe-chunk error:', error);
        return res.status(500).json({ message: error.message || "Internal error" });
      }
    },
  );

  // POST /api/sessions/:sessionId/transcribe-finalize
  // Body: { uploadId, totalChunks, language? }
  app.post(
    "/api/sessions/:sessionId/transcribe-finalize",
    requireAuth,
    blockAccountant,
    async (req: AuthenticatedRequest, res) => {
      req.setTimeout(15 * 60 * 1000);
      res.setTimeout(15 * 60 * 1000);

      try {
        const sessionId = parseInt(req.params.sessionId);
        const { uploadId, totalChunks, expectedChunks, silentChunks } = req.body || {};
        // Indices the client marked as truly silent (mic muted/unplugged).
        // They don't have a server-side row but DO count against expectedChunks
        // and produce a `[silence ~Xs]` marker in the stitched transcript so
        // downstream LLMs see the gap instead of inventing content over it.
        const silentMap = new Map<number, number>();
        if (Array.isArray(silentChunks)) {
          for (const s of silentChunks) {
            const idx = Number(s?.index);
            const dur = Number(s?.durationSeconds);
            if (Number.isFinite(idx) && idx >= 0) {
              silentMap.set(idx, Number.isFinite(dur) && dur > 0 ? dur : 0);
            }
          }
        }
        if (isNaN(sessionId) || !uploadId) {
          return res.status(400).json({ message: "sessionId and uploadId required" });
        }

        // AuthZ: re-verify session access at finalize time (defense in depth)
        const session = await storage.getSession(sessionId);
        if (!session) {
          return res.status(404).json({ message: "Session not found" });
        }
        const accessCheck = await assertSessionAccess(req, session);
        if (!accessCheck.ok) {
          return res.status(accessCheck.status).json({ message: accessCheck.message });
        }

        // Wait for the Deepgram WS-close persist (if any) so we read the
        // freshest text. No-op when this recording used the chunked Whisper
        // path (e.g. Arabic) — there is no live buffer to await.
        const { awaitLivePersist } = await import('./ai/deepgram-live');
        await awaitLivePersist(String(uploadId));

        const upload = await storage.getSessionTranscriptByUploadId(String(uploadId));
        if (!upload || upload.sessionId !== sessionId) {
          return res.status(404).json({ message: "Upload session not found or expired" });
        }
        if (upload.status === 'ready') {
          // Idempotent: already finalized — just return it.
          return res.json(upload);
        }
        // Bind upload to the original therapist who started it
        if (upload.therapistId !== req.user!.id && req.user!.role !== 'admin' && req.user!.role !== 'administrator') {
          return res.status(403).json({ message: "Only the recording therapist or an admin can finalize this upload" });
        }

        // Deepgram fast-path is now a FALLBACK only. The Whisper chunked
        // pipeline always runs and is the authoritative source for the
        // saved transcript, so we only fall back to the live Deepgram
        // text when no Whisper chunks were uploaded at all (e.g. very
        // short recording where Stop fires before any 20s slice rotated,
        // or Whisper API was unreachable for the whole recording).
        const hasUploadedChunks = upload.chunks
          && typeof upload.chunks === 'object'
          && Object.keys(upload.chunks as object).length > 0;
        const hasLiveText = !hasUploadedChunks
          && upload.status === 'processing'
          && typeof upload.content === 'string'
          && upload.content.trim().length > 0;
        if (hasLiveText) {
          const finalTranscript = await storage.finalizeTranscriptAtomic(upload.id, sessionId, {
            status: 'ready',
            chunks: null,
          });
          const { ipAddress, userAgent } = getRequestInfo(req);
          await AuditLogger.logAction({
            userId: req.user!.id,
            username: req.user!.username,
            action: 'session_transcript_created',
            result: 'success',
            resourceType: 'session_transcript',
            resourceId: String(finalTranscript.id),
            clientId: upload.clientId,
            ipAddress,
            userAgent,
            hipaaRelevant: true,
            riskLevel: 'high',
            details: JSON.stringify({
              sessionId,
              durationSeconds: upload.durationSeconds,
              wordCount: upload.wordCount,
              source: 'deepgram-live',
            }),
            accessReason: 'Therapist recorded session voice transcription (Deepgram live)',
          }).catch(() => {});
          return res.json(finalTranscript);
        }

        const chunksMap = (upload.chunks as Record<string, { text: string; durationSeconds: number }> | null) || {};
        const uploadedIndices = Object.keys(chunksMap).map((k) => parseInt(k, 10)).sort((a, b) => a - b);
        const chunksReceived = uploadedIndices.length;
        const liveContentLen = typeof upload.content === 'string' ? upload.content.trim().length : 0;
        console.log(`[SessionTranscript] finalize uploadId=${uploadId} session=${sessionId} chunksInDB=${chunksReceived} silentMarked=${silentMap.size} expected=${expectedChunks ?? totalChunks ?? 'n/a'} liveContentLen=${liveContentLen} status=${upload.status}`);
        // Total accounted for = uploaded chunks + client-marked silent chunks.
        // We need this for the missing-chunk safety check below; otherwise
        // every silent chunk would look like a "missing" chunk and block save.
        const accountedFor = chunksReceived + silentMap.size;

        // Block finalize if any expected chunks are missing (data-loss safety).
        // Silent chunks count as accounted-for: the client decided to skip
        // Whisper for them but they DID happen and will get a `[silence ~Xs]`
        // marker in the transcript.
        const expected = Number(expectedChunks ?? totalChunks);
        if (Number.isFinite(expected) && expected > 0) {
          if (accountedFor < expected) {
            return res.status(409).json({
              message: `Cannot finalize: only ${accountedFor} of ${expected} chunks were accounted for. Retry the missing chunks before saving.`,
              chunksReceived: accountedFor,
              chunksExpected: expected,
            });
          }
        }

        // Stitch chunks in order with chunk-boundary [hh:mm:ss] markers.
        // We iterate the FULL index range [0..maxIndex] so we can detect three
        // distinct cases at every position and surface them to the LLM:
        //   (1) chunk uploaded with text  → emit text under [hh:mm:ss] header
        //   (2) chunk uploaded but empty  → `[GAP IN RECORDING ~Xs — unintelligible]`
        //   (3) chunk in silentMap        → `[silence ~Xs]`
        //   (4) chunk index entirely missing → `[GAP IN RECORDING — chunk N missing]`
        // Without these markers the AI would silently glue disconnected
        // segments together and hallucinate transitions, which is the user's
        // "scenario mixing" complaint.
        const fmtHHMMSS = (totalSec: number): string => {
          const s = Math.max(0, Math.floor(totalSec));
          const h = Math.floor(s / 3600);
          const m = Math.floor((s % 3600) / 60);
          const sec = s % 60;
          const pad = (n: number) => String(n).padStart(2, '0');
          return `${pad(h)}:${pad(m)}:${pad(sec)}`;
        };
        // Hard cap: 2-hour recording at 60s slices = 120 chunks. We allow up
        // to 500 to leave headroom for any future timeslice changes / overruns.
        // Without this cap a malicious or buggy client could send `silentChunks`
        // with index: 1_000_000 and we'd loop a million times, OOM the process.
        const MAX_CHUNK_INDEX = 500;
        const rawMaxIndex = Math.max(
          uploadedIndices.length > 0 ? uploadedIndices[uploadedIndices.length - 1] : -1,
          silentMap.size > 0 ? Math.max(...Array.from(silentMap.keys())) : -1,
          Number.isFinite(expected) && expected > 0 ? expected - 1 : -1,
        );
        const maxIndex = Math.min(rawMaxIndex, MAX_CHUNK_INDEX);
        let cumulative = 0;
        const stitchedPieces: string[] = [];
        const labeledPieces: string[] = [];
        // The SmartHub recorder is always operated by a therapist on their
        // own device, so every spoken chunk is the therapist by definition.
        // We label directly here at stitch-time and skip the GPT-4o
        // diarization pass entirely — that second AI pass was rephrasing /
        // dropping content. System markers (gaps, silence) stay unlabeled
        // on their own line.
        const SOLO_LABEL = 'Therapist:';
        for (let i = 0; i <= maxIndex; i++) {
          const stored = chunksMap[String(i)];
          const ts = `[${fmtHHMMSS(cumulative)}]`;
          if (stored) {
            const text = (stored.text || '').trim();
            const dur = Number(stored.durationSeconds) || 0;
            if (text.length > 0) {
              stitchedPieces.push(`${ts}\n${text}`);
              labeledPieces.push(`${ts}\n${SOLO_LABEL} ${text}`);
            } else {
              // Whisper returned empty → unintelligible audio. Mark it.
              const marker = `[GAP IN RECORDING ~${Math.round(dur)}s — audio was unintelligible]`;
              stitchedPieces.push(`${ts}\n${marker}`);
              labeledPieces.push(`${ts}\n${marker}`);
            }
            cumulative += dur;
          } else if (silentMap.has(i)) {
            const dur = silentMap.get(i) || 0;
            const marker = `[silence ~${Math.round(dur)}s — microphone was muted or no speech]`;
            stitchedPieces.push(`${ts}\n${marker}`);
            labeledPieces.push(`${ts}\n${marker}`);
            cumulative += dur;
          } else {
            // Upload never arrived. Estimate ~60s (one slice) since we don't
            // know the real duration.
            const marker = `[GAP IN RECORDING — chunk ${i} failed to upload, content is missing]`;
            stitchedPieces.push(`${ts}\n${marker}`);
            labeledPieces.push(`${ts}\n${marker}`);
            cumulative += 60;
          }
        }
        const rawTranscript = stitchedPieces.join('\n').trim();
        const directlyLabeledTranscript = labeledPieces.join('\n\n').trim();
        const totalDurationSeconds = cumulative;
        const wordCount = rawTranscript
          ? rawTranscript.replace(/\[\d{2}:\d{2}:\d{2}\]/g, '').trim().split(/\s+/).filter(Boolean).length
          : 0;

        if (!rawTranscript) {
          const detail = `chunksInDB=${chunksReceived}, silentMarked=${silentMap.size}, expected=${expectedChunks ?? totalChunks ?? 'n/a'}, livePreviewLen=${liveContentLen}`;
          let hint = "Recording produced no audio.";
          if (chunksReceived === 0 && silentMap.size === 0) {
            hint = "The recorder never sent any audio to the server. This usually means the browser is running an old cached version of the page. Hard-refresh (Ctrl+Shift+R / Cmd+Shift+R) and try again. If it persists, check that microphone permission is granted for this site.";
          } else if (chunksReceived === 0 && silentMap.size > 0) {
            hint = "Every audio chunk was detected as silent. Check that the correct microphone is selected and not muted.";
          }
          const message = `No transcribed content to finalize. ${hint} (${detail})`;
          console.warn(`[SessionTranscript] finalize empty transcript: ${detail}`);
          await storage.updateSessionTranscript(upload.id, {
            status: 'failed',
            errorMessage: message,
          });
          return res.status(400).json({ message, detail });
        }

        // Mark this row as 'processing' so a concurrent refresh shows the
        // correct in-progress state. Old 'ready' transcript (if any) is
        // untouched until the atomic finalize step below.
        await storage.updateSessionTranscript(upload.id, {
          content: rawTranscript,
          rawContent: rawTranscript,
          durationSeconds: Math.round(totalDurationSeconds),
          chunkCount: chunksReceived,
          wordCount,
          status: 'processing',
        });

        // Direct labelling — no GPT-4o pass. The labeled transcript is built
        // straight from the Whisper chunks above with "Therapist:" prefixed
        // to each spoken turn. This eliminates the second-AI-pass data loss
        // the user reported (rephrasing, dropped lines, merged turns) and
        // makes Stop → Save effectively instant.
        // If we later need real two-speaker diarization for actual sessions
        // with a client present, the right tool is Deepgram's audio-based
        // speaker diarization, not a text LLM.
        const labeledContent = directlyLabeledTranscript;

        // Atomic: mark this row 'ready' AND remove any other (older) transcript
        // rows for the same session in a single transaction. The user is never
        // left with no transcript at all.
        const finalTranscript = await storage.finalizeTranscriptAtomic(upload.id, sessionId, {
          content: labeledContent,
          rawContent: rawTranscript,
          status: 'ready',
          chunks: null,
        });

        // Audit log
        const { ipAddress, userAgent } = getRequestInfo(req);
        await AuditLogger.logAction({
          userId: req.user!.id,
          username: req.user!.username,
          action: 'session_transcript_created',
          result: 'success',
          resourceType: 'session_transcript',
          resourceId: String(finalTranscript.id),
          clientId: upload.clientId,
          ipAddress,
          userAgent,
          hipaaRelevant: true,
          riskLevel: 'high',
          details: JSON.stringify({
            sessionId,
            durationSeconds: totalDurationSeconds,
            chunkCount: chunksReceived,
            wordCount,
            totalChunksRequested: totalChunks ?? chunksReceived,
          }),
          accessReason: 'Therapist recorded session voice transcription',
        });

        return res.json(finalTranscript);
      } catch (error: any) {
        console.error('[SessionTranscript] finalize error:', error);
        return res.status(500).json({ message: error.message || "Internal error" });
      }
    },
  );

  // GET /api/sessions/:sessionId/transcript
  app.get(
    "/api/sessions/:sessionId/transcript",
    requireAuth,
    async (req: AuthenticatedRequest, res) => {
      try {
        const sessionId = parseInt(req.params.sessionId);
        const session = await storage.getSession(sessionId);
        if (!session) return res.status(404).json({ message: "Session not found" });
        const accessCheck = await assertSessionAccess(req, session);
        if (!accessCheck.ok) {
          return res.status(accessCheck.status).json({ message: accessCheck.message });
        }
        const transcript = await storage.getSessionTranscript(sessionId);
        if (!transcript) return res.status(404).json({ message: "No transcript" });

        // Audit PHI read
        const { ipAddress, userAgent } = getRequestInfo(req);
        await AuditLogger.logAction({
          userId: req.user!.id,
          username: req.user!.username,
          action: 'session_transcript_viewed',
          result: 'success',
          resourceType: 'session_transcript',
          resourceId: String(transcript.id),
          clientId: transcript.clientId,
          ipAddress,
          userAgent,
          hipaaRelevant: true,
          riskLevel: 'medium',
          accessReason: 'Viewed session transcript',
        }).catch(() => {});

        return res.json(transcript);
      } catch (error: any) {
        return res.status(500).json({ message: error.message || "Internal error" });
      }
    },
  );

  // POST /api/sessions/:sessionId/transcript/smart-fill
  // Reads the saved transcript, asks GPT-4o to extract structured note fields,
  // and returns suggestions. Does NOT write to session_notes — the therapist
  // reviews and applies fields on the client.
  app.post(
    "/api/sessions/:sessionId/transcript/smart-fill",
    requireAuth,
    blockAccountant,
    async (req: AuthenticatedRequest, res) => {
      req.setTimeout(5 * 60 * 1000);
      res.setTimeout(5 * 60 * 1000);
      const { ipAddress, userAgent } = getRequestInfo(req);

      try {
        const sessionId = parseInt(req.params.sessionId);
        if (isNaN(sessionId)) {
          return res.status(400).json({ message: "Invalid sessionId" });
        }
        const session = await storage.getSession(sessionId);
        if (!session) return res.status(404).json({ message: "Session not found" });

        const accessCheck = await assertSessionAccess(req, session);
        if (!accessCheck.ok) {
          return res.status(accessCheck.status).json({ message: accessCheck.message });
        }

        const transcript = await storage.getSessionTranscript(sessionId);
        if (!transcript) {
          return res.status(404).json({
            message: "No transcript saved for this session. Record one first.",
          });
        }
        if (!transcript.content || transcript.content.trim().length === 0) {
          return res.status(400).json({ message: "Transcript is empty" });
        }

        // GDPR: AI consent must be granted on the client to run extraction
        const consentCheck = await checkAIProcessingConsent(transcript.clientId);
        if (!consentCheck.hasConsent) {
          await AuditLogger.logAction({
            userId: req.user!.id,
            username: req.user!.username,
            action: 'ai_processing_blocked',
            result: 'failure',
            resourceType: 'session_transcript',
            resourceId: String(transcript.id),
            clientId: transcript.clientId,
            ipAddress,
            userAgent,
            hipaaRelevant: true,
            riskLevel: 'medium',
            accessReason: 'Smart Fill blocked: AI consent not granted',
            details: JSON.stringify({ reason: consentCheck.message }),
          }).catch(() => {});
          return res.status(403).json({
            message: consentCheck.message || 'AI processing consent required',
          });
        }

        const { extractStructuredNoteFromTranscript } = await import('./ai/openai');
        const suggestions = await extractStructuredNoteFromTranscript(transcript.content);

        await AuditLogger.logAction({
          userId: req.user!.id,
          username: req.user!.username,
          action: 'session_transcript_smart_fill',
          result: 'success',
          resourceType: 'session_transcript',
          resourceId: String(transcript.id),
          clientId: transcript.clientId,
          ipAddress,
          userAgent,
          hipaaRelevant: true,
          riskLevel: 'medium',
          accessReason: 'Therapist requested AI-structured note draft from transcript',
          details: JSON.stringify({
            sessionId,
            transcriptWordCount: transcript.wordCount ?? null,
          }),
        }).catch(() => {});

        return res.json({ suggestions });
      } catch (error: any) {
        // Log full detail server-side; return generic message to client to avoid
        // leaking internal/AI provider details (defense in depth).
        console.error('[SmartFill] error:', error);
        return res.status(500).json({
          message: "Failed to generate Smart Fill suggestions. Please try again.",
        });
      }
    },
  );

  // DELETE /api/sessions/:sessionId/transcript
  app.delete(
    "/api/sessions/:sessionId/transcript",
    requireAuth,
    blockAccountant,
    async (req: AuthenticatedRequest, res) => {
      try {
        const sessionId = parseInt(req.params.sessionId);
        const session = await storage.getSession(sessionId);
        if (!session) return res.status(404).json({ message: "Session not found" });
        const accessCheck = await assertSessionAccess(req, session);
        if (!accessCheck.ok) {
          return res.status(accessCheck.status).json({ message: accessCheck.message });
        }

        const existing = await storage.getSessionTranscript(sessionId);
        if (!existing) return res.status(404).json({ message: "No transcript" });
        await storage.deleteSessionTranscript(sessionId);

        const { ipAddress, userAgent } = getRequestInfo(req);
        await AuditLogger.logAction({
          userId: req.user!.id,
          username: req.user!.username,
          action: 'session_transcript_deleted',
          result: 'success',
          resourceType: 'session_transcript',
          resourceId: String(existing.id),
          clientId: existing.clientId,
          ipAddress,
          userAgent,
          hipaaRelevant: true,
          riskLevel: 'high',
          accessReason: 'Therapist deleted session transcript',
        });
        return res.json({ ok: true });
      } catch (error: any) {
        return res.status(500).json({ message: error.message || "Internal error" });
      }
    },
  );


  // Bulk transcript-status lookup for a single client. Returns a map of
  // sessionId → true for sessions that have a 'ready' transcript. Used by
  // client-detail's Sessions tab to show a "Transcript ✓" pill on each card
  // without N+1 fetching per session.
  app.get(
    "/api/clients/:clientId/session-transcripts/status",
    requireAuth,
    blockAccountant,
    async (req: AuthenticatedRequest, res) => {
      try {
        if (!req.user) return res.status(401).json({ message: "Authentication required" });
        const clientId = parseInt(req.params.clientId);
        if (Number.isNaN(clientId)) return res.status(400).json({ message: "Invalid clientId" });

        // Per-client authorization, mirrors GET /api/clients/:id:
        // - admins: any client
        // - therapists: only their assigned clients
        // - supervisors: only clients of therapists they supervise
        // - everyone else (incl. portal clients): denied
        const client = await storage.getClient(clientId);
        if (!client) return res.status(404).json({ message: "Client not found" });
        const role = req.user.role;
        if (role === 'therapist') {
          if (client.assignedTherapistId !== req.user.id) {
            return res.status(403).json({ message: "Access denied. You can only view your assigned clients." });
          }
        } else if (role === 'supervisor') {
          const supervisorAssignments = await storage.getSupervisorAssignments(req.user.id);
          const supervisedTherapistIds = supervisorAssignments.map((a) => a.therapistId);
          if (!client.assignedTherapistId || !supervisedTherapistIds.includes(client.assignedTherapistId)) {
            return res.status(403).json({ message: "Access denied. You can only view clients of therapists you supervise." });
          }
        } else if (role !== 'admin' && role !== 'administrator') {
          return res.status(403).json({ message: "Access denied." });
        }

        const includeHidden = role === 'admin' || role === 'administrator';
        const clientSessions = await storage.getSessionsByClient(clientId, includeHidden);
        const sessionIds = clientSessions.map((s: any) => s.id);
        const ready = await storage.getReadyTranscriptSessionIds(sessionIds);
        const map: Record<number, boolean> = {};
        for (const id of ready) map[id] = true;
        return res.json(map);
      } catch (error: any) {
        return res.status(500).json({ message: error.message || "Internal error" });
      }
    },
  );

  // Bulk transcript-status lookup by sessionId list, used by the scheduling
  // page's session-card list. Filters to sessions the caller can access
  // (assigned therapist, supervisor of that therapist, or admin) so we never
  // leak transcript existence for sessions outside the user's scope.
  app.get(
    "/api/session-transcripts/status",
    requireAuth,
    blockAccountant,
    async (req: AuthenticatedRequest, res) => {
      try {
        if (!req.user) return res.status(401).json({ message: "Authentication required" });
        const raw = String(req.query.sessionIds || "").trim();
        if (!raw) return res.json({});
        const sessionIds = raw
          .split(",")
          .map((s) => parseInt(s.trim()))
          .filter((n) => Number.isFinite(n));
        if (!sessionIds.length) return res.json({});

        // Cap to avoid abuse; scheduling page paginates anyway.
        const capped = sessionIds.slice(0, 200);

        const role = req.user.role;
        const isAdmin = role === 'admin' || role === 'administrator';
        let allowedTherapistIds: number[] | null = null;
        if (!isAdmin) {
          if (role === 'supervisor') {
            const supervised = await storage.getSupervisorAssignments(req.user.id);
            allowedTherapistIds = [req.user.id, ...supervised.map((a) => a.therapistId)];
          } else if (role === 'therapist') {
            allowedTherapistIds = [req.user.id];
          } else {
            return res.json({});
          }
        }

        // Fetch session rows to enforce per-session access.
        const rows = await db
          .select({ id: sessions.id, therapistId: sessions.therapistId })
          .from(sessions)
          .where(inArray(sessions.id, capped));
        const allowedIds = rows
          .filter((r) => isAdmin || (allowedTherapistIds && allowedTherapistIds.includes(r.therapistId)))
          .map((r) => r.id);

        const ready = await storage.getReadyTranscriptSessionIds(allowedIds);
        const map: Record<number, boolean> = {};
        for (const id of ready) map[id] = true;
        return res.json(map);
      } catch (error: any) {
        return res.status(500).json({ message: error.message || "Internal error" });
      }
    },
  );

  app.post("/api/session-notes/transcribe", requireAuth, blockAccountant, audioUpload.single('audio'), async (req: AuthenticatedRequest, res) => {
    const { ipAddress, userAgent } = getRequestInfo(req);
    
    try {
      if (!req.user) {
        return res.status(401).json({ message: "Authentication required" });
      }

      // Optional session note ID (may not exist for new unsaved notes)
      const sessionNoteId = req.body.sessionNoteId ? parseInt(req.body.sessionNoteId) : null;
      // Session the note is for. Required for new (unsaved) notes so we can
      // authorize the caller and enforce AI-processing consent even without a
      // sessionNoteId. The client is derived from the session, never trusted
      // from the request body.
      const bodySessionId = req.body.sessionId ? parseInt(req.body.sessionId) : null;

      let clientName: string | undefined;
      let sessionDate: string | undefined;
      let noteClientId: number | undefined;
      let noteSessionId: number | undefined;
      
      // If sessionNoteId provided, verify permissions and get context
      if (sessionNoteId) {
        const note = await storage.getSessionNote(sessionNoteId);
        if (!note) {
          return res.status(404).json({ message: "Session note not found" });
        }

        // Permission check: Only assigned therapist or admin can transcribe
        const isAssignedTherapist = note.therapistId === req.user.id;
        const isAdmin = req.user.role === 'administrator';
        
        if (!isAssignedTherapist && !isAdmin) {
          return res.status(403).json({ message: "You do not have permission to transcribe audio for this session note" });
        }

        noteClientId = note.clientId;
        noteSessionId = note.sessionId;

        // Get client and session info for better AI context
        const client = await storage.getClient(note.clientId);
        const session = await storage.getSession(note.sessionId);
        clientName = client?.fullName;
        sessionDate = session?.sessionDate ? formatInTimeZone(new Date(session.sessionDate), 'America/New_York', "MMM dd, yyyy 'at' h:mm a") : undefined;
      } else if (bodySessionId != null && !Number.isNaN(bodySessionId)) {
        // New unsaved note: resolve the session, authorize the caller, and
        // derive the client from it so both access control and consent are
        // enforced below — same scope model as existing-note transcription.
        const session = await storage.getSession(bodySessionId);
        if (!session) {
          return res.status(404).json({ message: "Session not found" });
        }
        const accessCheck = await assertSessionAccess(req, session);
        if (!accessCheck.ok) {
          return res.status(accessCheck.status).json({ message: accessCheck.message });
        }
        noteClientId = session.clientId;
        noteSessionId = session.id;
        const client = await storage.getClient(session.clientId);
        clientName = client?.fullName;
        sessionDate = session.sessionDate ? formatInTimeZone(new Date(session.sessionDate), 'America/New_York', "MMM dd, yyyy 'at' h:mm a") : undefined;
      }

      // Check if audio file was uploaded
      if (!req.file) {
        return res.status(400).json({ message: "No audio file uploaded" });
      }

      // AI consent can only be verified against a known client. Require client
      // context for every transcription so AI processing is never run ungated.
      if (!noteClientId) {
        return res.status(400).json({ message: "Client context is required to transcribe audio" });
      }

      // GDPR: Check AI processing consent before transcribing
      if (noteClientId) {
        const consentCheck = await checkAIProcessingConsent(noteClientId);
        if (!consentCheck.hasConsent) {
          await AuditLogger.logAction({
            userId: req.user.id,
            username: req.user.username,
            action: 'ai_processing_blocked',
            result: 'denied',
            resourceType: 'voice_transcription',
            resourceId: sessionNoteId ? `session_note_${sessionNoteId}` : 'new_note',
            clientId: noteClientId,
            ipAddress,
            userAgent,
            hipaaRelevant: true,
            riskLevel: 'medium',
            details: JSON.stringify({
              reason: 'consent_not_granted',
              endpoint: '/api/session-notes/transcribe',
              consentType: 'ai_processing',
              sessionNoteId,
              error: consentCheck.error
            }),
            accessReason: 'Voice transcription attempted without consent'
          });
          
          return res.status(403).json({ message: consentCheck.message });
        }
      }

      console.log(`[API] Processing voice transcription${sessionNoteId ? ` for session note ${sessionNoteId}` : ' for new note'}. File size: ${req.file.size} bytes`);

      // Transcribe and map audio using AI
      const result = await transcribeAndMapAudio(
        req.file.buffer,
        req.file.originalname,
        clientName,
        sessionDate
      );

      // HIPAA Audit Log: Voice transcription processed
      if (sessionNoteId && noteClientId) {
        await AuditLogger.logSessionNoteAccess(
          req.user.id,
          req.user.username,
          sessionNoteId,
          noteClientId,
          'voice_transcription_processed',
          ipAddress,
          userAgent,
          { 
            sessionId: noteSessionId,
            audioFileSize: req.file.size,
            transcriptionLength: result.rawTranscription.length,
            fieldsExtracted: Object.keys(result.mappedFields).filter(k => (result.mappedFields as Record<string, any>)[k])
          }
        );
      } else {
        // Log for new note (no client/session ID yet)
        await storage.logUserActivity({
          userId: req.user.id,
          action: 'voice_transcription_new_note',
          resourceType: 'session_note',
          resourceId: null,
          details: JSON.stringify({
            description: 'Processed voice transcription for new unsaved session note',
            audioFileSize: req.file.size,
            transcriptionLength: result.rawTranscription.length,
          }),
          ipAddress,
          userAgent,
        });
      }

      console.log(`[API] Voice transcription completed${sessionNoteId ? ` for session note ${sessionNoteId}` : ' for new note'}`);

      // Return the transcription result for review dialog (don't auto-update database)
      res.json({
        success: true,
        rawTranscription: result.rawTranscription,
        mappedFields: result.mappedFields
      });
    } catch (error: any) {
      console.error('[API] Voice transcription error:', error);
      
      // Log failed attempt for audit trail
      if (req.user && req.body.sessionNoteId) {
        const noteId = parseInt(req.body.sessionNoteId);
        await AuditLogger.logSessionNoteAccess(
          req.user.id,
          req.user.username,
          noteId,
          0, // clientId not available in error case
          'voice_transcription_failed',
          ipAddress,
          userAgent,
          { error: error.message }
        );
      }
      
      res.status(500).json({ 
        message: error.message || "Voice transcription failed",
        error: error.message 
      });
    }
  });

  // Generate PDF HTML for session note (for preview only)
  app.get("/api/session-notes/:id/pdf", requireAuth, blockAccountant, async (req: AuthenticatedRequest, res) => {
    try {
      if (!req.user) {
        return res.status(401).json({ message: "Authentication required" });
      }
      
      const id = parseInt(req.params.id);
      const note = await storage.getSessionNote(id);
      
      if (!note) {
        return res.status(404).json({ message: "Session note not found" });
      }

      // Get practice settings
      let practiceSettings = {
        name: 'Resilience Counseling Research & Consultation',
        description: 'Licensed Mental Health Practice', 
        subtitle: 'Licensed Mental Health Practice',
        address: '111 Waterloo St Unit 406, London, ON N6B 2M4',
        phone: '+1 (548)866-0366',
        email: 'mail@resiliencec.com',
        website: 'www.resiliencec.com'
      };
      
      try {
        const practiceOptions = await storage.getSystemOptionsByCategory('practice_settings');
        practiceSettings.name = practiceOptions.find(o => o.optionKey === 'practice_name')?.optionLabel || practiceSettings.name;
        practiceSettings.description = practiceOptions.find(o => o.optionKey === 'practice_description')?.optionLabel || practiceSettings.description;
        practiceSettings.subtitle = practiceOptions.find(o => o.optionKey === 'practice_subtitle')?.optionLabel || practiceSettings.subtitle;
        practiceSettings.address = practiceOptions.find(o => o.optionKey === 'practice_address')?.optionLabel || practiceSettings.address;
        practiceSettings.phone = practiceOptions.find(o => o.optionKey === 'practice_phone')?.optionLabel || practiceSettings.phone;
        practiceSettings.email = practiceOptions.find(o => o.optionKey === 'practice_email')?.optionLabel || practiceSettings.email;
        practiceSettings.website = practiceOptions.find(o => o.optionKey === 'practice_website')?.optionLabel || practiceSettings.website;
      } catch (error) {
        // Use defaults if practice settings not found
      }

      // Import HTML generation module
      const { generateSessionNoteHTML } = await import("./pdf/session-note-pdf");
      
      // Convert date to string for PDF generation
      const noteForPDF = {
        ...note,
        date: note.date.toISOString(),
        session: {
          ...note.session,
          sessionDate: note.session.sessionDate.toISOString()
        }
      };
      
      const html = generateSessionNoteHTML(noteForPDF as any, practiceSettings);
      
      // Prevent caching to ensure fresh PDF generation
      res.setHeader('Content-Type', 'text/html');
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, private');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      res.removeHeader('ETag');
      res.send(html);
    } catch (error) {
      console.error('PDF generation error:', error);
      res.status(500).json({ message: "Failed to generate PDF" });
    }
  });


  // AI-powered routes
  app.post("/api/ai/generate-template", async (req, res) => {
    try {
      const { clientId, sessionId, formData, customInstructions } = req.body;
      
      if (!process.env.OPENAI_API_KEY && !process.env.AI_INTEGRATIONS_OPENAI_API_KEY) {
        return res.status(503).json({ error: "AI features not available. Please configure OPENAI_API_KEY." });
      }
      
      if (!customInstructions) {
        return res.status(400).json({ error: "Custom instructions are required" });
      }
      
      // GDPR: Check AI processing consent before generating content
      const consentCheck = await checkAIProcessingConsent(clientId);
      if (!consentCheck.hasConsent) {
        // Log blocked AI processing attempt
        await AuditLogger.logAction({
          userId: (req as any).user?.id || 0,
          username: (req as any).user?.username || 'system',
          action: 'ai_processing_blocked',
          result: 'denied',
          resourceType: 'ai_generation',
          resourceId: `client_${clientId}`,
          clientId,
          ipAddress: req.ip || '',
          userAgent: req.headers['user-agent'] || '',
          hipaaRelevant: true,
          riskLevel: 'medium',
          details: JSON.stringify({
            reason: 'consent_not_granted',
            endpoint: '/api/ai/generate-template',
            consentType: 'ai_processing'
          }),
          accessReason: 'AI processing attempted without consent'
        });
        
        return res.status(403).json({ error: consentCheck.message });
      }
      
      // Get client and session data
      const clientData = await storage.getClient(clientId);
      
      // Apply service visibility filtering when getting session data
      const includeHiddenServices = (req as any).user?.role === 'admin' || false;
      const sessionData = sessionId ? (await storage.getSessionsByClient(clientId, includeHiddenServices)).find(s => s.id === sessionId) : null;
      
      // If session requested but not found in filtered results, return error
      if (sessionId && !sessionData) {
        return res.status(404).json({ error: "Session not found" });
      }
      
      const { generateAITemplate } = await import("./ai/openai");
      const result = await generateAITemplate(clientData, sessionData, formData, customInstructions);
      
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: "Failed to generate AI template: " + (error instanceof Error ? error.message : 'Unknown error') });
    }
  });

  app.get("/api/ai/templates", async (req, res) => {
    try {
      const { getAllTemplates } = await import("./ai/openai");
      const templates = getAllTemplates();
      res.json({ templates });
    } catch (error) {
      res.status(500).json({ error: "Failed to get templates" });
    }
  });

  app.post("/api/ai/generate-from-template", async (req, res) => {
    try {
      const { templateId, field, context } = req.body;
      
      if (!process.env.OPENAI_API_KEY && !process.env.AI_INTEGRATIONS_OPENAI_API_KEY) {
        return res.status(503).json({ error: "AI features not available" });
      }
      
      const { generateFromTemplate } = await import("./ai/openai");
      const content = await generateFromTemplate(templateId, field, context);
      res.json({ content });
    } catch (error) {
      res.status(500).json({ error: "Failed to generate from template" });
    }
  });

  app.get("/api/ai/field-options/:templateId/:field", async (req, res) => {
    try {
      const { templateId, field } = req.params;
      const { getFieldOptions } = await import("./ai/openai");
      const options = getFieldOptions(templateId, field);
      res.json({ options });
    } catch (error) {
      res.status(500).json({ error: "Failed to get field options" });
    }
  });

  app.post("/api/ai/connected-suggestions", requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: "Authentication required" });
      }

      const { templateId, sourceField, sourceValue, clientId } = req.body;

      // GDPR: Check AI processing consent if clientId provided
      if (clientId) {
        const consentCheck = await checkAIProcessingConsent(clientId);
        if (!consentCheck.hasConsent) {
          const { ipAddress, userAgent } = getRequestInfo(req);
          await AuditLogger.logAction({
            userId: req.user.id,
            username: req.user.username,
            action: 'ai_processing_blocked',
            result: 'denied',
            resourceType: 'ai_suggestions',
            resourceId: templateId,
            clientId,
            ipAddress,
            userAgent,
            hipaaRelevant: true,
            riskLevel: 'low',
            details: JSON.stringify({
              reason: 'consent_not_granted',
              endpoint: '/api/ai/connected-suggestions',
              consentType: 'ai_processing',
              error: consentCheck.error
            }),
            accessReason: 'AI connected suggestions attempted without consent'
          });
          
          return res.status(403).json({ error: consentCheck.message });
        }
      }
      
      const { getConnectedSuggestions } = await import("./ai/openai");
      const suggestions = await getConnectedSuggestions(templateId, sourceField, sourceValue);
      res.json({ suggestions });
    } catch (error) {
      res.status(500).json({ error: "Failed to get connected suggestions" });
    }
  });

  app.post("/api/ai/generate-suggestions", requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: "Authentication required" });
      }

      const { field, context, clientId } = req.body;
      
      if (!process.env.OPENAI_API_KEY && !process.env.AI_INTEGRATIONS_OPENAI_API_KEY) {
        return res.status(503).json({ error: "AI features not available" });
      }

      // GDPR: Check AI processing consent if clientId provided
      if (clientId) {
        const consentCheck = await checkAIProcessingConsent(clientId);
        if (!consentCheck.hasConsent) {
          const { ipAddress, userAgent } = getRequestInfo(req);
          await AuditLogger.logAction({
            userId: req.user.id,
            username: req.user.username,
            action: 'ai_processing_blocked',
            result: 'denied',
            resourceType: 'ai_suggestions',
            resourceId: field,
            clientId,
            ipAddress,
            userAgent,
            hipaaRelevant: true,
            riskLevel: 'low',
            details: JSON.stringify({
              reason: 'consent_not_granted',
              endpoint: '/api/ai/generate-suggestions',
              consentType: 'ai_processing',
              field,
              error: consentCheck.error
            }),
            accessReason: 'AI suggestions generation attempted without consent'
          });
          
          return res.status(403).json({ error: consentCheck.message });
        }
      }
      
      const suggestions = await generateSmartSuggestions(field, context);
      res.json({ suggestions });
    } catch (error) {
      res.status(500).json({ error: "Failed to generate suggestions" });
    }
  });

  app.post("/api/ai/generate-clinical-report", requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: "Authentication required" });
      }

      const sessionNoteData = req.body;
      
      if (!process.env.OPENAI_API_KEY && !process.env.AI_INTEGRATIONS_OPENAI_API_KEY) {
        return res.status(503).json({ error: "AI features not available" });
      }

      // GDPR: Check AI processing consent before generating clinical report
      const clientId = sessionNoteData.clientId;
      if (clientId) {
        const consentCheck = await checkAIProcessingConsent(clientId);
        if (!consentCheck.hasConsent) {
          const { ipAddress, userAgent } = getRequestInfo(req);
          await AuditLogger.logAction({
            userId: req.user.id,
            username: req.user.username,
            action: 'ai_processing_blocked',
            result: 'denied',
            resourceType: 'clinical_report',
            resourceId: sessionNoteData.sessionNoteId || 'new_note',
            clientId,
            ipAddress,
            userAgent,
            hipaaRelevant: true,
            riskLevel: 'high',
            details: JSON.stringify({
              reason: 'consent_not_granted',
              endpoint: '/api/ai/generate-clinical-report',
              consentType: 'ai_processing',
              error: consentCheck.error
            }),
            accessReason: 'Clinical report generation attempted without consent'
          });
          
          return res.status(403).json({ error: consentCheck.message });
        }
      }
      
      // Format session date with time for AI prompt in EST
      if (sessionNoteData.sessionDate) {
        sessionNoteData.sessionDate = formatInTimeZone(new Date(sessionNoteData.sessionDate), 'America/New_York', "MMM dd, yyyy 'at' h:mm a");
      }
      
      const report = await generateClinicalReport(sessionNoteData);
      res.json({ report });
    } catch (error) {
      res.status(500).json({ error: "Failed to generate clinical report" });
    }
  });

  app.post("/api/ai/regenerate-content/:sessionNoteId", async (req, res) => {
    try {
      const sessionNoteId = parseInt(req.params.sessionNoteId);
      const { customPrompt } = req.body;
      
      if (!process.env.OPENAI_API_KEY && !process.env.AI_INTEGRATIONS_OPENAI_API_KEY) {
        return res.status(503).json({ error: "AI features not available" });
      }
      
      const sessionNote = await storage.getSessionNote(sessionNoteId);
      if (!sessionNote) {
        return res.status(404).json({ error: "Session note not found" });
      }
      
      // GDPR: Check AI processing consent before regenerating content
      const clientId = sessionNote.session?.clientId || sessionNote.clientId;
      if (clientId) {
        const consentCheck = await checkAIProcessingConsent(clientId);
        if (!consentCheck.hasConsent) {
          // Log blocked AI processing attempt
          await AuditLogger.logAction({
            userId: (req as any).user?.id || 0,
            username: (req as any).user?.username || 'system',
            action: 'ai_processing_blocked',
            result: 'denied',
            resourceType: 'ai_regeneration',
            resourceId: `session_note_${sessionNoteId}`,
            clientId,
            ipAddress: req.ip || '',
            userAgent: req.headers['user-agent'] || '',
            hipaaRelevant: true,
            riskLevel: 'medium',
            details: JSON.stringify({
              reason: 'consent_not_granted',
              endpoint: '/api/ai/regenerate-content',
              consentType: 'ai_processing',
              sessionNoteId
            }),
            accessReason: 'AI processing attempted without consent'
          });
          
          return res.status(403).json({ error: consentCheck.message });
        }
      }
      
      // Update status to processing
      await storage.updateSessionNote(sessionNoteId, { aiProcessingStatus: 'processing' });
      
      const aiContent = await generateSessionNoteSummary({
        sessionFocus: sessionNote.sessionFocus || undefined,
        symptoms: sessionNote.symptoms || undefined,
        shortTermGoals: sessionNote.shortTermGoals || undefined,
        intervention: sessionNote.intervention || undefined,
        progress: sessionNote.progress || undefined,
        remarks: sessionNote.remarks || undefined,
        recommendations: sessionNote.recommendations || undefined,
        customPrompt: customPrompt || sessionNote.customAiPrompt || undefined,
        sessionType: sessionNote.session?.sessionType || 'therapy session',
        sessionDate: sessionNote.session?.sessionDate ? formatInTimeZone(new Date(sessionNote.session.sessionDate), 'America/New_York', "MMM dd, yyyy 'at' h:mm a") : undefined,
        clientName: sessionNote.client?.fullName
      });
      
      // Update with regenerated content
      const updatedNote = await storage.updateSessionNote(sessionNoteId, {
        generatedContent: aiContent.generatedContent,
        draftContent: aiContent.generatedContent,
        customAiPrompt: customPrompt || sessionNote.customAiPrompt,
        aiProcessingStatus: 'completed'
      });
      
      res.json({ content: aiContent.generatedContent, sessionNote: updatedNote });
    } catch (error) {
      await storage.updateSessionNote(parseInt(req.params.sessionNoteId), { aiProcessingStatus: 'error' });
      res.status(500).json({ error: "Failed to regenerate AI content" });
    }
  });

  // Library routes
  app.get("/api/library/categories", requireAuth, blockAccountant, async (req: AuthenticatedRequest, res) => {
    try {
      const categories = await storage.getLibraryCategories();
      res.json(categories);
    } catch (error) {
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/library/categories/:id", requireAuth, blockAccountant, async (req: AuthenticatedRequest, res) => {
    try {
      const id = parseInt(req.params.id);
      const category = await storage.getLibraryCategory(id);
      if (!category) {
        return res.status(404).json({ message: "Category not found" });
      }
      res.json(category);
    } catch (error) {
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post("/api/library/categories", requireAuth, blockAccountant, async (req: AuthenticatedRequest, res) => {
    try {
      const validatedData = insertLibraryCategorySchema.parse(req.body);
      const category = await storage.createLibraryCategory(validatedData);
      res.status(201).json(category);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid category data", errors: error.errors });
      }
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.put("/api/library/categories/:id", requireAuth, blockAccountant, async (req: AuthenticatedRequest, res) => {
    try {
      const id = parseInt(req.params.id);
      const validatedData = insertLibraryCategorySchema.partial().parse(req.body);
      const category = await storage.updateLibraryCategory(id, validatedData);
      res.json(category);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid category data", errors: error.errors });
      }
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.delete("/api/library/categories/:id", requireAuth, blockAccountant, async (req: AuthenticatedRequest, res) => {
    try {
      const id = parseInt(req.params.id);
      await storage.deleteLibraryCategory(id);
      res.status(204).send();
    } catch (error) {
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/library/entries", requireAuth, blockAccountant, async (req: AuthenticatedRequest, res) => {
    try {
      const categoryId = req.query.categoryId ? parseInt(req.query.categoryId as string) : undefined;
      const entries = await storage.getLibraryEntries(categoryId);
      res.json(entries);
    } catch (error) {
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/library/entries/:id", requireAuth, blockAccountant, async (req: AuthenticatedRequest, res) => {
    try {
      const id = parseInt(req.params.id);
      const entry = await storage.getLibraryEntry(id);
      if (!entry) {
        return res.status(404).json({ message: "Entry not found" });
      }
      res.json(entry);
    } catch (error) {
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post("/api/library/entries", requireAuth, blockAccountant, async (req: AuthenticatedRequest, res) => {
    try {
      const validatedData = insertLibraryEntrySchema.parse(req.body);
      
      // Check for existing entry with same title
      const allEntries = await storage.getLibraryEntries();
      const existingEntry = allEntries.find(e => e.title.trim().toLowerCase() === validatedData.title.trim().toLowerCase());
      
      if (existingEntry) {
        return res.status(409).json({ 
          message: "Duplicate entry", 
          error: `Entry with title "${validatedData.title}" already exists` 
        });
      }
      
      const entry = await storage.createLibraryEntry(validatedData);
      res.status(201).json(entry);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid entry data", errors: error.errors });
      }
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Bulk create library entries
  app.post("/api/library/bulk-entries", requireAuth, blockAccountant, async (req: AuthenticatedRequest, res) => {
    try {
      const { categoryId, entries } = req.body;

      if (!Array.isArray(entries) || entries.length === 0) {
        return res.status(400).json({ message: "Invalid input: entries array required" });
      }

      if (!categoryId) {
        const hasAnyDomain = entries.some((e: any) => e.domain && e.domain.trim());
        if (!hasAnyDomain) {
          return res.status(400).json({ message: "Either categoryId or domain names are required to organize entries" });
        }
        const hasSubWithoutDomain = entries.some((e: any) => e.subdomain && e.subdomain.trim() && (!e.domain || !e.domain.trim()));
        if (hasSubWithoutDomain) {
          return res.status(400).json({ message: "Entries with subdomain must also have a domain" });
        }
      }

      const existingEntries = await storage.getLibraryEntries();
      const existingTitles = new Set(existingEntries.map(e => e.title.trim().toLowerCase()));

      const results = {
        total: entries.length,
        successful: 0,
        skipped: 0,
        failed: 0,
        categoriesCreated: 0,
        errors: [] as any[]
      };

      const needsCategoryResolution = !categoryId && entries.some((e: any) => e.domain || e.subdomain);

      const categoryCache = new Map<string, number>();

      if (needsCategoryResolution) {
        const allCategories = await storage.getLibraryCategories();

        const flattenCategories = (cats: any[], parentId: number | null = null) => {
          for (const cat of cats) {
            categoryCache.set(`${parentId || 'root'}::${cat.name.trim().toLowerCase()}`, cat.id);
            if (cat.children && cat.children.length > 0) {
              flattenCategories(cat.children, cat.id);
            }
          }
        };
        flattenCategories(allCategories);
      }

      const resolveCategory = async (domain?: string, subdomain?: string): Promise<number> => {
        if (categoryId) return categoryId;

        let domainId: number | undefined;

        if (domain) {
          const domainKey = `root::${domain.trim().toLowerCase()}`;
          if (categoryCache.has(domainKey)) {
            domainId = categoryCache.get(domainKey)!;
          } else {
            const created = await storage.createLibraryCategory({
              name: domain.trim(),
              parentId: null,
              sortOrder: 0,
              isActive: true,
            });
            domainId = created.id;
            categoryCache.set(domainKey, created.id);
            results.categoriesCreated++;
          }
        }

        if (subdomain && domainId) {
          const subKey = `${domainId}::${subdomain.trim().toLowerCase()}`;
          if (categoryCache.has(subKey)) {
            return categoryCache.get(subKey)!;
          } else {
            const created = await storage.createLibraryCategory({
              name: subdomain.trim(),
              parentId: domainId,
              sortOrder: 0,
              isActive: true,
            });
            categoryCache.set(subKey, created.id);
            results.categoriesCreated++;
            return created.id;
          }
        }

        if (domainId) return domainId;

        throw new Error('No category could be resolved - provide domain/subdomain or categoryId');
      };

      for (let i = 0; i < entries.length; i++) {
        const entryData = entries[i];

        try {
          if (existingTitles.has(entryData.title.trim().toLowerCase())) {
            results.skipped++;
            results.errors.push({
              row: i + 1,
              title: entryData.title,
              error: 'Duplicate - entry with this title already exists'
            });
            continue;
          }

          const resolvedCategoryId = await resolveCategory(entryData.domain, entryData.subdomain);

          const validatedData = insertLibraryEntrySchema.parse({
            categoryId: resolvedCategoryId,
            title: entryData.title,
            content: entryData.content,
            createdById: req.user!.id,
            tags: entryData.tags || null,
            sortOrder: entryData.sortOrder || 0
          });

          await storage.createLibraryEntry(validatedData);
          existingTitles.add(entryData.title.trim().toLowerCase());
          results.successful++;
        } catch (error) {
          results.failed++;
          results.errors.push({
            row: i + 1,
            title: entryData.title,
            error: error instanceof z.ZodError ? error.errors[0].message : (error instanceof Error ? error.message : 'Unknown error')
          });
        }
      }

      console.log('Bulk import results:', results);
      res.status(201).json(results);
    } catch (error) {
      console.error('Bulk import error:', error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.put("/api/library/entries/:id", requireAuth, blockAccountant, async (req: AuthenticatedRequest, res) => {
    try {
      const id = parseInt(req.params.id);
      const validatedData = insertLibraryEntrySchema.partial().parse(req.body);
      const entry = await storage.updateLibraryEntry(id, validatedData);
      res.json(entry);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid entry data", errors: error.errors });
      }
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.delete("/api/library/entries/:id", requireAuth, blockAccountant, async (req: AuthenticatedRequest, res) => {
    try {
      const id = parseInt(req.params.id);
      await storage.deleteLibraryEntry(id);
      res.status(204).send();
    } catch (error) {
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/library/search", requireAuth, blockAccountant, async (req: AuthenticatedRequest, res) => {
    try {
      const query = req.query.q as string;
      const categoryId = req.query.categoryId ? parseInt(req.query.categoryId as string) : undefined;
      
      if (!query) {
        return res.status(400).json({ message: "Search query is required" });
      }
      
      const entries = await storage.searchLibraryEntries(query, categoryId);
      res.json(entries);
    } catch (error) {
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post("/api/library/entries/:id/increment-usage", requireAuth, blockAccountant, async (req: AuthenticatedRequest, res) => {
    try {
      const id = parseInt(req.params.id);
      await storage.incrementLibraryEntryUsage(id);
      res.status(204).send();
    } catch (error) {
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Library entry connections routes
  app.get("/api/library/connections", requireAuth, blockAccountant, async (req: AuthenticatedRequest, res) => {
    try {
      const entryId = req.query.entryId ? parseInt(req.query.entryId as string) : undefined;
      const connections = await storage.getLibraryEntryConnections(entryId);
      res.json(connections);
    } catch (error) {
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/library/entries/:id/connected", requireAuth, blockAccountant, async (req: AuthenticatedRequest, res) => {
    try {
      const id = parseInt(req.params.id);
      const connectedEntries = await storage.getConnectedEntries(id);
      res.json(connectedEntries);
    } catch (error) {
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Bulk endpoint for fetching connections for multiple entries
  app.post("/api/library/entries/connected-bulk", requireAuth, blockAccountant, async (req: AuthenticatedRequest, res) => {
    try {
      const entryIds = req.body.entryIds;
      
      if (!Array.isArray(entryIds)) {
        return res.status(400).json({ message: "entryIds must be an array" });
      }

      // Handle empty array gracefully
      if (entryIds.length === 0) {
        return res.json({});
      }

      console.log(`[Bulk Connections] Fetching for ${entryIds.length} entries (sample:`, entryIds.slice(0, 3), ')');

      // Fetch connections for all provided entry IDs
      const connectionPromises = entryIds.map(async (id) => ({
        entryId: id,
        connections: await storage.getConnectedEntries(id)
      }));
      const results = await Promise.all(connectionPromises);
      
      // Return object keyed by entry ID for reliable mapping
      const connectionsMap = results.reduce((acc, { entryId, connections }) => {
        acc[entryId] = connections;
        return acc;
      }, {} as Record<number, any[]>);
      
      const nonEmptyCount = Object.values(connectionsMap).filter(c => c.length > 0).length;
      console.log(`[Bulk Connections] Returning ${Object.keys(connectionsMap).length} entries, ${nonEmptyCount} with connections`);
      
      res.json(connectionsMap);
    } catch (error) {
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post("/api/library/connections", requireAuth, blockAccountant, async (req: AuthenticatedRequest, res) => {
    try {
      if (!req.user) {
        return res.status(401).json({ message: "Authentication required" });
      }
      
      const connectionData = {
        ...req.body,
        createdById: req.user.id
      };
      
      const connection = await storage.createLibraryEntryConnection(connectionData);
      res.status(201).json(connection);
    } catch (error) {
      console.error("Error creating library connection:", error);
      res.status(500).json({ message: "Internal server error", error: error instanceof Error ? error.message : "Unknown error" });
    }
  });

  // Batch create connections endpoint with duplicate handling
  app.post("/api/library/connections/batch", requireAuth, blockAccountant, async (req: AuthenticatedRequest, res) => {
    try {
      if (!req.user) {
        return res.status(401).json({ message: "Authentication required" });
      }
      
      const connections = req.body.connections as Array<{
        fromEntryId: number;
        toEntryId: number;
        connectionType?: string;
        strength?: number;
        description?: string;
      }>;

      if (!Array.isArray(connections) || connections.length === 0) {
        return res.status(400).json({ message: "connections must be a non-empty array" });
      }

      const created: any[] = [];
      const skipped: any[] = [];

      for (const conn of connections) {
        try {
          const connectionData = {
            ...conn,
            createdById: req.user.id,
            connectionType: conn.connectionType || 'relates_to',
            strength: conn.strength || 4,
          };
          
          const result = await storage.createLibraryEntryConnection(connectionData);
          created.push(result);
        } catch (error: any) {
          // If duplicate (unique constraint violation), add to skipped
          if (error?.code === '23505' || error?.message?.includes('unique')) {
            skipped.push({ fromEntryId: conn.fromEntryId, toEntryId: conn.toEntryId });
          } else {
            // Re-throw other errors
            throw error;
          }
        }
      }

      res.status(201).json({
        created: created.length,
        skipped: skipped.length,
        total: connections.length,
        details: { created, skipped }
      });
    } catch (error) {
      console.error("Error creating batch connections:", error);
      res.status(500).json({ message: "Internal server error", error: error instanceof Error ? error.message : "Unknown error" });
    }
  });

  app.put("/api/library/connections/:id", requireAuth, blockAccountant, async (req: AuthenticatedRequest, res) => {
    try {
      const id = parseInt(req.params.id);
      const connection = await storage.updateLibraryEntryConnection(id, req.body);
      res.json(connection);
    } catch (error) {
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.delete("/api/library/connections/:id", requireAuth, blockAccountant, async (req: AuthenticatedRequest, res) => {
    try {
      const id = parseInt(req.params.id);
      await storage.deleteLibraryEntryConnection(id);
      res.status(204).send();
    } catch (error) {
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.delete("/api/library/entries/:entryId/connections", requireAuth, blockAccountant, async (req: AuthenticatedRequest, res) => {
    try {
      const entryId = parseInt(req.params.entryId);
      await storage.deleteAllLibraryEntryConnections(entryId);
      res.status(204).send();
    } catch (error) {
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Assessment Template Routes
  app.get("/api/assessments/templates", requireAuth, blockAccountant, async (req: AuthenticatedRequest, res) => {
    try {
      const templates = await storage.getAssessmentTemplates();
      res.json(templates);
    } catch (error) {
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/assessments/templates/:id", requireAuth, blockAccountant, async (req: AuthenticatedRequest, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid template ID" });
      }

      const template = await storage.getAssessmentTemplate(id);
      if (!template) {
        return res.status(404).json({ message: "Assessment template not found" });
      }

      res.json(template);
    } catch (error) {
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post("/api/assessments/templates", requireAuth, blockAccountant, async (req: AuthenticatedRequest, res) => {
    try {
      const validatedData = insertAssessmentTemplateSchema.parse(req.body);
      const template = await storage.createAssessmentTemplate(validatedData);
      res.status(201).json(template);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid template data", errors: error.errors });
      }
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.patch("/api/assessments/templates/:id", requireAuth, blockAccountant, async (req: AuthenticatedRequest, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid template ID" });
      }

      const templateData = req.body;
      const template = await storage.updateAssessmentTemplate(id, templateData);
      res.json(template);
    } catch (error) {
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.delete("/api/assessments/templates/:id", requireAuth, blockAccountant, async (req: AuthenticatedRequest, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid template ID" });
      }

      // First delete all assignments that reference this template
      try {
        await storage.deleteAssessmentAssignmentsByTemplateId(id);
      } catch (error) {
        // Continue if no assignments exist
      }
      
      // Then delete the template
      await storage.deleteAssessmentTemplate(id);
      res.json({ message: "Assessment template deleted successfully" });
    } catch (error) {
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Assessment Assignment Routes
  app.get("/api/assessments/assignments", requireAuth, blockAccountant, async (req: AuthenticatedRequest, res) => {
    try {
      const clientId = req.query.clientId ? parseInt(req.query.clientId as string) : undefined;
      const assignments = await storage.getAssessmentAssignments(clientId);
      res.json(assignments);
    } catch (error) {
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/assessments/assignments/:id", requireAuth, blockAccountant, async (req: AuthenticatedRequest, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid assignment ID" });
      }

      const assignment = await storage.getAssessmentAssignment(id);
      if (!assignment) {
        return res.status(404).json({ message: "Assessment assignment not found" });
      }

      res.json(assignment);
    } catch (error) {
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post("/api/assessments/assignments", requireAuth, blockAccountant, async (req: AuthenticatedRequest, res) => {
    try {
      const assignmentData = req.body;
      const assignment = await storage.createAssessmentAssignment(assignmentData);
      res.status(201).json(assignment);
    } catch (error) {
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // NOTE: PATCH route moved to line 6803 with proper authentication and authorization

  // Assessment Response Routes
  app.get("/api/assessments/assignments/:assignmentId/responses", requireAuth, blockAccountant, async (req: AuthenticatedRequest, res) => {
    try {
      const assignmentId = parseInt(req.params.assignmentId);
      if (isNaN(assignmentId)) {
        return res.status(400).json({ message: "Invalid assignment ID" });
      }

      const responses = await storage.getAssessmentResponses(assignmentId);
      res.json(responses);
    } catch (error) {
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Single assessment response endpoint - uses atomic upsert and filters empty responses
  app.post("/api/assessments/responses", requireAuth, blockAccountant, async (req: AuthenticatedRequest, res) => {
    try {
      if (!req.user) {
        return res.status(401).json({ message: "Authentication required" });
      }
      
      const responseData = req.body;
      
      // Require assignmentId for authorization
      if (!responseData.assignmentId) {
        return res.status(400).json({ message: "Assignment ID is required" });
      }
      
      // Authorization: Therapists/supervisors can save, clients for their own assessments
      const permCheck = await checkAssessmentResponsePermission(
        responseData.assignmentId,
        req.user.id,
        req.user.role,
        responseData.responderId // Pass responderId for validation
      );
      if (!permCheck.allowed) {
        return res.status(permCheck.notFound ? 404 : 403).json({ message: permCheck.message });
      }
      
      // Skip empty responses (same validation as batch endpoint)
      const hasText = responseData.responseText && responseData.responseText.trim() !== '';
      const hasOptions = Array.isArray(responseData.selectedOptions) && responseData.selectedOptions.length > 0;
      const hasRating = responseData.ratingValue !== null && responseData.ratingValue !== undefined;
      
      if (!hasText && !hasOptions && !hasRating) {
        return res.status(200).json({ message: 'Empty response skipped', skipped: true });
      }
      
      const response = await storage.saveAssessmentResponse(responseData);
      
      // Automatically update assessment status to 'client_in_progress' if it's currently 'pending'
      if (responseData.assignmentId) {
        const assignment = await storage.getAssessmentAssignmentById(responseData.assignmentId);
        if (assignment && assignment.status === 'pending') {
          await storage.updateAssessmentAssignment(responseData.assignmentId, {
            status: 'client_in_progress'
          });
        }
      }
      
      res.status(201).json(response);
    } catch (error) {
      console.error('Error saving assessment response:', error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Assessment Voice Transcription
  app.post("/api/assessments/transcribe", requireAuth, blockAccountant, audioUpload.single('audio'), async (req: AuthenticatedRequest, res) => {
    const { ipAddress, userAgent } = getRequestInfo(req);
    
    try {
      if (!req.user) {
        return res.status(401).json({ message: "Authentication required" });
      }

      // Check if audio file was uploaded
      if (!req.file) {
        return res.status(400).json({ message: "No audio file uploaded" });
      }

      // Get assignmentId to look up client context for consent checking
      const assignmentId = req.body.assignmentId ? parseInt(req.body.assignmentId) : null;
      let clientId: number | null = null;

      if (assignmentId) {
        const assignment = await storage.getAssessmentAssignment(assignmentId);
        if (assignment) {
          clientId = assignment.clientId;
          
          // GDPR: Check AI processing consent before transcribing
          const consentCheck = await checkAIProcessingConsent(clientId);
          if (!consentCheck.hasConsent) {
            await AuditLogger.logAction({
              userId: req.user.id,
              username: req.user.username,
              action: 'ai_processing_blocked',
              result: 'denied',
              resourceType: 'assessment_transcription',
              resourceId: String(assignmentId),
              clientId,
              ipAddress,
              userAgent,
              hipaaRelevant: true,
              riskLevel: 'medium',
              details: JSON.stringify({
                reason: 'consent_not_granted',
                endpoint: '/api/assessments/transcribe',
                consentType: 'ai_processing',
                assignmentId,
                error: consentCheck.error
              }),
              accessReason: 'Assessment voice transcription attempted without consent'
            });
            
            return res.status(403).json({ message: consentCheck.message });
          }
        }
      }

      // Get translation preference from request
      const translateToEnglish = req.body.translateToEnglish === 'true';
      
      console.log(`[API] Processing assessment voice transcription. Translation: ${translateToEnglish ? 'enabled' : 'disabled'}. File size: ${req.file.size} bytes`);

      // Transcribe audio (with optional translation)
      const transcription = await transcribeAssessmentAudio(
        req.file.buffer,
        req.file.originalname,
        translateToEnglish
      );

      console.log(`[API] Assessment transcription successful. Length: ${transcription.length} chars`);

      // Audit log successful transcription
      if (clientId && assignmentId) {
        await AuditLogger.logAction({
          userId: req.user.id,
          username: req.user.username,
          action: 'assessment_voice_transcribed',
          result: 'success',
          resourceType: 'assessment',
          resourceId: String(assignmentId),
          clientId,
          ipAddress,
          userAgent,
          hipaaRelevant: true,
          riskLevel: 'low',
          details: JSON.stringify({
            audioFileSize: req.file.size,
            transcriptionLength: transcription.length,
            translationEnabled: translateToEnglish
          }),
          accessReason: 'Voice transcription for assessment response'
        });
      }

      res.json({ transcription });
    } catch (error: any) {
      console.error('[API] Assessment transcription error:', error);
      res.status(500).json({ 
        message: error.message || "Voice transcription failed",
        error: error.message 
      });
    }
  });

  // Transcribe a voice recording for a client communication note.
  // Accepts multipart audio + clientId, checks AI processing consent for that
  // client, and returns the transcribed text. No note is persisted here — the
  // text is inserted into the add/edit note form on the client.
  app.post("/api/communications/transcribe", requireAuth, blockAccountant, audioUpload.single('audio'), async (req: AuthenticatedRequest, res) => {
    const { ipAddress, userAgent } = getRequestInfo(req);

    try {
      if (!req.user) {
        return res.status(401).json({ message: "Authentication required" });
      }

      if (!req.file) {
        return res.status(400).json({ message: "No audio file uploaded" });
      }

      const clientId = req.body.clientId ? parseInt(req.body.clientId) : null;
      if (!clientId || isNaN(clientId)) {
        return res.status(400).json({ message: "A valid clientId is required" });
      }

      const client = await storage.getClient(clientId);
      if (!client) {
        return res.status(404).json({ message: "Client not found" });
      }

      // Role-based authorization: therapists can only transcribe for their
      // assigned clients; supervisors only for clients of therapists they
      // supervise; admins have full access. Mirrors the client-access policy
      // used by protected client routes (HIPAA object-level access control).
      let accessDeniedReason: string | null = null;
      if (req.user.role === 'therapist') {
        if (client.assignedTherapistId !== req.user.id) {
          accessDeniedReason = "You can only transcribe notes for your assigned clients.";
        }
      } else if (req.user.role === 'supervisor') {
        const supervisorAssignments = await storage.getSupervisorAssignments(req.user.id);
        const supervisedTherapistIds = supervisorAssignments.map(a => a.therapistId);
        if (client.assignedTherapistId && !supervisedTherapistIds.includes(client.assignedTherapistId)) {
          accessDeniedReason = "You can only transcribe notes for clients of therapists you supervise.";
        }
      }

      if (accessDeniedReason) {
        await AuditLogger.logAction({
          userId: req.user.id,
          username: req.user.username,
          action: 'unauthorized_access',
          result: 'denied',
          resourceType: 'communication_transcription',
          resourceId: `client_${clientId}`,
          clientId,
          ipAddress,
          userAgent,
          hipaaRelevant: true,
          riskLevel: 'high',
          details: JSON.stringify({
            reason: 'client_not_authorized',
            endpoint: '/api/communications/transcribe',
            userRole: req.user.role
          }),
          accessReason: 'Communication voice transcription attempted for unauthorized client'
        });

        return res.status(403).json({ message: `Access denied. ${accessDeniedReason}` });
      }

      // GDPR: Check AI processing consent before transcribing client data.
      const consentCheck = await checkAIProcessingConsent(clientId);
      if (!consentCheck.hasConsent) {
        await AuditLogger.logAction({
          userId: req.user.id,
          username: req.user.username,
          action: 'ai_processing_blocked',
          result: 'denied',
          resourceType: 'communication_transcription',
          resourceId: `client_${clientId}`,
          clientId,
          ipAddress,
          userAgent,
          hipaaRelevant: true,
          riskLevel: 'medium',
          details: JSON.stringify({
            reason: 'consent_not_granted',
            endpoint: '/api/communications/transcribe',
            consentType: 'ai_processing',
            error: consentCheck.error
          }),
          accessReason: 'Communication voice transcription attempted without consent'
        });

        return res.status(403).json({ message: consentCheck.message });
      }

      const translateToEnglish = req.body.translateToEnglish === 'true';

      console.log(`[API] Processing communication voice transcription. Translation: ${translateToEnglish ? 'enabled' : 'disabled'}. File size: ${req.file.size} bytes`);

      const transcription = await transcribeAssessmentAudio(
        req.file.buffer,
        req.file.originalname,
        translateToEnglish
      );

      console.log(`[API] Communication transcription successful. Length: ${transcription.length} chars`);

      await AuditLogger.logAction({
        userId: req.user.id,
        username: req.user.username,
        action: 'voice_transcription_processed',
        result: 'success',
        resourceType: 'communication',
        resourceId: `client_${clientId}`,
        clientId,
        ipAddress,
        userAgent,
        hipaaRelevant: true,
        riskLevel: 'low',
        details: JSON.stringify({
          audioFileSize: req.file.size,
          transcriptionLength: transcription.length,
          translationEnabled: translateToEnglish
        }),
        accessReason: 'Voice transcription for client communication note'
      });

      res.json({ transcription });
    } catch (error: any) {
      console.error('[API] Communication transcription error:', error);
      res.status(500).json({
        message: error.message || "Voice transcription failed",
        error: error.message
      });
    }
  });

  // ===================================================================
  // COMMUNICATION VOICE NOTE — CHUNKED TRANSCRIPTION
  // ===================================================================
  // Mirrors the session-note recorder's server-minted uploadId + chunk flow
  // so long dictations (multi-minute) upload reliably in ~20s slices instead
  // of buffering the whole clip in the browser and POSTing one large blob at
  // Stop (slow, fragile, and capped by the 25 MB Whisper/multer limit). Each
  // chunk is Whisper-transcribed immediately and its text accumulated
  // server-side; finalize stitches the pieces in order and returns the
  // combined transcription.
  // Per-chunk transcript text + upload metadata is persisted to the
  // `comm_transcribe_uploads` DB table (via storage) rather than an in-memory
  // map, so a dictation interrupted mid-recording survives a SERVER RESTART and
  // can still be recovered/finalized. Rows are deleted on finalize and swept
  // after the TTL below (replaces the old in-memory 30-min TTL).
  const COMM_UPLOAD_TTL_MS = 30 * 60 * 1000;

  // Per-user-per-client chunk-upload rate limit (cheap circuit breaker so a
  // runaway client can't flood Whisper). 120 uploads / 10 min — same budget as
  // the session recorder. Process-local; revisit if horizontally scaled.
  const COMM_CHUNK_RATE_WINDOW_MS = 10 * 60 * 1000;
  const COMM_CHUNK_RATE_MAX = 120;
  const commChunkRateBuckets = new Map<string, number[]>();
  function checkCommChunkRate(userId: number, clientId: number): { ok: true } | { ok: false; retryAfterSec: number } {
    const key = `${userId}:${clientId}`;
    const now = Date.now();
    const cutoff = now - COMM_CHUNK_RATE_WINDOW_MS;
    const arr = (commChunkRateBuckets.get(key) || []).filter((t) => t > cutoff);
    if (arr.length >= COMM_CHUNK_RATE_MAX) {
      const retryAfterSec = Math.ceil((arr[0] + COMM_CHUNK_RATE_WINDOW_MS - now) / 1000);
      commChunkRateBuckets.set(key, arr);
      return { ok: false, retryAfterSec: Math.max(1, retryAfterSec) };
    }
    arr.push(now);
    commChunkRateBuckets.set(key, arr);
    return { ok: true };
  }

  // Role-based client access check shared by the chunked communication
  // transcription endpoints. Mirrors the policy used by the single-shot
  // /api/communications/transcribe route above (HIPAA object-level access).
  async function assertCommunicationClientAccess(
    req: AuthenticatedRequest,
    clientId: number,
  ): Promise<{ ok: true } | { ok: false; status: number; message: string }> {
    const client = await storage.getClient(clientId);
    if (!client) return { ok: false, status: 404, message: "Client not found" };
    if (req.user!.role === 'therapist') {
      if (client.assignedTherapistId !== req.user!.id) {
        return { ok: false, status: 403, message: "You can only transcribe notes for your assigned clients." };
      }
    } else if (req.user!.role === 'supervisor') {
      const supervisorAssignments = await storage.getSupervisorAssignments(req.user!.id);
      const supervisedTherapistIds = supervisorAssignments.map(a => a.therapistId);
      if (client.assignedTherapistId && !supervisedTherapistIds.includes(client.assignedTherapistId)) {
        return { ok: false, status: 403, message: "You can only transcribe notes for clients of therapists you supervise." };
      }
    }
    return { ok: true };
  }

  // POST /api/communications/transcribe-start
  // Body: { clientId, translateToEnglish?, language? }. Returns { uploadId }.
  app.post("/api/communications/transcribe-start", requireAuth, blockAccountant, async (req: AuthenticatedRequest, res) => {
    const { ipAddress, userAgent } = getRequestInfo(req);
    try {
      if (!req.user) return res.status(401).json({ message: "Authentication required" });
      const clientId = req.body?.clientId ? parseInt(String(req.body.clientId)) : NaN;
      if (!clientId || isNaN(clientId)) return res.status(400).json({ message: "A valid clientId is required" });

      const access = await assertCommunicationClientAccess(req, clientId);
      if (!access.ok) {
        if (access.status === 403) {
          await AuditLogger.logAction({
            userId: req.user.id,
            username: req.user.username,
            action: 'unauthorized_access',
            result: 'denied',
            resourceType: 'communication_transcription',
            resourceId: `client_${clientId}`,
            clientId,
            ipAddress,
            userAgent,
            hipaaRelevant: true,
            riskLevel: 'high',
            details: JSON.stringify({ reason: 'client_not_authorized', endpoint: '/api/communications/transcribe-start', userRole: req.user.role }),
            accessReason: 'Chunked communication voice transcription attempted for unauthorized client'
          }).catch(() => {});
          return res.status(403).json({ message: `Access denied. ${access.message}` });
        }
        return res.status(access.status).json({ message: access.message });
      }

      // GDPR: AI consent gate before any audio is accepted.
      const consentCheck = await checkAIProcessingConsent(clientId);
      if (!consentCheck.hasConsent) {
        await AuditLogger.logAction({
          userId: req.user.id,
          username: req.user.username,
          action: 'ai_processing_blocked',
          result: 'denied',
          resourceType: 'communication_transcription',
          resourceId: `client_${clientId}`,
          clientId,
          ipAddress,
          userAgent,
          hipaaRelevant: true,
          riskLevel: 'medium',
          details: JSON.stringify({ reason: 'consent_not_granted', endpoint: '/api/communications/transcribe-start', consentType: 'ai_processing', error: consentCheck.error }),
          accessReason: 'Chunked communication voice transcription attempted without consent'
        }).catch(() => {});
        return res.status(403).json({ message: consentCheck.message });
      }

      // Sweep abandoned (never-finalized) rows so the table can't grow unbounded.
      await storage.sweepCommTranscribeUploads(new Date(Date.now() - COMM_UPLOAD_TTL_MS)).catch(() => {});
      const uploadId = `srv-${crypto.randomBytes(16).toString('hex')}`;
      const translateToEnglish = req.body?.translateToEnglish === true || req.body?.translateToEnglish === 'true';
      const language = typeof req.body?.language === 'string' && req.body.language ? req.body.language : undefined;
      await storage.createCommTranscribeUpload({
        uploadId,
        userId: req.user.id,
        clientId,
        translateToEnglish,
        language: language ?? null,
        chunks: {},
        status: 'recording',
      });
      console.log(`[CommTranscribe] start uploadId=${uploadId} user=${req.user.id} client=${clientId} translate=${translateToEnglish}`);
      return res.json({ uploadId });
    } catch (error: any) {
      console.error('[CommTranscribe] start error:', error);
      return res.status(500).json({ message: error.message || 'Internal error' });
    }
  });

  // POST /api/communications/transcribe-chunk
  // Body: multipart with 'audio' file + uploadId + chunkIndex + (optional) chunkDurationSeconds
  app.post("/api/communications/transcribe-chunk", requireAuth, blockAccountant, audioUpload.single('audio'), async (req: AuthenticatedRequest, res) => {
    // Allow long Whisper calls.
    req.setTimeout(10 * 60 * 1000);
    res.setTimeout(10 * 60 * 1000);
    try {
      if (!req.user) return res.status(401).json({ message: "Authentication required" });
      if (!req.file) return res.status(400).json({ message: "No audio chunk uploaded" });

      const uploadId = String(req.body.uploadId || '');
      const chunkIndex = parseInt(req.body.chunkIndex);
      if (!uploadId || uploadId.length > 64 || isNaN(chunkIndex) || chunkIndex < 0) {
        return res.status(400).json({ message: "uploadId and chunkIndex required" });
      }
      // uploadId MUST be server-minted (created by /transcribe-start).
      if (!uploadId.startsWith('srv-')) {
        return res.status(400).json({ message: "Invalid uploadId — call /transcribe-start first" });
      }
      const upload = await storage.getCommTranscribeUpload(uploadId);
      if (!upload) return res.status(404).json({ message: "Unknown or expired uploadId — call /transcribe-start first" });
      if (upload.userId !== req.user.id) return res.status(403).json({ message: "This upload was started by a different user" });
      if (upload.status !== 'recording') return res.status(409).json({ message: `Upload is no longer accepting chunks (status: ${upload.status})` });

      // GDPR: re-verify AI consent on every chunk (defense in depth — consent
      // could be revoked mid-recording).
      const consentCheck = await checkAIProcessingConsent(upload.clientId);
      if (!consentCheck.hasConsent) return res.status(403).json({ message: consentCheck.message });

      // Per-user-per-client rate limit (cheap circuit breaker).
      const rate = checkCommChunkRate(req.user.id, upload.clientId);
      if (!rate.ok) {
        res.setHeader('Retry-After', String(rate.retryAfterSec));
        return res.status(429).json({ message: `Chunk upload rate limit exceeded. Try again in ${rate.retryAfterSec} seconds.` });
      }

      // Transcribe this chunk immediately, passing the previous chunk's text as
      // continuity context so Whisper doesn't drop/duplicate words at seams.
      const fileName = req.file.originalname || `chunk-${chunkIndex}.webm`;
      const previousChunkText = chunkIndex > 0 ? upload.chunks?.[String(chunkIndex - 1)] : undefined;
      console.log(`[CommTranscribe] chunk received uploadId=${uploadId} idx=${chunkIndex} bytes=${req.file.size}`);
      let chunkText = '';
      try {
        const { transcribeSessionChunk } = await import('./ai/openai');
        chunkText = await transcribeSessionChunk(
          req.file.buffer,
          fileName,
          upload.language ?? undefined,
          previousChunkText,
          upload.translateToEnglish,
        );
      } catch (err: any) {
        console.error('[CommTranscribe] chunk transcription error:', err);
        return res.status(500).json({ message: `Chunk transcription failed: ${err.message || 'Unknown'}` });
      }

      // Persist the chunk text (atomic JSONB merge) so it survives a restart.
      const updated = await storage.appendCommTranscribeChunk(uploadId, chunkIndex, chunkText);
      const chunksReceived = updated?.chunks ? Object.keys(updated.chunks).length : 0;
      console.log(`[CommTranscribe] chunk stored uploadId=${uploadId} idx=${chunkIndex} textLen=${chunkText.length} totalChunks=${chunksReceived}`);
      return res.json({ uploadId, chunkIndex, chunkText, chunksReceived });
    } catch (error: any) {
      console.error('[CommTranscribe] chunk error:', error);
      return res.status(500).json({ message: error.message || 'Internal error' });
    }
  });

  // POST /api/communications/transcribe-finalize
  // Body: { uploadId, expectedChunks?, totalChunks? }. Returns { transcription }.
  app.post("/api/communications/transcribe-finalize", requireAuth, blockAccountant, async (req: AuthenticatedRequest, res) => {
    const { ipAddress, userAgent } = getRequestInfo(req);
    try {
      if (!req.user) return res.status(401).json({ message: "Authentication required" });
      const uploadId = String(req.body?.uploadId || '');
      if (!uploadId) return res.status(400).json({ message: "uploadId required" });
      const upload = await storage.getCommTranscribeUpload(uploadId);
      if (!upload) return res.status(404).json({ message: "Unknown or expired uploadId" });
      if (upload.userId !== req.user.id) return res.status(403).json({ message: "This upload was started by a different user" });

      // Data-loss safety: if the client tells us how many chunks it sent and
      // some never made it (permanent upload failure), refuse to finalize so
      // the recorder can retry the missing chunks first.
      const expected = Number(req.body?.expectedChunks ?? req.body?.totalChunks);
      const chunkMap = upload.chunks ?? {};
      const receivedIndices = Object.keys(chunkMap)
        .map((k) => parseInt(k, 10))
        .filter((n) => Number.isFinite(n))
        .sort((a, b) => a - b);
      if (Number.isFinite(expected) && expected > 0 && receivedIndices.length < expected) {
        return res.status(409).json({
          message: `Cannot finalize: only ${receivedIndices.length} of ${expected} chunks were received. Retry the missing chunks before saving.`,
          chunksReceived: receivedIndices.length,
          chunksExpected: expected,
        });
      }

      // Stitch chunk texts in index order into one transcript.
      const transcription = receivedIndices
        .map((i) => (chunkMap[String(i)] || '').trim())
        .filter(Boolean)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();

      // Delete the row — finalize consumes the upload (matches prior in-memory
      // behavior; a subsequent chunk/finalize for the same id now 404s).
      await storage.deleteCommTranscribeUpload(uploadId);

      if (!transcription) {
        return res.status(400).json({ message: "No speech was detected in the recording. Please try recording again." });
      }

      await AuditLogger.logAction({
        userId: req.user.id,
        username: req.user.username,
        action: 'voice_transcription_processed',
        result: 'success',
        resourceType: 'communication',
        resourceId: `client_${upload.clientId}`,
        clientId: upload.clientId,
        ipAddress,
        userAgent,
        hipaaRelevant: true,
        riskLevel: 'low',
        details: JSON.stringify({
          chunkCount: receivedIndices.length,
          transcriptionLength: transcription.length,
          translationEnabled: upload.translateToEnglish,
          mode: 'chunked',
        }),
        accessReason: 'Chunked voice transcription for client communication note'
      }).catch(() => {});

      console.log(`[CommTranscribe] finalize uploadId=${uploadId} chunks=${receivedIndices.length} textLen=${transcription.length}`);
      return res.json({ transcription });
    } catch (error: any) {
      console.error('[CommTranscribe] finalize error:', error);
      return res.status(500).json({ message: error.message || 'Internal error' });
    }
  });

  // Recalculate scores for an assessment (useful for fixing existing assessments)
  app.post("/api/assessments/:assignmentId/recalculate-scores", requireAuth, blockAccountant, async (req: AuthenticatedRequest, res) => {
    try {
      const assignmentId = parseInt(req.params.assignmentId);
      await storage.recalculateAssessmentScores(assignmentId);
      res.status(200).json({ message: "Scores recalculated successfully" });
    } catch (error) {
      console.error('Error recalculating assessment scores:', error);
      res.status(500).json({ message: "Internal server error" });
    }
  });


  app.post("/api/assessments/sections", requireAuth, blockAccountant, async (req: AuthenticatedRequest, res) => {
    try {
      // Convert templateId to number if it's a string
      const body = {
        ...req.body,
        templateId: typeof req.body.templateId === 'string' ? parseInt(req.body.templateId, 10) : req.body.templateId,
        sortOrder: typeof req.body.sortOrder === 'string' ? parseInt(req.body.sortOrder, 10) : req.body.sortOrder
      };
      const validatedData = insertAssessmentSectionSchema.parse(body);
      const section = await storage.createAssessmentSection(validatedData);
      res.status(201).json(section);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid section data", errors: error.errors });
      }
      console.error('Assessment section creation error:', error);
      res.status(500).json({ message: "Internal server error", error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.patch("/api/assessments/sections/:id", requireAuth, blockAccountant, async (req: AuthenticatedRequest, res) => {
    try {
      const id = parseInt(req.params.id);
      // Convert templateId and sortOrder to numbers if they're strings
      const body = {
        ...req.body,
        templateId: typeof req.body.templateId === 'string' ? parseInt(req.body.templateId, 10) : req.body.templateId,
        sortOrder: typeof req.body.sortOrder === 'string' ? parseInt(req.body.sortOrder, 10) : req.body.sortOrder
      };
      const validatedData = insertAssessmentSectionSchema.partial().parse(body);
      const section = await storage.updateAssessmentSection(id, validatedData);
      res.json(section);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid section data", errors: error.errors });
      }
      console.error('Assessment section update error:', error);
      res.status(500).json({ message: "Internal server error", error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.delete("/api/assessments/sections/:id", requireAuth, blockAccountant, async (req: AuthenticatedRequest, res) => {
    try {
      const id = parseInt(req.params.id);
      await storage.deleteAssessmentSection(id);
      res.status(204).send();
    } catch (error) {
      console.error('Assessment section deletion error:', error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Assessment questions routes
  app.post("/api/assessments/questions", requireAuth, blockAccountant, async (req: AuthenticatedRequest, res) => {
    try {
      // Convert sectionId and sortOrder to numbers if they're strings
      const questionData = {
        ...req.body,
        sectionId: typeof req.body.sectionId === 'string' ? parseInt(req.body.sectionId, 10) : req.body.sectionId,
        sortOrder: typeof req.body.sortOrder === 'string' ? parseInt(req.body.sortOrder, 10) : req.body.sortOrder
      };
      const question = await storage.createAssessmentQuestion(questionData);
      
      // Debug: ensure question has ID
      if (!question || !question.id) {
        throw new Error("Question creation failed - no ID returned");
      }
      
      res.status(201).json(question);
    } catch (error) {
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.patch("/api/assessments/questions/:id", requireAuth, blockAccountant, async (req: AuthenticatedRequest, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid question ID" });
      }
      
      // Convert sectionId and sortOrder to numbers if they're strings
      const questionData = {
        ...req.body,
        sectionId: typeof req.body.sectionId === 'string' ? parseInt(req.body.sectionId, 10) : req.body.sectionId,
        sortOrder: typeof req.body.sortOrder === 'string' ? parseInt(req.body.sortOrder, 10) : req.body.sortOrder
      };
      const question = await storage.updateAssessmentQuestion(id, questionData);
      res.json(question);
    } catch (error) {
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Assessment Question Options Routes
  app.get("/api/assessments/questions/:questionId/options", requireAuth, blockAccountant, async (req: AuthenticatedRequest, res) => {
    try {
      const questionId = parseInt(req.params.questionId);
      if (isNaN(questionId)) {
        return res.status(400).json({ message: "Invalid question ID" });
      }
      const options = await storage.getAssessmentQuestionOptions(questionId);
      res.json(options);
    } catch (error) {
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Helper function to convert option data types
  const convertOptionData = (option: any) => ({
    ...option,
    questionId: typeof option.questionId === 'string' ? parseInt(option.questionId, 10) : option.questionId,
    sortOrder: typeof option.sortOrder === 'string' ? parseInt(option.sortOrder, 10) : option.sortOrder
  });

  // FIXED: Prevents duplicates by checking existing options first
  app.post("/api/assessments/question-options", requireAuth, blockAccountant, async (req: AuthenticatedRequest, res) => {
    try {
      const body = convertOptionData(req.body);
      const validatedData = insertAssessmentQuestionOptionSchema.parse(body);
      
      // Check if option with same text already exists for this question
      const existingOptions = await storage.getAssessmentQuestionOptions(validatedData.questionId);
      const existingMatch = existingOptions.find(
        (existing: any) => existing.optionText === validatedData.optionText
      );
      
      if (existingMatch) {
        // Update existing option instead of creating duplicate
        const updated = await storage.updateAssessmentQuestionOption(existingMatch.id, {
          optionValue: validatedData.optionValue,
          sortOrder: validatedData.sortOrder
        });
        return res.status(200).json(updated);
      }
      
      const option = await storage.createAssessmentQuestionOption(validatedData);
      res.status(201).json(option);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid option data", errors: error.errors });
      }
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Bulk create question options for performance
  // FIXED: Prevents duplicates by checking existing options first
  app.post("/api/assessments/question-options/bulk", requireAuth, blockAccountant, async (req: AuthenticatedRequest, res) => {
    try {
      const { options } = req.body;
      if (!Array.isArray(options)) {
        return res.status(400).json({ message: "Options must be an array" });
      }
      
      const validatedOptions = options.map(option => 
        insertAssessmentQuestionOptionSchema.parse(convertOptionData(option))
      );
      
      // Group options by questionId to check for existing options
      const optionsByQuestion = new Map<number, typeof validatedOptions>();
      for (const option of validatedOptions) {
        const qId = option.questionId;
        if (!optionsByQuestion.has(qId)) {
          optionsByQuestion.set(qId, []);
        }
        optionsByQuestion.get(qId)!.push(option);
      }
      
      const createdOptions: any[] = [];
      
      for (const [questionId, newOptions] of Array.from(optionsByQuestion)) {
        // Get existing options for this question
        const existingOptions = await storage.getAssessmentQuestionOptions(questionId);
        
        for (const newOption of newOptions) {
          // Check if an option with the same text already exists
          const existingMatch = existingOptions.find(
            (existing: any) => existing.optionText === newOption.optionText
          );
          
          if (existingMatch) {
            // Update existing option instead of creating duplicate
            const updated = await storage.updateAssessmentQuestionOption(existingMatch.id, {
              optionValue: newOption.optionValue,
              sortOrder: newOption.sortOrder
            });
            createdOptions.push(updated);
          } else {
            // Create new option only if it doesn't exist
            const created = await storage.createAssessmentQuestionOption(newOption);
            createdOptions.push(created);
          }
        }
      }
      
      res.status(201).json(createdOptions);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid option data", errors: error.errors });
      }
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.patch("/api/assessments/question-options/:id", requireAuth, blockAccountant, async (req: AuthenticatedRequest, res) => {
    try {
      const id = parseInt(req.params.id);
      const body = convertOptionData(req.body);
      const validatedData = insertAssessmentQuestionOptionSchema.partial().parse(body);
      const option = await storage.updateAssessmentQuestionOption(id, validatedData);
      res.json(option);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid option data", errors: error.errors });
      }
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.delete("/api/assessments/question-options/:id", requireAuth, blockAccountant, async (req: AuthenticatedRequest, res) => {
    try {
      const id = parseInt(req.params.id);
      
      // Check if any responses reference this option
      const responsesExist = await storage.checkOptionHasResponses(id);
      if (responsesExist) {
        return res.status(409).json({ 
          message: "Cannot delete this option because completed assessments reference it. This protects existing client data." 
        });
      }
      
      await storage.deleteAssessmentQuestionOption(id);
      res.status(204).send();
    } catch (error) {
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.delete("/api/assessments/questions/:questionId/options", requireAuth, blockAccountant, async (req: AuthenticatedRequest, res) => {
    try {
      const questionId = parseInt(req.params.questionId);
      
      // Check if any responses exist for this question
      const responsesExist = await storage.checkQuestionHasResponses(questionId);
      if (responsesExist) {
        return res.status(409).json({ 
          message: "Cannot delete options because completed assessments reference this question. This protects existing client data." 
        });
      }
      
      await storage.deleteAllAssessmentQuestionOptions(questionId);
      res.status(204).send();
    } catch (error) {
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.delete("/api/assessments/questions/:questionId", requireAuth, blockAccountant, async (req: AuthenticatedRequest, res) => {
    try {
      const questionId = parseInt(req.params.questionId);
      if (isNaN(questionId)) {
        return res.status(400).json({ message: "Invalid question ID" });
      }
      
      // Check if any responses exist for this question
      const responsesExist = await storage.checkQuestionHasResponses(questionId);
      if (responsesExist) {
        return res.status(409).json({ 
          message: "Cannot delete this question because completed assessments reference it. This protects existing client data." 
        });
      }
      
      // First delete all options for this question
      await storage.deleteAllAssessmentQuestionOptions(questionId);
      // Then delete the question itself
      await storage.deleteAssessmentQuestion(questionId);
      res.status(204).send();
    } catch (error) {
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Assessment Report Routes
  app.get("/api/assessments/assignments/:assignmentId/report", requireAuth, blockAccountant, async (req: AuthenticatedRequest, res) => {
    try {
      const assignmentId = parseInt(req.params.assignmentId);
      if (isNaN(assignmentId)) {
        return res.status(400).json({ message: "Invalid assignment ID" });
      }

      const report = await storage.getAssessmentReport(assignmentId);
      if (!report) {
        return res.status(404).json({ message: "Assessment report not found" });
      }

      res.json(report);
    } catch (error) {
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post("/api/assessments/reports", requireAuth, blockAccountant, async (req: AuthenticatedRequest, res) => {
    try {
      if (!req.user) {
        return res.status(401).json({ message: "Authentication required" });
      }
      
      const reportData = req.body;
      
      // Authorization: Only creator can create reports
      if (reportData.assignmentId) {
        const permCheck = await checkAssessmentEditPermission(reportData.assignmentId, req.user.id, req.user.role);
        if (!permCheck.allowed) {
          return res.status(permCheck.notFound ? 404 : 403).json({ message: permCheck.message });
        }
      } else {
        return res.status(400).json({ message: "Assignment ID is required" });
      }
      
      const report = await storage.createAssessmentReport(reportData);
      res.status(201).json(report);
    } catch (error) {
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Generate AI assessment report
  app.post("/api/assessments/assignments/:assignmentId/generate-report", requireAuth, blockAccountant, async (req: AuthenticatedRequest, res) => {
    const { ipAddress, userAgent } = getRequestInfo(req);
    
    try {
      if (!req.user) {
        return res.status(401).json({ message: "Authentication required" });
      }

      const assignmentId = parseInt(req.params.assignmentId);
      if (isNaN(assignmentId)) {
        return res.status(400).json({ message: "Invalid assignment ID" });
      }

      // Authorization: Only creator can generate reports
      const permCheck = await checkAssessmentEditPermission(assignmentId, req.user.id, req.user.role);
      if (!permCheck.allowed) {
        return res.status(permCheck.notFound ? 404 : 403).json({ message: permCheck.message });
      }

      // Get assignment details, responses, and sections
      const assignment = await storage.getAssessmentAssignment(assignmentId);
      if (!assignment) {
        return res.status(404).json({ message: "Assessment assignment not found" });
      }

      const responses = await storage.getAssessmentResponses(assignmentId);
      const sections = await storage.getAssessmentSections(assignment.templateId);

      // Check if OpenAI API key is configured
      if (!process.env.OPENAI_API_KEY && !process.env.AI_INTEGRATIONS_OPENAI_API_KEY) {
        return res.status(503).json({ 
          message: "AI features not available. Please configure OPENAI_API_KEY environment variable." 
        });
      }

      // GDPR: Check AI processing consent before generating report
      const clientId = assignment.clientId;
      const consentCheck = await checkAIProcessingConsent(clientId);
      if (!consentCheck.hasConsent) {
        // Log blocked AI processing attempt
        await AuditLogger.logAction({
          userId: req.user.id,
          username: req.user.username,
          action: 'ai_processing_blocked',
          result: 'denied',
          resourceType: 'assessment_report',
          resourceId: `assignment_${assignmentId}`,
          clientId,
          ipAddress,
          userAgent,
          hipaaRelevant: true,
          riskLevel: 'high', // Assessment reports are high-risk PHI
          details: JSON.stringify({
            reason: 'consent_not_granted',
            endpoint: '/api/assessments/assignments/:assignmentId/generate-report',
            consentType: 'ai_processing',
            assignmentId,
            templateId: assignment.templateId
          }),
          accessReason: 'AI assessment report generation attempted without consent'
        });
        
        return res.status(403).json({ 
          message: consentCheck.message,
          consentRequired: true,
          consentType: 'ai_processing'
        });
      }

      // Generate the report using AI
      console.log(`[API] Generating assessment report for assignment ${assignmentId}...`);
      const { generateAssessmentReport } = await import("./ai/openai");
      const generatedContent = await generateAssessmentReport(assignment, responses, sections);

      // Check if a report already exists for this assignment
      const existingReport = await storage.getAssessmentReport(assignmentId);
      
      let report;
      if (existingReport) {
        // UPDATE existing report - completely replace content with new AI-generated content
        report = await storage.updateAssessmentReport(existingReport.id, {
          generatedContent,
          draftContent: null, // Clear any old draft
          finalContent: null, // Clear any old finalized content
          reportData: JSON.stringify({ responses, sections }),
          generatedAt: new Date(),
          isFinalized: false, // Reset finalization status
          finalizedAt: null,
          finalizedById: null,
          createdById: req.user.id
        });
      } else {
        // CREATE new report
        const reportData = {
          assignmentId,
          generatedContent,
          reportData: JSON.stringify({ responses, sections }),
          generatedAt: new Date(),
          createdById: req.user.id
        };
        report = await storage.createAssessmentReport(reportData);
      }
      
      // Update assessment status to waiting_for_therapist (report generated but not finalized)
      await storage.updateAssessmentAssignment(assignmentId, {
        status: 'waiting_for_therapist'
      });
      
      // HIPAA Audit: Log AI report generation
      await AuditLogger.logAssessmentAccess(
        req.user.id,
        req.user.username,
        assignmentId,
        assignment.clientId,
        'assessment_report_generated',
        ipAddress,
        userAgent,
        { 
          templateId: assignment.templateId,
          reportId: report.id,
          aiModel: 'gpt-4o',
          method: 'ai_generated'
        }
      );

      res.status(201).json(report);
    } catch (error: any) {
      console.error('[API] Error generating assessment report:', error);
      const errorMessage = error.message || "Failed to generate assessment report";
      
      // Return appropriate status code based on error type
      if (errorMessage.includes('not configured') || errorMessage.includes('API key')) {
        return res.status(503).json({ message: errorMessage });
      } else if (errorMessage.includes('timeout')) {
        return res.status(504).json({ message: errorMessage });
      } else if (errorMessage.includes('quota') || errorMessage.includes('billing')) {
        return res.status(402).json({ message: errorMessage });
      }
      
      res.status(500).json({ message: errorMessage });
    }
  });

  // Update assessment report draft (save edited content)
  app.put("/api/assessments/assignments/:assignmentId/report", requireAuth, blockAccountant, async (req: AuthenticatedRequest, res) => {
    const { ipAddress, userAgent } = getRequestInfo(req);
    
    try {
      if (!req.user) {
        return res.status(401).json({ message: "Authentication required" });
      }

      const assignmentId = parseInt(req.params.assignmentId);
      if (isNaN(assignmentId)) {
        return res.status(400).json({ message: "Invalid assignment ID" });
      }

      const { draftContent } = req.body;
      if (!draftContent) {
        return res.status(400).json({ message: "Draft content is required" });
      }

      // Authorization: Only creator can update reports
      const permCheck = await checkAssessmentEditPermission(assignmentId, req.user.id, req.user.role);
      if (!permCheck.allowed) {
        return res.status(permCheck.notFound ? 404 : 403).json({ message: permCheck.message });
      }

      // Get existing report
      const existingReport = await storage.getAssessmentReport(assignmentId);
      if (!existingReport) {
        return res.status(404).json({ message: "Assessment report not found" });
      }

      // Check if report is finalized (cannot edit)
      if (existingReport.isFinalized) {
        return res.status(400).json({ message: "Cannot edit finalized report" });
      }

      // Update draft content
      const updatedReport = await storage.updateAssessmentReportDraft(assignmentId, draftContent);

      // HIPAA Audit: Log report edit
      await AuditLogger.logAction({
        userId: req.user.id,
        username: req.user.username,
        action: 'assessment_updated',
        result: 'success',
        resourceType: 'assessment',
        resourceId: assignmentId.toString(),
        clientId: existingReport.assignment.clientId,
        ipAddress,
        userAgent,
        hipaaRelevant: true,
        riskLevel: 'high',
        details: JSON.stringify({
          reportId: updatedReport.id,
          operation: 'draft_saved',
        }),
        accessReason: 'Clinical assessment and evaluation',
      });

      res.json(updatedReport);
    } catch (error) {
      console.error('Error updating assessment report draft:', error);
      res.status(500).json({ message: "Failed to update assessment report" });
    }
  });

  // Finalize assessment report (matching session notes pattern)
  app.post("/api/assessments/assignments/:assignmentId/report/finalize", requireAuth, blockAccountant, async (req: AuthenticatedRequest, res) => {
    const { ipAddress, userAgent } = getRequestInfo(req);
    
    try {
      if (!req.user) {
        return res.status(401).json({ message: "Authentication required" });
      }

      const assignmentId = parseInt(req.params.assignmentId);
      if (isNaN(assignmentId)) {
        return res.status(400).json({ message: "Invalid assignment ID" });
      }

      // Get existing report
      const existingReport = await storage.getAssessmentReport(assignmentId);
      if (!existingReport) {
        return res.status(404).json({ message: "Assessment report not found" });
      }

      // Check if already finalized
      if (existingReport.isFinalized) {
        return res.status(400).json({ message: "Report is already finalized" });
      }

      // Authorization: Only creator can finalize reports
      const permCheck = await checkAssessmentEditPermission(assignmentId, req.user.id, req.user.role);
      if (!permCheck.allowed) {
        return res.status(permCheck.notFound ? 404 : 403).json({ message: permCheck.message });
      }

      // Finalize report (copy draft/generated content to final)
      const finalContent = existingReport.draftContent || existingReport.generatedContent || '';
      const updatedReport = await storage.updateAssessmentReport(existingReport.id, {
        isFinalized: true,
        isDraft: false,
        finalContent,
        finalizedAt: new Date(),
        finalizedById: req.user.id
      });

      // Update assessment status to completed (report finalized)
      await storage.updateAssessmentAssignment(assignmentId, {
        status: 'completed',
        completedAt: new Date()
      });

      // HIPAA Audit: Log report finalization
      await AuditLogger.logAssessmentAccess(
        req.user.id,
        req.user.username,
        assignmentId,
        existingReport.assignment.clientId,
        'assessment_completed',
        ipAddress,
        userAgent,
        { 
          reportId: updatedReport.id,
          operation: 'report_finalized'
        }
      );

      res.json(updatedReport);
    } catch (error) {
      console.error('Error finalizing assessment report:', error);
      res.status(500).json({ message: "Failed to finalize assessment report" });
    }
  });

  // Unfinalize assessment report (allows reopening for regeneration/editing)
  app.post("/api/assessments/assignments/:assignmentId/report/unfinalize", requireAuth, blockAccountant, async (req: AuthenticatedRequest, res) => {
    const { ipAddress, userAgent } = getRequestInfo(req);
    
    try {
      if (!req.user) {
        return res.status(401).json({ message: "Authentication required" });
      }

      const assignmentId = parseInt(req.params.assignmentId);
      if (isNaN(assignmentId)) {
        return res.status(400).json({ message: "Invalid assignment ID" });
      }

      // Get existing report
      const existingReport = await storage.getAssessmentReport(assignmentId);
      if (!existingReport) {
        return res.status(404).json({ message: "Assessment report not found" });
      }

      // Check if actually finalized
      if (!existingReport.isFinalized) {
        return res.status(400).json({ message: "Report is not finalized" });
      }

      // Authorization: Only creator can unfinalize reports
      const permCheck = await checkAssessmentEditPermission(assignmentId, req.user.id, req.user.role);
      if (!permCheck.allowed) {
        return res.status(permCheck.notFound ? 404 : 403).json({ message: permCheck.message });
      }

      // Unfinalize report (move final content back to draft for editing)
      const draftContent = existingReport.finalContent || existingReport.draftContent || existingReport.generatedContent || '';
      const updatedReport = await storage.updateAssessmentReport(existingReport.id, {
        isFinalized: false,
        isDraft: true,
        draftContent,
        finalContent: null,
        finalizedAt: null,
        finalizedById: null
      });

      // Update assessment status back to therapist_completed (reopened)
      await storage.updateAssessmentAssignment(assignmentId, {
        status: 'therapist_completed',
        completedAt: null
      });

      // HIPAA Audit: Log report reopening
      await AuditLogger.logAction({
        userId: req.user.id,
        username: req.user.username,
        action: 'assessment_updated',
        result: 'success',
        resourceType: 'assessment',
        resourceId: assignmentId.toString(),
        clientId: existingReport.assignment.clientId,
        ipAddress,
        userAgent,
        hipaaRelevant: true,
        riskLevel: 'high',
        details: JSON.stringify({
          reportId: updatedReport.id,
          operation: 'report_reopened',
        }),
        accessReason: 'Clinical assessment and evaluation',
      });

      res.json(updatedReport);
    } catch (error) {
      console.error('Error unfinalizing assessment report:', error);
      res.status(500).json({ message: "Failed to unfinalize assessment report" });
    }
  });

  // Download assessment report as PDF
  app.get("/api/assessments/assignments/:assignmentId/download/pdf", requireAuth, blockAccountant, async (req: AuthenticatedRequest, res) => {
    const { ipAddress, userAgent } = getRequestInfo(req);
    
    try {
      if (!req.user) {
        return res.status(401).json({ message: "Authentication required" });
      }

      const assignmentId = parseInt(req.params.assignmentId);
      const report = await storage.getAssessmentReport(assignmentId);
      
      if (!report) {
        return res.status(404).json({ message: "Assessment report not found" });
      }

      const assignment = await storage.getAssessmentAssignment(assignmentId);
      if (!assignment) {
        return res.status(404).json({ message: "Assessment assignment not found" });
      }

      // Fetch practice settings from system options (matching session notes)
      let practiceSettings = {
        name: 'Resilience Counseling Research & Consultation',
        description: 'Licensed Mental Health Practice',
        subtitle: 'Licensed Mental Health Practice',
        address: '111 Waterloo St Unit 406, London, ON N6B 2M4',
        phone: '+1 (548)866-0366',
        email: 'mail@resiliencec.com',
        website: 'www.resiliencec.com'
      };
      
      try {
        const practiceOptions = await storage.getSystemOptionsByCategory('practice_settings');
        practiceSettings.name = practiceOptions.find(o => o.optionKey === 'practice_name')?.optionLabel || practiceSettings.name;
        practiceSettings.description = practiceOptions.find(o => o.optionKey === 'practice_description')?.optionLabel || practiceSettings.description;
        practiceSettings.subtitle = practiceOptions.find(o => o.optionKey === 'practice_subtitle')?.optionLabel || practiceSettings.subtitle;
        practiceSettings.address = practiceOptions.find(o => o.optionKey === 'practice_address')?.optionLabel || practiceSettings.address;
        practiceSettings.phone = practiceOptions.find(o => o.optionKey === 'practice_phone')?.optionLabel || practiceSettings.phone;
        practiceSettings.email = practiceOptions.find(o => o.optionKey === 'practice_email')?.optionLabel || practiceSettings.email;
        practiceSettings.website = practiceOptions.find(o => o.optionKey === 'practice_website')?.optionLabel || practiceSettings.website;
      } catch (error) {
        // Use defaults if practice settings not found
      }

      // Fetch therapist details with signature
      if (assignment.assignedById) {
        const therapist = await storage.getUser(assignment.assignedById);
        const userProfile = await storage.getUserProfile(assignment.assignedById);
        
        assignment.assignedBy = {
          ...therapist,
          signatureImage: (userProfile as any)?.signatureImage,
          profile: {
            licenseType: userProfile?.licenseType,
            licenseNumber: userProfile?.licenseNumber
          }
        } as any;
      }

      // Generate professional HTML (also used as the print-ready fallback)
      const { generateAssessmentReportHTML } = await import("./pdf/assessment-report-pdf");
      const { generatePDFFromHTML } = await import("./pdf/client-report-pdf");
      const html = generateAssessmentReportHTML(assignment as any, report, practiceSettings);

      const baseFilename = `assessment-report-${(assignment.template?.name || 'assessment').replace(/\s+/g, '-')}-${new Date().toISOString().split('T')[0]}`;

      // Try to render a real PDF (with internal retry); fall back to print-ready HTML on failure
      let pdfBuffer: Buffer | null = null;
      try {
        pdfBuffer = await generatePDFFromHTML(html);
      } catch (pdfError) {
        console.error('Assessment report PDF rendering failed after retry, falling back to print-ready HTML:', pdfError);
      }

      // HIPAA Audit: Log PDF download (record whether a PDF or HTML fallback was served)
      await AuditLogger.logDocumentAccess(
        req.user.id,
        req.user.username,
        report.id,
        assignment.clientId,
        'document_downloaded',
        ipAddress,
        userAgent,
        { 
          assignmentId,
          format: pdfBuffer ? 'pdf' : 'html',
          documentType: 'assessment_report',
          templateName: assignment.template?.name
        }
      );

      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, private');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      res.removeHeader('ETag');

      if (pdfBuffer) {
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${baseFilename}.pdf"`);
        res.setHeader('Content-Length', pdfBuffer.length);
        res.send(pdfBuffer);
      } else {
        // Fallback: return the print-ready HTML so the user can still print to PDF
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.setHeader('Content-Disposition', `inline; filename="${baseFilename}.html"`);
        res.send(html);
      }
      
    } catch (error) {
      console.error('Error generating PDF:', error);
      res.status(500).json({ message: "Failed to generate PDF" });
    }
  });

  // Download assessment report as Word document
  app.get("/api/assessments/assignments/:assignmentId/download/docx", requireAuth, blockAccountant, async (req: AuthenticatedRequest, res) => {
    const { ipAddress, userAgent } = getRequestInfo(req);
    
    try {
      if (!req.user) {
        return res.status(401).json({ message: "Authentication required" });
      }

      const assignmentId = parseInt(req.params.assignmentId);
      const report = await storage.getAssessmentReport(assignmentId);
      
      if (!report) {
        return res.status(404).json({ message: "Assessment report not found" });
      }

      const assignment = await storage.getAssessmentAssignment(assignmentId);
      if (!assignment) {
        return res.status(404).json({ message: "Assessment assignment not found" });
      }

      // Fetch practice settings (matching session notes)
      let practiceSettings = {
        name: 'Resilience Counseling Research & Consultation',
        address: '111 Waterloo St Unit 406, London, ON N6B 2M4',
        phone: '+1 (548)866-0366',
        email: 'mail@resiliencec.com',
        website: 'www.resiliencec.com'
      };
      
      try {
        const practiceOptions = await storage.getSystemOptionsByCategory('practice_settings');
        practiceSettings.name = practiceOptions.find(o => o.optionKey === 'practice_name')?.optionLabel || practiceSettings.name;
        practiceSettings.address = practiceOptions.find(o => o.optionKey === 'practice_address')?.optionLabel || practiceSettings.address;
        practiceSettings.phone = practiceOptions.find(o => o.optionKey === 'practice_phone')?.optionLabel || practiceSettings.phone;
        practiceSettings.email = practiceOptions.find(o => o.optionKey === 'practice_email')?.optionLabel || practiceSettings.email;
        practiceSettings.website = practiceOptions.find(o => o.optionKey === 'practice_website')?.optionLabel || practiceSettings.website;
      } catch (error) {
        // Use defaults if practice settings not found
      }

      // Fetch therapist details with signature (for finalized reports)
      if (assignment.assignedById) {
        const therapist = await storage.getUser(assignment.assignedById);
        const userProfile = await storage.getUserProfile(assignment.assignedById);
        
        assignment.assignedBy = {
          ...therapist,
          signatureImage: (userProfile as any)?.signatureImage,
          profile: {
            licenseType: userProfile?.licenseType,
            licenseNumber: userProfile?.licenseNumber
          }
        } as any;
      }

      // Generate Word document using docx
      const { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, BorderStyle } = await import("docx");
      const { formatInTimeZone } = await import("date-fns-tz");
      const PRACTICE_TIMEZONE = 'America/New_York';
      
      // Parse the report content - prioritize finalContent if finalized
      const reportContent = report.finalContent || report.draftContent || report.generatedContent || '';
      const paragraphs = [];
      
      // Header: Practice Information
      paragraphs.push(new Paragraph({
        children: [new TextRun({ 
          text: practiceSettings.name, 
          bold: true, 
          size: 28,
          color: "1e40af"
        })],
        spacing: { after: 100 }
      }));
      
      paragraphs.push(new Paragraph({
        children: [new TextRun({ text: practiceSettings.address, size: 20 })],
        spacing: { after: 50 }
      }));
      
      paragraphs.push(new Paragraph({
        children: [new TextRun({ text: `Phone: ${practiceSettings.phone} | Email: ${practiceSettings.email}`, size: 20 })],
        spacing: { after: 50 }
      }));
      
      paragraphs.push(new Paragraph({
        children: [new TextRun({ text: `Website: ${practiceSettings.website}`, size: 20 })],
        spacing: { after: 300 }
      }));

      // Title
      paragraphs.push(new Paragraph({
        children: [new TextRun({ 
          text: "CLINICAL ASSESSMENT REPORT", 
          bold: true, 
          size: 32,
          color: "1e40af"
        })],
        heading: HeadingLevel.HEADING_1,
        alignment: AlignmentType.CENTER,
        spacing: { after: 200 }
      }));

      // Confidentiality Banner
      paragraphs.push(new Paragraph({
        children: [new TextRun({ 
          text: "⚠️ Confidential Medical Record - HIPAA Protected Information", 
          bold: true, 
          size: 20,
          color: "92400e"
        })],
        alignment: AlignmentType.CENTER,
        spacing: { after: 300 },
        border: {
          left: { style: BorderStyle.SINGLE, size: 20, color: "f59e0b" }
        }
      }));

      // Client Information Section
      paragraphs.push(new Paragraph({
        children: [new TextRun({ text: "CLIENT INFORMATION", bold: true, size: 24, color: "1e40af" })],
        spacing: { after: 200 }
      }));

      const clientInfo = [
        `Client Name: ${assignment.client?.fullName || 'Not provided'}`,
        `Client ID: ${assignment.client?.clientId || 'Not provided'}`,
        `Date of Birth: ${assignment.client?.dateOfBirth ? formatInTimeZone(new Date(assignment.client.dateOfBirth), PRACTICE_TIMEZONE, 'MMMM dd, yyyy') : 'Not provided'}`,
        `Assessment: ${assignment.template?.name || 'Assessment'}`,
        `Clinician: ${assignment.assignedBy?.fullName || 'Not assigned'}${assignment.assignedBy?.title ? ', ' + assignment.assignedBy.title : ''}`
      ];

      clientInfo.forEach(info => {
        paragraphs.push(new Paragraph({
          children: [new TextRun({ text: info, size: 22 })],
          spacing: { after: 100 }
        }));
      });

      paragraphs.push(new Paragraph({ text: "", spacing: { after: 300 } }));

      // Report Content - parse rich HTML into properly formatted DOCX
      // paragraphs (preserves headings, bold, italic, lists, line breaks).
      const decodeEntities = (s: string) =>
        s
          .replace(/&nbsp;/g, ' ')
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&quot;/g, '"')
          .replace(/&#39;/g, "'");

      // Split inline HTML into TextRuns honoring <strong>/<b>, <em>/<i>, <u>, <br>.
      const parseInline = (html: string): InstanceType<typeof TextRun>[] => {
        const runs: InstanceType<typeof TextRun>[] = [];
        const tokens = html.split(/(<\/?(?:strong|b|em|i|u|br\s*\/?)>)/gi);
        let bold = false;
        let italics = false;
        let underline = false;
        for (const tok of tokens) {
          if (!tok) continue;
          const m = tok.match(/^<(\/?)(strong|b|em|i|u|br)\s*\/?>$/i);
          if (m) {
            const close = m[1] === '/';
            const tag = m[2].toLowerCase();
            if (tag === 'br') {
              runs.push(new TextRun({ text: '', break: 1, font: 'Times New Roman', size: 22 }));
            } else if (tag === 'strong' || tag === 'b') {
              bold = !close;
            } else if (tag === 'em' || tag === 'i') {
              italics = !close;
            } else if (tag === 'u') {
              underline = !close;
            }
            continue;
          }
          const text = decodeEntities(tok.replace(/<[^>]+>/g, ''));
          if (!text) continue;
          runs.push(
            new TextRun({
              text,
              font: 'Times New Roman',
              size: 22,
              bold: bold || undefined,
              italics: italics || undefined,
              underline: underline ? {} : undefined,
            }),
          );
        }
        return runs.length ? runs : [new TextRun({ text: '', font: 'Times New Roman', size: 22 })];
      };

      // Walk top-level block elements (h1-h4, p, ul, ol, blockquote). Anything
      // outside a block becomes a normal paragraph.
      const blockRegex =
        /<(h[1-4]|p|ul|ol|blockquote)\b[^>]*>([\s\S]*?)<\/\1>/gi;
      const blocks: { tag: string; inner: string }[] = [];
      let lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = blockRegex.exec(reportContent)) !== null) {
        if (match.index > lastIndex) {
          const between = reportContent.slice(lastIndex, match.index).trim();
          if (between) blocks.push({ tag: 'p', inner: between });
        }
        blocks.push({ tag: match[1].toLowerCase(), inner: match[2] });
        lastIndex = blockRegex.lastIndex;
      }
      if (lastIndex < reportContent.length) {
        const tail = reportContent.slice(lastIndex).trim();
        if (tail) blocks.push({ tag: 'p', inner: tail });
      }
      // If no block elements were detected, treat the whole content as paragraphs.
      if (blocks.length === 0 && reportContent.trim()) {
        for (const line of reportContent.split(/\n+/)) {
          if (line.trim()) blocks.push({ tag: 'p', inner: line });
        }
      }

      const HEADING_SIZES: Record<string, number> = { h1: 32, h2: 28, h3: 26, h4: 24 };
      for (const { tag, inner } of blocks) {
        if (tag.startsWith('h')) {
          paragraphs.push(
            new Paragraph({
              children: [
                new TextRun({
                  text: decodeEntities(inner.replace(/<[^>]+>/g, '')).trim(),
                  bold: true,
                  size: HEADING_SIZES[tag] || 24,
                  color: '1e40af',
                  font: 'Times New Roman',
                }),
              ],
              heading:
                tag === 'h1'
                  ? HeadingLevel.HEADING_1
                  : tag === 'h2'
                    ? HeadingLevel.HEADING_2
                    : tag === 'h3'
                      ? HeadingLevel.HEADING_3
                      : HeadingLevel.HEADING_4,
              spacing: { before: 200, after: 120 },
            }),
          );
        } else if (tag === 'ul' || tag === 'ol') {
          const items = Array.from(inner.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi));
          items.forEach((li, idx) => {
            const prefix = tag === 'ol' ? `${idx + 1}. ` : '• ';
            const itemRuns = parseInline(li[1]);
            paragraphs.push(
              new Paragraph({
                children: [
                  new TextRun({ text: prefix, font: 'Times New Roman', size: 22 }),
                  ...itemRuns,
                ],
                indent: { left: 360 },
                spacing: { after: 80 },
              }),
            );
          });
        } else if (tag === 'blockquote') {
          paragraphs.push(
            new Paragraph({
              children: parseInline(inner),
              indent: { left: 720 },
              spacing: { after: 120 },
              alignment: AlignmentType.JUSTIFIED,
            }),
          );
        } else {
          // <p> or fallback
          const runs = parseInline(inner);
          // Skip totally empty paragraphs
          const hasText = runs.some((r) => (r as any).options?.text?.trim?.());
          paragraphs.push(
            new Paragraph({
              children: runs,
              spacing: { after: hasText ? 120 : 80 },
              alignment: AlignmentType.JUSTIFIED,
            }),
          );
        }
      }

      // Signature Section (only if finalized)
      if (report.isFinalized && report.finalizedAt && assignment.assignedBy) {
        paragraphs.push(new Paragraph({ text: "", spacing: { after: 400 } }));
        
        paragraphs.push(new Paragraph({
          children: [new TextRun({ text: "DIGITAL SIGNATURE", bold: true, size: 24, color: "1e40af" })],
          spacing: { after: 200 }
        }));

        paragraphs.push(new Paragraph({
          children: [new TextRun({ text: assignment.assignedBy.fullName, bold: true, size: 24 })],
          spacing: { after: 100 }
        }));

        if ((assignment.assignedBy as any).profile?.licenseType) {
          paragraphs.push(new Paragraph({
            children: [new TextRun({ 
              text: `${(assignment.assignedBy as any).profile.licenseType}${(assignment.assignedBy as any).profile.licenseNumber ? ' #' + (assignment.assignedBy as any).profile.licenseNumber : ''}`, 
              size: 22 
            })],
            spacing: { after: 100 }
          }));
        }

        paragraphs.push(new Paragraph({
          children: [new TextRun({ 
            text: `Digitally signed: ${formatInTimeZone(new Date(report.finalizedAt), PRACTICE_TIMEZONE, 'MMMM dd, yyyy')}`, 
            size: 22,
            italics: true
          })],
          spacing: { after: 200 }
        }));
      }

      // Footer
      paragraphs.push(new Paragraph({ text: "", spacing: { after: 400 } }));
      paragraphs.push(new Paragraph({
        children: [new TextRun({ text: `${practiceSettings.name} | ${practiceSettings.phone} | ${practiceSettings.email}`, size: 20, color: "9ca3af" })],
        alignment: AlignmentType.CENTER
      }));
      
      const doc = new Document({
        sections: [{
          properties: {},
          children: paragraphs
        }]
      });
      
      const buffer = await Packer.toBuffer(doc);
      
      // HIPAA Audit: Log Word download
      await AuditLogger.logDocumentAccess(
        req.user.id,
        req.user.username,
        report.id,
        assignment.clientId,
        'document_downloaded',
        ipAddress,
        userAgent,
        { 
          assignmentId,
          format: 'docx',
          documentType: 'assessment_report',
          templateName: assignment.template?.name
        }
      );
      
      const filename = `assessment-report-${assignment.client?.fullName?.replace(/\s+/g, '-')}-${new Date().toISOString().split('T')[0]}.docx`;
      
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send(buffer);
      
    } catch (error) {
      console.error('Error generating Word document:', error);
      res.status(500).json({ message: "Failed to generate Word document" });
    }
  });

  // ==================== REPORT TEMPLATES (AI client reports) ====================
  // Shared helper: assemble practice settings (mirrors assessment download routes)
  async function getPracticeSettingsForReport() {
    const practiceSettings = {
      name: 'Resilience Counseling Research & Consultation',
      description: 'Licensed Mental Health Practice',
      subtitle: 'Licensed Mental Health Practice',
      address: '111 Waterloo St Unit 406, London, ON N6B 2M4',
      phone: '+1 (548)866-0366',
      email: 'mail@resiliencec.com',
      website: 'www.resiliencec.com',
    };
    try {
      const practiceOptions = await storage.getSystemOptionsByCategory('practice_settings');
      practiceSettings.name = practiceOptions.find(o => o.optionKey === 'practice_name')?.optionLabel || practiceSettings.name;
      practiceSettings.description = practiceOptions.find(o => o.optionKey === 'practice_description')?.optionLabel || practiceSettings.description;
      practiceSettings.subtitle = practiceOptions.find(o => o.optionKey === 'practice_subtitle')?.optionLabel || practiceSettings.subtitle;
      practiceSettings.address = practiceOptions.find(o => o.optionKey === 'practice_address')?.optionLabel || practiceSettings.address;
      practiceSettings.phone = practiceOptions.find(o => o.optionKey === 'practice_phone')?.optionLabel || practiceSettings.phone;
      practiceSettings.email = practiceOptions.find(o => o.optionKey === 'practice_email')?.optionLabel || practiceSettings.email;
      practiceSettings.website = practiceOptions.find(o => o.optionKey === 'practice_website')?.optionLabel || practiceSettings.website;
    } catch {
      // defaults
    }
    return practiceSettings;
  }

  const isAdminRole = (role?: string) => role === 'administrator' || role === 'admin';

  // Client-scope check for report access (mirrors GET /api/clients/:id):
  // therapists only their assigned clients, supervisors only their supervisees' clients, admins all.
  const userCanAccessClient = async (user: AuthenticatedRequest['user'], clientId: number): Promise<boolean> => {
    if (!user) return false;
    if (user.role === 'therapist') {
      const client = await storage.getClient(clientId);
      return !!client && client.assignedTherapistId === user.id;
    }
    if (user.role === 'supervisor') {
      const client = await storage.getClient(clientId);
      if (!client) return false;
      const supervisorAssignments = await storage.getSupervisorAssignments(user.id);
      const supervisedTherapistIds = supervisorAssignments.map(a => a.therapistId);
      return !client.assignedTherapistId || supervisedTherapistIds.includes(client.assignedTherapistId);
    }
    return true;
  };

  // Sanitize report HTML before persistence (XSS defense for stored/rendered/exported content)
  const sanitizeReportHtml = async (html: string | null | undefined): Promise<string> => {
    if (!html) return '';
    const DOMPurify = (await import('isomorphic-dompurify')).default;
    return DOMPurify.sanitize(html, { USE_PROFILES: { html: true } });
  };

  // List active report templates (staff). Admins see inactive too via ?includeInactive=true
  app.get("/api/report-templates", requireAuth, blockAccountant, async (req: AuthenticatedRequest, res) => {
    try {
      const includeInactive = req.query.includeInactive === 'true' && isAdminRole(req.user?.role);
      const templates = await storage.getReportTemplates(includeInactive);
      res.json(templates);
    } catch (error) {
      console.error('Error fetching report templates:', error);
      res.status(500).json({ message: "Failed to fetch report templates" });
    }
  });

  // Upload a new report template (admin only). Body: { name, description?, aiInstructions?, fileContent(base64), originalName, mimeType }
  app.post("/api/report-templates", requireAuth, async (req: AuthenticatedRequest, res) => {
    const { ipAddress, userAgent } = getRequestInfo(req);
    try {
      if (!req.user) return res.status(401).json({ message: "Authentication required" });
      if (!isAdminRole(req.user.role)) {
        return res.status(403).json({ message: "Access denied. Admin privileges required." });
      }

      const {
        name, description, aiInstructions, fileContent, originalName, mimeType,
        defaultIncludeProfile, defaultIncludeNotes, defaultIncludeAssessments,
        supportingFilesGuidance, supportingFilesExpected, supportingFileTypes,
      } = req.body || {};
      if (!name || !fileContent || !originalName || !mimeType) {
        return res.status(400).json({ message: "name, fileContent, originalName and mimeType are required" });
      }

      const isDocx = mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || originalName.toLowerCase().endsWith('.docx');
      const isPdf = mimeType === 'application/pdf' || originalName.toLowerCase().endsWith('.pdf');
      if (!isDocx && !isPdf) {
        return res.status(400).json({ message: "Only Word (.docx) or PDF (.pdf) templates are supported." });
      }

      const base64 = String(fileContent).includes(',') ? String(fileContent).split(',')[1] : String(fileContent);
      const buffer = Buffer.from(base64, 'base64');
      if (buffer.length > 15 * 1024 * 1024) {
        return res.status(400).json({ message: "Template file too large (max 15MB)." });
      }

      const { extractTemplateStructure } = await import("./report-templates/extract");
      const { structureText } = await extractTemplateStructure(buffer, mimeType, originalName);

      const validated = insertReportTemplateSchema.parse({
        name,
        description: description || null,
        aiInstructions: aiInstructions || null,
        originalName,
        mimeType,
        fileSize: buffer.length,
        structureText,
        defaultIncludeProfile: defaultIncludeProfile === undefined ? true : !!defaultIncludeProfile,
        defaultIncludeNotes: defaultIncludeNotes === undefined ? true : !!defaultIncludeNotes,
        defaultIncludeAssessments: defaultIncludeAssessments === undefined ? true : !!defaultIncludeAssessments,
        supportingFilesGuidance: supportingFilesGuidance || null,
        supportingFilesExpected: !!supportingFilesExpected,
        supportingFileTypes: Array.isArray(supportingFileTypes)
          ? supportingFileTypes.map((t: any) => String(t).trim()).filter(Boolean)
          : null,
        isActive: true,
        createdById: req.user.id,
      });
      let template = await storage.createReportTemplate(validated);

      // Persist the original uploaded file in Azure blob storage and save its reference.
      try {
        const uploadResult = await azureStorage.uploadFile(
          buffer,
          originalName,
          mimeType,
          template.id,
          { kind: 'report_template', createdById: req.user.id.toString() },
        );
        if (!uploadResult.success) {
          await storage.deleteReportTemplate(template.id);
          throw new Error(`Azure Blob Storage upload failed: ${uploadResult.error}`);
        }
        template = await storage.updateReportTemplate(template.id, {
          fileBlobName: uploadResult.blobName,
          fileUrl: uploadResult.url,
        });
      } catch (uploadError) {
        await storage.deleteReportTemplate(template.id);
        throw uploadError;
      }

      await AuditLogger.logAction({
        userId: req.user.id,
        username: req.user.username,
        action: 'report_template_created',
        result: 'success',
        resourceType: 'report_template',
        resourceId: template.id.toString(),
        ipAddress,
        userAgent,
        hipaaRelevant: false,
        riskLevel: 'low',
        details: JSON.stringify({ operation: 'report_template_created', name }),
        accessReason: 'Report template management',
      });

      res.status(201).json(template);
    } catch (error: any) {
      console.error('Error creating report template:', error);
      res.status(error?.message?.includes('Unsupported') || error?.message?.includes('Could not read') ? 400 : 500)
        .json({ message: error?.message || "Failed to create report template" });
    }
  });

  // Update a report template's metadata (admin only)
  app.patch("/api/report-templates/:id", requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      if (!req.user) return res.status(401).json({ message: "Authentication required" });
      if (!isAdminRole(req.user.role)) {
        return res.status(403).json({ message: "Access denied. Admin privileges required." });
      }
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid template ID" });

      const {
        name, description, aiInstructions, isActive, structureText,
        defaultIncludeProfile, defaultIncludeNotes, defaultIncludeAssessments,
        supportingFilesGuidance, supportingFilesExpected, supportingFileTypes,
      } = req.body || {};
      const updates: any = {};
      if (name !== undefined) updates.name = name;
      if (description !== undefined) updates.description = description;
      if (aiInstructions !== undefined) updates.aiInstructions = aiInstructions;
      if (structureText !== undefined) updates.structureText = (typeof structureText === "string" ? structureText.trim() : "") || null;
      if (isActive !== undefined) updates.isActive = isActive;
      if (defaultIncludeProfile !== undefined) updates.defaultIncludeProfile = !!defaultIncludeProfile;
      if (defaultIncludeNotes !== undefined) updates.defaultIncludeNotes = !!defaultIncludeNotes;
      if (defaultIncludeAssessments !== undefined) updates.defaultIncludeAssessments = !!defaultIncludeAssessments;
      if (supportingFilesGuidance !== undefined) updates.supportingFilesGuidance = supportingFilesGuidance || null;
      if (supportingFilesExpected !== undefined) updates.supportingFilesExpected = !!supportingFilesExpected;
      if (supportingFileTypes !== undefined) {
        updates.supportingFileTypes = Array.isArray(supportingFileTypes)
          ? supportingFileTypes.map((t: any) => String(t).trim()).filter(Boolean)
          : null;
      }

      const updated = await storage.updateReportTemplate(id, updates);

      const { ipAddress, userAgent } = getRequestInfo(req);
      await AuditLogger.logAction({
        userId: req.user.id,
        username: req.user.username,
        action: 'report_template_updated',
        result: 'success',
        resourceType: 'report_template',
        resourceId: id.toString(),
        ipAddress,
        userAgent,
        hipaaRelevant: false,
        riskLevel: 'low',
        details: JSON.stringify({ operation: 'report_template_updated', fields: Object.keys(updates) }),
        accessReason: 'Report template management',
      });

      res.json(updated);
    } catch (error) {
      console.error('Error updating report template:', error);
      res.status(500).json({ message: "Failed to update report template" });
    }
  });

  // Delete a report template (admin only)
  app.delete("/api/report-templates/:id", requireAuth, async (req: AuthenticatedRequest, res) => {
    const { ipAddress, userAgent } = getRequestInfo(req);
    try {
      if (!req.user) return res.status(401).json({ message: "Authentication required" });
      if (!isAdminRole(req.user.role)) {
        return res.status(403).json({ message: "Access denied. Admin privileges required." });
      }
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid template ID" });

      const existing = await storage.getReportTemplate(id);
      await storage.deleteReportTemplate(id);
      // Best-effort cleanup of the stored original file; do not fail the request if blob removal fails.
      if (existing?.fileBlobName) {
        try {
          await azureStorage.deleteFile(existing.fileBlobName);
        } catch (blobError) {
          console.warn('[report-templates] Failed to delete template blob:', blobError);
        }
      }
      await AuditLogger.logAction({
        userId: req.user.id,
        username: req.user.username,
        action: 'report_template_deleted',
        result: 'success',
        resourceType: 'report_template',
        resourceId: id.toString(),
        ipAddress,
        userAgent,
        hipaaRelevant: false,
        riskLevel: 'low',
        details: JSON.stringify({ operation: 'report_template_deleted' }),
        accessReason: 'Report template management',
      });
      res.json({ success: true });
    } catch (error) {
      console.error('Error deleting report template:', error);
      res.status(500).json({ message: "Failed to delete report template" });
    }
  });

  // ==================== REPORT SUPPORTING FILES (per-client AI context) ====================
  // List a client's supporting files (staff with client access). Extracted text is omitted from the list payload.
  app.get("/api/clients/:clientId/supporting-files", requireAuth, blockAccountant, async (req: AuthenticatedRequest, res) => {
    const { ipAddress, userAgent } = getRequestInfo(req);
    try {
      if (!req.user) return res.status(401).json({ message: "Authentication required" });
      const clientId = parseInt(req.params.clientId);
      if (isNaN(clientId)) return res.status(400).json({ message: "Invalid client ID" });
      if (!(await userCanAccessClient(req.user, clientId))) {
        // HIPAA: record the blocked attempt. A denied attempt to list a client's
        // documents is as worth retaining as a denied download.
        await AuditLogger.logAction({
          userId: req.user.id,
          username: req.user.username,
          action: 'unauthorized_access',
          result: 'denied',
          resourceType: 'report_supporting_file',
          clientId,
          ipAddress,
          userAgent,
          hipaaRelevant: true,
          riskLevel: 'high',
          details: JSON.stringify({
            reason: 'client_not_authorized',
            endpoint: '/api/clients/:clientId/supporting-files',
            userRole: req.user.role,
          }),
          accessReason: 'Supporting file list attempted for unauthorized client',
        });
        return res.status(403).json({ message: "Access denied. You can only view files for your assigned clients." });
      }
      const files = await storage.getReportSupportingFilesByClient(clientId);
      // Return only safe metadata. Never expose extractedText (large PHI) or the
      // blob URL/name (the Azure container allows blob-level reads by URL).
      const list = files.map((f) => ({
        id: f.id,
        clientId: f.clientId,
        originalName: f.originalName,
        mimeType: f.mimeType,
        fileSize: f.fileSize,
        documentType: f.documentType,
        createdById: f.createdById,
        createdAt: f.createdAt,
      }));
      res.json(list);
    } catch (error) {
      console.error('Error fetching supporting files:', error);
      res.status(500).json({ message: "Failed to fetch supporting files" });
    }
  });

  // Securely download/preview a supporting file. Streams the blob through the server
  // after verifying the caller can access the file's client. Never hands out the raw
  // Azure blob URL (the container allows blob-level reads by URL).
  app.get("/api/supporting-files/:id/download", requireAuth, blockAccountant, async (req: AuthenticatedRequest, res) => {
    const { ipAddress, userAgent } = getRequestInfo(req);
    try {
      if (!req.user) return res.status(401).json({ message: "Authentication required" });
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid file ID" });

      const file = await storage.getReportSupportingFile(id);
      if (!file) return res.status(404).json({ message: "Supporting file not found" });
      if (!(await userCanAccessClient(req.user, file.clientId))) {
        // HIPAA: record the blocked attempt. A denied attempt to pull a client's
        // document is exactly the kind of event the access log must retain.
        await AuditLogger.logAction({
          userId: req.user.id,
          username: req.user.username,
          action: 'unauthorized_access',
          result: 'denied',
          resourceType: 'report_supporting_file',
          resourceId: file.id.toString(),
          clientId: file.clientId,
          ipAddress,
          userAgent,
          hipaaRelevant: true,
          riskLevel: 'high',
          details: JSON.stringify({
            reason: 'client_not_authorized',
            endpoint: '/api/supporting-files/:id/download',
            userRole: req.user.role,
          }),
          accessReason: 'Supporting file download attempted for unauthorized client',
        });
        return res.status(403).json({ message: "Access denied. You can only download files for your assigned clients." });
      }

      // Resolve the blob: prefer the stored blob name, fall back to name variations.
      let blobName = file.fileBlobName || null;
      if (!blobName || !(await azureStorage.fileExists(blobName))) {
        blobName = await azureStorage.findBlobName(file.id, file.originalName, file.originalName);
      }
      if (!blobName) {
        return res.status(404).json({ message: "File not found in storage" });
      }

      const downloadResult = await azureStorage.downloadFile(blobName);
      if (!downloadResult.success || !downloadResult.data) {
        return res.status(404).json({ message: "File not found in storage" });
      }

      const disposition = req.query.inline === '1' ? 'inline' : 'attachment';
      const safeName = String(file.originalName).replace(/"/g, '');

      await AuditLogger.logAction({
        userId: req.user.id,
        username: req.user.username,
        action: 'report_supporting_file_downloaded',
        result: 'success',
        resourceType: 'report_supporting_file',
        resourceId: file.id.toString(),
        clientId: file.clientId,
        ipAddress,
        userAgent,
        hipaaRelevant: true,
        riskLevel: 'medium',
        details: JSON.stringify({ operation: 'report_supporting_file_downloaded', originalName: file.originalName, mimeType: file.mimeType }),
        accessReason: 'Supporting file management for AI reports',
      });

      res.setHeader('Content-Type', file.mimeType || 'application/octet-stream');
      res.setHeader('Content-Disposition', `${disposition}; filename="${safeName}"`);
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      res.send(downloadResult.data);
    } catch (error) {
      console.error('Error downloading supporting file:', error);
      res.status(500).json({ message: "Failed to download supporting file" });
    }
  });

  // Upload a supporting file for a client. Body: { fileContent(base64), originalName, mimeType }
  app.post("/api/clients/:clientId/supporting-files", requireAuth, blockAccountant, async (req: AuthenticatedRequest, res) => {
    const { ipAddress, userAgent } = getRequestInfo(req);
    try {
      if (!req.user) return res.status(401).json({ message: "Authentication required" });
      const clientId = parseInt(req.params.clientId);
      if (isNaN(clientId)) return res.status(400).json({ message: "Invalid client ID" });
      if (!(await userCanAccessClient(req.user, clientId))) {
        // HIPAA: record the blocked attempt. A denied attempt to upload a
        // document for a client is as worth retaining as a denied download.
        await AuditLogger.logAction({
          userId: req.user.id,
          username: req.user.username,
          action: 'unauthorized_access',
          result: 'denied',
          resourceType: 'report_supporting_file',
          clientId,
          ipAddress,
          userAgent,
          hipaaRelevant: true,
          riskLevel: 'high',
          details: JSON.stringify({
            reason: 'client_not_authorized',
            endpoint: '/api/clients/:clientId/supporting-files',
            userRole: req.user.role,
          }),
          accessReason: 'Supporting file upload attempted for unauthorized client',
        });
        return res.status(403).json({ message: "Access denied. You can only add files for your assigned clients." });
      }

      const { fileContent, originalName, mimeType, documentType, templateId } = req.body || {};
      if (!fileContent || !originalName || !mimeType) {
        return res.status(400).json({ message: "fileContent, originalName and mimeType are required" });
      }
      const normalizedDocumentType =
        typeof documentType === 'string' && documentType.trim() ? documentType.trim() : null;

      // If a document type was chosen, it must be one of the types the admin
      // defined on the template the therapist is generating from. This stops a
      // tampered request from saving an arbitrary, off-list label.
      if (normalizedDocumentType) {
        const parsedTemplateId = parseInt(String(templateId));
        if (isNaN(parsedTemplateId)) {
          return res.status(400).json({ message: "A templateId is required when choosing a document type." });
        }
        const template = await storage.getReportTemplate(parsedTemplateId);
        const allowedTypes = template?.supportingFileTypes || [];
        if (!allowedTypes.includes(normalizedDocumentType)) {
          return res.status(400).json({ message: "That document type is not allowed for this template." });
        }
      }

      const { isSupportedDocumentType, extractDocumentText } = await import("./report-templates/extract");
      if (!isSupportedDocumentType(mimeType, originalName)) {
        return res.status(400).json({ message: "Only Word (.docx), PDF (.pdf), or plain text (.txt) files are supported." });
      }

      const base64 = String(fileContent).includes(',') ? String(fileContent).split(',')[1] : String(fileContent);
      const buffer = Buffer.from(base64, 'base64');
      if (buffer.length > 15 * 1024 * 1024) {
        return res.status(400).json({ message: "File too large (max 15MB)." });
      }

      let extractedText: string;
      try {
        extractedText = await extractDocumentText(buffer, mimeType, originalName);
      } catch (extractError: any) {
        // Supported file type but no readable text (empty file or image-only
        // PDF). This is bad user input, not a server error — return a clear 400.
        return res.status(400).json({
          message: extractError?.message || "Could not read any text from the uploaded file. Please ensure it is not empty or image-only.",
        });
      }

      const validated = insertReportSupportingFileSchema.parse({
        clientId,
        originalName,
        mimeType,
        fileSize: buffer.length,
        documentType: normalizedDocumentType,
        extractedText,
        createdById: req.user.id,
      });
      let file = await storage.createReportSupportingFile(validated);

      // Persist the original file in Azure blob storage (best effort — keep the row even if blob upload fails).
      try {
        const uploadResult = await azureStorage.uploadFile(
          buffer,
          originalName,
          mimeType,
          file.id,
          { kind: 'report_supporting_file', clientId: clientId.toString(), createdById: req.user.id.toString() },
        );
        if (uploadResult.success) {
          file = await storage.updateReportSupportingFile(file.id, {
            fileBlobName: uploadResult.blobName ?? null,
            fileUrl: uploadResult.url ?? null,
          });
        }
      } catch (uploadError) {
        console.warn('[supporting-files] Failed to upload blob:', uploadError);
      }

      await AuditLogger.logAction({
        userId: req.user.id,
        username: req.user.username,
        action: 'report_supporting_file_uploaded',
        result: 'success',
        resourceType: 'report_supporting_file',
        resourceId: file.id.toString(),
        clientId,
        ipAddress,
        userAgent,
        hipaaRelevant: true,
        riskLevel: 'medium',
        details: JSON.stringify({ operation: 'report_supporting_file_uploaded', originalName, mimeType }),
        accessReason: 'Supporting file management for AI reports',
      });

      res.status(201).json({
        id: file.id,
        clientId: file.clientId,
        originalName: file.originalName,
        mimeType: file.mimeType,
        fileSize: file.fileSize,
        documentType: file.documentType,
        createdById: file.createdById,
        createdAt: file.createdAt,
      });
    } catch (error: any) {
      console.error('Error uploading supporting file:', error);
      const msg = error?.message || "Failed to upload supporting file";
      res.status(msg.includes('Unsupported') || msg.includes('Could not read') ? 400 : 500).json({ message: msg });
    }
  });

  // Delete a supporting file (staff with access to the file's client)
  app.delete("/api/supporting-files/:id", requireAuth, blockAccountant, async (req: AuthenticatedRequest, res) => {
    const { ipAddress, userAgent } = getRequestInfo(req);
    try {
      if (!req.user) return res.status(401).json({ message: "Authentication required" });
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid file ID" });

      const existing = await storage.getReportSupportingFile(id);
      if (!existing) return res.status(404).json({ message: "Supporting file not found" });
      if (!(await userCanAccessClient(req.user, existing.clientId))) {
        // HIPAA: record the blocked attempt. A denied attempt to delete a client's
        // document is exactly the kind of event the access log must retain.
        await AuditLogger.logAction({
          userId: req.user.id,
          username: req.user.username,
          action: 'unauthorized_access',
          result: 'denied',
          resourceType: 'report_supporting_file',
          resourceId: existing.id.toString(),
          clientId: existing.clientId,
          ipAddress,
          userAgent,
          hipaaRelevant: true,
          riskLevel: 'high',
          details: JSON.stringify({
            reason: 'client_not_authorized',
            endpoint: '/api/supporting-files/:id',
            userRole: req.user.role,
          }),
          accessReason: 'Supporting file deletion attempted for unauthorized client',
        });
        return res.status(403).json({ message: "Access denied. You can only delete files for your assigned clients." });
      }

      await storage.deleteReportSupportingFile(id);
      if (existing.fileBlobName) {
        try {
          await azureStorage.deleteFile(existing.fileBlobName);
        } catch (blobError) {
          console.warn('[supporting-files] Failed to delete blob:', blobError);
        }
      }

      await AuditLogger.logAction({
        userId: req.user.id,
        username: req.user.username,
        action: 'report_supporting_file_deleted',
        result: 'success',
        resourceType: 'report_supporting_file',
        resourceId: id.toString(),
        clientId: existing.clientId,
        ipAddress,
        userAgent,
        hipaaRelevant: true,
        riskLevel: 'medium',
        details: JSON.stringify({ operation: 'report_supporting_file_deleted', originalName: existing.originalName }),
        accessReason: 'Supporting file management for AI reports',
      });

      res.json({ success: true });
    } catch (error) {
      console.error('Error deleting supporting file:', error);
      res.status(500).json({ message: "Failed to delete supporting file" });
    }
  });

  // ==================== CLIENT REPORTS (AI-generated) ====================
  // List a client's reports
  app.get("/api/clients/:clientId/reports", requireAuth, blockAccountant, async (req: AuthenticatedRequest, res) => {
    try {
      const clientId = parseInt(req.params.clientId);
      if (isNaN(clientId)) return res.status(400).json({ message: "Invalid client ID" });
      if (!(await userCanAccessClient(req.user, clientId))) {
        return res.status(403).json({ message: "Access denied. You can only view reports for your assigned clients." });
      }
      const reports = await storage.getClientReports(clientId);
      res.json(reports);
    } catch (error) {
      console.error('Error fetching client reports:', error);
      res.status(500).json({ message: "Failed to fetch client reports" });
    }
  });

  // Generate a new client report from a template (consent-gated, fail closed)
  app.post("/api/clients/:clientId/reports/generate", requireAuth, blockAccountant, async (req: AuthenticatedRequest, res) => {
    const { ipAddress, userAgent } = getRequestInfo(req);
    try {
      if (!req.user) return res.status(401).json({ message: "Authentication required" });
      const clientId = parseInt(req.params.clientId);
      if (isNaN(clientId)) return res.status(400).json({ message: "Invalid client ID" });

      const { templateId, sources, supportingFileIds } = req.body || {};
      if (!templateId) return res.status(400).json({ message: "templateId is required" });

      if (!process.env.OPENAI_API_KEY && !process.env.AI_INTEGRATIONS_OPENAI_API_KEY) {
        return res.status(503).json({ message: "AI features not available. Please configure OPENAI_API_KEY." });
      }

      const client = await storage.getClient(clientId);
      if (!client) return res.status(404).json({ message: "Client not found" });
      if (!(await userCanAccessClient(req.user, clientId))) {
        return res.status(403).json({ message: "Access denied. You can only generate reports for your assigned clients." });
      }

      const template = await storage.getReportTemplate(parseInt(String(templateId)));
      if (!template) return res.status(404).json({ message: "Report template not found" });
      if (!template.isActive) return res.status(400).json({ message: "This template is no longer active" });

      // GDPR/HIPAA: AI processing consent (fail closed)
      const consentCheck = await checkAIProcessingConsent(clientId);
      if (!consentCheck.hasConsent) {
        await AuditLogger.logAction({
          userId: req.user.id,
          username: req.user.username,
          action: 'ai_processing_blocked',
          result: 'denied',
          resourceType: 'client_report',
          resourceId: `client_${clientId}`,
          clientId,
          ipAddress,
          userAgent,
          hipaaRelevant: true,
          riskLevel: 'high',
          details: JSON.stringify({ reason: 'consent_not_granted', templateId, consentType: 'ai_processing' }),
          accessReason: 'AI client report generation attempted without consent',
        });
        return res.status(403).json({ message: consentCheck.message, consentRequired: true, consentType: 'ai_processing' });
      }

      // Resolve which data sources to include. Defaults come from the template;
      // the therapist can override per generation via `sources`.
      const includeProfile = sources?.includeProfile ?? template.defaultIncludeProfile ?? true;
      const includeNotes = sources?.includeNotes ?? template.defaultIncludeNotes ?? true; // sessions + notes
      const includeAssessments = sources?.includeAssessments ?? template.defaultIncludeAssessments ?? true;

      // Gather only the requested client data.
      const [sessions, notes, assessments] = await Promise.all([
        includeNotes ? storage.getSessionsByClient(clientId) : Promise.resolve([]),
        includeNotes ? storage.getSessionNotesByClient(clientId) : Promise.resolve([]),
        includeAssessments ? storage.getAssessmentAssignments(clientId) : Promise.resolve([]),
      ]);

      // Resolve any selected supporting files (must belong to this client).
      let supportingFiles: { name: string; text: string; type?: string | null }[] = [];
      const requestedFileIds = Array.isArray(supportingFileIds)
        ? supportingFileIds.map((v: any) => parseInt(String(v))).filter((n: number) => !isNaN(n))
        : [];
      if (requestedFileIds.length > 0) {
        const clientFiles = await storage.getReportSupportingFilesByClient(clientId);
        supportingFiles = clientFiles
          .filter((f) => requestedFileIds.includes(f.id) && !!f.extractedText)
          .map((f) => ({ name: f.originalName, text: f.extractedText as string, type: f.documentType }));
      }

      const { generateClientReportFromTemplate } = await import("./ai/openai");
      const rawGenerated = await generateClientReportFromTemplate({
        client,
        sessions,
        notes,
        assessments,
        templateStructure: template.structureText || '',
        aiInstructions: template.aiInstructions,
        includeProfile,
        includeNotes,
        includeAssessments,
        supportingFiles,
      });
      const generatedContent = await sanitizeReportHtml(rawGenerated);

      const validated = insertClientReportSchema.parse({
        clientId,
        templateId: template.id,
        templateName: template.name,
        generatedContent,
        draftContent: null,
        finalContent: null,
        isDraft: true,
        isFinalized: false,
        generatedAt: new Date(),
        createdById: req.user.id,
      });
      const report = await storage.createClientReport(validated);

      await AuditLogger.logAction({
        userId: req.user.id,
        username: req.user.username,
        action: 'client_report_generated',
        result: 'success',
        resourceType: 'client_report',
        resourceId: report.id.toString(),
        clientId,
        ipAddress,
        userAgent,
        hipaaRelevant: true,
        riskLevel: 'high',
        details: JSON.stringify({
          templateId: template.id,
          reportId: report.id,
          aiModel: 'gpt-4o',
          sources: { includeProfile, includeNotes, includeAssessments },
          supportingFileIds: supportingFiles.length > 0 ? requestedFileIds : [],
        }),
        accessReason: 'AI client report generation',
      });

      res.status(201).json(report);
    } catch (error: any) {
      console.error('Error generating client report:', error);
      const msg = error?.message || "Failed to generate client report";
      if (msg.includes('not configured') || msg.includes('API key')) return res.status(503).json({ message: msg });
      if (msg.includes('timeout')) return res.status(504).json({ message: msg });
      if (msg.includes('quota') || msg.includes('billing')) return res.status(402).json({ message: msg });
      res.status(500).json({ message: msg });
    }
  });

  // Get a single client report
  app.get("/api/reports/:id", requireAuth, blockAccountant, async (req: AuthenticatedRequest, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid report ID" });
      const report = await storage.getClientReport(id);
      if (!report) return res.status(404).json({ message: "Report not found" });
      if (!(await userCanAccessClient(req.user, report.clientId))) {
        return res.status(403).json({ message: "Access denied. You can only view reports for your assigned clients." });
      }
      res.json(report);
    } catch (error) {
      console.error('Error fetching client report:', error);
      res.status(500).json({ message: "Failed to fetch report" });
    }
  });

  // Save draft content for a client report
  app.put("/api/reports/:id", requireAuth, blockAccountant, async (req: AuthenticatedRequest, res) => {
    try {
      if (!req.user) return res.status(401).json({ message: "Authentication required" });
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid report ID" });
      const { draftContent } = req.body || {};
      if (draftContent === undefined) return res.status(400).json({ message: "draftContent is required" });

      const existing = await storage.getClientReport(id);
      if (!existing) return res.status(404).json({ message: "Report not found" });
      if (!(await userCanAccessClient(req.user, existing.clientId))) {
        return res.status(403).json({ message: "Access denied. You can only edit reports for your assigned clients." });
      }
      if (existing.isFinalized) return res.status(400).json({ message: "Cannot edit a finalized report. Reopen it first." });

      const cleanDraft = await sanitizeReportHtml(draftContent);
      const updated = await storage.updateClientReport(id, { draftContent: cleanDraft, isDraft: true, editedAt: new Date() });
      res.json(updated);
    } catch (error) {
      console.error('Error saving client report draft:', error);
      res.status(500).json({ message: "Failed to save report" });
    }
  });

  // Finalize a client report
  app.post("/api/reports/:id/finalize", requireAuth, blockAccountant, async (req: AuthenticatedRequest, res) => {
    const { ipAddress, userAgent } = getRequestInfo(req);
    try {
      if (!req.user) return res.status(401).json({ message: "Authentication required" });
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid report ID" });

      const existing = await storage.getClientReport(id);
      if (!existing) return res.status(404).json({ message: "Report not found" });
      if (!(await userCanAccessClient(req.user, existing.clientId))) {
        return res.status(403).json({ message: "Access denied. You can only finalize reports for your assigned clients." });
      }
      if (existing.isFinalized) return res.status(400).json({ message: "Report is already finalized" });

      const finalContent = existing.draftContent || existing.generatedContent || '';
      const updated = await storage.updateClientReport(id, {
        isFinalized: true,
        isDraft: false,
        finalContent,
        finalizedAt: new Date(),
        finalizedById: req.user.id,
      });

      await AuditLogger.logAction({
        userId: req.user.id,
        username: req.user.username,
        action: 'client_report_finalized',
        result: 'success',
        resourceType: 'client_report',
        resourceId: id.toString(),
        clientId: existing.clientId,
        ipAddress,
        userAgent,
        hipaaRelevant: true,
        riskLevel: 'high',
        details: JSON.stringify({ operation: 'client_report_finalized', reportId: id }),
        accessReason: 'Clinical report finalization',
      });
      res.json(updated);
    } catch (error) {
      console.error('Error finalizing client report:', error);
      res.status(500).json({ message: "Failed to finalize report" });
    }
  });

  // Unfinalize (reopen) a client report
  app.post("/api/reports/:id/unfinalize", requireAuth, blockAccountant, async (req: AuthenticatedRequest, res) => {
    const { ipAddress, userAgent } = getRequestInfo(req);
    try {
      if (!req.user) return res.status(401).json({ message: "Authentication required" });
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid report ID" });

      const existing = await storage.getClientReport(id);
      if (!existing) return res.status(404).json({ message: "Report not found" });
      if (!(await userCanAccessClient(req.user, existing.clientId))) {
        return res.status(403).json({ message: "Access denied. You can only reopen reports for your assigned clients." });
      }
      if (!existing.isFinalized) return res.status(400).json({ message: "Report is not finalized" });

      const draftContent = existing.finalContent || existing.draftContent || existing.generatedContent || '';
      const updated = await storage.updateClientReport(id, {
        isFinalized: false,
        isDraft: true,
        draftContent,
        finalContent: null,
        finalizedAt: null,
        finalizedById: null,
      });

      await AuditLogger.logAction({
        userId: req.user.id,
        username: req.user.username,
        action: 'client_report_reopened',
        result: 'success',
        resourceType: 'client_report',
        resourceId: id.toString(),
        clientId: existing.clientId,
        ipAddress,
        userAgent,
        hipaaRelevant: true,
        riskLevel: 'high',
        details: JSON.stringify({ operation: 'client_report_reopened', reportId: id }),
        accessReason: 'Clinical report reopened for editing',
      });
      res.json(updated);
    } catch (error) {
      console.error('Error unfinalizing client report:', error);
      res.status(500).json({ message: "Failed to reopen report" });
    }
  });

  // Delete a client report
  app.delete("/api/reports/:id", requireAuth, blockAccountant, async (req: AuthenticatedRequest, res) => {
    try {
      if (!req.user) return res.status(401).json({ message: "Authentication required" });
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid report ID" });
      const existing = await storage.getClientReport(id);
      if (!existing) return res.status(404).json({ message: "Report not found" });
      if (!(await userCanAccessClient(req.user, existing.clientId))) {
        return res.status(403).json({ message: "Access denied. You can only delete reports for your assigned clients." });
      }
      await storage.deleteClientReport(id);
      res.json({ success: true });
    } catch (error) {
      console.error('Error deleting client report:', error);
      res.status(500).json({ message: "Failed to delete report" });
    }
  });

  // Download client report as PDF (HTML; browser prints)
  app.get("/api/reports/:id/download/pdf", requireAuth, blockAccountant, async (req: AuthenticatedRequest, res) => {
    const { ipAddress, userAgent } = getRequestInfo(req);
    try {
      if (!req.user) return res.status(401).json({ message: "Authentication required" });
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid report ID" });

      const report = await storage.getClientReport(id);
      if (!report || !report.client) return res.status(404).json({ message: "Report not found" });
      if (!(await userCanAccessClient(req.user, report.clientId))) {
        return res.status(403).json({ message: "Access denied. You can only download reports for your assigned clients." });
      }

      const practiceSettings = await getPracticeSettingsForReport();
      const { generateClientReportHTML, generateClientReportPDF } = await import("./pdf/client-report-pdf");
      const html = generateClientReportHTML(report.client, report, practiceSettings);

      const baseFilename = `client-report-${(report.client.fullName || 'client').replace(/\s+/g, '-')}-${new Date().toISOString().split('T')[0]}`;

      let pdfBuffer: Buffer | null = null;
      try {
        pdfBuffer = await generateClientReportPDF(html);
      } catch (pdfError) {
        console.error('Client report PDF rendering failed after retry, falling back to print-ready HTML:', pdfError);
      }

      await AuditLogger.logDocumentAccess(
        req.user.id, req.user.username, report.id, report.clientId,
        'document_downloaded', ipAddress, userAgent,
        { format: pdfBuffer ? 'pdf' : 'html', documentType: 'client_report', templateName: report.templateName },
      );

      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, private');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      res.removeHeader('ETag');

      if (pdfBuffer) {
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${baseFilename}.pdf"`);
        res.setHeader('Content-Length', pdfBuffer.length);
        res.send(pdfBuffer);
      } else {
        // Fallback: return the print-ready HTML so the user can still print to PDF
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.setHeader('Content-Disposition', `inline; filename="${baseFilename}.html"`);
        res.send(html);
      }
    } catch (error) {
      console.error('Error generating client report PDF:', error);
      res.status(500).json({ message: "Failed to generate PDF" });
    }
  });

  // Download client report as Word
  app.get("/api/reports/:id/download/docx", requireAuth, blockAccountant, async (req: AuthenticatedRequest, res) => {
    const { ipAddress, userAgent } = getRequestInfo(req);
    try {
      if (!req.user) return res.status(401).json({ message: "Authentication required" });
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid report ID" });

      const report = await storage.getClientReport(id);
      if (!report || !report.client) return res.status(404).json({ message: "Report not found" });
      if (!(await userCanAccessClient(req.user, report.clientId))) {
        return res.status(403).json({ message: "Access denied. You can only download reports for your assigned clients." });
      }

      const practiceSettings = await getPracticeSettingsForReport();
      const { generateClientReportDocx } = await import("./docx/report-docx");
      const buffer = await generateClientReportDocx(report.client, report, practiceSettings);

      await AuditLogger.logDocumentAccess(
        req.user.id, req.user.username, report.id, report.clientId,
        'document_downloaded', ipAddress, userAgent,
        { format: 'docx', documentType: 'client_report', templateName: report.templateName },
      );

      const filename = `client-report-${(report.client.fullName || 'client').replace(/\s+/g, '-')}-${new Date().toISOString().split('T')[0]}.docx`;
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send(buffer);
    } catch (error) {
      console.error('Error generating client report Word doc:', error);
      res.status(500).json({ message: "Failed to generate Word document" });
    }
  });

  // Service Management API (admin-only for full list)
  app.get("/api/services", requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      // Admin-only access for full service list
      if (req.user?.role !== 'administrator' && req.user?.role !== 'admin') {
        return res.status(403).json({ message: "Access denied. Admin privileges required." });
      }

      const services = await storage.getServices();
      res.json(services);
    } catch (error) {
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post("/api/services", async (req, res) => {
    try {
      const validatedData = insertServiceSchema.parse(req.body);
      const service = await storage.createService(validatedData);
      res.status(201).json(service);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid service data", errors: error.errors });
      }
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Update service (including price)
  app.put("/api/services/:id", async (req, res) => {
    try {
      const serviceId = parseInt(req.params.id);
      if (isNaN(serviceId)) {
        return res.status(400).json({ message: "Invalid service ID" });
      }

      const updateData = req.body;
      const service = await storage.updateService(serviceId, updateData);
      res.json(service);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid service data", errors: error.errors });
      }
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Delete service
  app.delete("/api/services/:id", async (req, res) => {
    try {
      const serviceId = parseInt(req.params.id);
      if (isNaN(serviceId)) {
        return res.status(400).json({ message: "Invalid service ID" });
      }

      await storage.deleteService(serviceId);
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // ===================== THERAPIST PAYMENTS =====================
  // Active service list for the pay-rule editor (admin/billing only).
  app.get("/api/therapist-pay/services", requireAuth, requireTherapistPayAccess, async (req: AuthenticatedRequest, res) => {
    try {
      const allServices = await storage.getServices();
      const active = allServices.filter((s: any) => s.isActive !== false);
      res.json(active);
    } catch (error) {
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Therapist list for the picker (admin/billing only).
  app.get("/api/therapist-pay/therapists", requireAuth, requireTherapistPayAccess, async (req: AuthenticatedRequest, res) => {
    try {
      const therapists = await storage.getTherapists();
      res.json(therapists.map((t) => ({ id: t.id, fullName: t.fullName, role: t.role })));
    } catch (error) {
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Get a therapist's pay rules.
  app.get("/api/therapist-pay/rules/:therapistId", requireAuth, requireTherapistPayAccess, async (req: AuthenticatedRequest, res) => {
    try {
      const therapistId = parseInt(req.params.therapistId);
      if (isNaN(therapistId)) return res.status(400).json({ message: "Invalid therapist ID" });
      const rules = await storage.getTherapistPayRules(therapistId);
      res.json(rules);
    } catch (error) {
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Create or update a single pay rule (one default rule per therapist when
  // serviceId is null; otherwise one rule per service).
  app.post("/api/therapist-pay/rules", requireAuth, requireTherapistPayAccess, async (req: AuthenticatedRequest, res) => {
    try {
      // Coerce incoming values defensively: ids can arrive as strings (the
      // Neon driver returns serial ids as strings, so a service id selected in
      // the UI comes through as e.g. "29"), and payValue may be a number.
      const payRuleInputSchema = z.object({
        therapistId: z.coerce.number().int().positive(),
        serviceId: z.preprocess(
          (v) => (v === null || v === undefined || v === '' ? null : Number(v)),
          z.number().int().positive().nullable(),
        ),
        payType: z.enum(['percentage', 'fixed']),
        payValue: z.coerce.string().trim().min(1),
      });
      const validated = payRuleInputSchema.parse(req.body);
      const value = Number(validated.payValue);
      if (!isFinite(value) || value < 0) {
        return res.status(400).json({ message: "payValue must be a non-negative number" });
      }
      if (validated.payType === 'percentage' && value > 100) {
        return res.status(400).json({ message: "A percentage rule cannot exceed 100%" });
      }
      const rule = await storage.upsertTherapistPayRule(validated);

      await db.insert(auditLogs).values({
        userId: req.user!.id,
        username: req.user!.username,
        action: 'therapist_pay_rule_updated',
        result: 'success',
        resourceType: 'therapist_pay_rule',
        resourceId: String(rule.id),
        details: JSON.stringify({
          therapistId: rule.therapistId,
          serviceId: rule.serviceId,
          payType: rule.payType,
          payValue: rule.payValue,
        }),
        ipAddress: req.ip || null,
        userAgent: req.get('user-agent') || null,
      });

      res.status(201).json(rule);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid pay rule data", errors: error.errors });
      }
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Delete a pay rule.
  app.delete("/api/therapist-pay/rules/:id", requireAuth, requireTherapistPayAccess, async (req: AuthenticatedRequest, res) => {
    try {
      const id = parseInt(req.params.id);
      const therapistId = parseInt(String(req.query.therapistId));
      if (isNaN(id) || isNaN(therapistId)) {
        return res.status(400).json({ message: "Invalid rule or therapist ID" });
      }
      await storage.deleteTherapistPayRule(id, therapistId);

      await db.insert(auditLogs).values({
        userId: req.user!.id,
        username: req.user!.username,
        action: 'therapist_pay_rule_deleted',
        result: 'success',
        resourceType: 'therapist_pay_rule',
        resourceId: String(id),
        details: JSON.stringify({ therapistId }),
        ipAddress: req.ip || null,
        userAgent: req.get('user-agent') || null,
      });

      res.status(204).send();
    } catch (error) {
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // What a therapist is currently owed (collected, not-yet-paid sessions).
  app.get("/api/therapist-pay/owed/:therapistId", requireAuth, requireTherapistPayAccess, async (req: AuthenticatedRequest, res) => {
    try {
      const therapistId = parseInt(req.params.therapistId);
      if (isNaN(therapistId)) return res.status(400).json({ message: "Invalid therapist ID" });
      const owed = await storage.getTherapistOwed(therapistId);
      res.json(owed);
    } catch (error) {
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Record a payout for selected owed sessions.
  app.post("/api/therapist-pay/payouts", requireAuth, requireTherapistPayAccess, async (req: AuthenticatedRequest, res) => {
    try {
      const { therapistId, paymentDate, paymentMethod, referenceNumber, notes, sessionBillingIds } = req.body || {};
      const tId = parseInt(String(therapistId));
      if (isNaN(tId)) return res.status(400).json({ message: "Invalid therapist ID" });
      if (!paymentDate || typeof paymentDate !== 'string') {
        return res.status(400).json({ message: "paymentDate is required" });
      }
      if (!Array.isArray(sessionBillingIds) || sessionBillingIds.length === 0) {
        return res.status(400).json({ message: "Select at least one session to pay" });
      }
      const ids = sessionBillingIds.map((x: any) => parseInt(String(x))).filter((x: number) => !isNaN(x));
      if (ids.length === 0) return res.status(400).json({ message: "No valid sessions selected" });

      const payout = await storage.createTherapistPayout({
        therapistId: tId,
        paymentDate,
        paymentMethod: paymentMethod || null,
        referenceNumber: referenceNumber || null,
        notes: notes || null,
        sessionBillingIds: ids,
        createdBy: req.user!.id,
      });

      await db.insert(auditLogs).values({
        userId: req.user!.id,
        username: req.user!.username,
        action: 'therapist_payout_created',
        result: 'success',
        resourceType: 'therapist_payout',
        resourceId: String(payout.id),
        details: JSON.stringify({
          therapistId: tId,
          totalAmount: payout.totalAmount,
          sessionCount: ids.length,
          paymentMethod: payout.paymentMethod,
          referenceNumber: payout.referenceNumber,
        }),
        ipAddress: req.ip || null,
        userAgent: req.get('user-agent') || null,
      });

      // One audit row per session allocation so every applied amount is
      // independently traceable (HIPAA/financial audit trail).
      if (payout.allocations.length > 0) {
        await db.insert(auditLogs).values(
          payout.allocations.map((a) => ({
            userId: req.user!.id,
            username: req.user!.username,
            action: 'therapist_payment_allocated' as const,
            result: 'success' as const,
            resourceType: 'therapist_payment_allocation',
            resourceId: String(a.sessionBillingId),
            details: JSON.stringify({
              payoutId: payout.id,
              paymentType: 'itemized',
              therapistId: tId,
              sessionBillingId: a.sessionBillingId,
              sessionId: a.sessionId,
              amountAllocated: a.amountAllocated,
            }),
            ipAddress: req.ip || null,
            userAgent: req.get('user-agent') || null,
          })),
        );
      }

      res.status(201).json(payout);
    } catch (error: any) {
      const msg = error?.message || "Internal server error";
      if (msg === 'No payable sessions selected') {
        return res.status(400).json({ message: msg });
      }
      // Unique violation on payout items => a selected session was already paid
      // (e.g. concurrent submit). Surface a clear, actionable message.
      if (error?.code === '23505') {
        return res.status(409).json({ message: "One or more selected sessions were already paid out. Please refresh and try again." });
      }
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // List payouts (optionally filtered by therapist).
  app.get("/api/therapist-pay/payouts", requireAuth, requireTherapistPayAccess, async (req: AuthenticatedRequest, res) => {
    try {
      const therapistId = req.query.therapistId ? parseInt(String(req.query.therapistId)) : undefined;
      const payouts = await storage.getTherapistPayouts(therapistId != null && !isNaN(therapistId) ? therapistId : undefined);
      res.json(payouts);
    } catch (error) {
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Payout detail with the sessions it covered.
  app.get("/api/therapist-pay/payouts/:id", requireAuth, requireTherapistPayAccess, async (req: AuthenticatedRequest, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid payout ID" });
      const payout = await storage.getTherapistPayoutById(id);
      if (!payout) return res.status(404).json({ message: "Payout not found" });
      res.json(payout);
    } catch (error) {
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Void a payout (releases its sessions back to owed).
  app.post("/api/therapist-pay/payouts/:id/void", requireAuth, requireTherapistPayAccess, async (req: AuthenticatedRequest, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid payout ID" });
      const reason = (req.body?.reason || '').toString().trim();
      if (!reason) return res.status(400).json({ message: "A reason is required to void a payout" });

      const payout = await storage.voidTherapistPayout(id, req.user!.id, reason);

      await db.insert(auditLogs).values({
        userId: req.user!.id,
        username: req.user!.username,
        action: 'therapist_payout_voided',
        result: 'success',
        resourceType: 'therapist_payout',
        resourceId: String(id),
        details: JSON.stringify({ therapistId: payout.therapistId, reason }),
        ipAddress: req.ip || null,
        userAgent: req.get('user-agent') || null,
      });

      res.json(payout);
    } catch (error: any) {
      const msg = error?.message || "Internal server error";
      if (msg === 'Payout not found') return res.status(404).json({ message: msg });
      if (msg === 'Payout already voided') return res.status(400).json({ message: msg });
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Running statement (ledger) for a therapist: chronological earnings & payments
  // with a running balance.
  app.get("/api/therapist-pay/statement/:therapistId", requireAuth, requireTherapistPayAccess, async (req: AuthenticatedRequest, res) => {
    try {
      const therapistId = parseInt(req.params.therapistId);
      if (isNaN(therapistId)) return res.status(400).json({ message: "Invalid therapist ID" });
      const statement = await storage.getTherapistStatement(therapistId);
      res.json(statement);
    } catch (error) {
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Record a single lump payment, auto-applied oldest-first to outstanding earnings.
  app.post("/api/therapist-pay/lump-payment", requireAuth, requireTherapistPayAccess, async (req: AuthenticatedRequest, res) => {
    try {
      const { therapistId, amount, paymentDate, paymentMethod, referenceNumber, notes } = req.body || {};
      const tId = parseInt(String(therapistId));
      if (isNaN(tId)) return res.status(400).json({ message: "Invalid therapist ID" });
      const amt = Math.round(Number(amount) * 100) / 100;
      if (!(amt > 0)) return res.status(400).json({ message: "Payment amount must be greater than zero" });
      if (!paymentDate || typeof paymentDate !== 'string') {
        return res.status(400).json({ message: "paymentDate is required" });
      }

      const payout = await storage.createTherapistLumpPayment({
        therapistId: tId,
        amount: amt,
        paymentDate,
        paymentMethod: paymentMethod || null,
        referenceNumber: referenceNumber || null,
        notes: notes || null,
        createdBy: req.user!.id,
      });

      await db.insert(auditLogs).values({
        userId: req.user!.id,
        username: req.user!.username,
        action: 'therapist_payout_created',
        result: 'success',
        resourceType: 'therapist_payout',
        resourceId: String(payout.id),
        details: JSON.stringify({
          paymentType: 'lump',
          therapistId: tId,
          totalAmount: payout.totalAmount,
          appliedAmount: payout.appliedAmount,
          unappliedAmount: payout.unappliedAmount,
          allocationCount: payout.allocationCount,
          paymentMethod: payout.paymentMethod,
          referenceNumber: payout.referenceNumber,
        }),
        ipAddress: req.ip || null,
        userAgent: req.get('user-agent') || null,
      });

      // One audit row per session allocation so every applied amount is
      // independently traceable (HIPAA/financial audit trail).
      if (payout.allocations.length > 0) {
        await db.insert(auditLogs).values(
          payout.allocations.map((a) => ({
            userId: req.user!.id,
            username: req.user!.username,
            action: 'therapist_payment_allocated' as const,
            result: 'success' as const,
            resourceType: 'therapist_payment_allocation',
            resourceId: String(a.sessionBillingId),
            details: JSON.stringify({
              payoutId: payout.id,
              paymentType: 'lump',
              therapistId: tId,
              sessionBillingId: a.sessionBillingId,
              sessionId: a.sessionId,
              amountAllocated: a.amountAllocated,
            }),
            ipAddress: req.ip || null,
            userAgent: req.get('user-agent') || null,
          })),
        );
      }

      res.status(201).json(payout);
    } catch (error: any) {
      const msg = error?.message || "Internal server error";
      if (msg === 'Payment amount must be greater than zero') {
        return res.status(400).json({ message: msg });
      }
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Per-therapist monthly audit report (opening/earned/paid/closing + session detail).
  app.get("/api/therapist-pay/monthly-statement/:therapistId", requireAuth, requireTherapistPayAccess, async (req: AuthenticatedRequest, res) => {
    try {
      const therapistId = parseInt(req.params.therapistId);
      if (isNaN(therapistId)) return res.status(400).json({ message: "Invalid therapist ID" });
      const month = String(req.query.month || '').trim();
      const startDate = String(req.query.startDate || '').trim();
      const endDate = String(req.query.endDate || '').trim();
      let statement;
      if (startDate || endDate) {
        // Arbitrary date range (inclusive). Both bounds required when ranging.
        if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
          return res.status(400).json({ message: "startDate and endDate are required (YYYY-MM-DD)" });
        }
        statement = await storage.getTherapistPeriodStatement(therapistId, startDate, endDate);
      } else {
        // Backward-compatible single-month path.
        if (!/^\d{4}-\d{2}$/.test(month)) {
          return res.status(400).json({ message: "Provide month=YYYY-MM or startDate & endDate=YYYY-MM-DD" });
        }
        statement = await storage.getTherapistMonthlyStatement(therapistId, month);
      }
      res.json(statement);
    } catch (error: any) {
      const msg = error?.message || "Internal server error";
      if (msg.includes('YYYY') || msg.includes('startDate') || msg.includes('endDate')) {
        return res.status(400).json({ message: msg });
      }
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // List a therapist's manual adjustments (bonuses/deductions), newest first.
  app.get("/api/therapist-pay/adjustments/:therapistId", requireAuth, requireTherapistPayAccess, async (req: AuthenticatedRequest, res) => {
    try {
      const therapistId = parseInt(req.params.therapistId);
      if (isNaN(therapistId)) return res.status(400).json({ message: "Invalid therapist ID" });
      const rows = await storage.listTherapistAdjustments(therapistId);
      res.json(rows);
    } catch (error) {
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Create a manual adjustment (bonus = +, deduction = -) on a therapist's ledger.
  app.post("/api/therapist-pay/adjustments", requireAuth, requireTherapistPayAccess, async (req: AuthenticatedRequest, res) => {
    try {
      const { therapistId, adjustmentType, amount, description, effectiveDate } = req.body || {};
      const tId = parseInt(String(therapistId));
      if (isNaN(tId)) return res.status(400).json({ message: "Invalid therapist ID" });
      if (adjustmentType !== 'bonus' && adjustmentType !== 'deduction') {
        return res.status(400).json({ message: "adjustmentType must be 'bonus' or 'deduction'" });
      }
      const amt = Math.round(Number(amount) * 100) / 100;
      if (!Number.isFinite(amt) || amt <= 0) {
        return res.status(400).json({ message: "Amount must be greater than zero" });
      }
      const desc = (description || '').toString().trim();
      if (!desc) return res.status(400).json({ message: "A description is required" });
      const date = (effectiveDate || '').toString().trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return res.status(400).json({ message: "effectiveDate is required (YYYY-MM-DD)" });
      }

      const adjustment = await storage.createTherapistAdjustment({
        therapistId: tId,
        adjustmentType,
        amount: amt,
        description: desc,
        effectiveDate: date,
        createdBy: req.user!.id,
      });

      await db.insert(auditLogs).values({
        userId: req.user!.id,
        username: req.user!.username,
        action: 'therapist_adjustment_created',
        result: 'success',
        resourceType: 'therapist_adjustment',
        resourceId: String(adjustment.id),
        details: JSON.stringify({
          therapistId: tId,
          adjustmentType,
          amount: amt,
          effectiveDate: date,
          description: desc,
        }),
        ipAddress: req.ip || null,
        userAgent: req.get('user-agent') || null,
      });

      res.status(201).json(adjustment);
    } catch (error: any) {
      const msg = error?.message || "Internal server error";
      if (msg === 'Amount must be greater than zero') return res.status(400).json({ message: msg });
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Void a manual adjustment (excluded from all balances afterwards).
  app.post("/api/therapist-pay/adjustments/:id/void", requireAuth, requireTherapistPayAccess, async (req: AuthenticatedRequest, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid adjustment ID" });
      const reason = (req.body?.reason || '').toString().trim();
      if (!reason) return res.status(400).json({ message: "A reason is required to void an adjustment" });

      const adjustment = await storage.voidTherapistAdjustment(id, req.user!.id, reason);

      await db.insert(auditLogs).values({
        userId: req.user!.id,
        username: req.user!.username,
        action: 'therapist_adjustment_voided',
        result: 'success',
        resourceType: 'therapist_adjustment',
        resourceId: String(id),
        details: JSON.stringify({ therapistId: adjustment.therapistId, reason }),
        ipAddress: req.ip || null,
        userAgent: req.get('user-agent') || null,
      });

      res.json(adjustment);
    } catch (error: any) {
      const msg = error?.message || "Internal server error";
      if (msg === 'Adjustment not found') return res.status(404).json({ message: msg });
      if (msg === 'Adjustment is already voided') return res.status(400).json({ message: msg });
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // "Needs attention" summary across therapists with pay activity (read-only).
  app.get("/api/therapist-pay/attention", requireAuth, requireTherapistPayAccess, async (req: AuthenticatedRequest, res) => {
    try {
      const attention = await storage.getTherapistPayAttention();
      res.json(attention);
    } catch (error) {
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Audit a statement / monthly-report export (CSV or print/PDF) by an admin.
  app.post("/api/therapist-pay/export-audit", requireAuth, requireTherapistPayAccess, async (req: AuthenticatedRequest, res) => {
    try {
      const { therapistId, reportType, format, month } = req.body || {};
      const tId = parseInt(String(therapistId));
      if (isNaN(tId)) return res.status(400).json({ message: "Invalid therapist ID" });
      const type = reportType === 'monthly' ? 'monthly' : 'statement';
      const fmt = format === 'pdf' || format === 'print' ? 'pdf' : 'csv';

      await db.insert(auditLogs).values({
        userId: req.user!.id,
        username: req.user!.username,
        action: 'therapist_statement_exported',
        result: 'success',
        resourceType: 'therapist_payout',
        resourceId: String(tId),
        details: JSON.stringify({
          therapistId: tId,
          reportType: type,
          format: fmt,
          month: typeof month === 'string' ? month : null,
        }),
        ipAddress: req.ip || null,
        userAgent: req.get('user-agent') || null,
      });

      res.json({ ok: true });
    } catch (error) {
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // ===================================================================
  // INSURANCE STATEMENT RECONCILIATION (admin + billing only)
  // ===================================================================
  const insuranceUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 15 * 1024 * 1024 }, // 15MB
    fileFilter: (_req, file, cb) => {
      const name = (file.originalname || '').toLowerCase();
      const ok =
        name.endsWith('.pdf') ||
        name.endsWith('.xlsx') ||
        name.endsWith('.xls') ||
        name.endsWith('.csv') ||
        name.endsWith('.txt') ||
        name.endsWith('.docx');
      if (ok) {
        cb(null, true);
      } else {
        cb(new Error('Please upload a PDF, Excel (.xlsx/.xls), or CSV file.'));
      }
    },
  });

  // Multer runs before the route handler, so its errors (file too large, wrong
  // type) bypass the route's try/catch. Wrap it to always return clean JSON with
  // a clear message instead of a generic 500 / cut-off response.
  const insuranceUploadSingle = (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction,
  ) => {
    insuranceUpload.single('file')(req, res, (err: any) => {
      if (err) {
        if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
          return res.status(413).json({
            message:
              "This file is too large (max 15 MB). Please split a long statement into smaller files and upload them separately.",
          });
        }
        return res.status(400).json({
          message: err.message || "Could not read the uploaded file.",
        });
      }
      next();
    });
  };

  // Upload an insurance statement: extract its lines (AI for PDF, direct parse
  // for Excel/CSV), persist, and auto-match each line to a session billing.
  app.post(
    "/api/insurance/statements",
    requireAuth,
    requireTherapistPayAccess,
    insuranceUploadSingle,
    async (req: AuthenticatedRequest, res) => {
      try {
        if (!req.file) return res.status(400).json({ message: "No file uploaded" });
        const { buffer, originalname, mimetype } = req.file;

        let parsed;
        try {
          parsed = await parseInsuranceUpload(buffer, mimetype, originalname);
        } catch (e: any) {
          return res.status(422).json({ message: e?.message || "Could not read the uploaded file." });
        }
        const { sourceType, extracted } = parsed;
        if (!extracted.lines.length) {
          return res.status(422).json({
            message: "No payment lines could be read from this file. Please check the file and try again.",
          });
        }

        // Guard against amounts that exceed the money columns' capacity. Line
        // money columns are decimal(10,2) -> max 99,999,999.99; the statement
        // total is decimal(12,2) -> max 9,999,999,999.99. A value beyond these is
        // almost always a misread column (e.g. an account or claim number read as
        // a dollar amount). Fail with a clear, specific message instead of letting
        // Postgres throw a generic "numeric field overflow" 500. We never silently
        // clamp a money value — that would corrupt the financial record.
        const LINE_MONEY_MAX = 99999999.99;
        const STATEMENT_TOTAL_MAX = 9999999999.99;
        const overLimit = (v: number | null | undefined, max: number) =>
          v != null && Number.isFinite(v) && Math.abs(v) > max;
        const fmtMoney = (v: number | null | undefined) =>
          v == null
            ? "—"
            : `$${Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
        const badLineIdx = extracted.lines.findIndex(
          (l) =>
            overLimit(l.billedAmount, LINE_MONEY_MAX) ||
            overLimit(l.allowedAmount, LINE_MONEY_MAX) ||
            overLimit(l.insurancePaidAmount, LINE_MONEY_MAX) ||
            overLimit(l.patientResponsibility, LINE_MONEY_MAX),
        );
        if (badLineIdx !== -1) {
          const l = extracted.lines[badLineIdx];
          const who = l.clientName ? `"${l.clientName}"` : `row ${badLineIdx + 1}`;
          const amounts = [
            overLimit(l.billedAmount, LINE_MONEY_MAX) ? `billed ${fmtMoney(l.billedAmount)}` : null,
            overLimit(l.allowedAmount, LINE_MONEY_MAX) ? `allowed ${fmtMoney(l.allowedAmount)}` : null,
            overLimit(l.insurancePaidAmount, LINE_MONEY_MAX) ? `paid ${fmtMoney(l.insurancePaidAmount)}` : null,
            overLimit(l.patientResponsibility, LINE_MONEY_MAX)
              ? `patient responsibility ${fmtMoney(l.patientResponsibility)}`
              : null,
          ]
            .filter(Boolean)
            .join(", ");
          return res.status(422).json({
            message: `An amount in this file is too large to be a real payment (${who}: ${amounts}). This usually means a column such as an account or claim number was read as money. Please check the amount columns in the file and try again.`,
          });
        }
        if (overLimit(extracted.totalPaid, STATEMENT_TOTAL_MAX)) {
          return res.status(422).json({
            message: `The statement's total paid amount (${fmtMoney(extracted.totalPaid)}) is too large to record. Please check the file's amount columns and try again.`,
          });
        }

        // Flag a likely re-upload so it can't be posted twice by accident. The
        // caller can re-send with force=true to upload it anyway.
        const force = req.body?.force === 'true' || req.body?.force === true;
        if (!force) {
          const duplicate = await storage.findDuplicateStatement({
            payerName: extracted.payerName ?? null,
            statementDate: extracted.statementDate ?? null,
            totalPaid: extracted.totalPaid != null ? extracted.totalPaid.toFixed(2) : null,
            checkNumber: extracted.checkNumber ?? null,
            lineCount: extracted.lines.length,
          });
          if (duplicate) {
            return res.status(200).json({ duplicate });
          }
        }

        // Optional: assign the one therapist this statement belongs to. Sent as a
        // multipart form field; ignore anything that isn't a positive integer.
        const therapistIdRaw = req.body?.therapistId;
        const parsedTherapistId =
          therapistIdRaw != null && therapistIdRaw !== ''
            ? parseInt(String(therapistIdRaw), 10)
            : NaN;
        let therapistId: number | null = null;
        if (Number.isInteger(parsedTherapistId) && parsedTherapistId > 0) {
          const therapistUser = await storage.getUser(parsedTherapistId);
          if (!therapistUser || therapistUser.role !== 'therapist') {
            return res.status(400).json({ message: "Selected user is not a therapist" });
          }
          therapistId = parsedTherapistId;
        }

        const statement = await storage.createInsuranceStatement(
          {
            fileName: originalname,
            fileBlobName: null,
            sourceType,
            payerName: extracted.payerName,
            checkNumber: extracted.checkNumber,
            statementDate: extracted.statementDate,
            totalPaid: extracted.totalPaid != null ? extracted.totalPaid.toFixed(2) : null,
            status: 'draft',
            therapistId,
            uploadedBy: req.user!.id,
          },
          extracted.lines.map((l) => ({
            serviceDate: l.serviceDate,
            clientNameRaw: l.clientName,
            serviceCode: l.serviceCode,
            billedAmount: l.billedAmount != null ? l.billedAmount.toFixed(2) : null,
            allowedAmount: l.allowedAmount != null ? l.allowedAmount.toFixed(2) : null,
            insurancePaidAmount: (l.insurancePaidAmount ?? 0).toFixed(2),
            patientResponsibility: l.patientResponsibility != null ? l.patientResponsibility.toFixed(2) : null,
            remarkCode: l.remarkCode,
            rawText: JSON.stringify(l),
          })),
        );

        await db.insert(auditLogs).values({
          userId: req.user!.id,
          username: req.user!.username,
          action: 'insurance_statement_uploaded',
          result: 'success',
          resourceType: 'insurance_statement',
          resourceId: String(statement.id),
          details: JSON.stringify({
            sourceType,
            fileName: originalname,
            lineCount: extracted.lines.length,
            payerName: extracted.payerName,
          }),
          ipAddress: req.ip || null,
          userAgent: req.get('user-agent') || null,
        });

        const detail = await storage.getInsuranceStatementById(statement.id);
        res.status(201).json(detail);
      } catch (error: any) {
        res.status(500).json({ message: error?.message || "Internal server error" });
      }
    },
  );

  // List uploaded statements with rolled-up counts.
  app.get("/api/insurance/statements", requireAuth, requireTherapistPayAccess, async (_req: AuthenticatedRequest, res) => {
    try {
      const statements = await storage.getInsuranceStatements();
      res.json(statements);
    } catch (error) {
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Flat list of every statement line across all statements, for the
  // searchable/filterable "Transactions" tab.
  app.get("/api/insurance/transactions", requireAuth, requireTherapistPayAccess, async (_req: AuthenticatedRequest, res) => {
    try {
      const rows = await storage.getAllInsuranceLines();
      res.json(rows);
    } catch (error) {
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Assign (or clear) the single therapist a statement belongs to.
  app.patch("/api/insurance/statements/:id/therapist", requireAuth, requireTherapistPayAccess, async (req: AuthenticatedRequest, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid statement ID" });

      const raw = (req.body ?? {}).therapistId;
      let therapistId: number | null = null;
      if (raw != null && raw !== '') {
        const parsed = parseInt(String(raw), 10);
        if (!Number.isInteger(parsed) || parsed <= 0) {
          return res.status(400).json({ message: "Invalid therapist ID" });
        }
        const user = await storage.getUser(parsed);
        if (!user || user.role !== 'therapist') {
          return res.status(400).json({ message: "Selected user is not a therapist" });
        }
        therapistId = parsed;
      }

      const detail = await storage.updateInsuranceStatementTherapist(id, therapistId);

      await db.insert(auditLogs).values({
        userId: req.user!.id,
        username: req.user!.username,
        action: 'insurance_statement_therapist_assigned',
        result: 'success',
        resourceType: 'insurance_statement',
        resourceId: String(id),
        details: JSON.stringify({ therapistId }),
        ipAddress: req.ip || null,
        userAgent: req.get('user-agent') || null,
      });

      res.json(detail);
    } catch (error: any) {
      const msg = error?.message || "Internal server error";
      if (msg.includes('not found')) return res.status(404).json({ message: msg });
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Statement detail with each line and what it matched to.
  app.get("/api/insurance/statements/:id", requireAuth, requireTherapistPayAccess, async (req: AuthenticatedRequest, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid statement ID" });
      const detail = await storage.getInsuranceStatementById(id);
      if (!detail) return res.status(404).json({ message: "Statement not found" });
      res.json(detail);
    } catch (error) {
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Re-run auto-matching for a statement's still-unconfirmed lines.
  app.post("/api/insurance/statements/:id/rematch", requireAuth, requireTherapistPayAccess, async (req: AuthenticatedRequest, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid statement ID" });
      await storage.autoMatchStatementLines(id);
      const detail = await storage.getInsuranceStatementById(id);
      if (!detail) return res.status(404).json({ message: "Statement not found" });
      res.json(detail);
    } catch (error: any) {
      const msg = error?.message || "Internal server error";
      if (msg.includes('not found')) return res.status(404).json({ message: msg });
      if (msg.includes('Cannot')) return res.status(400).json({ message: msg });
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Update one line's match (confirm / repoint / clear / skip).
  app.patch("/api/insurance/lines/:id", requireAuth, requireTherapistPayAccess, async (req: AuthenticatedRequest, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid line ID" });
      const { matchStatus, matchedSessionBillingId } = req.body || {};
      const allowed = ['unmatched', 'suggested', 'confirmed', 'skipped'];
      if (!allowed.includes(matchStatus)) {
        return res.status(400).json({ message: "Invalid matchStatus" });
      }
      let billingId: number | null | undefined = undefined;
      if (matchedSessionBillingId !== undefined) {
        billingId = matchedSessionBillingId === null ? null : parseInt(String(matchedSessionBillingId));
        if (billingId !== null && isNaN(billingId)) {
          return res.status(400).json({ message: "Invalid matchedSessionBillingId" });
        }
      }
      const updated = await storage.updateStatementLineMatch(id, {
        matchStatus,
        matchedSessionBillingId: billingId,
      });
      res.json(updated);
    } catch (error: any) {
      const msg = error?.message || "Internal server error";
      if (msg.includes('not found')) return res.status(404).json({ message: msg });
      if (msg.includes('Cannot') || msg.includes('confirm')) return res.status(400).json({ message: msg });
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Post the confirmed lines as insurance payments.
  app.post("/api/insurance/statements/:id/post", requireAuth, requireTherapistPayAccess, async (req: AuthenticatedRequest, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid statement ID" });
      const result = await storage.postInsuranceStatement(id, req.user!.id);

      await db.insert(auditLogs).values({
        userId: req.user!.id,
        username: req.user!.username,
        action: 'insurance_statement_posted',
        result: 'success',
        resourceType: 'insurance_statement',
        resourceId: String(id),
        details: JSON.stringify({ postedCount: result.postedCount, postedTotal: result.postedTotal, skippedDuplicates: result.skippedDuplicates }),
        ipAddress: req.ip || null,
        userAgent: req.get('user-agent') || null,
      });

      const detail = await storage.getInsuranceStatementById(id);
      res.json({ ...detail, postedCount: result.postedCount, postedTotal: result.postedTotal, skippedDuplicates: result.skippedDuplicates });
    } catch (error: any) {
      const msg = error?.message || "Internal server error";
      if (msg.includes('not found')) return res.status(404).json({ message: msg });
      if (msg.includes('Cannot')) return res.status(400).json({ message: msg });
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Void a posted statement (reverses every posted insurance payment).
  app.post("/api/insurance/statements/:id/void", requireAuth, requireTherapistPayAccess, async (req: AuthenticatedRequest, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid statement ID" });
      const reason = (req.body?.reason || '').toString().trim();
      if (!reason) return res.status(400).json({ message: "A reason is required to void a statement" });

      const statement = await storage.voidInsuranceStatement(id, req.user!.id, reason);

      await db.insert(auditLogs).values({
        userId: req.user!.id,
        username: req.user!.username,
        action: 'insurance_statement_voided',
        result: 'success',
        resourceType: 'insurance_statement',
        resourceId: String(id),
        details: JSON.stringify({ reason }),
        ipAddress: req.ip || null,
        userAgent: req.get('user-agent') || null,
      });

      const detail = await storage.getInsuranceStatementById(id);
      res.json(detail ?? statement);
    } catch (error: any) {
      const msg = error?.message || "Internal server error";
      if (msg.includes('not found')) return res.status(404).json({ message: msg });
      if (msg.includes('already voided')) return res.status(400).json({ message: msg });
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Re-open a voided statement so it can be fixed and re-posted (lines back to
  // 'confirmed', void fields cleared, status returned to a re-postable 'draft').
  app.post("/api/insurance/statements/:id/reopen", requireAuth, requireTherapistPayAccess, async (req: AuthenticatedRequest, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid statement ID" });

      const statement = await storage.reopenInsuranceStatement(id, req.user!.id);

      await db.insert(auditLogs).values({
        userId: req.user!.id,
        username: req.user!.username,
        action: 'insurance_statement_reopened',
        result: 'success',
        resourceType: 'insurance_statement',
        resourceId: String(id),
        details: JSON.stringify({ previousVoidReason: statement.voidReason ?? null }),
        ipAddress: req.ip || null,
        userAgent: req.get('user-agent') || null,
      });

      const detail = await storage.getInsuranceStatementById(id);
      res.json(detail ?? statement);
    } catch (error: any) {
      const msg = error?.message || "Internal server error";
      if (msg.includes('not found')) return res.status(404).json({ message: msg });
      if (msg.includes('Only a voided')) return res.status(400).json({ message: msg });
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Permanently delete a statement. Allowed only when it is NOT posted (draft or
  // voided) — a posted statement must be voided first so its payments are
  // reversed before it can be removed.
  app.delete("/api/insurance/statements/:id", requireAuth, requireTherapistPayAccess, async (req: AuthenticatedRequest, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid statement ID" });

      const existing = await storage.getInsuranceStatementById(id);
      await storage.deleteInsuranceStatement(id);

      await db.insert(auditLogs).values({
        userId: req.user!.id,
        username: req.user!.username,
        action: 'insurance_statement_deleted',
        result: 'success',
        resourceType: 'insurance_statement',
        resourceId: String(id),
        details: JSON.stringify({
          fileName: existing?.statement?.fileName ?? null,
          status: existing?.statement?.status ?? null,
        }),
        ipAddress: req.ip || null,
        userAgent: req.get('user-agent') || null,
      });

      res.json({ success: true });
    } catch (error: any) {
      const msg = error?.message || "Internal server error";
      if (msg.includes('not found')) return res.status(404).json({ message: msg });
      if (msg.includes('must be voided')) return res.status(400).json({ message: msg });
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Get filtered services based on user role
  app.get("/api/services/filtered", requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const userRole = req.user?.role || 'therapist';
      const services = await storage.getServicesFiltered(userRole);
      res.json(services);
    } catch (error) {
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Update service visibility (admin only)
  app.put("/api/services/:id/visibility", requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      // Check if user is admin
      if (req.user?.role !== 'administrator' && req.user?.role !== 'admin') {
        return res.status(403).json({ message: "Access denied. Admin privileges required." });
      }

      const serviceId = parseInt(req.params.id);
      if (isNaN(serviceId)) {
        return res.status(400).json({ message: "Invalid service ID" });
      }

      // Validate request body with Zod
      const visibilitySchema = z.object({
        therapistVisible: z.boolean()
      });
      
      const validatedData = visibilitySchema.parse(req.body);
      const service = await storage.updateServiceVisibility(serviceId, validatedData.therapistVisible);
      res.json(service);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid request body", errors: error.errors });
      }
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Room Management API
  app.get("/api/rooms", async (req, res) => {
    try {
      const rooms = await storage.getRooms();
      res.json(rooms);
    } catch (error) {
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post("/api/rooms", async (req, res) => {
    try {
      const validatedData = insertRoomSchema.parse(req.body);
      const room = await storage.createRoom(validatedData);
      res.status(201).json(room);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid room data", errors: error.errors });
      }
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Update room
  app.put("/api/rooms/:id", async (req, res) => {
    try {
      const roomId = parseInt(req.params.id);
      if (isNaN(roomId)) {
        return res.status(400).json({ message: "Invalid room ID" });
      }

      const updateData = req.body;
      const room = await storage.updateRoom(roomId, updateData);
      res.json(room);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid room data", errors: error.errors });
      }
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Delete room
  app.delete("/api/rooms/:id", async (req, res) => {
    try {
      const roomId = parseInt(req.params.id);
      if (isNaN(roomId)) {
        return res.status(400).json({ message: "Invalid room ID" });
      }

      await storage.deleteRoom(roomId);
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Room Availability Check
  app.get("/api/rooms/availability", async (req, res) => {
    try {
      const { date, startTime, endTime, excludeSessionId } = req.query;
      
      if (!date || !startTime || !endTime) {
        return res.status(400).json({ message: "Date, start time, and end time are required" });
      }
      
      const availability = await storage.checkRoomAvailability(
        date as string,
        startTime as string,
        endTime as string,
        excludeSessionId ? parseInt(excludeSessionId as string) : undefined
      );
      
      res.json(availability);
    } catch (error) {
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Enhanced Session Management with Billing
  app.put("/api/sessions/:id/status", requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const sessionId = parseInt(req.params.id);
      const { status } = req.body;
      
      if (isNaN(sessionId)) {
        return res.status(400).json({ message: "Invalid session ID" });
      }
      
      // Update session status
      const updatedSession = await storage.updateSessionStatus(sessionId, status);
      
      // Trigger billing when session is completed or no_show
      if (status === 'completed' || status === 'no_show') {
        try {
          // Check if billing already exists
          const existingBilling = await storage.getSessionBilling(sessionId);
          if (!existingBilling) {
            await storage.createSessionBilling(sessionId);
          }
        } catch (billingError) {
          // Continue with session update even if billing fails
        }
      }
      
      res.json(updatedSession);
    } catch (error) {
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Session Billing API
  app.get("/api/sessions/:id/billing", requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      if (!req.user) {
        return res.status(401).json({ message: "Authentication required" });
      }
      
      const sessionId = parseInt(req.params.id);
      
      if (isNaN(sessionId)) {
        return res.status(400).json({ message: "Invalid session ID" });
      }
      
      // Check if user can access this session (via service visibility)
      const includeHiddenServices = req.user.role === 'admin';
      const sessionResults = await storage.getSessionsWithFiltering({
        includeHiddenServices,
        page: 1,
        limit: 1000
      });
      
      // Check if the requested session is in the filtered results
      const hasAccess = sessionResults.sessions.some(session => session.id === sessionId);
      if (!hasAccess) {
        return res.status(404).json({ message: "Session not found" });
      }
      
      const billing = await storage.getSessionBilling(sessionId);
      res.json(billing);
    } catch (error) {
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post("/api/sessions/:id/billing", requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      if (!req.user) {
        return res.status(401).json({ message: "Authentication required" });
      }
      
      const sessionId = parseInt(req.params.id);
      
      if (isNaN(sessionId)) {
        return res.status(400).json({ message: "Invalid session ID" });
      }
      
      // Check if user can access this session (via service visibility)
      const includeHiddenServices = req.user.role === 'admin';
      const sessionResults = await storage.getSessionsWithFiltering({
        includeHiddenServices,
        page: 1,
        limit: 1000
      });
      
      // Check if the requested session is in the filtered results
      const hasAccess = sessionResults.sessions.some(session => session.id === sessionId);
      if (!hasAccess) {
        return res.status(404).json({ message: "Session not found" });
      }
      
      const billing = await storage.createSessionBilling(sessionId);
      res.json(billing);
    } catch (error) {
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/billing/reports", requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      if (!req.user) return res.status(401).json({ message: "Authentication required" });
      const { startDate, endDate, therapistId, status, serviceCode, clientSearch, clientType, sessionStatus } = req.query;

      let resolvedTherapistId: number | undefined;
      let supervisedTherapistIds: number[] | undefined;

      if (req.user.role === "supervisor") {
        const assignments = await storage.getSupervisorAssignments(req.user.id);
        if (assignments.length === 0) return res.json([]);
        supervisedTherapistIds = assignments.map(a => a.therapistId);
        // Allow supervisor to further filter by one of their therapists
        if (therapistId && therapistId !== 'all') {
          const tid = parseInt(therapistId as string);
          if (supervisedTherapistIds.includes(tid)) {
            supervisedTherapistIds = [tid];
          }
        }
      } else if (req.user.role === "therapist") {
        resolvedTherapistId = req.user.id;
      } else {
        // admin / accountant: use the UI filter if provided
        resolvedTherapistId = therapistId ? parseInt(therapistId as string) : undefined;
      }

      let reports = await storage.getBillingReports({
        startDate: startDate as string,
        endDate: endDate as string,
        therapistId: resolvedTherapistId,
        supervisedTherapistIds,
        status: status as string,
        serviceCode: serviceCode as string,
        clientSearch: clientSearch as string,
        clientType: clientType as string,
        sessionStatus: sessionStatus as string
      });
      
      // Redact client names for accountant role
      if (req.user.role === "accountant" && Array.isArray(reports)) {
        reports = reports.map((r: any) => redactBillingClient(r));
      }
      
      res.json(reports);
    } catch (error) {
      console.error('Billing reports error:', error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Billing routes
  app.get("/api/sessions/:sessionId/billing", requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      if (!req.user) {
        return res.status(401).json({ message: "Authentication required" });
      }
      
      const sessionId = parseInt(req.params.sessionId);
      
      // Check if user can access this session (via service visibility)
      const includeHiddenServices = req.user.role === 'admin';
      const sessionResults = await storage.getSessionsWithFiltering({
        includeHiddenServices,
        page: 1,
        limit: 1000
      });
      
      // Check if the requested session is in the filtered results
      const hasAccess = sessionResults.sessions.some(session => session.id === sessionId);
      if (!hasAccess) {
        return res.status(404).json({ message: "Session not found" });
      }
      
      const billing = await storage.getBillingRecordsBySession(sessionId);
      res.json(billing);
    } catch (error) {
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/clients/:clientId/billing", requireAuth, blockAccountant, async (req: AuthenticatedRequest, res) => {
    try {
      const clientId = parseInt(req.params.clientId);
      
      // Role-based authorization: therapists can only view billing for their assigned clients
      if (req.user && req.user.role === 'therapist') {
        const client = await storage.getClient(clientId);
        if (!client) {
          return res.status(404).json({ message: "Client not found" });
        }
        if (client.assignedTherapistId !== req.user.id) {
          return res.status(403).json({ message: "Access denied. You can only view billing for your assigned clients." });
        }
      } else if (req.user && req.user.role === 'supervisor') {
        // Supervisors can only view billing for clients of therapists they supervise
        const client = await storage.getClient(clientId);
        if (!client) {
          return res.status(404).json({ message: "Client not found" });
        }
        const supervisorAssignments = await storage.getSupervisorAssignments(req.user.id);
        const supervisedTherapistIds = supervisorAssignments.map(a => a.therapistId);
        if (client.assignedTherapistId && !supervisedTherapistIds.includes(client.assignedTherapistId)) {
          return res.status(403).json({ message: "Access denied. You can only view billing for clients of therapists you supervise." });
        }
      }
      // Administrators can view all billing (no restriction)
      
      const billing = await storage.getBillingRecordsByClient(clientId);
      res.json(billing);
    } catch (error) {
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Per-client SMS activity log. Reads the audit_logs rows that auditSms()
  // writes for every appointment text attempt (sent / failed / blocked) so
  // staff can confirm a reminder went out or see why it didn't. PHI-safe:
  // returns only outcome + reason, no message body or phone number.
  app.get("/api/clients/:id/sms-log", requireAuth, blockAccountant, auditClientAccess('client_viewed'), async (req: AuthenticatedRequest, res) => {
    try {
      if (!req.user) {
        return res.status(401).json({ message: "Authentication required" });
      }

      const clientId = parseInt(req.params.id);
      if (!Number.isFinite(clientId)) {
        return res.status(400).json({ message: "Invalid client id" });
      }

      const client = await storage.getClient(clientId);
      if (!client) {
        return res.status(404).json({ message: "Client not found" });
      }

      // Optional filters: outcome (sent/blocked/failed) and a date range.
      // These only narrow which audit rows are returned — they never expose
      // anything beyond the outcome/timestamp/reason already shown in the log.
      const conditions = [
        eq(auditLogs.resourceType, "sms_notification"),
        eq(auditLogs.clientId, clientId),
      ];

      const outcomeParam =
        typeof req.query.outcome === "string"
          ? req.query.outcome.toLowerCase()
          : null;
      // Map the staff-facing outcome label to the stored audit result value.
      const outcomeToResult: Record<string, string> = {
        sent: "success",
        blocked: "blocked",
        failed: "failure",
      };
      if (outcomeParam && outcomeParam !== "all") {
        const mappedResult = outcomeToResult[outcomeParam];
        if (!mappedResult) {
          return res.status(400).json({ message: "Invalid outcome filter" });
        }
        conditions.push(eq(auditLogs.result, mappedResult as any));
      }

      const parseDateParam = (value: unknown): Date | null => {
        if (typeof value !== "string" || !value.trim()) return null;
        const parsed = new Date(value);
        return Number.isNaN(parsed.getTime()) ? null : parsed;
      };

      if (req.query.startDate !== undefined) {
        const startDate = parseDateParam(req.query.startDate);
        if (!startDate) {
          return res.status(400).json({ message: "Invalid startDate" });
        }
        conditions.push(gte(auditLogs.timestamp, startDate));
      }

      if (req.query.endDate !== undefined) {
        const endDate = parseDateParam(req.query.endDate);
        if (!endDate) {
          return res.status(400).json({ message: "Invalid endDate" });
        }
        // Treat endDate as inclusive of the whole day when no time is given.
        if (!/[T:]/.test(String(req.query.endDate))) {
          endDate.setHours(23, 59, 59, 999);
        }
        conditions.push(lte(auditLogs.timestamp, endDate));
      }

      // Optional free-text search. It only matches the same non-PHI fields the
      // UI already renders — the event type and the blocked/failed reason. We
      // deliberately match in JS against the parsed values (never the raw
      // details JSON) so the message body and phone number can never be matched.
      const searchTerm =
        typeof req.query.search === "string"
          ? req.query.search.trim().toLowerCase()
          : "";

      // The visible log shows the most recent 100 attempts. When a search is
      // active we scan a larger window so busy clients can still find older
      // matches, then cap the returned results back to 100.
      const RESULT_LIMIT = 100;
      const fetchLimit = searchTerm ? 1000 : RESULT_LIMIT;

      const rows = await db
        .select({
          id: auditLogs.id,
          action: auditLogs.action,
          result: auditLogs.result,
          details: auditLogs.details,
          timestamp: auditLogs.timestamp,
        })
        .from(auditLogs)
        .where(and(...conditions))
        .orderBy(desc(auditLogs.timestamp))
        .limit(fetchLimit);

      const mapped = rows.map((row) => {
        let eventType: string | null = null;
        let reason: string | null = null;
        try {
          const parsed = row.details ? JSON.parse(row.details) : {};
          eventType = typeof parsed.eventType === "string" ? parsed.eventType : null;
          // Surface a human-readable explanation depending on outcome. We never
          // expose the message body or phone number — only the reason a text was
          // blocked or the error that made a send fail.
          reason =
            (typeof parsed.reason === "string" && parsed.reason) ||
            (typeof parsed.error === "string" && parsed.error) ||
            null;
        } catch {
          // Malformed details JSON — leave eventType/reason null rather than fail.
        }
        return {
          id: row.id,
          action: row.action,
          result: row.result,
          eventType,
          reason,
          timestamp: row.timestamp,
        };
      });

      let entries = mapped;
      if (searchTerm) {
        entries = mapped.filter((entry) => {
          // Mirror the UI: a null eventType is shown as "Appointment text".
          const eventTypeText = (entry.eventType ?? "appointment text")
            .replace(/_/g, " ")
            .toLowerCase();
          const reasonText = (entry.reason ?? "").toLowerCase();
          return (
            eventTypeText.includes(searchTerm) ||
            reasonText.includes(searchTerm)
          );
        });
      }
      entries = entries.slice(0, RESULT_LIMIT);

      res.json(entries);
    } catch (error) {
      console.error("Error fetching client SMS log:", error);
      res.status(500).json({ message: "Failed to fetch SMS log" });
    }
  });

  // Export the currently filtered SMS log as CSV. This honors the same
  // outcome/date-range filters as GET /api/clients/:id/sms-log and emits only
  // the non-PHI fields already shown in the UI (outcome, event type, timestamp,
  // reason) — never the message body or phone number. The export is audit
  // logged via auditDataExport so client-data exports are tracked like other
  // sensitive access.
  app.get("/api/clients/:id/sms-log/export", requireAuth, blockAccountant, auditDataExport('client_sms_log'), async (req: AuthenticatedRequest, res) => {
    try {
      if (!req.user) {
        return res.status(401).json({ message: "Authentication required" });
      }

      const clientId = parseInt(req.params.id);
      if (!Number.isFinite(clientId)) {
        return res.status(400).json({ message: "Invalid client id" });
      }

      const client = await storage.getClient(clientId);
      if (!client) {
        return res.status(404).json({ message: "Client not found" });
      }

      const conditions = [
        eq(auditLogs.resourceType, "sms_notification"),
        eq(auditLogs.clientId, clientId),
      ];

      const outcomeParam =
        typeof req.query.outcome === "string"
          ? req.query.outcome.toLowerCase()
          : null;
      const outcomeToResult: Record<string, string> = {
        sent: "success",
        blocked: "blocked",
        failed: "failure",
      };
      if (outcomeParam && outcomeParam !== "all") {
        const mappedResult = outcomeToResult[outcomeParam];
        if (!mappedResult) {
          return res.status(400).json({ message: "Invalid outcome filter" });
        }
        conditions.push(eq(auditLogs.result, mappedResult as any));
      }

      const parseDateParam = (value: unknown): Date | null => {
        if (typeof value !== "string" || !value.trim()) return null;
        const parsed = new Date(value);
        return Number.isNaN(parsed.getTime()) ? null : parsed;
      };

      if (req.query.startDate !== undefined) {
        const startDate = parseDateParam(req.query.startDate);
        if (!startDate) {
          return res.status(400).json({ message: "Invalid startDate" });
        }
        conditions.push(gte(auditLogs.timestamp, startDate));
      }

      if (req.query.endDate !== undefined) {
        const endDate = parseDateParam(req.query.endDate);
        if (!endDate) {
          return res.status(400).json({ message: "Invalid endDate" });
        }
        if (!/[T:]/.test(String(req.query.endDate))) {
          endDate.setHours(23, 59, 59, 999);
        }
        conditions.push(lte(auditLogs.timestamp, endDate));
      }

      const rows = await db
        .select({
          result: auditLogs.result,
          details: auditLogs.details,
          timestamp: auditLogs.timestamp,
        })
        .from(auditLogs)
        .where(and(...conditions))
        .orderBy(desc(auditLogs.timestamp))
        .limit(100);

      const resultToOutcome: Record<string, string> = {
        success: "Sent",
        blocked: "Blocked",
        failure: "Failed",
      };

      const formatEventType = (eventType: string | null): string => {
        if (!eventType) return "Appointment text";
        return eventType
          .split("_")
          .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
          .join(" ");
      };

      // RFC-4180 style escaping: wrap in quotes and double any embedded quotes.
      const csvCell = (value: string): string => {
        const needsQuoting = /[",\n\r]/.test(value);
        const escaped = value.replace(/"/g, '""');
        return needsQuoting ? `"${escaped}"` : escaped;
      };

      const header = ["Outcome", "Event Type", "Timestamp", "Reason"];
      const lines = [header.map(csvCell).join(",")];

      for (const row of rows) {
        let eventType: string | null = null;
        let reason: string | null = null;
        try {
          const parsed = row.details ? JSON.parse(row.details) : {};
          eventType = typeof parsed.eventType === "string" ? parsed.eventType : null;
          reason =
            (typeof parsed.reason === "string" && parsed.reason) ||
            (typeof parsed.error === "string" && parsed.error) ||
            null;
        } catch {
          // Malformed details JSON — leave eventType/reason null.
        }
        const outcome = resultToOutcome[row.result as string] || String(row.result);
        const timestamp = row.timestamp ? new Date(row.timestamp).toISOString() : "";
        lines.push(
          [
            csvCell(outcome),
            csvCell(formatEventType(eventType)),
            csvCell(timestamp),
            csvCell(reason || ""),
          ].join(","),
        );
      }

      // Prepend a UTF-8 BOM so Excel opens the file with correct encoding.
      const csv = "\uFEFF" + lines.join("\r\n") + "\r\n";
      const filename = `sms-log-client-${clientId}-${new Date().toISOString().slice(0, 10)}.csv`;

      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${filename}"`,
      );
      res.setHeader("X-Export-Row-Count", String(rows.length));
      res.setHeader(
        "Access-Control-Expose-Headers",
        "X-Export-Row-Count",
      );
      res.send(csv);
    } catch (error) {
      console.error("Error exporting client SMS log:", error);
      res.status(500).json({ message: "Failed to export SMS log" });
    }
  });

  app.get("/api/clients/:clientId/communications", requireAuth, blockAccountant, async (req: AuthenticatedRequest, res) => {
    try {
      if (!req.user) {
        return res.status(401).json({ message: "Authentication required" });
      }

      const clientId = parseInt(req.params.clientId);
      
      // Get client to verify access
      const client = await storage.getClient(clientId);
      if (!client) {
        return res.status(404).json({ message: "Client not found" });
      }

      // Fetch notifications related to this client
      // Look for notifications where relatedEntityType='client' OR notifications for sessions of this client
      const { notifications: notificationsTable } = await import("@shared/schema");
      
      const clientNotifications = await db
        .select()
        .from(notificationsTable)
        .where(
          and(
            eq(notificationsTable.relatedEntityType, 'client' as any),
            eq(notificationsTable.relatedEntityId, clientId)
          )
        )
        .orderBy(desc(notificationsTable.createdAt))
        .limit(100);

      // Also get session-related notifications for this client's sessions
      const clientSessions = await storage.getSessionsByClient(clientId, true);
      const sessionIds = clientSessions.map((s: any) => s.id);

      let sessionNotifications: any[] = [];
      if (sessionIds.length > 0) {
        const { inArray } = await import("drizzle-orm");
        sessionNotifications = await db
          .select()
          .from(notificationsTable)
          .where(
            and(
              eq(notificationsTable.relatedEntityType, 'session' as any),
              inArray(notificationsTable.relatedEntityId, sessionIds)
            )
          )
          .orderBy(desc(notificationsTable.createdAt))
          .limit(100);
      }

      // Also get billing/invoice-related notifications for this client
      const billingRecords = await storage.getBillingRecordsByClient(clientId);
      const billingIds = billingRecords.map((b: any) => b.id);

      let billingNotifications: any[] = [];
      if (billingIds.length > 0) {
        const { inArray } = await import("drizzle-orm");
        billingNotifications = await db
          .select()
          .from(notificationsTable)
          .where(
            and(
              eq(notificationsTable.relatedEntityType, 'billing' as any),
              inArray(notificationsTable.relatedEntityId, billingIds)
            )
          )
          .orderBy(desc(notificationsTable.createdAt))
          .limit(100);
      }

      // Combine and sort all notifications
      const allNotifications = [...clientNotifications, ...sessionNotifications, ...billingNotifications]
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        .slice(0, 100); // Limit to 100 most recent

      // PHI safety: surface ONLY the safe display fields the communications log
      // needs. The raw `data` JSON payload can carry private detail (client
      // email, transmission ids, internal ids) and is never used by the client,
      // so it — along with other internal columns (userId, actionUrl, etc.) —
      // must never be echoed back. See test/communications-log-privacy.test.ts.
      const safeNotifications = allNotifications.map((n: any) => ({
        id: n.id,
        type: n.type,
        title: n.title,
        message: n.message,
        priority: n.priority,
        isRead: n.isRead,
        createdAt: n.createdAt,
        relatedEntityType: n.relatedEntityType,
        relatedEntityId: n.relatedEntityId,
      }));

      res.json(safeNotifications);
    } catch (error) {
      console.error("Error fetching client communications:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.patch("/api/billing/:billingId/status", requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      // Check if user has billing access
      if (req.user?.role !== 'administrator' && req.user?.role !== 'admin') {
        return res.status(403).json({ message: "Access denied. Admin privileges required." });
      }

      const billingId = parseInt(req.params.billingId);
      const { status } = req.body;
      
      if (!['pending', 'billed', 'paid', 'denied', 'refunded', 'follow_up'].includes(status)) {
        return res.status(400).json({ message: "Invalid billing status" });
      }
      
      // Get billing record to get client ID for audit
      const { sessionBilling } = await import("@shared/schema");
      const [billingRecord] = await db.select().from(sessionBilling).where(eq(sessionBilling.id, billingId));
      
      if (!billingRecord) {
        return res.status(404).json({ message: "Billing record not found" });
      }
      
      // Get session to get client ID
      const { sessions } = await import("@shared/schema");
      const [session] = await db.select().from(sessions).where(eq(sessions.id, billingRecord.sessionId));
      
      const oldStatus = billingRecord.paymentStatus;
      await storage.updateBillingStatus(billingId, status);
      
      // HIPAA Audit Log: Billing status changed
      if (session && req.user) {
        const { ipAddress, userAgent } = getRequestInfo(req);
        await AuditLogger.logBillingAccess(
          req.user.id,
          req.user.username,
          billingId,
          session.clientId,
          'billing_status_changed',
          ipAddress,
          userAgent,
          { oldStatus, newStatus: status, sessionId: session.id }
        );
      }
      
      res.json({ message: "Billing status updated successfully" });
    } catch (error) {
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Invoice Generation Routes
  app.post("/api/clients/:clientId/invoice", requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const clientId = parseInt(req.params.clientId);
      const { action, billingId } = req.body;
      
      if (!['download', 'print', 'email'].includes(action)) {
        return res.status(400).json({ message: "Invalid action. Use 'download', 'print', or 'email'" });
      }
      
      // Use centralized storage method for invoice data
      let billingRecords: any[];
      let client;
      let providerInfo = null;
      
      if (billingId) {
        // Get single billing record with all related data using centralized method
        const invoiceData = await storage.getBillingForInvoice(clientId, billingId);
        if (!invoiceData) {
          return res.status(404).json({ message: "Billing record not found" });
        }
        
        // Transform to match expected structure with nested session and service
        billingRecords = [{
          ...invoiceData.billing,
          session: invoiceData.session,
          service: invoiceData.service
        }];
        client = invoiceData.client;
        
        // Get provider info from the therapist who provided the service
        if (invoiceData.therapist) {
          const therapistProfile = await storage.getUserProfile(invoiceData.therapist.id);
          providerInfo = {
            name: invoiceData.therapist.fullName || 'Amjed Abojedi',
            credentials: therapistProfile?.licenseType || 'CRPO',
            license: therapistProfile?.licenseNumber || 'License not set in profile',
            licenseState: therapistProfile?.licenseState || 'ON',
            npi: 'Please update NPI in profile',
            experience: therapistProfile?.yearsOfExperience || 0,
            specializations: therapistProfile?.specializations || []
          };
        }
      } else {
        // Get all billing records for client
        client = await storage.getClient(clientId);
        if (!client) {
          return res.status(404).json({ message: "Client not found" });
        }
        
        billingRecords = await storage.getBillingRecordsByClient(clientId);
        if (billingRecords.length === 0) {
          return res.status(404).json({ message: "No billing records found for this client" });
        }
        
        // Get provider info from first record's therapist
        if (billingRecords.length > 0 && billingRecords[0].session?.therapistId) {
          const therapistProfile = await storage.getUserProfile(billingRecords[0].session.therapistId);
          const users = await storage.getUsers();
          const therapist = users.find((u: any) => u.id === billingRecords[0].session.therapistId);
          
          if (therapist) {
            providerInfo = {
              name: therapist.fullName || 'Amjed Abojedi',
              credentials: therapistProfile?.licenseType || 'CRPO',
              license: therapistProfile?.licenseNumber || 'License not set in profile',
              licenseState: therapistProfile?.licenseState || 'ON',
              npi: 'Please update NPI in profile',
              experience: therapistProfile?.yearsOfExperience || 0,
              specializations: therapistProfile?.specializations || []
            };
          }
        }
      }
      
      // Use default provider info if not found
      if (!providerInfo) {
        providerInfo = {
          name: 'Amjed Abojedi',
          credentials: 'CRPO',
          license: 'License not set in profile',
          licenseState: 'ON',
          npi: 'Please update NPI in your profile',
          experience: 0,
          specializations: []
        };
      }
      
      // Get practice settings with your actual business information
      let practiceSettings = {
        name: 'Resilience Counseling Research & Consultation',
        description: 'Licensed Mental Health Practice', 
        subtitle: 'Licensed Mental Health Practice',
        address: '111 Waterloo St Unit 406, London, ON N6B 2M4',
        phone: '+1 (548)866-0366',
        email: 'mail@resiliencec.com',
        website: 'www.resiliencec.com'
      };
      
      try {
        const practiceOptions = await storage.getSystemOptionsByCategory('practice_settings');
        practiceSettings.name = practiceOptions.find(o => o.optionKey === 'practice_name')?.optionLabel || practiceSettings.name;
        practiceSettings.description = practiceOptions.find(o => o.optionKey === 'practice_description')?.optionLabel || practiceSettings.description;
        practiceSettings.subtitle = practiceOptions.find(o => o.optionKey === 'practice_subtitle')?.optionLabel || practiceSettings.subtitle;
        practiceSettings.address = practiceOptions.find(o => o.optionKey === 'practice_address')?.optionLabel || practiceSettings.address;
        practiceSettings.phone = practiceOptions.find(o => o.optionKey === 'practice_phone')?.optionLabel || practiceSettings.phone;
        practiceSettings.email = practiceOptions.find(o => o.optionKey === 'practice_email')?.optionLabel || practiceSettings.email;
        practiceSettings.website = practiceOptions.find(o => o.optionKey === 'practice_website')?.optionLabel || practiceSettings.website;
      } catch (error) {
      }
      
      const subtotal = billingRecords.reduce((sum, record) => sum + Number(record.totalAmount || 0), 0);
      const totalDiscount = billingRecords.reduce((sum, record) => sum + Number(record.discountAmount || 0), 0);
      const isBillingInsured = (r: any) => {
        const hasKnownCopay = r.copayAmount != null && !isNaN(Number(r.copayAmount));
        return !!r.insuranceCovered || (hasKnownCopay && Number(r.copayAmount) > 0);
      };
      const hasInsurance = billingRecords.some(isBillingInsured);
      const insuranceCoverage = billingRecords.reduce((sum, record) => {
        const hasKnownCopay = record.copayAmount != null && !isNaN(Number(record.copayAmount));
        if (isBillingInsured(record) && hasKnownCopay) {
          const afterDiscount = Number(record.totalAmount || 0) - Number(record.discountAmount || 0);
          return sum + Math.max(afterDiscount - Number(record.copayAmount), 0);
        }
        return sum;
      }, 0);
      const copayTotal = billingRecords.reduce((sum, record) => {
        const hasKnownCopay = record.copayAmount != null && !isNaN(Number(record.copayAmount));
        if (isBillingInsured(record) && hasKnownCopay) {
          return sum + Number(record.copayAmount);
        }
        return sum;
      }, 0);
      const totalPayments = billingRecords.reduce((sum, record) => sum + Number(record.paymentAmount || 0), 0);
      const clientOwes = billingRecords.reduce((sum, record) => {
        const total = Number(record.totalAmount || 0);
        const discount = Number(record.discountAmount || 0);
        const afterDiscount = Math.max(total - discount, 0);
        return sum + afterDiscount;
      }, 0);
      const remainingDue = Math.max(clientOwes - totalPayments, 0);
      
      // Generate unique invoice number
      const invoiceNumber = billingId ? `INV-${client.clientId}-${billingId}` : `INV-${client.clientId}-${new Date().getFullYear()}`;
      
      // Calculate service date range from actual session dates
      let serviceDate = null;
      if (billingRecords.length === 1) {
        // Single service - use exact session date
        serviceDate = formatInTimeZone(new Date(billingRecords[0].session.sessionDate), 'America/New_York', 'MMM dd, yyyy');
      } else if (billingRecords.length > 1) {
        // Multiple services - show date range
        const dates = billingRecords.map(r => new Date(r.session.sessionDate)).sort((a, b) => a.getTime() - b.getTime());
        const startDate = formatInTimeZone(dates[0], 'America/New_York', 'MMM dd, yyyy');
        const endDate = formatInTimeZone(dates[dates.length - 1], 'America/New_York', 'MMM dd, yyyy');
        serviceDate = startDate === endDate ? startDate : `${startDate} - ${endDate}`;
      }
      
      const invoiceHtml = `
        <!DOCTYPE html>
        <html>
        <head>
          <title>Invoice - ${client.fullName}${billingId ? ` - ${billingRecords[0].serviceCode}` : ''}</title>
          <style>
            body { 
              font-family: 'Times New Roman', Times, serif; 
              margin: 40px; 
              font-size: 11pt;
              line-height: 1.4;
              color: #000000;
            }
            .header { display: flex; justify-content: space-between; margin-bottom: 40px; }
            .invoice-title { 
              font-size: 26px; 
              font-weight: bold; 
              color: #000000; 
              font-family: 'Times New Roman', Times, serif;
              text-transform: uppercase;
              letter-spacing: 1px;
            }
            .company-info { 
              text-align: right; 
              color: #333333;
              font-size: 10pt;
              line-height: 1.3;
              font-family: 'Times New Roman', Times, serif;
            }
            .company-info h3 {
              font-size: 13pt;
              font-weight: bold;
              color: #000000;
              margin-bottom: 8px;
              font-family: 'Times New Roman', Times, serif;
            }
            .client-info { display: flex; gap: 60px; margin-bottom: 40px; }
            .section-title { 
              font-size: 13pt; 
              font-weight: bold; 
              color: #000000; 
              margin-bottom: 12px;
              font-family: 'Times New Roman', Times, serif;
              text-transform: uppercase;
              border-bottom: 1px solid #000000;
              padding-bottom: 4px;
            }
            table { 
              width: 100%; 
              border-collapse: collapse; 
              margin-bottom: 30px;
              font-size: 10pt;
            }
            th, td { 
              border: 1px solid #000000; 
              padding: 10px 12px; 
              text-align: left;
              font-family: 'Times New Roman', Times, serif;
            }
            th { 
              background-color: #f5f5f5;
              font-weight: bold;
              color: #000000;
            }
            .totals { width: 300px; margin-left: auto; }
            .total-row { 
              display: flex; 
              justify-content: space-between; 
              margin-bottom: 8px;
              font-size: 10pt;
              font-family: 'Times New Roman', Times, serif;
            }
            .total-due { 
              font-weight: bold; 
              font-size: 13pt; 
              border-top: 2px solid #000000; 
              padding-top: 8px;
              color: #000000;
              font-family: 'Times New Roman', Times, serif;
            }
            .invoice-number {
              font-weight: bold;
              font-size: 11pt;
              font-family: 'Times New Roman', Times, serif;
            }
            @media print { 
              body { margin: 0.5in; font-size: 10pt; }
              .header { margin-bottom: 20px; }
              .invoice-title { font-size: 22pt; }
              .section-title { font-size: 11pt; }
              .client-info { margin-bottom: 20px; }
              table { font-size: 9pt; }
              th, td { padding: 8px; }
            }
          </style>
        </head>
        <body>
          <div class="header">
            <div>
              <h1 class="invoice-title">INVOICE</h1>
              <p>Invoice #: ${invoiceNumber}</p>
              <p>Date: ${formatInTimeZone(new Date(), 'America/New_York', 'MMM dd, yyyy')}</p>
              ${serviceDate ? `<p>Service Date: ${serviceDate}</p>` : ''}
            </div>
            <div class="company-info">
              <h3>${practiceSettings.name}</h3>
              <div style="margin-top: 10px; font-size: 0.9em;">
                <p>${practiceSettings.address.replace('\n', '<br>')}</p>
                <p>Phone: ${practiceSettings.phone}</p>
                <p>Email: ${practiceSettings.email}</p>
                <p>Website: ${practiceSettings.website}</p>
              </div>
            </div>
          </div>
          
          <div class="client-info">
            <div>
              <h3 class="section-title">Bill To:</h3>
              <p>${client.fullName}</p>
              <p>${client.address || ''}</p>
              <p>${client.phone || ''}</p>
              <p>${client.email || ''}</p>
            </div>
            <div>
              <h3 class="section-title">Insurance Info:</h3>
              <p>Provider: ${client.insuranceProvider || 'N/A'}</p>
              <p>Policy: ${client.policyNumber || 'N/A'}</p>
              <p>Group: ${client.groupNumber || 'N/A'}</p>
            </div>
          </div>
          
          <table>
            <thead>
              <tr>
                <th>Service</th>
                <th>CPT Code</th>
                <th>Date</th>
                <th style="text-align: right;">Amount</th>
              </tr>
            </thead>
            <tbody>
              ${billingRecords.map(record => `
                <tr>
                  <td>${record.service?.serviceName || 'Professional Service'}</td>
                  <td>${record.service?.serviceCode || record.serviceCode}</td>
                  <td>${formatInTimeZone(new Date(record.session.sessionDate), 'America/New_York', 'MMM dd, yyyy')}</td>
                  <td style="text-align: right;">$${Number(record.totalAmount).toFixed(2)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
          
          <div class="totals">
            <div class="total-row">
              <span>${billingRecords.length === 1 ? 'Service Amount:' : 'Subtotal:'}</span>
              <span>$${subtotal.toFixed(2)}</span>
            </div>
            ${totalDiscount > 0 ? `
            <div class="total-row" style="color: #059669;">
              <span>Discount Applied:</span>
              <span>-$${totalDiscount.toFixed(2)}</span>
            </div>` : ''}
            ${hasInsurance ? `
            <div class="total-row" style="color: #2563eb;">
              <span>Insurance Coverage:</span>
              <span>-$${insuranceCoverage.toFixed(2)}</span>
            </div>
            <div class="total-row">
              <span>Client Copay:</span>
              <span>$${copayTotal.toFixed(2)}</span>
            </div>` : ''}
            ${totalPayments > 0 ? `
            <div class="total-row">
              <span>Payments Received:</span>
              <span>-$${totalPayments.toFixed(2)}</span>
            </div>` : ''}
            <div class="total-row total-due">
              <span>Total Due:</span>
              <span style="${remainingDue === 0 ? 'color: #16a34a; font-weight: bold;' : ''}">
                $${remainingDue.toFixed(2)}
              </span>
            </div>
            ${remainingDue === 0 ? `
            <div class="total-row" style="color: #16a34a; font-weight: bold; margin-top: 10px;">
              <span>Status:</span>
              <span>✓ PAID IN FULL</span>
            </div>` : ''}
          </div>
          
          <div style="margin-top: 40px; padding: 20px; border-top: 2px solid #e2e8f0; background-color: #f8fafc; font-size: 12px; color: #64748b;">
            <h4 style="color: #1e293b; margin-bottom: 15px; font-size: 13px;">Provider Information for Insurance Reimbursement</h4>
            <div>
              <p><strong>Provider Name:</strong> ${providerInfo.name}</p>
              <p><strong>License Name:</strong> ${providerInfo.credentials}</p>
              <p><strong>License Number:</strong> ${providerInfo.license}</p>
            </div>
          </div>
        </body>
        </html>
      `;
      
      if (action === 'download' || action === 'print') {
        // Return HTML - browser will handle PDF conversion (matching session notes & assessment reports pattern)
        res.setHeader('Content-Type', 'text/html');
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, private');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
        res.removeHeader('ETag');
        res.send(invoiceHtml);
      } else if (action === 'email') {
        // Email invoice using SparkPost if available
        if (process.env.SPARKPOST_API_KEY && client.email) {
          try {
            const sp = new SparkPost(process.env.SPARKPOST_API_KEY);
            
            // Use the configured send domain for emails
            const fromEmail = getEmailFromAddress();
            
            // Generate PDF for email attachment with improved reliability
            let pdfBuffer;
            try {
              const chromiumPath = getChromiumExecutablePath();
              const launchOptions: any = {
                args: [
                  '--no-sandbox',
                  '--disable-setuid-sandbox',
                  '--disable-dev-shm-usage',
                  '--disable-gpu',
                  '--disable-extensions',
                  '--disable-default-apps',
                  '--disable-web-security',
                  '--single-process',
                  '--no-zygote',
                  '--disable-logging',
                  '--disable-background-networking',
                  '--disable-background-timer-throttling',
                  '--disable-renderer-backgrounding',
                  '--disable-features=TranslateUI,BlinkGenPropertyTrees'
                ],
                headless: true,
                timeout: 90000,
                protocolTimeout: 120000
              };
              
              // Only set executablePath if the Nix path exists, otherwise let Puppeteer find system Chrome
              if (chromiumPath) {
                launchOptions.executablePath = chromiumPath;
              }
              
              const browser = await puppeteer.launch(launchOptions);
              
              const page = await browser.newPage();
              await page.setDefaultTimeout(60000);
              await page.setViewport({ width: 1200, height: 800 });
              await page.emulateMediaType('print');
              await page.setContent(invoiceHtml, { waitUntil: 'domcontentloaded', timeout: 60000 });
              
              // Wait for fonts and styling to load
              await new Promise(resolve => setTimeout(resolve, 2000));
              
              pdfBuffer = await page.pdf({
                format: 'A4',
                printBackground: true,
                margin: {
                  top: '20mm',
                  right: '10mm',
                  bottom: '20mm',
                  left: '10mm'
                },
                timeout: 60000
              });
              
              await browser.close();
              
              console.log('[PDF SUCCESS] Generated PDF for email:', {
                clientEmail: client.email,
                pdfSize: pdfBuffer.length,
                pdfSizeKB: (pdfBuffer.length / 1024).toFixed(2) + 'KB'
              });
              
            } catch (pdfError: any) {
              console.error('PDF generation failed for email:', {
                error: pdfError?.message || 'Unknown error',
                errorType: pdfError?.name || 'Unknown',
                stack: pdfError?.stack?.split('\n').slice(0, 3).join('\n') || 'No stack',
                clientId: client.clientId,
                clientEmail: client.email,
                timestamp: new Date().toISOString()
              });
              
              // Retry once with different settings if it's a timeout
              if (pdfError?.message?.includes('timeout') || pdfError?.message?.includes('timed out')) {
                try {
                  const chromiumPath = getChromiumExecutablePath();
                  const launchOptions: any = {
                    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
                    headless: true,
                    timeout: 60000,
                    protocolTimeout: 60000
                  };
                  
                  // Only set executablePath if the Nix path exists, otherwise let Puppeteer find system Chrome
                  if (chromiumPath) {
                    launchOptions.executablePath = chromiumPath;
                  }
                  
                  const browser = await puppeteer.launch(launchOptions);
                  
                  const page = await browser.newPage();
                  await page.setContent(invoiceHtml);
                  pdfBuffer = await page.pdf({ format: 'A4', printBackground: true });
                  await browser.close();
                } catch (retryError: any) {
                  pdfBuffer = null;
                }
              } else {
                pdfBuffer = null;
              }
            }

            const result = await sp.transmissions.send({
              options: {
                sandbox: false  // Set to false for production sending
              },
              recipients: [{ address: client.email }],
              content: {
                from: fromEmail,
                subject: `Invoice from ${providerInfo.name} - ${client.fullName}`,
                html: `
                  <div style="font-family: 'Times New Roman', Times, serif; max-width: 600px; margin: 0 auto; padding: 30px; background: #ffffff; border: 1px solid #e5e7eb;">
                    <div style="text-align: center; margin-bottom: 30px; border-bottom: 2px solid #1e293b; padding-bottom: 20px;">
                      <h1 style="color: #1e293b; font-size: 28px; margin: 0; text-transform: uppercase; letter-spacing: 1px;">INVOICE</h1>
                      <p style="color: #6b7280; margin: 10px 0 0 0; font-size: 16px;">${practiceSettings.name}</p>
                    </div>
                    
                    <div style="margin-bottom: 25px;">
                      <p style="margin: 15px 0; line-height: 1.6; color: #374151;">Thank you for choosing ${practiceSettings.name}. Please find below the details of your recent session and billing information.</p>
                    </div>
                    
                    <div style="background: #f8fafc; padding: 20px; border-left: 4px solid #3b82f6; margin: 25px 0;">
                      <h3 style="color: #1e293b; margin: 0 0 15px 0; font-size: 16px;">Invoice Details</h3>
                      <table style="width: 100%; border-collapse: collapse;">
                        <tr><td style="padding: 5px 0; color: #6b7280; width: 40%;">Invoice Number:</td><td style="padding: 5px 0; color: #1e293b; font-weight: bold;">INV-${client.clientId}-${billingId}</td></tr>
                        <tr><td style="padding: 5px 0; color: #6b7280;">Date:</td><td style="padding: 5px 0; color: #1e293b;">${formatInTimeZone(new Date(), 'America/New_York', 'MMM dd, yyyy')}</td></tr>
                        <tr><td style="padding: 5px 0; color: #6b7280;">Service:</td><td style="padding: 5px 0; color: #1e293b;">${billingRecords[0].serviceCode}</td></tr>
                        <tr><td style="padding: 5px 0; color: #6b7280;">Amount Due:</td><td style="padding: 5px 0; color: #dc2626; font-weight: bold; font-size: 18px;">$${remainingDue.toFixed(2)}</td></tr>
                      </table>
                    </div>
                    
                    <hr style="margin: 30px 0; border: none; border-top: 1px solid #e5e7eb;">
                    
                    <div style="text-align: center; color: #6b7280; font-size: 14px; line-height: 1.5;">
                      <p style="margin: 5px 0; font-weight: bold; color: #1e293b;">${practiceSettings.name}</p>
                      <p style="margin: 5px 0;">${practiceSettings.address}</p>
                      <p style="margin: 5px 0;">Phone: ${practiceSettings.phone} | Email: ${practiceSettings.email}</p>
                      <p style="margin: 5px 0;">Website: ${practiceSettings.website}</p>
                    </div>
                  </div>
                `,
                text: `Please find your invoice attached as a PDF. Invoice #: INV-${client.clientId}-${billingId}, Amount: $${remainingDue.toFixed(2)}. For questions, contact us at ${practiceSettings.email} or ${practiceSettings.phone}.`,
                ...(pdfBuffer && {
                  attachments: [{
                    name: `Invoice-${client.clientId}-${new Date().toISOString().split('T')[0]}.pdf`,
                    type: 'application/pdf',
                    data: Buffer.isBuffer(pdfBuffer) ? pdfBuffer.toString('base64') : Buffer.from(pdfBuffer).toString('base64')
                  }]
                })
              }
            });

            // Log successful send details for debugging delivery issues
            console.log('[EMAIL SUCCESS] Invoice email sent via SparkPost:', {
              to: client.email,
              clientName: client.fullName,
              transmissionId: result.results?.id,
              totalAccepted: result.results?.total_accepted_recipients,
              totalRejected: result.results?.total_rejected_recipients,
              hasAttachment: !!pdfBuffer,
              fromDomain: fromEmail.split('@')[1],
              timestamp: new Date().toISOString()
            });

            // Track invoice email in communications history
            try {
              const { notifications } = await import("@shared/schema");
              // Use system admin user (id=6) for client email tracking
              const SYSTEM_USER_ID = 6;
              
              await db.insert(notifications).values({
                userId: SYSTEM_USER_ID, // System user for client email tracking
                type: 'invoice_sent' as any,
                title: `Invoice Sent - INV-${client.clientId}-${billingId}`,
                message: `Invoice sent to ${client.email} for $${remainingDue.toFixed(2)}${pdfBuffer ? ' with PDF attachment' : ' as HTML email'}`,
                data: JSON.stringify({
                  isClientEmail: true,
                  clientEmail: client.email,
                  billingId,
                  invoiceNumber: `INV-${client.clientId}-${billingId}`,
                  amount: remainingDue,
                  hasPdfAttachment: !!pdfBuffer,
                  transmissionId: result.results?.id
                }),
                priority: 'medium' as any,
                actionUrl: null,
                actionLabel: null,
                groupingKey: `invoice_${billingId}_${client.id}`,
                relatedEntityType: 'billing' as any,
                relatedEntityId: billingId
              });
              
              console.log('[EMAIL TRACKING] Invoice email tracked successfully:', {
                billingId,
                clientEmail: client.email,
                amount: remainingDue
              });
            } catch (trackingError) {
              console.error('[EMAIL TRACKING] Failed to track invoice email:', trackingError);
              // Don't fail the request if tracking fails
            }

            res.json({ 
              message: `Invoice ${pdfBuffer ? 'PDF' : 'email'} sent successfully to ` + client.email,
              messageId: result.results?.id,
              attachmentType: pdfBuffer ? 'PDF' : 'HTML',
              note: `Invoice sent as ${pdfBuffer ? 'PDF attachment' : 'professional HTML email'} from configured domain.`
            });
          } catch (error) {
            const err = error as any;
            
            console.error('[EMAIL] Failed to send invoice email:', {
              to: client.email,
              error: err.message,
              errorDetails: err.errors?.[0],
              stack: err.stack?.split('\n').slice(0, 3),
              timestamp: new Date().toISOString()
            });

            // Provide helpful error message about domain configuration
            let errorMessage = "Failed to send invoice email";
            if (err.errors?.[0]?.message?.includes('Unconfigured Sending Domain')) {
              errorMessage = "Email domain needs to be verified in SparkPost. Please contact your administrator to configure send.rcrc.ca domain in SparkPost.";
            }
            
            res.status(500).json({ 
              message: errorMessage,
              error: err.errors?.[0]?.message || err.message,
              help: "To fix this, verify the domain 'send.rcrc.ca' in your SparkPost account under Account Settings > Sending Domains"
            });
          }
        } else {
          const issues = [];
          if (!process.env.SPARKPOST_API_KEY) issues.push('SPARKPOST_API_KEY not set');
          if (!client.email) issues.push('Client email not available');
          
          res.status(503).json({ 
            message: "Email service not configured or client email not available",
            issues,
            help: "Check environment variables and client email address"
          });
        }
      }
    } catch (error) {
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Payment Status Update Route
  app.put("/api/billing/:billingId/payment", requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const billingId = parseInt(req.params.billingId);
      const { status, amount, date, reference, method, notes, clientId, source, acknowledgeDuplicate } = req.body;
      
      // Use centralized storage method to get billing data for authorization
      // clientId is passed from frontend to use getBillingForInvoice
      if (!clientId) {
        return res.status(400).json({ message: "Client ID is required" });
      }
      
      const invoiceData = await storage.getBillingForInvoice(clientId, billingId);
      
      if (!invoiceData) {
        return res.status(404).json({ message: "Billing record not found" });
      }

      // Authorization check: Allow administrators, supervisors, accountants,
      // dedicated billing staff, or therapists assigned to the client.
      // 'billing' is included here to match the neighbouring billing routes
      // (insurance post/void, transactions) which already grant it full
      // billing access — recording a manual payment is the same class of action.
      const userRole = req.user?.role?.toLowerCase();
      if (userRole === 'administrator' || userRole === 'admin' || userRole === 'supervisor') {
        // Admins and supervisors can record any payment
      } else if (userRole === 'accountant' || userRole === 'billing') {
        // Accountants and dedicated billing staff can record payments (billing access)
      } else if (userRole === 'therapist') {
        // Therapists can only record payments for their assigned clients
        if (invoiceData.client.assignedTherapistId !== req.user!.id) {
          return res.status(403).json({ message: "Access denied. You can only record payments for your assigned clients." });
        }
      } else {
        return res.status(403).json({ message: "Access denied. Insufficient privileges." });
      }
      
      if (!['pending', 'billed', 'paid', 'denied', 'refunded', 'follow_up'].includes(status)) {
        return res.status(400).json({ message: "Invalid payment status" });
      }
      
      // Use centralized recordPayment method
      await storage.recordPayment(billingId, {
        status,
        amount,
        date,
        reference,
        method,
        notes,
        source,
        acknowledgeDuplicate: acknowledgeDuplicate === true,
        recordedBy: req.user?.id
      });
      
      res.json({ message: "Payment details updated successfully" });
    } catch (error: any) {
      // Server-side duplicate-insurance guard: surface a clear 422 so a scripted
      // or stale-page call (which never saw the dialog's advisory) can't silently
      // double-count collected insurance. The dialog forwards acknowledgeDuplicate
      // when staff deliberately override, which bypasses this.
      if (error?.code === 'DUPLICATE_INSURANCE_PAYMENT') {
        return res.status(422).json({ message: error.message, code: error.code });
      }
      console.error('[PAYMENT ERROR]', error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Fetch payment transaction history for a billing record
  app.get("/api/billing/:billingId/transactions", requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const billingId = parseInt(req.params.billingId);
      if (!Number.isFinite(billingId)) {
        return res.status(400).json({ message: "Invalid billing id" });
      }

      // Look up the billing record + owning client for ownership check
      const billing = await storage.getBillingRecordWithClient(billingId);
      if (!billing) {
        return res.status(404).json({ message: "Billing record not found" });
      }

      const userRole = (req.user?.role || '').toLowerCase();
      if (['administrator', 'admin', 'supervisor', 'accountant', 'billing'].includes(userRole)) {
        // Full billing access
      } else if (userRole === 'therapist') {
        if (billing.assignedTherapistId !== req.user!.id) {
          return res.status(403).json({ message: "Access denied. You can only view payment history for your assigned clients." });
        }
      } else {
        return res.status(403).json({ message: "Access denied" });
      }

      const transactions = await storage.getPaymentTransactions(billingId);
      res.json(transactions);
    } catch (error) {
      console.error('[PAYMENT ERROR]', error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Void a single payment transaction (admin/billing only)
  app.post("/api/payment-transactions/:id/void", requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const txId = parseInt(req.params.id);
      if (!Number.isFinite(txId)) {
        return res.status(400).json({ message: "Invalid transaction id" });
      }
      const userRole = (req.user?.role || '').toLowerCase();
      if (!['administrator', 'admin', 'supervisor', 'accountant', 'billing'].includes(userRole)) {
        return res.status(403).json({ message: "Access denied. Only admin/billing can void payments." });
      }
      const reason = (req.body?.reason || '').toString();
      const result = await storage.voidPaymentTransaction(txId, reason, req.user!.id);
      res.json({ message: "Payment voided", billingId: result.billingId });
    } catch (error: any) {
      console.error('[VOID ERROR]', error);
      const msg = error?.message || "Internal server error";
      const code = msg.includes('not found') ? 404 : msg.includes('required') || msg.includes('already voided') ? 400 : 500;
      res.status(code).json({ message: msg });
    }
  });

  // Apply discount to billing record
  app.patch("/api/billing/:billingId/discount", requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const billingId = parseInt(req.params.billingId);
      const { discountType, discountValue, discountAmount } = req.body;
      
      // Authorization check: Allow administrators, supervisors, therapists, accountants, and billing roles
      if (!['administrator', 'admin', 'supervisor', 'therapist', 'accountant', 'billing'].includes(req.user?.role || '')) {
        return res.status(403).json({ message: "Access denied. Insufficient privileges to apply discounts." });
      }
      
      // Update the billing record with discount
      await storage.updateBillingDiscount(billingId, {
        discountType,
        discountValue,
        discountAmount
      });
      
      res.json({ message: "Discount applied successfully" });
    } catch (error) {
      console.error('[DISCOUNT ERROR]', error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Assessment completion workflow endpoints
  
  // Get assignment details with full relationships
  app.get('/api/assessments/assignments/:assignmentId', requireAuth, blockAccountant, async (req: AuthenticatedRequest, res) => {
    try {
      if (!req.user) {
        return res.status(401).json({ message: "Authentication required" });
      }
      
      const { assignmentId } = req.params;
      const assignment = await storage.getAssessmentAssignmentById(parseInt(assignmentId));
      
      if (!assignment) {
        return res.status(404).json({ message: 'Assessment assignment not found' });
      }
      
      // Role-based authorization: therapists can only view assessments for their assigned clients
      if (req.user.role === 'therapist') {
        const client = await storage.getClient(assignment.clientId);
        if (!client || client.assignedTherapistId !== req.user.id) {
          return res.status(403).json({ message: "Access denied. You can only view assessments for your assigned clients." });
        }
      } else if (req.user.role === 'supervisor') {
        // Supervisors can only view assessments for clients of therapists they supervise
        const client = await storage.getClient(assignment.clientId);
        if (!client) {
          return res.status(404).json({ message: 'Client not found' });
        }
        const supervisorAssignments = await storage.getSupervisorAssignments(req.user.id);
        const supervisedTherapistIds = supervisorAssignments.map(a => a.therapistId);
        if (client.assignedTherapistId && !supervisedTherapistIds.includes(client.assignedTherapistId)) {
          return res.status(403).json({ message: "Access denied. You can only view assessments for clients of therapists you supervise." });
        }
      }
      // Administrators can view all assessments (no restriction)
      
      res.json(assignment);
    } catch (error) {
      res.status(500).json({ message: 'Internal server error' });
    }
  });

  // Get template sections with questions
  app.get('/api/assessments/templates/:templateId/sections', requireAuth, blockAccountant, async (req: AuthenticatedRequest, res) => {
    try {
      const { templateId } = req.params;
      const sections = await storage.getAssessmentTemplateSections(parseInt(templateId));
      res.json(sections);
    } catch (error) {
      console.error('Error getting sections:', error);
      res.status(500).json({ message: 'Internal server error', error: (error as any)?.message });
    }
  });

  // Get assignment responses
  app.get('/api/assessments/assignments/:assignmentId/responses', requireAuth, blockAccountant, async (req: AuthenticatedRequest, res) => {
    try {
      if (!req.user) {
        return res.status(401).json({ message: "Authentication required" });
      }
      
      const { assignmentId } = req.params;
      const assignment = await storage.getAssessmentAssignmentById(parseInt(assignmentId));
      
      if (!assignment) {
        return res.status(404).json({ message: 'Assessment assignment not found' });
      }
      
      // Role-based authorization: therapists can only view responses for their assigned clients
      if (req.user.role === 'therapist') {
        const client = await storage.getClient(assignment.clientId);
        if (!client || client.assignedTherapistId !== req.user.id) {
          return res.status(403).json({ message: "Access denied. You can only view assessment responses for your assigned clients." });
        }
      } else if (req.user.role === 'supervisor') {
        const client = await storage.getClient(assignment.clientId);
        if (!client) {
          return res.status(404).json({ message: 'Client not found' });
        }
        const supervisorAssignments = await storage.getSupervisorAssignments(req.user.id);
        const supervisedTherapistIds = supervisorAssignments.map(a => a.therapistId);
        if (client.assignedTherapistId && !supervisedTherapistIds.includes(client.assignedTherapistId)) {
          return res.status(403).json({ message: "Access denied. You can only view responses for clients of therapists you supervise." });
        }
      }
      
      const responses = await storage.getAssessmentResponses(parseInt(assignmentId));
      res.json(responses);
    } catch (error) {
      res.status(500).json({ message: 'Internal server error' });
    }
  });

  // Save assessment response (authenticated version with status update)
  // Note: Duplicate route removed - see endpoint at line ~7271

  // Batch save multiple assessment responses
  app.post('/api/assessments/responses/batch', requireAuth, blockAccountant, async (req: AuthenticatedRequest, res) => {
    try {
      if (!req.user) {
        return res.status(401).json({ message: "Authentication required" });
      }
      
      const { responses } = req.body;
      
      if (!Array.isArray(responses) || responses.length === 0) {
        return res.status(400).json({ message: 'Invalid request: responses array is required' });
      }

      // Require assignmentId and ensure all responses belong to the same assignment
      const assignmentId = responses[0]?.assignmentId;
      if (!assignmentId) {
        return res.status(400).json({ message: 'Assignment ID is required for all responses' });
      }
      
      // Verify all responses have the same assignmentId
      const allSameAssignment = responses.every(r => r.assignmentId === assignmentId);
      if (!allSameAssignment) {
        return res.status(400).json({ message: 'All responses must belong to the same assessment assignment' });
      }

      // Authorization: Therapists/supervisors can save, clients for their own assessments
      // Check responderId from first response (all responses should have same responder)
      const responderId = responses[0]?.responderId;
      const permCheck = await checkAssessmentResponsePermission(
        assignmentId,
        req.user.id,
        req.user.role,
        responderId // Pass responderId for validation
      );
      if (!permCheck.allowed) {
        return res.status(permCheck.notFound ? 404 : 403).json({ message: permCheck.message });
      }

      // Helper to check if response has actual data
      const hasActualData = (r: any): boolean => {
        const hasText = r.responseText && r.responseText.trim() !== '';
        const hasOptions = Array.isArray(r.selectedOptions) && r.selectedOptions.length > 0;
        const hasRating = r.ratingValue !== null && r.ratingValue !== undefined;
        return hasText || hasOptions || hasRating;
      };

      // Filter to only responses with actual data - skip empty ones
      const responsesWithData = responses.filter(hasActualData);
      
      // Save only responses that have actual data
      const savedResponses = [];
      for (const responseData of responsesWithData) {
        const response = await storage.saveAssessmentResponse(responseData);
        savedResponses.push(response);
      }
      
      // Update assessment status to 'client_in_progress' if it's currently 'pending'
      if (responses[0]?.assignmentId) {
        const assignment = await storage.getAssessmentAssignmentById(responses[0].assignmentId);
        if (assignment && assignment.status === 'pending') {
          await storage.updateAssessmentAssignment(responses[0].assignmentId, {
            status: 'client_in_progress'
          });
        }
      }
      
      const skippedCount = responses.length - responsesWithData.length;
      res.json({ 
        message: `Successfully saved ${savedResponses.length} responses${skippedCount > 0 ? ` (${skippedCount} empty responses skipped)` : ''}`,
        responses: savedResponses,
        savedCount: savedResponses.length,
        skippedCount: skippedCount
      });
    } catch (error) {
      console.error('Batch save error:', error);
      res.status(500).json({ message: 'Internal server error' });
    }
  });

  // Update assignment status
  app.patch('/api/assessments/assignments/:assignmentId', requireAuth, blockAccountant, async (req: AuthenticatedRequest, res) => {
    try {
      if (!req.user) {
        return res.status(401).json({ message: "Authentication required" });
      }
      
      const { assignmentId } = req.params;
      
      // Authorization: Only creator can update assignments
      const permCheck = await checkAssessmentEditPermission(parseInt(assignmentId), req.user.id, req.user.role);
      if (!permCheck.allowed) {
        return res.status(permCheck.notFound ? 404 : 403).json({ message: permCheck.message });
      }
      
      // Convert ISO string dates to Date objects for database
      const updateData = { ...req.body };
      if (updateData.completedAt && typeof updateData.completedAt === 'string') {
        updateData.completedAt = new Date(updateData.completedAt);
      }
      if (updateData.therapistCompletedAt && typeof updateData.therapistCompletedAt === 'string') {
        updateData.therapistCompletedAt = new Date(updateData.therapistCompletedAt);
      }
      
      const assignment = await storage.updateAssessmentAssignment(parseInt(assignmentId), updateData);
      
      // Trigger assessment completed notification if status changed to completed
      if (req.body.status === 'completed') {
        try {
          await notificationService.processEvent('assessment_completed', {
            id: assignment.id,
            clientId: assignment.clientId,
            templateId: assignment.templateId,
            completionDate: new Date(),
            assignedById: assignment.assignedById,
            completedAt: assignment.completedAt
          });
        } catch (notificationError) {
          console.error('Assessment completed notification failed:', notificationError);
        }
      }
      
      res.json(assignment);
    } catch (error) {
      console.error('Error updating assessment assignment:', error);
      res.status(500).json({ message: 'Internal server error' });
    }
  });

  // Delete assessment assignment
  app.delete('/api/assessments/assignments/:assignmentId', requireAuth, blockAccountant, async (req: AuthenticatedRequest, res) => {
    try {
      if (!req.user) {
        return res.status(401).json({ message: "Authentication required" });
      }
      
      const { assignmentId } = req.params;
      
      // Authorization: Only creator can delete assignments
      const permCheck = await checkAssessmentEditPermission(parseInt(assignmentId), req.user.id, req.user.role);
      if (!permCheck.allowed) {
        return res.status(permCheck.notFound ? 404 : 403).json({ message: permCheck.message });
      }
      
      await storage.deleteAssessmentAssignment(parseInt(assignmentId));
      res.json({ message: 'Assessment assignment deleted successfully' });
    } catch (error) {
      res.status(500).json({ message: 'Internal server error' });
    }
  });

  // ===== ROLE MANAGEMENT ROUTES =====
  
  // Get all roles
  app.get("/api/roles", requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      if (!req.user) {
        return res.status(401).json({ message: "Authentication required" });
      }
      
      // Only administrators can view roles
      if (req.user.role !== 'administrator' && req.user.role !== 'admin') {
        return res.status(403).json({ message: "Access denied. Administrator privileges required." });
      }
      
      const roles = await storage.getRoles();
      res.json(roles);
    } catch (error) {
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Get specific role
  app.get("/api/roles/:id", requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      if (!req.user) {
        return res.status(401).json({ message: "Authentication required" });
      }
      
      // Only administrators can view roles
      if (req.user.role !== 'administrator' && req.user.role !== 'admin') {
        return res.status(403).json({ message: "Access denied. Administrator privileges required." });
      }
      
      const id = parseInt(req.params.id);
      const role = await storage.getRole(id);
      if (!role) {
        return res.status(404).json({ message: "Role not found" });
      }
      res.json(role);
    } catch (error) {
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Create role
  app.post("/api/roles", requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      if (!req.user) {
        return res.status(401).json({ message: "Authentication required" });
      }
      
      // Only administrators can create roles
      if (req.user.role !== 'administrator' && req.user.role !== 'admin') {
        return res.status(403).json({ message: "Access denied. Administrator privileges required." });
      }
      
      const validatedData = insertRoleSchema.parse(req.body);
      const { permissions = [], ...roleData } = validatedData as any;
      
      // Create the role
      const role = await storage.createRole(roleData);
      
      // Assign permissions if provided
      if (permissions.length > 0) {
        await storage.updateRolePermissions(role.id, permissions);
      }
      
      // Return role with permissions
      const roleWithPermissions = await storage.getRole(role.id);
      res.status(201).json(roleWithPermissions);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid role data", errors: error.errors });
      }
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Update role
  app.put("/api/roles/:id", requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      if (!req.user) {
        return res.status(401).json({ message: "Authentication required" });
      }
      
      // Only administrators can update roles
      if (req.user.role !== 'administrator' && req.user.role !== 'admin') {
        return res.status(403).json({ message: "Access denied. Administrator privileges required." });
      }
      
      const id = parseInt(req.params.id);
      const validatedData = insertRoleSchema.partial().parse(req.body);
      const { permissions = [], ...roleData } = validatedData as any;
      
      // Update the role
      const role = await storage.updateRole(id, roleData);
      
      // Update permissions if provided
      if (Array.isArray(permissions)) {
        await storage.updateRolePermissions(id, permissions);
      }
      
      // Return updated role with permissions
      const roleWithPermissions = await storage.getRole(id);
      res.json(roleWithPermissions);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid role data", errors: error.errors });
      }
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Delete role
  app.delete("/api/roles/:id", requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      if (!req.user) {
        return res.status(401).json({ message: "Authentication required" });
      }
      
      // Only administrators can delete roles
      if (req.user.role !== 'administrator' && req.user.role !== 'admin') {
        return res.status(403).json({ message: "Access denied. Administrator privileges required." });
      }
      
      const id = parseInt(req.params.id);
      
      // Check if role is system role
      const role = await storage.getRole(id);
      if (role?.isSystem) {
        return res.status(400).json({ message: "Cannot delete system role" });
      }
      
      await storage.deleteRole(id);
      res.status(204).send();
    } catch (error) {
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // ===== PERMISSION MANAGEMENT ROUTES =====
  
  // Get all permissions
  app.get("/api/permissions", requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      if (!req.user) {
        return res.status(401).json({ message: "Authentication required" });
      }
      
      // Only administrators can view permissions
      if (req.user.role !== 'administrator' && req.user.role !== 'admin') {
        return res.status(403).json({ message: "Access denied. Administrator privileges required." });
      }
      
      const permissions = await storage.getPermissions();
      res.json(permissions);
    } catch (error) {
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Get specific permission
  app.get("/api/permissions/:id", requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      if (!req.user) {
        return res.status(401).json({ message: "Authentication required" });
      }
      
      // Only administrators can view permissions
      if (req.user.role !== 'administrator' && req.user.role !== 'admin') {
        return res.status(403).json({ message: "Access denied. Administrator privileges required." });
      }
      
      const id = parseInt(req.params.id);
      const permission = await storage.getPermission(id);
      if (!permission) {
        return res.status(404).json({ message: "Permission not found" });
      }
      res.json(permission);
    } catch (error) {
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Create permission
  app.post("/api/permissions", requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      if (!req.user) {
        return res.status(401).json({ message: "Authentication required" });
      }
      
      // Only administrators can create permissions
      if (req.user.role !== 'administrator' && req.user.role !== 'admin') {
        return res.status(403).json({ message: "Access denied. Administrator privileges required." });
      }
      
      const validatedData = insertPermissionSchema.parse(req.body);
      const permission = await storage.createPermission(validatedData);
      res.status(201).json(permission);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid permission data", errors: error.errors });
      }
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Update permission
  app.put("/api/permissions/:id", requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      if (!req.user) {
        return res.status(401).json({ message: "Authentication required" });
      }
      
      // Only administrators can update permissions
      if (req.user.role !== 'administrator' && req.user.role !== 'admin') {
        return res.status(403).json({ message: "Access denied. Administrator privileges required." });
      }
      
      const id = parseInt(req.params.id);
      const validatedData = insertPermissionSchema.partial().parse(req.body);
      const permission = await storage.updatePermission(id, validatedData);
      res.json(permission);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid permission data", errors: error.errors });
      }
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Delete permission
  app.delete("/api/permissions/:id", requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      if (!req.user) {
        return res.status(401).json({ message: "Authentication required" });
      }
      
      // Only administrators can delete permissions
      if (req.user.role !== 'administrator' && req.user.role !== 'admin') {
        return res.status(403).json({ message: "Access denied. Administrator privileges required." });
      }
      
      const id = parseInt(req.params.id);
      await storage.deletePermission(id);
      res.status(204).send();
    } catch (error) {
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // ===== SYSTEM OPTIONS API ROUTES =====
  // (Following same pattern as Services/Rooms)

  // BATCH API: Get all filter data in one call (optimized for client page)
  app.get("/api/client-filters/batch", requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      // Get all data needed for client page filters in parallel
      const [
        categories,
        therapists,
        checklistTemplates
      ] = await Promise.all([
        storage.getOptionCategories(),
        storage.getTherapists(),
        storage.getChecklistTemplates()
      ]);

      // Get specific system options we need for client forms
      const neededCategories = categories.filter(cat => 
        ['client_type', 'referral_sources', 'marital_status', 'employment_status', 'education_level', 'gender', 'preferred_language'].includes(cat.categoryKey)
      );
      
      const optionsPromises = neededCategories.map(cat => storage.getSystemOptions(cat.id));
      const allOptions = await Promise.all(optionsPromises);
      
      // Organize options by category key
      const systemOptions: { [key: string]: any } = {};
      neededCategories.forEach((cat, index) => {
        systemOptions[cat.categoryKey] = {
          category: cat,
          options: allOptions[index] || []
        };
      });

      res.json({
        therapists,
        checklistTemplates,
        systemOptions
      });
    } catch (error) {
      console.error('Error fetching client filters batch:', error);
      res.status(500).json({ error: 'Failed to fetch client filters' });
    }
  });

  // Option Categories Management
  app.get("/api/system-options/categories", requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const categories = await storage.getOptionCategories();
      res.json(categories);
    } catch (error) {
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/system-options/categories/:id", requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid category ID" });
      }
      const category = await storage.getOptionCategory(id);
      if (!category) {
        return res.status(404).json({ message: "Category not found" });
      }
      res.json(category);
    } catch (error) {
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post("/api/system-options/categories", requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const validatedData = insertOptionCategorySchema.parse(req.body);
      const category = await storage.createOptionCategory(validatedData);
      res.status(201).json(category);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid category data", errors: error.errors });
      }
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.put("/api/system-options/categories/:id", requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid category ID" });
      }
      const validatedData = insertOptionCategorySchema.partial().parse(req.body);
      const category = await storage.updateOptionCategory(id, validatedData);
      res.json(category);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid category data", errors: error.errors });
      }
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.delete("/api/system-options/categories/:id", requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid category ID" });
      }
      await storage.deleteOptionCategory(id);
      res.status(204).send();
    } catch (error) {
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // System Options Management
  app.get("/api/system-options", requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const categoryId = req.query.categoryId ? parseInt(req.query.categoryId as string) : undefined;
      const options = await storage.getSystemOptions(categoryId);
      res.json(options);
    } catch (error) {
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/system-options/by-category/:categoryKey", requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const categoryKey = req.params.categoryKey;
      const options = await storage.getSystemOptionsByCategory(categoryKey);
      res.json(options);
    } catch (error) {
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/system-options/:id", requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid option ID" });
      }
      const option = await storage.getSystemOption(id);
      if (!option) {
        return res.status(404).json({ message: "Option not found" });
      }
      res.json(option);
    } catch (error) {
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post("/api/system-options", requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const validatedData = insertSystemOptionSchema.parse(req.body);
      const option = await storage.createSystemOption(validatedData);
      res.status(201).json(option);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid option data", errors: error.errors });
      }
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.put("/api/system-options/:id", requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid option ID" });
      }
      
      const { oldOptionKey, ...validatedData } = req.body;
      const parsedData = insertSystemOptionSchema.partial().parse(validatedData);
      
      // Update the option and migrate data if key changed
      const option = await storage.updateSystemOptionWithMigration(id, parsedData, oldOptionKey);
      res.json(option);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid option data", errors: error.errors });
      }

      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.delete("/api/system-options/:id", requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid option ID" });
      }
      await storage.deleteSystemOption(id);
      res.status(204).send();
    } catch (error) {
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // ===== CHECKLIST TEMPLATE MANAGEMENT =====
  // Database-backed storage for checklist templates and items

  app.get('/api/checklist-templates', requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const templates = await storage.getChecklistTemplates();
      res.json(templates);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post('/api/checklist-templates', requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const template = await storage.createChecklistTemplate(req.body);
      res.json(template);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.delete('/api/checklist-templates/:id', requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const templateId = parseInt(req.params.id);
      await storage.deleteChecklistTemplate(templateId);
      res.status(204).send();
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get('/api/checklist-items', async (req, res) => {
    try {
      const templateId = req.query.templateId ? parseInt(req.query.templateId as string) : undefined;
      const items = await storage.getChecklistItems(templateId);
      res.json(items);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post('/api/checklist-items', async (req, res) => {
    try {
      const item = await storage.createChecklistItem(req.body);
      res.json(item);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.put('/api/checklist-items/:id', async (req, res) => {
    try {
      const itemId = parseInt(req.params.id);
      const item = await storage.updateChecklistItem(itemId, req.body);
      res.json(item);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.delete('/api/checklist-items/:id', async (req, res) => {
    try {
      const itemId = parseInt(req.params.id);
      await storage.deleteChecklistItem(itemId);
      res.status(204).send();
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Client Checklist Routes
  app.get('/api/clients/:clientId/checklists', async (req, res) => {
    try {
      const clientId = parseInt(req.params.clientId);
      const checklists = await storage.getClientChecklists(clientId);
      res.json(checklists);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post('/api/clients/:clientId/checklists', async (req, res) => {
    try {
      const clientId = parseInt(req.params.clientId);
      const { templateId, dueDate } = req.body;
      
      // Check if client already has this checklist template assigned
      const existingChecklists = await storage.getClientChecklists(clientId);
      const hasTemplate = existingChecklists.some((checklist: any) => 
        checklist.templateId === templateId
      );
      
      if (hasTemplate) {
        return res.status(400).json({ 
          error: "This checklist template is already assigned to this client" 
        });
      }
      
      const assignment = await storage.assignChecklistToClient(clientId, templateId, dueDate);
      res.json(assignment);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get('/api/client-checklist-items/:clientChecklistId', async (req, res) => {
    try {
      const clientChecklistId = parseInt(req.params.clientChecklistId);
      const items = await storage.getClientChecklistItems(clientChecklistId);
      res.json(items);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.put('/api/client-checklist-items/:id', async (req, res) => {
    try {
      const itemId = parseInt(req.params.id);
      const updatedItem = await storage.updateClientChecklistItem(itemId, req.body);
      res.json(updatedItem);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ===== AUTHENTICATION ROUTES =====
  const { default: authRoutes } = await import('./auth-routes');
  app.use('/api/auth', authRoutes);

  // ===== NOTIFICATION SYSTEM ROUTES =====
  // Notification routes use the authenticated user from session

  app.use('/api/notifications', notificationRoutes);

  // ===== HIPAA AUDIT LOGGING ROUTES =====
  app.get("/api/audit/logs", async (req, res) => {
    try {
      const { startDate, endDate, riskLevel, hipaaOnly, action, userId } = req.query;
      
      // Some audit rows (e.g. notes_viewed / client_viewed) store the client in
      // resource_id instead of client_id. Resolve the client name from there too,
      // but only when resource_type points at a client and resource_id is numeric.
      const resourceClients = alias(clients, "resourceClients");
      const resourceClientId = sql<number>`case when ${auditLogs.resourceType} in ('client', 'client_notes') and ${auditLogs.resourceId} ~ '^[0-9]+$' and length(${auditLogs.resourceId}) <= 18 then ${auditLogs.resourceId}::bigint else null end`;

      // Build query with filters
      let query = db.select({
        id: auditLogs.id,
        userId: auditLogs.userId,
        username: sql<string>`coalesce(nullif(${auditLogs.username}, ''), ${users.fullName}, ${users.username})`,
        action: auditLogs.action,
        result: auditLogs.result,
        resourceType: auditLogs.resourceType,
        resourceId: auditLogs.resourceId,
        clientId: auditLogs.clientId,
        clientName: sql<string>`coalesce(${clients.fullName}, ${resourceClients.fullName})`,
        ipAddress: auditLogs.ipAddress,
        userAgent: auditLogs.userAgent,
        riskLevel: auditLogs.riskLevel,
        hipaaRelevant: auditLogs.hipaaRelevant,
        details: auditLogs.details,
        timestamp: auditLogs.timestamp,
      })
      .from(auditLogs)
      .leftJoin(clients, eq(auditLogs.clientId, clients.id))
      .leftJoin(resourceClients, eq(resourceClients.id, resourceClientId))
      .leftJoin(users, eq(auditLogs.userId, users.id));

      // Apply filters
      const whereConditions = [];
      
      if (startDate) {
        whereConditions.push(gte(auditLogs.timestamp, new Date(startDate as string)));
      }
      
      if (endDate) {
        const endDateTime = new Date(endDate as string);
        endDateTime.setHours(23, 59, 59, 999); // End of day
        whereConditions.push(lte(auditLogs.timestamp, endDateTime));
      }
      
      if (riskLevel && riskLevel !== 'all') {
        whereConditions.push(eq(auditLogs.riskLevel, riskLevel as string));
      }
      
      if (action && action !== 'all') {
        if ((AUDIT_ACTIONS as readonly string[]).includes(action as string)) {
          whereConditions.push(eq(auditLogs.action, action as AuditAction));
        }
      }
      
      if (userId && userId !== '') {
        whereConditions.push(
          or(
            ilike(auditLogs.username, `%${userId}%`),
            ilike(users.fullName, `%${userId}%`),
            ilike(users.username, `%${userId}%`),
          )
        );
      }
      
      if (hipaaOnly === 'true') {
        whereConditions.push(eq(auditLogs.hipaaRelevant, true));
      }
      
      // Execute query with conditions
      let finalQuery;
      if (whereConditions.length > 0) {
        finalQuery = query.where(and(...whereConditions));
      } else {
        finalQuery = query;
      }
      
      const logs = await finalQuery
        .orderBy(desc(auditLogs.timestamp))
        .limit(500);
      
      res.json(logs);
    } catch (error) {
      console.error("Error fetching audit logs:", error);
      res.status(500).json({ error: "Failed to fetch audit logs" });
    }
  });

  app.get("/api/audit/stats", async (req, res) => {
    try {
      // Calculate real statistics from actual audit log data
      const totalActivities = await db.select({ count: sql`count(*)` }).from(auditLogs);
      const phiAccess = await db.select({ count: sql`count(*)` }).from(auditLogs).where(eq(auditLogs.hipaaRelevant, true));
      const highRiskEvents = await db.select({ count: sql`count(*)` }).from(auditLogs).where(sql`${auditLogs.riskLevel} IN ('high', 'critical')`);
      const failedAttempts = await db.select({ count: sql`count(*)` }).from(loginAttempts).where(eq(loginAttempts.success, false));

      // Get top active users (resolve display name from the users table when the
      // stored username is empty, mirroring the audit logs listing)
      const resolvedUsername = sql<string>`coalesce(nullif(${auditLogs.username}, ''), ${users.fullName}, ${users.username})`;
      const userActivity = await db.select({
        username: resolvedUsername,
        activityCount: sql`count(*)`,
        lastActivity: sql`max(${auditLogs.timestamp})`,
      })
      .from(auditLogs)
      .leftJoin(users, eq(auditLogs.userId, users.id))
      .groupBy(resolvedUsername)
      .orderBy(desc(sql`count(*)`))
      .limit(10);

      const stats = {
        totalActivities: Number(totalActivities[0]?.count || 0),
        phiAccess: Number(phiAccess[0]?.count || 0),
        highRiskEvents: Number(highRiskEvents[0]?.count || 0),
        failedAttempts: Number(failedAttempts[0]?.count || 0),
        userActivity,
      };
      
      res.json(stats);
    } catch (error) {
      console.error("Error fetching audit stats:", error);
      res.status(500).json({ error: "Failed to fetch audit stats" });
    }
  });

  app.get("/api/audit/export", async (req, res) => {
    try {
      const { startDate, endDate, riskLevel, hipaaOnly } = req.query;
      
      // Log the export event as critical risk
      if (req.auditUser) {
        const { ipAddress, userAgent } = getRequestInfo(req);
        await AuditLogger.logDataExport(
          req.auditUser.id,
          req.auditUser.username,
          'audit_log_export',
          [], // No specific clients
          ipAddress,
          userAgent,
          { filters: req.query }
        );
      }
      
      const logs = await db.select().from(auditLogs).orderBy(desc(auditLogs.timestamp)).limit(1000).execute();
      
      // Convert to CSV format
      const csvHeaders = 'Timestamp,User,Action,Resource,Result,Risk Level,PHI Relevant,IP Address\n';
      const csvData = logs.map(log => 
        `"${log.timestamp}","${log.username}","${log.action}","${log.resourceType}","${log.result}","${log.riskLevel}","${log.hipaaRelevant}","${log.ipAddress}"`
      ).join('\n');
      
      const csv = csvHeaders + csvData;
      
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="hipaa_audit_report_${new Date().toISOString().split('T')[0]}.csv"`);
      res.send(csv);
    } catch (error) {
      console.error("Error exporting audit logs:", error);
      res.status(500).json({ error: "Failed to export audit logs" });
    }
  });

  // ===== CLIENT PORTAL AUTHENTICATION =====
  
  // Client portal login
  app.post("/api/portal/login", async (req, res) => {
    const { ipAddress, userAgent } = getRequestInfo(req);
    
    try {
      const { email, password } = req.body;

      if (!email || !password) {
        // Audit failed login - missing credentials
        await AuditLogger.logAuthEvent(
          null,
          email || 'unknown',
          'login_failed',
          ipAddress,
          userAgent,
          'failure',
          { reason: 'Missing credentials', portal: true }
        );
        return res.status(400).json({ error: "Email and password are required" });
      }

      // Find client by portal email OR regular email
      const normalizedEmail = email.toLowerCase().trim();
      console.log(`[PORTAL_LOGIN] Login attempt for email: ${normalizedEmail}`);
      
      const [client] = await db
        .select()
        .from(clients)
        .where(or(
          eq(clients.portalEmail, normalizedEmail),
          eq(clients.email, normalizedEmail)
        ));
      
      if (!client || !client.hasPortalAccess || !client.portalPassword) {
        console.log(`[PORTAL_LOGIN] Login failed - client not found or no portal access:`, {
          clientFound: !!client,
          hasPortalAccess: client?.hasPortalAccess,
          hasPortalPassword: !!client?.portalPassword,
          portalEmail: client?.portalEmail,
          email: client?.email
        });
        // Audit failed login - client not found or no portal access
        await AuditLogger.logAuthEvent(
          null,
          email,
          'login_failed',
          ipAddress,
          userAgent,
          'failure',
          { reason: 'Invalid credentials or no portal access', portal: true }
        );
        return res.status(401).json({ error: "Invalid email or password" });
      }

      console.log(`[PORTAL_LOGIN] Client found (ID: ${client.id}), verifying password...`);
      
      // Verify password
      const passwordMatch = await bcrypt.compare(password, client.portalPassword);
      
      if (!passwordMatch) {
        console.log(`[PORTAL_LOGIN] Password mismatch for client ${client.id}`);
        // Audit failed login - wrong password
        await AuditLogger.logAuthEvent(
          client.id,
          email,
          'login_failed',
          ipAddress,
          userAgent,
          'failure',
          { reason: 'Invalid password', portal: true, clientId: client.id }
        );
        return res.status(401).json({ error: "Invalid email or password" });
      }

      console.log(`[PORTAL_LOGIN] Password verified successfully for client ${client.id} (${client.fullName})`);

      // Generate session token
      const sessionToken = crypto.randomBytes(32).toString('hex');
      
      // Create portal session (expires in 7 days)
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 7);
      
      await storage.createPortalSession({
        clientId: client.id,
        sessionToken,
        ipAddress: req.ip || req.headers['x-forwarded-for'] as string || 'unknown',
        userAgent: req.headers['user-agent'] || 'unknown',
        expiresAt,
        isActive: true
      });

      // Update client's last login
      await storage.updateClient(client.id, { lastLogin: new Date() });

      // Audit successful portal login
      await AuditLogger.logAuthEvent(
        null, // Portal users are clients, not in users table
        email,
        'login',
        ipAddress,
        userAgent,
        'success',
        { portal: true, clientId: client.id, fullName: client.fullName }
      );

      // Set session token in HttpOnly, Secure cookie for HIPAA compliance
      res.cookie('portalSessionToken', sessionToken, {
        httpOnly: true, // Prevents JavaScript access (XSS protection)
        secure: process.env.NODE_ENV === 'production', // HTTPS only in production
        sameSite: 'strict', // CSRF protection
        maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days in milliseconds
        path: '/api/portal' // Only send cookie for portal API routes
      });

      // Return client info only (no token in response body)
      res.json({
        client: {
          id: client.id,
          clientId: client.clientId,
          fullName: client.fullName,
          email: client.portalEmail
        }
      });
    } catch (error) {
      console.error("Portal login error:", error);
      res.status(500).json({ error: "Login failed" });
    }
  });

  // Get current portal session info
  app.get("/api/portal/me", async (req, res) => {
    try {
      // Read session token from HttpOnly cookie
      const sessionToken = req.cookies.portalSessionToken;

      if (!sessionToken) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const session = await storage.getPortalSessionByToken(sessionToken);
      
      if (!session) {
        // Clear invalid cookie with matching flags for reliable removal
        res.clearCookie('portalSessionToken', {
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          sameSite: 'strict',
          path: '/api/portal'
        });
        return res.status(401).json({ error: "Invalid or expired session" });
      }

      // Update session activity
      await storage.updatePortalSessionActivity(session.id);

      // Get client info
      const client = await storage.getClient(session.clientId);
      
      if (!client) {
        return res.status(404).json({ error: "Client not found" });
      }

      res.json({
        client: {
          id: client.id,
          clientId: client.clientId,
          fullName: client.fullName,
          email: client.portalEmail,
          phone: client.phone,
          assignedTherapistId: client.assignedTherapistId
        }
      });
    } catch (error) {
      console.error("Portal session error:", error);
      res.status(500).json({ error: "Failed to get session info" });
    }
  });

  // Client portal logout
  app.post("/api/portal/logout", async (req, res) => {
    const { ipAddress, userAgent } = getRequestInfo(req);
    
    try {
      // Read session token from HttpOnly cookie
      const sessionToken = req.cookies.portalSessionToken;

      if (sessionToken) {
        const session = await storage.getPortalSessionByToken(sessionToken);
        
        if (session) {
          const client = await storage.getClient(session.clientId);
          
          // Audit portal logout
          if (client) {
            await AuditLogger.logAuthEvent(
              null, // Portal users are clients, not in users table
              client.portalEmail || client.email || 'unknown',
              'logout',
              ipAddress,
              userAgent,
              'success',
              { portal: true, clientId: client.id }
            );
          }
          
          await storage.deletePortalSession(session.id);
        }
      }

      // Clear the session cookie with matching flags for reliable removal
      res.clearCookie('portalSessionToken', {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        path: '/api/portal'
      });
      
      res.json({ message: "Logged out successfully" });
    } catch (error) {
      console.error("Portal logout error:", error);
      res.status(500).json({ error: "Logout failed" });
    }
  });

  // ===== PATIENT CONSENT MANAGEMENT (GDPR) =====

  // Get all consents for current client
  app.get("/api/portal/consents", async (req, res) => {
    try {
      const sessionToken = req.cookies.portalSessionToken;

      if (!sessionToken) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const session = await storage.getPortalSessionByToken(sessionToken);
      
      if (!session) {
        return res.status(401).json({ error: "Invalid session" });
      }

      const consents = await storage.getClientConsents(session.clientId);
      res.json(consents);
    } catch (error) {
      console.error("Error fetching consents:", error);
      res.status(500).json({ error: "Failed to fetch consents" });
    }
  });

  // Twilio inbound-SMS webhook: honor STOP / START replies as consent changes.
  //
  // Twilio POSTs (application/x-www-form-urlencoded) here whenever a client texts
  // our number back. We treat the standard carrier keywords as a consent action:
  //   STOP / STOPALL / UNSUBSCRIBE / CANCEL / END / QUIT  -> withdraw SMS consent
  //   START / UNSTOP / YES                                 -> re-grant SMS consent
  // The request signature is validated against the Twilio auth token so a forged
  // request can never mutate consent. Every change is audit-logged exactly like
  // the portal consent endpoints (resourceType 'patient_consent'). We always
  // answer 200 with empty TwiML so Twilio doesn't retry; only a bad signature is
  // rejected (403). One phone may map to several clients (a family) — every
  // matching client is updated.
  const SMS_CONSENT_VERSION = "1.0.0";
  app.post("/api/sms/inbound", async (req, res) => {
    const { ipAddress, userAgent } = getRequestInfo(req);
    const twiml = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';

    try {
      const signature = req.header("X-Twilio-Signature") || undefined;
      const url = `${getBaseUrl(req)}${req.originalUrl}`;
      if (!validateTwilioSignature(signature, url, req.body || {})) {
        console.warn("[SMS INBOUND] Rejected request with invalid Twilio signature");
        return res.status(403).type("text/xml").send(twiml);
      }

      const fromRaw = (req.body?.From as string | undefined) || "";
      const bodyRaw = (req.body?.Body as string | undefined) || "";
      const intent = classifyInboundSms(bodyRaw);

      // Not an opt-in/opt-out keyword — acknowledge and ignore.
      if (!intent) {
        return res.status(200).type("text/xml").send(twiml);
      }

      const fromE164 = normalizePhoneE164(fromRaw);
      if (!fromE164) {
        console.warn("[SMS INBOUND] Could not normalize inbound 'From' number; ignoring");
        return res.status(200).type("text/xml").send(twiml);
      }

      const matchingClients = await storage.getClientsByPhone(fromE164);
      if (matchingClients.length === 0) {
        console.warn(`[SMS INBOUND] No client matched inbound number; ${intent} ignored`);
        return res.status(200).type("text/xml").send(twiml);
      }

      const granted = intent === "opt-in";

      for (const client of matchingClients) {
        let consent;
        if (granted) {
          // Re-grant: record a fresh granted consent (mirrors portal grant path).
          consent = await storage.createClientConsent({
            clientId: client.id,
            consentType: "sms_notifications",
            granted: true,
            consentVersion: SMS_CONSENT_VERSION,
            ipAddress: ipAddress || "",
            userAgent: userAgent || "",
            notes: "SMS consent re-granted via inbound text reply (START/UNSTOP)",
          } as any);
        } else {
          // Withdraw any active granted consent; if none exists, record an
          // explicit opt-out row so the withdrawal is captured + audited.
          consent = await storage.withdrawClientConsent(client.id, "sms_notifications");
          if (!consent) {
            consent = await storage.createClientConsent({
              clientId: client.id,
              consentType: "sms_notifications",
              granted: false,
              consentVersion: SMS_CONSENT_VERSION,
              ipAddress: ipAddress || "",
              userAgent: userAgent || "",
              notes: "SMS opt-out recorded via inbound text reply (STOP)",
            } as any);
            await storage.updateClientConsent(consent.id, { withdrawnAt: new Date() } as any);
          }
        }

        await AuditLogger.logAction({
          // System user: the change is initiated by Twilio's webhook, not a
          // logged-in user. audit_logs.user_id is FK-constrained to users, so a
          // client id can't go here — the client is recorded via clientId below.
          userId: 6,
          username: "SMS Inbound (Twilio)",
          action: granted ? "consent_granted" : "consent_withdrawn",
          result: "success",
          resourceType: "patient_consent",
          resourceId: consent.id.toString(),
          clientId: client.id,
          ipAddress: ipAddress || "",
          userAgent: userAgent || "",
          hipaaRelevant: true,
          riskLevel: "high",
          details: JSON.stringify({
            consentType: "sms_notifications",
            granted,
            withdrawn: !granted,
            consentVersion: SMS_CONSENT_VERSION,
            consentId: consent.id,
            source: "sms_inbound_webhook",
            keyword: bodyRaw.trim().toUpperCase().slice(0, 32),
          }),
          accessReason: "SMS opt-out/opt-in via inbound text reply",
        });
      }

      return res.status(200).type("text/xml").send(twiml);
    } catch (error) {
      console.error("[SMS INBOUND] Error processing inbound SMS:", error);
      // Still answer 200 so Twilio doesn't retry a request we can't process.
      return res.status(200).type("text/xml").send(twiml);
    }
  });

  // Grant or update consent
  app.post("/api/portal/consents", async (req, res) => {
    const { ipAddress, userAgent } = getRequestInfo(req);
    
    try {
      const sessionToken = req.cookies.portalSessionToken;

      if (!sessionToken) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const session = await storage.getPortalSessionByToken(sessionToken);
      
      if (!session) {
        return res.status(401).json({ error: "Invalid session" });
      }

      const { consentType, granted, consentVersion } = req.body;

      if (!consentType || typeof granted !== 'boolean' || !consentVersion) {
        return res.status(400).json({ error: "Consent type, granted status, and version are required" });
      }

      // Create new consent record
      const consent = await storage.createClientConsent({
        clientId: session.clientId,
        consentType,
        granted,
        consentVersion,
        ipAddress: ipAddress || '',
        userAgent: userAgent || '',
        notes: granted ? 'Consent granted via client portal' : 'Consent withdrawn via client portal'
      });

      // Audit the consent change with comprehensive metadata for GDPR compliance
      await AuditLogger.logAction({
        userId: session.clientId, // Client ID in portal context
        username: 'Portal User',
        action: granted ? 'consent_granted' : 'consent_withdrawn',
        result: 'success',
        resourceType: 'patient_consent',
        resourceId: consent.id.toString(),
        clientId: session.clientId,
        ipAddress: ipAddress || '',
        userAgent: userAgent || '',
        hipaaRelevant: true,
        riskLevel: 'high', // GDPR consent is high-risk
        details: JSON.stringify({
          consentType,
          granted,
          withdrawn: !granted,
          consentVersion,
          consentId: consent.id,
          grantedAt: granted ? new Date().toISOString() : null,
          withdrawnAt: !granted ? new Date().toISOString() : null,
          portal: true,
          source: 'client_portal'
        }),
        accessReason: 'GDPR consent management'
      });

      res.json(consent);
    } catch (error) {
      console.error("Error creating consent:", error);
      res.status(500).json({ error: "Failed to create consent" });
    }
  });

  // Withdraw specific consent
  app.post("/api/portal/consents/withdraw", async (req, res) => {
    const { ipAddress, userAgent } = getRequestInfo(req);
    
    try {
      const sessionToken = req.cookies.portalSessionToken;

      if (!sessionToken) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const session = await storage.getPortalSessionByToken(sessionToken);
      
      if (!session) {
        return res.status(401).json({ error: "Invalid session" });
      }

      const { consentType } = req.body;

      if (!consentType) {
        return res.status(400).json({ error: "Consent type is required" });
      }

      const withdrawn = await storage.withdrawClientConsent(session.clientId, consentType);

      // Audit the consent withdrawal with comprehensive metadata for GDPR compliance
      await AuditLogger.logAction({
        userId: session.clientId, // Client ID in portal context
        username: 'Portal User',
        action: 'consent_withdrawn',
        result: 'success',
        resourceType: 'patient_consent',
        resourceId: withdrawn.id.toString(),
        clientId: session.clientId,
        ipAddress: ipAddress || '',
        userAgent: userAgent || '',
        hipaaRelevant: true,
        riskLevel: 'high', // GDPR consent is high-risk
        details: JSON.stringify({
          consentType,
          granted: false,
          withdrawn: true,
          consentVersion: withdrawn.consentVersion,
          consentId: withdrawn.id,
          grantedAt: withdrawn.grantedAt?.toISOString() || null,
          withdrawnAt: new Date().toISOString(),
          portal: true,
          source: 'client_portal',
          previouslyGranted: withdrawn.grantedAt !== null
        }),
        accessReason: 'GDPR consent management'
      });

      res.json(withdrawn);
    } catch (error) {
      console.error("Error withdrawing consent:", error);
      res.status(500).json({ error: "Failed to withdraw consent" });
    }
  });

  // Admin: Get consents for a specific client
  app.get("/api/admin/clients/:clientId/consents", requireAuth, async (req, res) => {
    try {
      const clientId = parseInt(req.params.clientId);

      if (isNaN(clientId)) {
        return res.status(400).json({ error: "Invalid client ID" });
      }

      const consents = await storage.getClientConsents(clientId);
      res.json(consents);
    } catch (error) {
      console.error("Error fetching client consents:", error);
      res.status(500).json({ error: "Failed to fetch consents" });
    }
  });

  // Admin: Get all client consents with client details
  app.get("/api/admin/consents", requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: "Authentication required" });
      }

      // Only admins and supervisors can view all consents
      if (!['administrator', 'admin', 'supervisor'].includes(req.user.role)) {
        return res.status(403).json({ error: "Access denied" });
      }

      // Get filter parameters
      const consentType = req.query.consentType as string | undefined;
      const granted = req.query.granted === 'true' ? true : req.query.granted === 'false' ? false : undefined;

      // Get all clients with their consents
      const clientsWithConsents = await db
        .select({
          id: clients.id,
          clientId: clients.clientId,
          fullName: clients.fullName,
          email: clients.email,
          hasPortalAccess: clients.hasPortalAccess,
          consentId: patientConsents.id,
          consentType: patientConsents.consentType,
          granted: patientConsents.granted,
          grantedAt: patientConsents.grantedAt,
          withdrawnAt: patientConsents.withdrawnAt,
          consentVersion: patientConsents.consentVersion,
          createdAt: patientConsents.createdAt,
          updatedAt: patientConsents.updatedAt,
        })
        .from(clients)
        .leftJoin(patientConsents, eq(clients.id, patientConsents.clientId))
        .orderBy(clients.fullName, patientConsents.consentType);

      // Group consents by client
      const clientConsentMap = new Map<number, any>();
      
      for (const row of clientsWithConsents) {
        if (!clientConsentMap.has(row.id)) {
          clientConsentMap.set(row.id, {
            id: row.id,
            clientId: row.clientId,
            fullName: row.fullName,
            email: row.email,
            hasPortalAccess: row.hasPortalAccess,
            consents: []
          });
        }

        if (row.consentId) {
          const consent = {
            id: row.consentId,
            consentType: row.consentType,
            granted: row.granted,
            grantedAt: row.grantedAt,
            withdrawnAt: row.withdrawnAt,
            consentVersion: row.consentVersion,
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
          };

          // Apply filters
          let includeConsent = true;
          if (consentType && consent.consentType !== consentType) {
            includeConsent = false;
          }
          if (granted !== undefined && consent.granted !== granted) {
            includeConsent = false;
          }

          if (includeConsent) {
            clientConsentMap.get(row.id)!.consents.push(consent);
          }
        }
      }

      // Convert map to array
      const result = Array.from(clientConsentMap.values());

      // If filtering by consent type or granted status, only return clients that match
      const filtered = (consentType || granted !== undefined) 
        ? result.filter(c => c.consents.length > 0)
        : result;

      res.json(filtered);
    } catch (error) {
      console.error("Error fetching all consents:", error);
      res.status(500).json({ error: "Failed to fetch consents" });
    }
  });

  // Portal activation - validate token and set password
  app.post("/api/portal/activate", async (req, res) => {
    try {
      const { token, password } = req.body;

      if (!token || !password) {
        return res.status(400).json({ error: "Activation token and password are required" });
      }

      // Validate password strength (at least 8 characters)
      if (password.length < 8) {
        return res.status(400).json({ error: "Password must be at least 8 characters long" });
      }

      // Find client by activation token
      const [client] = await db
        .select()
        .from(clients)
        .where(eq(clients.activationToken, token));

      if (!client) {
        return res.status(404).json({ error: "Invalid or expired activation token" });
      }

      if (!client.hasPortalAccess) {
        return res.status(403).json({ error: "Portal access is not enabled for this account" });
      }

      // Hash password
      const hashedPassword = await bcrypt.hash(password, 10);

      // Update client with password and clear activation token
      await storage.updateClient(client.id, {
        portalPassword: hashedPassword,
        activationToken: null,
        lastLogin: new Date()
      });

      // Create initial portal session
      const sessionToken = crypto.randomBytes(32).toString('hex');
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 7);

      await storage.createPortalSession({
        clientId: client.id,
        sessionToken,
        ipAddress: req.ip || req.headers['x-forwarded-for'] as string || 'unknown',
        userAgent: req.headers['user-agent'] || 'unknown',
        expiresAt,
        isActive: true
      });

      // Set session cookie
      res.cookie('portalSessionToken', sessionToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: 7 * 24 * 60 * 60 * 1000,
        path: '/api/portal'
      });

      res.json({
        message: "Account activated successfully",
        client: {
          id: client.id,
          clientId: client.clientId,
          fullName: client.fullName,
          email: client.portalEmail
        }
      });
    } catch (error) {
      console.error("Portal activation error:", error);
      res.status(500).json({ error: "Activation failed" });
    }
  });

  // Portal password reset request - generate token and send email
  app.post("/api/portal/forgot-password", async (req, res) => {
    try {
      const { email } = req.body;

      if (!email) {
        return res.status(400).json({ error: "Email is required" });
      }

      console.log(`[PASSWORD_RESET] Password reset requested for email: ${email}`);

      // Find client by portal email OR regular email
      const [client] = await db
        .select()
        .from(clients)
        .where(or(
          eq(clients.portalEmail, email),
          eq(clients.email, email)
        ));

      // Always return success to prevent email enumeration attacks
      if (!client) {
        console.log(`[PASSWORD_RESET] No client found with email: ${email}`);
        return res.json({ message: "If an account exists with this email, a password reset link has been sent." });
      }

      if (!client.hasPortalAccess) {
        console.log(`[PASSWORD_RESET] Client ${client.id} does not have portal access enabled`);
        return res.json({ message: "If an account exists with this email, a password reset link has been sent." });
      }

      // Determine which email to use for sending
      const emailToUse = client.portalEmail || client.email;
      if (!emailToUse) {
        console.log(`[PASSWORD_RESET] Client ${client.id} has no email address`);
        return res.json({ message: "If an account exists with this email, a password reset link has been sent." });
      }

      // Generate reset token
      const resetToken = crypto.randomBytes(32).toString('hex');

      // Update client with reset token (no expiry tracking for now - tokens are single-use)
      await storage.updateClient(client.id, {
        passwordResetToken: resetToken
      });

      console.log(`[PASSWORD_RESET] Reset token generated for client ${client.id}, sending email to ${emailToUse}`);

      // Send reset email
      try {
        await sendPasswordResetEmail(emailToUse, client.fullName, resetToken, getBaseUrl(req));
        console.log(`[PASSWORD_RESET] Reset email sent to ${emailToUse} for client ${client.fullName}`);
      } catch (emailError) {
        console.error(`[PASSWORD_RESET] Failed to send reset email to ${emailToUse}:`, emailError);
        // Still return success to prevent email enumeration
      }

      res.json({ message: "If an account exists with this email, a password reset link has been sent." });
    } catch (error) {
      console.error("[PASSWORD_RESET] Forgot password error:", error);
      res.status(500).json({ error: "Failed to process password reset request" });
    }
  });

  // Portal password reset - validate token and update password
  app.post("/api/portal/reset-password", async (req, res) => {
    try {
      const { token, password } = req.body;

      if (!token || !password) {
        return res.status(400).json({ error: "Reset token and password are required" });
      }

      // Validate password strength
      if (password.length < 8) {
        return res.status(400).json({ error: "Password must be at least 8 characters long" });
      }

      // Find client by reset token
      const [client] = await db
        .select()
        .from(clients)
        .where(eq(clients.passwordResetToken, token));

      if (!client) {
        return res.status(404).json({ error: "Invalid or expired reset token" });
      }

      if (!client.hasPortalAccess) {
        return res.status(403).json({ error: "Portal access is not enabled for this account" });
      }

      // Hash new password
      const hashedPassword = await bcrypt.hash(password, 10);

      // Update client with new password and clear reset token
      await storage.updateClient(client.id, {
        portalPassword: hashedPassword,
        passwordResetToken: null
      });

      console.log(`[PASSWORD_RESET] Password reset successful for client ${client.fullName}`);

      res.json({ message: "Password reset successfully. You can now log in with your new password." });
    } catch (error) {
      console.error("Password reset error:", error);
      res.status(500).json({ error: "Failed to reset password" });
    }
  });

  // Portal - Get client's appointments
  // Portal - Submit SRS V.3.0 rating for a completed session (one-time, locked after submit)
  app.post("/api/portal/sessions/:sessionId/rating", async (req, res) => {
    try {
      const sessionToken = req.cookies.portalSessionToken;
      if (!sessionToken) return res.status(401).json({ error: "Not authenticated" });
      const portalSession = await storage.getPortalSessionByToken(sessionToken);
      if (!portalSession) return res.status(401).json({ error: "Invalid or expired session" });

      const sessionId = parseInt(req.params.sessionId);
      if (isNaN(sessionId)) return res.status(400).json({ error: "Invalid session ID" });

      // Verify the session belongs to this client and is completed
      const sessionResult = await db.select().from(sessions)
        .where(and(eq(sessions.id, sessionId), eq(sessions.clientId, portalSession.clientId)))
        .limit(1);
      if (!sessionResult.length) return res.status(404).json({ error: "Session not found" });
      if (sessionResult[0].status !== 'completed') return res.status(400).json({ error: "Can only rate completed sessions" });

      // Block re-submission
      const existing = await db.select().from(sessionRatings).where(eq(sessionRatings.sessionId, sessionId)).limit(1);
      if (existing.length) return res.status(409).json({ error: "Rating already submitted for this session" });

      const { relationship, goalsTopics, approachMethod, overall } = req.body;
      const r = parseFloat(relationship), g = parseFloat(goalsTopics), a = parseFloat(approachMethod), o = parseFloat(overall);
      if ([r, g, a, o].some(v => isNaN(v) || v < 0 || v > 10)) {
        return res.status(400).json({ error: "Each score must be between 0 and 10" });
      }
      const totalScore = parseFloat((r + g + a + o).toFixed(1));

      const [rating] = await db.insert(sessionRatings).values({
        sessionId,
        clientId: portalSession.clientId,
        therapistId: sessionResult[0].therapistId,
        relationship: r.toFixed(1),
        goalsTopics: g.toFixed(1),
        approachMethod: a.toFixed(1),
        overall: o.toFixed(1),
        totalScore: totalScore.toFixed(1),
      }).returning();

      // Low score alert: if total < 36, create a task for the therapist
      if (totalScore < 36) {
        const client = await storage.getClient(portalSession.clientId);
        const initials = client ? `${(client as any).firstName} ${(client as any).lastName?.charAt(0)}.` : 'Client';
        const sessionDate = sessionResult[0].sessionDate ? new Date(sessionResult[0].sessionDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'recent session';
        await storage.createTask({
          title: `Review SRS feedback — ${initials} — ${sessionDate}`,
          description: `Client rated their session ${totalScore}/40. Scores below 36 suggest the therapeutic alliance may need attention. Please review before the next session.`,
          assignedToId: sessionResult[0].therapistId,
          clientId: portalSession.clientId,
          priority: totalScore < 30 ? 'high' : 'medium',
          status: 'pending',
          dueDate: undefined,
        });
      }

      res.status(201).json(rating);
    } catch (error) {
      console.error("SRS rating submission error:", error);
      res.status(500).json({ error: "Failed to submit rating" });
    }
  });

  app.get("/api/portal/appointments", async (req, res) => {
    const { ipAddress, userAgent } = getRequestInfo(req);
    
    try {
      // Read session token from HttpOnly cookie
      const sessionToken = req.cookies.portalSessionToken;

      if (!sessionToken) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const session = await storage.getPortalSessionByToken(sessionToken);
      
      if (!session) {
        return res.status(401).json({ error: "Invalid or expired session" });
      }

      // Update session activity
      await storage.updatePortalSessionActivity(session.id);

      // Get client info for reference number
      const client = await storage.getClient(session.clientId);
      
      // Get client's sessions with all details (excluding sensitive clinical notes)
      // Filter to last 6 months - older records can be requested from therapist
      const sixMonthsAgo = new Date();
      sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
      
      const clientSessionsRaw = await db
        .select({
          id: sessions.id,
          sessionDate: sessions.sessionDate,
          duration: sessions.duration,
          sessionType: sessions.sessionType,
          status: sessions.status,
          room: sessions.room,
          roomId: sessions.roomId,
          serviceId: sessions.serviceId,
          therapistId: sessions.therapistId,
          therapistName: users.fullName,
        })
        .from(sessions)
        .leftJoin(users, eq(sessions.therapistId, users.id))
        .where(and(
          eq(sessions.clientId, session.clientId),
          gte(sessions.sessionDate, sixMonthsAgo)
        ))
        .orderBy(desc(sessions.sessionDate))
        .limit(100);

      // Get all rooms for lookup
      const allRooms = await storage.getRooms();
      const roomMap = new Map(allRooms.map(r => [r.id, r]));
      
      // Get all services for lookup
      const allServices = await storage.getServices();
      const serviceMap = new Map(allServices.map(s => [s.id, s]));

      // Fetch SRS ratings for all returned sessions in one query
      const sessionIds = clientSessionsRaw.map(s => s.id);
      const ratingsResult = sessionIds.length > 0
        ? await db.select().from(sessionRatings).where(inArray(sessionRatings.sessionId, sessionIds))
        : [];
      const ratingMap = new Map(ratingsResult.map(r => [r.sessionId, r]));

      // Format sessions for portal display in America/New_York timezone
      const { formatInTimeZone } = await import('date-fns-tz');
      const formattedSessions = clientSessionsRaw.map(s => {
        const room = s.roomId ? roomMap.get(s.roomId) : null;
        const service = s.serviceId ? serviceMap.get(s.serviceId) : null;
        const rating = ratingMap.get(s.id) || null;
        
        return {
          id: s.id,
          sessionDate: formatInTimeZone(s.sessionDate, 'America/New_York', 'yyyy-MM-dd'),
          sessionTime: formatInTimeZone(s.sessionDate, 'America/New_York', 'HH:mm'),
          duration: s.duration,
          sessionType: s.sessionType,
          status: s.status,
          location: s.room || 'Office',
          roomName: room ? (room.roomName || room.roomNumber) : null,
          referenceNumber: client?.referenceNumber,
          serviceCode: service?.serviceCode,
          serviceName: service?.serviceName,
          serviceRate: service?.baseRate,
          therapistName: s.therapistName,
          srsRating: rating ? {
            relationship: parseFloat(rating.relationship),
            goalsTopics: parseFloat(rating.goalsTopics),
            approachMethod: parseFloat(rating.approachMethod),
            overall: parseFloat(rating.overall),
            totalScore: parseFloat(rating.totalScore),
            completedAt: rating.completedAt,
          } : null,
        };
      });

      // Audit appointment access
      if (client) {
        await AuditLogger.logAction({
          userId: null,
          username: client.portalEmail || client.email || 'unknown',
          action: 'appointments_viewed',
          result: 'success',
          resourceType: 'appointments',
          resourceId: session.clientId.toString(),
          clientId: session.clientId,
          ipAddress,
          userAgent,
          hipaaRelevant: true,
          riskLevel: 'medium',
          details: JSON.stringify({ portal: true, appointmentCount: formattedSessions.length }),
          accessReason: 'Client portal appointment viewing',
        });
      }

      res.json(formattedSessions);
    } catch (error) {
      console.error("Portal appointments error:", error);
      res.status(500).json({ error: "Failed to fetch appointments" });
    }
  });

  // Portal - Get client's notifications
  app.get("/api/portal/notifications", async (req, res) => {
    const { ipAddress, userAgent } = getRequestInfo(req);
    
    try {
      // Read session token from HttpOnly cookie
      const sessionToken = req.cookies.portalSessionToken;

      if (!sessionToken) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const session = await storage.getPortalSessionByToken(sessionToken);
      
      if (!session) {
        return res.status(401).json({ error: "Invalid or expired session" });
      }

      // Update session activity
      await storage.updatePortalSessionActivity(session.id);

      const clientId = session.clientId;

      // Fetch notifications related to this client
      // Look for notifications where relatedEntityType='client' OR notifications for sessions of this client
      const { notifications: notificationsTable } = await import("@shared/schema");
      
      const clientNotifications = await db
        .select()
        .from(notificationsTable)
        .where(
          and(
            eq(notificationsTable.relatedEntityType, 'client' as any),
            eq(notificationsTable.relatedEntityId, clientId)
          )
        )
        .orderBy(desc(notificationsTable.createdAt))
        .limit(100);

      // Also get session-related notifications for this client's sessions
      const clientSessions = await storage.getSessionsByClient(clientId, true);
      const sessionIds = clientSessions.map((s: any) => s.id);

      let sessionNotifications: any[] = [];
      if (sessionIds.length > 0) {
        const { inArray } = await import("drizzle-orm");
        sessionNotifications = await db
          .select()
          .from(notificationsTable)
          .where(
            and(
              eq(notificationsTable.relatedEntityType, 'session' as any),
              inArray(notificationsTable.relatedEntityId, sessionIds)
            )
          )
          .orderBy(desc(notificationsTable.createdAt))
          .limit(100);
      }

      // Also get billing/invoice-related notifications for this client
      const billingRecords = await storage.getBillingRecordsByClient(clientId);
      const billingIds = billingRecords.map((b: any) => b.id);

      let billingNotifications: any[] = [];
      if (billingIds.length > 0) {
        const { inArray } = await import("drizzle-orm");
        billingNotifications = await db
          .select()
          .from(notificationsTable)
          .where(
            and(
              eq(notificationsTable.relatedEntityType, 'billing' as any),
              inArray(notificationsTable.relatedEntityId, billingIds)
            )
          )
          .orderBy(desc(notificationsTable.createdAt))
          .limit(100);
      }

      // Combine and sort all notifications
      const allNotifications = [...clientNotifications, ...sessionNotifications, ...billingNotifications]
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        .slice(0, 50); // Limit to 50 most recent for portal

      res.json(allNotifications);
    } catch (error) {
      console.error("Portal notifications error:", error);
      res.status(500).json({ error: "Failed to fetch notifications" });
    }
  });

  // Portal - Get available services for booking
  app.get("/api/portal/services", async (req, res) => {
    try {
      // Read session token from HttpOnly cookie
      const sessionToken = req.cookies.portalSessionToken;

      if (!sessionToken) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const session = await storage.getPortalSessionByToken(sessionToken);
      
      if (!session) {
        return res.status(401).json({ error: "Invalid or expired session" });
      }

      // Update session activity
      await storage.updatePortalSessionActivity(session.id);

      // Get all active services that are visible in client portal
      const allServices = await storage.getServices();
      const availableServices = allServices.filter(s => s.isActive && s.clientPortalVisible);

      res.json(availableServices);
    } catch (error) {
      console.error("Portal services error:", error);
      res.status(500).json({ error: "Failed to fetch services" });
    }
  });

  // Portal - Get available time slots for booking
  app.get("/api/portal/available-slots", async (req, res) => {
    try {
      // Read session token from HttpOnly cookie
      const sessionToken = req.cookies.portalSessionToken;

      if (!sessionToken) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const session = await storage.getPortalSessionByToken(sessionToken);
      
      if (!session) {
        return res.status(401).json({ error: "Invalid or expired session" });
      }

      // Update session activity
      await storage.updatePortalSessionActivity(session.id);

      // Get client info to find assigned therapist
      const client = await storage.getClient(session.clientId);
      
      if (!client || !client.assignedTherapistId) {
        return res.status(400).json({ error: "No therapist assigned to your account" });
      }

      // Get query parameters for date range and session type
      const { startDate, endDate, sessionType } = req.query;
      
      if (!startDate || !endDate) {
        return res.status(400).json({ error: "Start date and end date are required" });
      }
      
      if (!sessionType || (sessionType !== 'online' && sessionType !== 'in-person')) {
        return res.status(400).json({ error: "Valid session type (online or in-person) is required" });
      }

      // Calculate available slots - show therapist's working hours based on session type
      // Get therapist profile for working hours
      const therapistProfile = await storage.getUserProfile(client.assignedTherapistId);
      if (!therapistProfile) {
        return res.status(400).json({ error: "Therapist profile not found" });
      }
      
      // ⚡ OPTIMIZED: Fetch all data ONCE for entire date range (not per-day)
      // This reduces database queries from 180+ (30 days × 6 queries) to just 5 queries total
      const start = new Date(startDate as string);
      const end = new Date(endDate as string);
      
      // 1. Get service info (for duration)
      // NOTE: Using standard 60-min psychotherapy service (ID 23) for slot interval generation
      // The actual service is selected later in the booking flow, and availability is re-validated
      // at booking time with the actual service duration and conflicts check via transaction
      const service = await db.select().from(services).where(eq(services.id, 23)).limit(1);
      const sessionDuration = service[0]?.duration || therapistProfile.sessionDuration || 60;
      
      // 2. Get ALL blocked times for entire date range (1 query instead of 30)
      const rangeStart = new Date(start);
      rangeStart.setHours(0, 0, 0, 0);
      const rangeEnd = new Date(end);
      rangeEnd.setHours(23, 59, 59, 999);
      
      const blockedTimes = await storage.getTherapistBlockedTimes(
        client.assignedTherapistId,
        rangeStart,
        rangeEnd
      );
      
      // 3. Get ALL therapist sessions for entire date range (1 query instead of 30)
      const therapistSessions = await db
        .select()
        .from(sessions)
        .where(and(
          eq(sessions.therapistId, client.assignedTherapistId),
          gte(sessions.sessionDate, rangeStart),
          lte(sessions.sessionDate, rangeEnd),
          inArray(sessions.status, ['scheduled', 'confirmed', 'in-progress'])
        ));
      
      // 4. Get ALL sessions for room checking (1 query instead of 30)
      const allSessions = await db
        .select()
        .from(sessions)
        .where(and(
          gte(sessions.sessionDate, rangeStart),
          lte(sessions.sessionDate, rangeEnd),
          inArray(sessions.status, ['scheduled', 'confirmed', 'in-progress'])
        ));
      
      // Parse working hours
      const workingHoursData = therapistProfile.workingHours ? JSON.parse(therapistProfile.workingHours) : null;
      
      // Now process each day in memory (fast, no more database queries)
      const slotsByDate: Record<string, Array<{start: string; end: string}>> = {};
      
      for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        const dateKey = d.toISOString().split('T')[0];
        const dayOfWeek = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'][d.getDay()];
        
        // Check working hours for this day
        let dayHours;
        if (Array.isArray(workingHoursData)) {
          dayHours = workingHoursData.find(dh => dh.day && dh.day.toLowerCase() === dayOfWeek.toLowerCase());
        } else if (workingHoursData && typeof workingHoursData === 'object') {
          dayHours = workingHoursData[dayOfWeek];
        }
        
        if (!dayHours || dayHours.enabled === false || !dayHours.start || !dayHours.end) {
          slotsByDate[dateKey] = []; // Not a working day
          continue;
        }
        
        // Get sessions for this specific day using centralized timezone helpers
        const dayTherapistSessions = therapistSessions.filter(s => 
          utcDateMatchesLocalDate(new Date(s.sessionDate), dateKey)
        );
        
        const dayAllSessions = allSessions.filter(s => 
          utcDateMatchesLocalDate(new Date(s.sessionDate), dateKey)
        );
        
        const dayBlockedTimes = blockedTimes.filter(bt => {
          const btStart = new Date(bt.startTime);
          const btEnd = new Date(bt.endTime);
          const startDateStr = utcToLocalDateString(btStart);
          const endDateStr = utcToLocalDateString(btEnd);
          
          // Include if blocked time:
          // 1. Starts on this day
          // 2. Ends on this day
          // 3. Spans this day (starts before, ends after)
          return startDateStr === dateKey || 
                 endDateStr === dateKey || 
                 (startDateStr < dateKey && endDateStr > dateKey);
        });
        
        // Generate time slots for this day
        const availableSlots = [];
        const [startHour, startMin] = dayHours.start.split(':').map(Number);
        const [endHour, endMin] = dayHours.end.split(':').map(Number);
        
        for (let hour = startHour; hour < endHour || (hour === endHour && startMin < endMin); hour++) {
          for (let minute = 0; minute < 60; minute += 30) {
            if (hour === startHour && minute < startMin) continue;
            if (hour === endHour && minute >= endMin) break;
            
            // Create slot time in America/New_York timezone, then convert to UTC
            const slotDate = localTimeToUtc(dateKey, hour, minute);
            const slotEnd = new Date(slotDate.getTime() + sessionDuration * 60000);
            
            // Check therapist availability
            const isTherapistBusy = dayTherapistSessions.some(s => {
              const sStart = new Date(s.sessionDate);
              const sEnd = new Date(sStart.getTime() + (s.duration || 60) * 60000);
              return slotDate < sEnd && slotEnd > sStart;
            });
            
            // Check blocked times
            const isBlocked = dayBlockedTimes.some(bt => {
              const btStart = new Date(bt.startTime);
              const btEnd = new Date(bt.endTime);
              return slotDate < btEnd && slotEnd > btStart;
            });
            
            // Check room availability
            let roomAvailable = false;
            if (sessionType === 'online') {
              if (therapistProfile.virtualRoomId) {
                const roomBusy = dayAllSessions.some(s => {
                  if (s.roomId !== therapistProfile.virtualRoomId) return false;
                  const sStart = new Date(s.sessionDate);
                  const sEnd = new Date(sStart.getTime() + (s.duration || 60) * 60000);
                  return slotDate < sEnd && slotEnd > sStart;
                });
                roomAvailable = !roomBusy;
              }
            } else {
              const availableRooms = therapistProfile.availablePhysicalRooms || [];
              roomAvailable = availableRooms.some(roomId => {
                const roomBusy = dayAllSessions.some(s => {
                  if (s.roomId !== roomId) return false;
                  const sStart = new Date(s.sessionDate);
                  const sEnd = new Date(sStart.getTime() + (s.duration || 60) * 60000);
                  return slotDate < sEnd && slotEnd > sStart;
                });
                return !roomBusy;
              });
            }
            
            if (!isTherapistBusy && !isBlocked && roomAvailable) {
              const startHour24 = hour.toString().padStart(2, '0');
              const startMin24 = minute.toString().padStart(2, '0');
              const endHour24 = slotEnd.getHours().toString().padStart(2, '0');
              const endMin24 = slotEnd.getMinutes().toString().padStart(2, '0');
              
              availableSlots.push({
                start: `${startHour24}:${startMin24}`,
                end: `${endHour24}:${endMin24}`
              });
            }
          }
        }
        
        slotsByDate[dateKey] = availableSlots;
      }

      // Disable caching for this endpoint
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      res.json(slotsByDate);
    } catch (error) {
      console.error("Portal available slots error:", error);
      res.status(500).json({ error: "Failed to fetch available slots" });
    }
  });

  // Portal - Book a new appointment
  app.post("/api/portal/book-appointment", async (req, res) => {
    const { ipAddress, userAgent } = getRequestInfo(req);
    
    try {
      // Read session token from HttpOnly cookie
      const sessionToken = req.cookies.portalSessionToken;

      if (!sessionToken) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const session = await storage.getPortalSessionByToken(sessionToken);
      
      if (!session) {
        return res.status(401).json({ error: "Invalid or expired session" });
      }

      // Update session activity
      await storage.updatePortalSessionActivity(session.id);

      // Get client info
      const client = await storage.getClient(session.clientId);
      
      if (!client || !client.assignedTherapistId) {
        return res.status(400).json({ error: "No therapist assigned to your account" });
      }

      const { sessionStartUtc, duration, serviceId, sessionType, location } = req.body;

      if (!sessionStartUtc) {
        return res.status(400).json({ error: "Session date and time are required" });
      }

      if (!serviceId) {
        return res.status(400).json({ error: "Service selection is required" });
      }
      
      // Parse UTC timestamp from frontend (already converted from EST to UTC)
      const sessionDateTime = new Date(sessionStartUtc);
      
      // Extract sessionTime in EST for backward compatibility
      const { formatInTimeZone } = await import('date-fns-tz');
      const sessionTime = formatInTimeZone(sessionDateTime, 'America/New_York', 'HH:mm');

      // Get therapist profile for room assignment
      const therapistProfile = await storage.getUserProfile(client.assignedTherapistId);
      if (!therapistProfile) {
        return res.status(400).json({ error: "Therapist profile not found" });
      }

      // ⚡ DATABASE TRANSACTION: Prevent double-booking race conditions
      // This ensures atomic check-and-create - no one else can book between our availability check and session creation
      const newSession = await db.transaction(async (tx) => {
        const sessionDuration = duration || 60;
        const sessionEnd = new Date(sessionDateTime.getTime() + sessionDuration * 60000);

        // CRITICAL: Re-check therapist availability INSIDE transaction
        // This prevents race condition where two clients book simultaneously
        const therapistConflicts = await tx
          .select()
          .from(sessions)
          .where(and(
            eq(sessions.therapistId, client.assignedTherapistId!),
            inArray(sessions.status, ['scheduled', 'confirmed', 'in-progress'])
          ));

        // Check for time overlap with existing sessions
        const hasTherapistConflict = therapistConflicts.some(s => {
          const existingStart = new Date(s.sessionDate);
          const existingEnd = new Date(existingStart.getTime() + (s.duration || 60) * 60000);
          return sessionDateTime < existingEnd && sessionEnd > existingStart;
        });

        if (hasTherapistConflict) {
          throw new Error("This time slot is no longer available. Please select another time.");
        }

        // Assign room based on session type
        let assignedRoomId = null;
        
        if (sessionType === 'online') {
          // ONLINE: Assign therapist's configured virtual room
          assignedRoomId = therapistProfile.virtualRoomId || null;
        } else if (sessionType === 'in-person') {
          // IN-PERSON: Find first available physical room
          const availableRooms = therapistProfile.availablePhysicalRooms || [];
          
          if (availableRooms.length > 0) {
            for (const roomId of availableRooms) {
              // Check room conflicts INSIDE transaction
              const roomConflicts = await tx
                .select()
                .from(sessions)
                .where(and(
                  eq(sessions.roomId, roomId),
                  inArray(sessions.status, ['scheduled', 'confirmed', 'in-progress'])
                ));
              
              // Check for time overlap
              const hasRoomConflict = roomConflicts.some(s => {
                const existingStart = new Date(s.sessionDate);
                const existingEnd = new Date(existingStart.getTime() + (s.duration || 60) * 60000);
                return sessionDateTime < existingEnd && sessionEnd > existingStart;
              });
              
              if (!hasRoomConflict) {
                assignedRoomId = roomId;
                break;
              }
            }
            
            if (!assignedRoomId) {
              throw new Error("No rooms available for this time slot. Please select another time.");
            }
          }
        }

        // Create session atomically within transaction
        const [createdSession] = await tx
          .insert(sessions)
          .values({
            clientId: session.clientId,
            therapistId: client.assignedTherapistId!,
            serviceId: serviceId,
            roomId: assignedRoomId,
            sessionDate: sessionDateTime,
            duration: sessionDuration,
            sessionType: sessionType || 'online',
            status: 'scheduled',
          })
          .returning();

        return createdSession;
      });

      // Audit appointment booking
      const sessionDateEST = formatInTimeZone(sessionDateTime, 'America/New_York', 'yyyy-MM-dd');
      await AuditLogger.logSessionAccess(
        client.id,
        client.portalEmail || client.email || 'unknown',
        newSession.id,
        session.clientId,
        'session_created',
        ipAddress,
        userAgent,
        { 
          portal: true, 
          sessionDate: sessionDateEST, 
          sessionTime, 
          sessionType,
          bookedByClient: true 
        }
      );

      // Trigger full notification service (same as therapist booking)
      try {
        // Get therapist details
        const therapist = await storage.getUser(client.assignedTherapistId);
        
        // Get room name if room is assigned
        let roomName = null;
        if (newSession.roomId) {
          try {
            const rooms = await storage.getRooms();
            const room = rooms.find(r => r.id === newSession.roomId);
            roomName = room?.roomName || room?.roomNumber || `Room ${newSession.roomId}`;
          } catch (error) {
            console.warn('[PORTAL BOOKING] Could not fetch room name for notification');
            roomName = `Room ${newSession.roomId}`;
          }
        }
        
        const notificationData = {
          id: newSession.id,
          clientId: newSession.clientId,
          therapistId: newSession.therapistId,
          clientName: client.fullName,
          therapistName: therapist?.fullName || 'Unknown Therapist',
          sessionDate: newSession.sessionDate,
          sessionType: newSession.sessionType,
          roomId: newSession.roomId,
          roomName: roomName,
          duration: newSession.duration,
          createdAt: newSession.createdAt,
          location: sessionType === 'online' ? 'Online' : 'Office',
          bookedByClient: true, // Flag to indicate this was booked through portal
          zoomEnabled: false, // Portal bookings don't create Zoom meetings
          zoomMeetingData: null
        };
        
        await notificationService.processEvent('session_scheduled', notificationData);
      } catch (notificationError) {
        console.error('[PORTAL BOOKING] Session scheduled notification failed:', notificationError);
        // Don't fail the booking if notification fails
      }

      res.status(201).json({
        message: "Appointment booked successfully",
        appointment: {
          id: newSession.id,
          sessionDate: formatInTimeZone(newSession.sessionDate, 'America/New_York', 'yyyy-MM-dd'),
          sessionTime: sessionTime,
          duration: newSession.duration,
          sessionType: newSession.sessionType,
          status: newSession.status,
          location: sessionType === 'online' ? 'Online' : 'Office',
        }
      });
    } catch (error) {
      console.error("Portal book appointment error:", error);
      res.status(500).json({ error: "Failed to book appointment" });
    }
  });

  // Portal - Get client invoices
  app.get("/api/portal/invoices", async (req, res) => {
    const { ipAddress, userAgent } = getRequestInfo(req);
    
    try {
      // Read session token from HttpOnly cookie
      const sessionToken = req.cookies.portalSessionToken;

      if (!sessionToken) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const session = await storage.getPortalSessionByToken(sessionToken);
      
      if (!session) {
        return res.status(401).json({ error: "Invalid or expired session" });
      }

      // Update session activity
      await storage.updatePortalSessionActivity(session.id);

      // Get invoices for this client with service information
      const allInvoices = await storage.getClientInvoices(session.clientId);
      
      // Filter to last 6 months - older records can be requested from therapist
      const sixMonthsAgo = new Date();
      sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
      
      const rawInvoices = allInvoices.filter(inv => {
        const invoiceDate = inv.billingDate ? new Date(inv.billingDate) : 
                           inv.sessionDate ? new Date(inv.sessionDate) : null;
        return invoiceDate && invoiceDate >= sixMonthsAgo;
      });
      
      // Fetch services for service names
      const allServices = await storage.getServices();
      const serviceMap = new Map(allServices.map(s => [s.serviceCode, s]));
      
      // Enrich invoices with service names
      const invoices = rawInvoices.map(inv => {
        const service = inv.serviceCode ? serviceMap.get(inv.serviceCode) : null;
        return {
          ...inv,
          serviceName: service?.serviceName || null,
        };
      });

      // Audit invoice access
      const client = await storage.getClient(session.clientId);
      if (client) {
        await AuditLogger.logAction({
          userId: null, // Portal users are clients, not in users table
          username: client.portalEmail || client.email || 'unknown',
          action: 'invoices_viewed',
          result: 'success',
          resourceType: 'billing',
          resourceId: session.clientId.toString(),
          clientId: session.clientId,
          ipAddress,
          userAgent,
          hipaaRelevant: true,
          riskLevel: 'medium',
          details: JSON.stringify({ portal: true, invoiceCount: invoices.length }),
          accessReason: 'Client portal invoice viewing',
        });
      }

      res.json(invoices);
    } catch (error) {
      console.error("Portal invoices error:", error);
      res.status(500).json({ error: "Failed to fetch invoices" });
    }
  });

  // Portal - Initiate payment for invoice
  app.post("/api/portal/invoices/:invoiceId/pay", async (req, res) => {
    const { ipAddress, userAgent } = getRequestInfo(req);
    
    try {
      // Check if Stripe is configured
      if (!stripe) {
        return res.status(503).json({ error: "Payment system not configured" });
      }

      // Read session token from HttpOnly cookie
      const sessionToken = req.cookies.portalSessionToken;

      if (!sessionToken) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const session = await storage.getPortalSessionByToken(sessionToken);
      
      if (!session) {
        return res.status(401).json({ error: "Invalid or expired session" });
      }

      // Update session activity
      await storage.updatePortalSessionActivity(session.id);

      const invoiceId = parseInt(req.params.invoiceId);
      
      // Get the invoice (already filtered by clientId in getClientInvoices)
      const invoices = await storage.getClientInvoices(session.clientId);
      const invoice = invoices.find(inv => inv.id === invoiceId);
      
      if (!invoice) {
        return res.status(404).json({ error: "Invoice not found or access denied" });
      }

      // Check if already paid
      if (invoice.paymentStatus === 'paid') {
        return res.status(400).json({ error: "Invoice already paid" });
      }

      // Get client info
      const client = await storage.getClient(session.clientId);
      if (!client) {
        return res.status(404).json({ error: "Client not found" });
      }

      // Create Stripe Checkout Session
      const checkoutSession = await stripe.checkout.sessions.create({
        payment_method_types: ['card'],
        line_items: [
          {
            price_data: {
              currency: 'usd',
              product_data: {
                name: `${(invoice as any).serviceName || invoice.serviceCode} - ${invoice.sessionType}`,
                description: `Session on ${formatInTimeZone(invoice.sessionDate, 'America/New_York', 'MMM dd, yyyy')}`,
              },
              unit_amount: Math.round(parseFloat(invoice.totalAmount) * 100), // Convert to cents
            },
            quantity: 1,
          },
        ],
        mode: 'payment',
        success_url: `${req.protocol}://${req.get('host')}/portal/invoices?payment=success&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${req.protocol}://${req.get('host')}/portal/invoices?payment=cancelled`,
        client_reference_id: invoiceId.toString(),
        customer_email: client.portalEmail || client.email || undefined,
        metadata: {
          invoiceId: invoiceId.toString(),
          clientId: session.clientId.toString(),
          portalPayment: 'true',
        },
      });

      // Audit payment initiation
      await AuditLogger.logAction({
        userId: client.id,
        username: client.portalEmail || client.email || 'unknown',
        action: 'payment_initiated',
        result: 'success',
        resourceType: 'billing',
        resourceId: invoiceId.toString(),
        clientId: session.clientId,
        ipAddress,
        userAgent,
        hipaaRelevant: true,
        riskLevel: 'high',
        details: JSON.stringify({ 
          portal: true, 
          amount: invoice.totalAmount,
          stripeSessionId: checkoutSession.id 
        }),
        accessReason: 'Client portal payment initiation',
      });

      res.json({ 
        sessionId: checkoutSession.id,
        checkoutUrl: checkoutSession.url 
      });
    } catch (error) {
      console.error("Portal payment error:", error);
      res.status(500).json({ error: "Failed to initiate payment" });
    }
  });

  // Stripe webhook handler for payment confirmations
  app.post("/api/stripe/webhook", async (req, res) => {
    try {
      if (!stripe) {
        return res.status(503).json({ error: "Payment system not configured" });
      }

      const sig = req.headers['stripe-signature'];
      
      if (!sig) {
        return res.status(400).json({ error: "No signature" });
      }

      // Note: In production, you should verify the webhook signature
      // For now, we'll process the event directly
      const event = req.body;

      // Handle successful checkout session
      if (event.type === 'checkout.session.completed') {
        const session = event.data.object;
        const invoiceId = parseInt(session.metadata.invoiceId);
        const clientId = parseInt(session.metadata.clientId);

        // Update invoice payment status
        await db
          .update(sessionBilling)
          .set({
            paymentStatus: 'paid',
            paymentAmount: (session.amount_total / 100).toString(), // Convert cents to dollars
            paymentDate: new Date().toISOString().split('T')[0],
            paymentReference: session.payment_intent as string,
            paymentMethod: 'stripe',
          })
          .where(eq(sessionBilling.id, invoiceId));

        // Audit payment completion
        await AuditLogger.logAction({
          userId: clientId,
          username: session.customer_email || 'unknown',
          action: 'payment_completed',
          result: 'success',
          resourceType: 'billing',
          resourceId: invoiceId.toString(),
          clientId: clientId,
          ipAddress: 'stripe-webhook',
          userAgent: 'stripe-webhook',
          hipaaRelevant: true,
          riskLevel: 'high',
          details: JSON.stringify({ 
            portal: true, 
            amount: (session.amount_total / 100).toString(),
            stripeSessionId: session.id,
            paymentIntent: session.payment_intent,
          }),
          accessReason: 'Stripe payment webhook processing',
        });

        // Send payment receipt email
        try {
          // Get client and invoice details
          const client = await storage.getClient(clientId);
          const invoiceDetails = await db
            .select({
              invoice: sessionBilling,
              sessionDate: sessions.sessionDate,
              sessionType: sessions.sessionType,
              serviceName: services.serviceName,
              serviceCode: services.serviceCode,
            })
            .from(sessionBilling)
            .leftJoin(sessions, eq(sessionBilling.sessionId, sessions.id))
            .leftJoin(services, eq(sessionBilling.serviceCode, services.serviceCode))
            .where(eq(sessionBilling.id, invoiceId))
            .limit(1);

          if (client && client.email && invoiceDetails.length > 0) {
            const invoice = invoiceDetails[0];
            const amount = (session.amount_total / 100).toFixed(2);
            
            if (process.env.SPARKPOST_API_KEY) {
              const SparkPost = (await import('sparkpost')).default;
              const sp = new SparkPost(process.env.SPARKPOST_API_KEY);
              const fromEmail = getEmailFromAddress();
              
              await sp.transmissions.send({
                options: {
                  sandbox: false,
                },
                content: {
                  from: fromEmail,
                  subject: 'Payment Receipt - SmartHub',
                  html: `
                    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                      <h2 style="color: #2563eb;">Payment Receipt</h2>
                      <p>Dear ${client.fullName},</p>
                      <p>Thank you for your payment. Your payment has been successfully processed.</p>
                      
                      <div style="background-color: #f3f4f6; padding: 20px; border-radius: 8px; margin: 20px 0;">
                        <h3 style="margin-top: 0;">Payment Details</h3>
                        <table style="width: 100%; border-collapse: collapse;">
                          <tr>
                            <td style="padding: 8px 0; font-weight: bold;">Amount Paid:</td>
                            <td style="padding: 8px 0; text-align: right;">$${amount}</td>
                          </tr>
                          <tr>
                            <td style="padding: 8px 0; font-weight: bold;">Payment Method:</td>
                            <td style="padding: 8px 0; text-align: right;">Stripe</td>
                          </tr>
                          <tr>
                            <td style="padding: 8px 0; font-weight: bold;">Payment Date:</td>
                            <td style="padding: 8px 0; text-align: right;">${new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</td>
                          </tr>
                          <tr>
                            <td style="padding: 8px 0; font-weight: bold;">Service:</td>
                            <td style="padding: 8px 0; text-align: right;">${invoice.serviceName || invoice.serviceCode}</td>
                          </tr>
                          <tr>
                            <td style="padding: 8px 0; font-weight: bold;">Session Type:</td>
                            <td style="padding: 8px 0; text-align: right; text-transform: capitalize;">${invoice.sessionType}</td>
                          </tr>
                          <tr>
                            <td style="padding: 8px 0; font-weight: bold;">Reference Number:</td>
                            <td style="padding: 8px 0; text-align: right; font-size: 12px;">${session.payment_intent || session.id}</td>
                          </tr>
                        </table>
                      </div>
                      
                      <p>You can view all your invoices and receipts by logging into your client portal.</p>
                      
                      <p style="margin-top: 30px;">
                        If you have any questions about this payment, please contact us.
                      </p>
                      
                      <p style="color: #6b7280; font-size: 12px; margin-top: 30px;">
                        This is an automated receipt from SmartHub. Please do not reply to this email.
                      </p>
                    </div>
                  `,
                },
                recipients: [{ address: client.email }],
              });

              console.log(`[EMAIL] Payment receipt sent to ${client.email} for invoice ${invoiceId}`);
            }
          }
        } catch (emailError) {
          console.error('[EMAIL] Failed to send payment receipt:', emailError);
          // Don't fail the webhook if email fails
        }

        console.log(`Payment completed for invoice ${invoiceId}`);
      }

      res.json({ received: true });
    } catch (error) {
      console.error("Stripe webhook error:", error);
      res.status(500).json({ error: "Webhook processing failed" });
    }
  });

  // Portal - View/Download Invoice Receipt
  app.post("/api/portal/invoices/:invoiceId/receipt", async (req, res) => {
    const { ipAddress, userAgent } = getRequestInfo(req);
    
    try {
      // Read session token from HttpOnly cookie
      const sessionToken = req.cookies.portalSessionToken;

      if (!sessionToken) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const session = await storage.getPortalSessionByToken(sessionToken);
      
      if (!session) {
        return res.status(401).json({ error: "Invalid or expired session" });
      }

      // Update session activity
      await storage.updatePortalSessionActivity(session.id);

      const invoiceId = parseInt(req.params.invoiceId);
      const { action } = req.body; // 'preview' or 'download'

      console.log(`[RECEIPT] Fetching invoice ${invoiceId} for client ${session.clientId}`);

      // Get invoice data - ensure it belongs to this client
      const invoiceData = await storage.getBillingForInvoice(session.clientId, invoiceId);
      
      console.log(`[RECEIPT] Invoice data found:`, invoiceData ? 'yes' : 'no');
      
      if (!invoiceData) {
        console.log(`[RECEIPT] Invoice ${invoiceId} not found for client ${session.clientId}`);
        return res.status(404).json({ error: "Invoice not found" });
      }

      const client = invoiceData.client;
      const billing = invoiceData.billing;
      const sessionData = invoiceData.session;
      const service = invoiceData.service;

      // Get provider info
      let providerInfo = null;
      if (invoiceData.therapist) {
        const therapistProfile = await storage.getUserProfile(invoiceData.therapist.id);
        providerInfo = {
          name: invoiceData.therapist.fullName || 'Amjed Abojedi',
          credentials: therapistProfile?.licenseType || 'CRPO',
          license: therapistProfile?.licenseNumber || 'License not set in profile',
          licenseState: therapistProfile?.licenseState || 'ON',
        };
      } else {
        providerInfo = {
          name: 'Amjed Abojedi',
          credentials: 'CRPO',
          license: 'License not set in profile',
          licenseState: 'ON',
        };
      }

      // Get practice settings
      let practiceSettings = {
        name: 'Resilience Counseling Research & Consultation',
        address: '111 Waterloo St Unit 406, London, ON N6B 2M4',
        phone: '+1 (548)866-0366',
        email: 'mail@resiliencec.com',
        website: 'www.resiliencec.com'
      };

      try {
        const practiceOptions = await storage.getSystemOptionsByCategory('practice_settings');
        practiceSettings.name = practiceOptions.find(o => o.optionKey === 'practice_name')?.optionLabel || practiceSettings.name;
        practiceSettings.address = practiceOptions.find(o => o.optionKey === 'practice_address')?.optionLabel || practiceSettings.address;
        practiceSettings.phone = practiceOptions.find(o => o.optionKey === 'practice_phone')?.optionLabel || practiceSettings.phone;
        practiceSettings.email = practiceOptions.find(o => o.optionKey === 'practice_email')?.optionLabel || practiceSettings.email;
        practiceSettings.website = practiceOptions.find(o => o.optionKey === 'practice_website')?.optionLabel || practiceSettings.website;
      } catch (error) {
        // Use defaults
      }

      const invoiceNumber = `INV-${client.clientId}-${billing.id}`;
      const serviceDate = formatInTimeZone(new Date(sessionData.sessionDate), 'America/New_York', 'MMM dd, yyyy');
      const invoiceDate = billing.billingDate ? formatInTimeZone(new Date(billing.billingDate), 'America/New_York', 'MMM dd, yyyy') : serviceDate;
      const paymentDate = billing.paymentDate ? formatInTimeZone(new Date(billing.paymentDate), 'America/New_York', 'MMM dd, yyyy') : null;

      // Calculate payment amounts
      const subtotal = parseFloat(billing.totalAmount);
      // Calculate insurance coverage from actual copay amount, not hardcoded 80%
      const insuranceCoverage = billing.insuranceCovered && billing.copayAmount 
        ? subtotal - parseFloat(billing.copayAmount) 
        : 0;
      const copayTotal = billing.insuranceCovered ? parseFloat(billing.copayAmount || '0') : 0;
      const totalDiscount = parseFloat(billing.discountAmount || '0');
      const totalPayments = parseFloat(billing.paymentAmount || '0');
      const remainingDue = subtotal - totalDiscount - totalPayments;

      // Use EXACT SAME invoice HTML template as admin system
      const invoiceHtml = `
        <!DOCTYPE html>
        <html>
        <head>
          <title>Invoice - ${client.fullName} - ${billing.serviceCode}</title>
          <style>
            body { 
              font-family: 'Times New Roman', Times, serif; 
              margin: 40px; 
              font-size: 11pt;
              line-height: 1.4;
              color: #000000;
            }
            .header { display: flex; justify-content: space-between; margin-bottom: 40px; }
            .invoice-title { 
              font-size: 26px; 
              font-weight: bold; 
              color: #000000; 
              font-family: 'Times New Roman', Times, serif;
              text-transform: uppercase;
              letter-spacing: 1px;
            }
            .company-info { 
              text-align: right; 
              color: #333333;
              font-size: 10pt;
              line-height: 1.3;
              font-family: 'Times New Roman', Times, serif;
            }
            .company-info h3 {
              font-size: 13pt;
              font-weight: bold;
              color: #000000;
              margin-bottom: 8px;
              font-family: 'Times New Roman', Times, serif;
            }
            .client-info { display: flex; gap: 60px; margin-bottom: 40px; }
            .section-title { 
              font-size: 13pt; 
              font-weight: bold; 
              color: #000000; 
              margin-bottom: 12px;
              font-family: 'Times New Roman', Times, serif;
              text-transform: uppercase;
              border-bottom: 1px solid #000000;
              padding-bottom: 4px;
            }
            table { 
              width: 100%; 
              border-collapse: collapse; 
              margin-bottom: 30px;
              font-size: 10pt;
            }
            th, td { 
              border: 1px solid #000000; 
              padding: 10px 12px; 
              text-align: left;
              font-family: 'Times New Roman', Times, serif;
            }
            th { 
              background-color: #f5f5f5;
              font-weight: bold;
              color: #000000;
            }
            .totals { width: 300px; margin-left: auto; }
            .total-row { 
              display: flex; 
              justify-content: space-between; 
              margin-bottom: 8px;
              font-size: 10pt;
              font-family: 'Times New Roman', Times, serif;
            }
            .total-due { 
              font-weight: bold; 
              font-size: 13pt; 
              border-top: 2px solid #000000; 
              padding-top: 8px;
              color: #000000;
              font-family: 'Times New Roman', Times, serif;
            }
            .invoice-number {
              font-weight: bold;
              font-size: 11pt;
              font-family: 'Times New Roman', Times, serif;
            }
            @media print { 
              body { margin: 0.5in; font-size: 10pt; }
              .header { margin-bottom: 20px; }
              .invoice-title { font-size: 22pt; }
              .section-title { font-size: 11pt; }
              .client-info { margin-bottom: 20px; }
              table { font-size: 9pt; }
              th, td { padding: 8px; }
            }
          </style>
        </head>
        <body>
          <div class="header">
            <div>
              <h1 class="invoice-title">INVOICE</h1>
              <p>Invoice #: ${invoiceNumber}</p>
              <p>Date: ${invoiceDate}</p>
              <p>Service Date: ${serviceDate}</p>
            </div>
            <div class="company-info">
              <h3>${practiceSettings.name}</h3>
              <div style="margin-top: 10px; font-size: 0.9em;">
                <p>${practiceSettings.address.replace('\n', '<br>')}</p>
                <p>Phone: ${practiceSettings.phone}</p>
                <p>Email: ${practiceSettings.email}</p>
                <p>Website: ${practiceSettings.website}</p>
              </div>
            </div>
          </div>
          
          <div class="client-info">
            <div>
              <h3 class="section-title">Bill To:</h3>
              <p>${client.fullName}</p>
              <p>${client.address || ''}</p>
              <p>${client.phone || ''}</p>
              <p>${client.email || ''}</p>
            </div>
            <div>
              <h3 class="section-title">Insurance Info:</h3>
              <p>Provider: ${client.insuranceProvider || 'N/A'}</p>
              <p>Policy: ${client.policyNumber || 'N/A'}</p>
              <p>Group: ${client.groupNumber || 'N/A'}</p>
            </div>
          </div>
          
          <table>
            <thead>
              <tr>
                <th>Service</th>
                <th>CPT Code</th>
                <th>Date</th>
                <th style="text-align: right;">Amount</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>${service?.name || 'Professional Service'}</td>
                <td>${service?.serviceCode || billing.serviceCode}</td>
                <td>${serviceDate}</td>
                <td style="text-align: right;">$${subtotal.toFixed(2)}</td>
              </tr>
            </tbody>
          </table>
          
          <div class="totals">
            <div class="total-row">
              <span>Service Amount:</span>
              <span>$${subtotal.toFixed(2)}</span>
            </div>
            ${totalDiscount > 0 ? `
            <div class="total-row" style="color: #059669;">
              <span>Discount Applied:</span>
              <span>-$${totalDiscount.toFixed(2)}</span>
            </div>` : ''}
            ${billing.insuranceCovered ? `
            <div class="total-row">
              <span>Insurance Coverage:</span>
              <span>-$${insuranceCoverage.toFixed(2)}</span>
            </div>` : ''}
            ${billing.insuranceCovered ? `
            <div class="total-row">
              <span>Copay Amount:</span>
              <span>$${copayTotal.toFixed(2)}</span>
            </div>` : ''}
            ${totalPayments > 0 ? `
            <div class="total-row">
              <span>Payments Received:</span>
              <span>-$${totalPayments.toFixed(2)}</span>
            </div>` : ''}
            <div class="total-row total-due">
              <span>Total Due:</span>
              <span style="${remainingDue === 0 ? 'color: #16a34a; font-weight: bold;' : ''}">
                $${remainingDue.toFixed(2)}
              </span>
            </div>
            ${remainingDue === 0 ? `
            <div class="total-row" style="color: #16a34a; font-weight: bold; margin-top: 10px;">
              <span>Status:</span>
              <span>✓ PAID IN FULL</span>
            </div>` : ''}
          </div>
          
          <div style="margin-top: 40px; padding: 20px; border-top: 2px solid #e2e8f0; background-color: #f8fafc; font-size: 12px; color: #64748b;">
            <h4 style="color: #1e293b; margin-bottom: 15px; font-size: 13px;">Provider Information for Insurance Reimbursement</h4>
            <div>
              <p><strong>Provider Name:</strong> ${providerInfo.name}</p>
              <p><strong>License Name:</strong> ${providerInfo.credentials}</p>
              <p><strong>License Number:</strong> ${providerInfo.license}</p>
            </div>
          </div>
        </body>
        </html>
      `;

      // Audit log
      await AuditLogger.logAction({
        userId: null, // Portal users are clients, not in users table
        username: client.email || 'unknown',
        action: 'invoice_viewed',
        result: 'success',
        resourceType: 'billing',
        resourceId: invoiceId.toString(),
        clientId: session.clientId,
        ipAddress,
        userAgent,
        hipaaRelevant: true,
        riskLevel: 'medium',
        details: JSON.stringify({ portal: true, action, invoiceNumber }),
        accessReason: 'Client portal invoice receipt access',
      });

      // Return HTML - browser will handle PDF conversion (matching session notes & assessment reports pattern)
      res.setHeader('Content-Type', 'text/html');
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, private');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      res.removeHeader('ETag');
      res.send(invoiceHtml);
    } catch (error) {
      console.error("Portal invoice receipt error:", error);
      res.status(500).json({ error: "Failed to generate receipt" });
    }
  });

  // Portal - Get client documents
  app.get("/api/portal/documents", async (req, res) => {
    const { ipAddress, userAgent } = getRequestInfo(req);
    
    try {
      // Read session token from HttpOnly cookie
      const sessionToken = req.cookies.portalSessionToken;

      if (!sessionToken) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const session = await storage.getPortalSessionByToken(sessionToken);
      
      if (!session) {
        return res.status(401).json({ error: "Invalid or expired session" });
      }

      // Update session activity
      await storage.updatePortalSessionActivity(session.id);

      // Get client info for display
      const client = await storage.getClient(session.clientId);
      
      if (!client) {
        return res.status(404).json({ error: "Client not found" });
      }

      // Query documents directly with LEFT JOIN to include all cases
      const { db } = await import('./db');
      const { documents, users } = await import('@shared/schema');
      const { eq, desc } = await import('drizzle-orm');

      const results = await db
        .select({
          document: documents,
          uploadedBy: users
        })
        .from(documents)
        .leftJoin(users, eq(documents.uploadedById, users.id))
        .where(eq(documents.clientId, session.clientId))
        .orderBy(desc(documents.createdAt));

      // Map results to include uploadedBy info for all cases
      const portalDocuments = results
        // Show documents that are: (1) uploaded by client (null uploadedById), OR (2) shared by staff
        .filter(r => r.document.uploadedById === null || r.document.isSharedInPortal === true)
        .map(r => {
          // Client uploads: uploadedById is null
          if (r.document.uploadedById === null) {
            return {
              ...r.document,
              uploadedBy: {
                id: client.id,
                fullName: client.fullName,
              }
            };
          }
          // Staff uploads with valid user join
          if (r.uploadedBy) {
            return {
              ...r.document,
              uploadedBy: {
                id: r.uploadedBy.id,
                fullName: r.uploadedBy.fullName,
              }
            };
          }
          // Legacy/unknown uploaders
          return {
            ...r.document,
            uploadedBy: {
              id: 0,
              fullName: "Staff"
            }
          };
        });

      // Audit document access
      await AuditLogger.logAction({
        userId: client.id,
        username: client.portalEmail || client.email || 'unknown',
        action: 'documents_viewed',
        result: 'success',
        resourceType: 'document',
        resourceId: session.clientId.toString(),
        clientId: session.clientId,
        ipAddress,
        userAgent,
        hipaaRelevant: true,
        riskLevel: 'high',
        details: JSON.stringify({ portal: true, documentCount: portalDocuments.length }),
        accessReason: 'Client portal document viewing',
      });

      res.json(portalDocuments);
    } catch (error) {
      console.error("Portal documents error:", error);
      res.status(500).json({ error: "Failed to fetch documents" });
    }
  });

  // Portal - Upload document
  app.post("/api/portal/upload-document", async (req, res) => {
    const { ipAddress, userAgent } = getRequestInfo(req);
    
    try {
      // Read session token from HttpOnly cookie
      const sessionToken = req.cookies.portalSessionToken;

      if (!sessionToken) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const session = await storage.getPortalSessionByToken(sessionToken);
      
      if (!session) {
        return res.status(401).json({ error: "Invalid or expired session" });
      }

      // Update session activity
      await storage.updatePortalSessionActivity(session.id);

      const { fileContent, fileName, originalName, fileSize, mimeType, category } = req.body;

      if (!fileContent || !fileName || !originalName) {
        return res.status(400).json({ error: "Missing required fields" });
      }

      // Create document record (uploaded by client)
      // Portal uploads are marked as shared by default
      // uploadedById is NULL for client uploads (clients aren't in users table)
      const document = await storage.createDocument({
        clientId: session.clientId,
        uploadedById: null, // Null for client uploads (clients not in users table)
        fileName,
        originalName,
        fileSize: fileSize || 0,
        mimeType: mimeType || 'application/octet-stream',
        category: category || 'uploaded',
        isSharedInPortal: true, // Always share portal uploads
      });

      // Store file content in Azure Blob Storage
      if (fileContent) {
        try {
          const fileBuffer = Buffer.from(fileContent, 'base64');
          const uploadResult = await azureStorage.uploadFile(
            fileBuffer,
            document.fileName,
            document.mimeType,
            document.id,
            {
              clientId: document.clientId.toString(),
              uploadedById: document.uploadedById ? document.uploadedById.toString() : 'null',
              category: document.category
            }
          );
          
          if (!uploadResult.success) {
            // Delete document record if storage upload fails
            await storage.deleteDocument(document.id);
            return res.status(500).json({ error: "Failed to upload file to storage" });
          }
        } catch (error) {
          // Delete document record if upload fails
          await storage.deleteDocument(document.id);
          return res.status(400).json({ error: "Upload failed" });
        }
      }

      // Audit document upload
      const client = await storage.getClient(session.clientId);
      if (client) {
        await AuditLogger.logDocumentAccess(
          client.id,
          client.portalEmail || client.email || 'unknown',
          document.id,
          session.clientId,
          'document_uploaded',
          ipAddress,
          userAgent,
          { 
            portal: true, 
            fileName: originalName,
            fileSize,
            category,
            uploadedByClient: true 
          }
        );
      }

      res.status(201).json(document);
    } catch (error) {
      console.error("Portal document upload error:", error);
      res.status(500).json({ error: "Failed to upload document" });
    }
  });

  // Portal - Download document
  app.get("/api/portal/documents/:id/download", async (req, res) => {
    const { ipAddress, userAgent } = getRequestInfo(req);
    
    try {
      // Read session token from HttpOnly cookie
      const sessionToken = req.cookies.portalSessionToken;

      if (!sessionToken) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const session = await storage.getPortalSessionByToken(sessionToken);
      
      if (!session) {
        return res.status(401).json({ error: "Invalid or expired session" });
      }

      // Update session activity
      await storage.updatePortalSessionActivity(session.id);

      const documentId = parseInt(req.params.id);
      
      // Get all documents for this client and find the specific one
      const clientDocuments = await storage.getDocumentsByClient(session.clientId);
      const document = clientDocuments.find(doc => doc.id === documentId);

      if (!document) {
        return res.status(404).json({ error: "Document not found" });
      }

      // Verify document is accessible (client upload OR shared)
      const isClientUpload = document.uploadedById === null;
      const isShared = document.isSharedInPortal === true;
      
      if (!isClientUpload && !isShared) {
        return res.status(403).json({ error: "Document not shared" });
      }

      // Download from Azure Blob Storage (only)
      try {
        // Try to find the blob using multiple name variations
        let blobName = await azureStorage.findBlobName(document.id, document.fileName, document.originalName);
        
        // Fallback to standard blob name if findBlobName didn't find it
        if (!blobName) {
          blobName = azureStorage.generateBlobName(document.id, document.fileName);
        }
        
        const downloadResult = await azureStorage.downloadFile(blobName);
        
        if (downloadResult.success) {
          const fileBuffer = downloadResult.data!;
          
          // Audit document download
          const client = await storage.getClient(session.clientId);
          if (client) {
            await AuditLogger.logDocumentAccess(
              client.id,
              client.portalEmail || client.email || 'unknown',
              document.id,
              session.clientId,
              'document_downloaded',
              ipAddress,
              userAgent,
              { 
                portal: true, 
                fileName: document.originalName,
                fileSize: document.fileSize,
                storageLocation: 'Azure Blob Storage'
              }
            );
          }

          // Serve the file inline (not as download) for preview
          res.setHeader('Content-Type', document.mimeType || 'application/pdf');
          res.setHeader('Content-Disposition', `inline`);
          res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
          res.setHeader('Pragma', 'no-cache');
          res.setHeader('Expires', '0');
          res.send(fileBuffer);
        } else {
          return res.status(404).json({ error: "File not found in storage" });
        }
      } catch (error) {
        console.error('Portal document download error:', error);
        return res.status(500).json({ error: "Failed to download file" });
      }
    } catch (error) {
      console.error("Portal document download error:", error);
      res.status(500).json({ error: "Failed to download document" });
    }
  });

  // Portal - Get client form assignments
  app.get("/api/portal/forms/assignments", async (req, res) => {
    const { ipAddress, userAgent } = getRequestInfo(req);
    
    try {
      const sessionToken = req.cookies.portalSessionToken;

      if (!sessionToken) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const session = await storage.getPortalSessionByToken(sessionToken);
      
      if (!session) {
        return res.status(401).json({ error: "Invalid or expired session" });
      }

      await storage.updatePortalSessionActivity(session.id);

      const client = await storage.getClient(session.clientId);
      
      if (!client) {
        return res.status(404).json({ error: "Client not found" });
      }

      const results = await db
        .select({
          assignment: formAssignments,
          template: formTemplates
        })
        .from(formAssignments)
        .leftJoin(formTemplates, eq(formAssignments.templateId, formTemplates.id))
        .where(eq(formAssignments.clientId, session.clientId))
        .orderBy(desc(formAssignments.createdAt));

      const assignments = results.map(r => ({
        ...r.assignment,
        template: r.template
      }));

      await AuditLogger.logAction({
        userId: client.id,
        username: client.portalEmail || client.email || 'unknown',
        action: 'forms_list_viewed',
        result: 'success',
        resourceType: 'form_assignment',
        resourceId: null,
        clientId: session.clientId,
        ipAddress,
        userAgent,
        hipaaRelevant: true,
        riskLevel: 'low',
        details: JSON.stringify({ portal: true, count: assignments.length }),
        accessReason: 'Client portal forms list access',
      });

      res.json(assignments);
    } catch (error) {
      console.error("Portal forms assignments error:", error);
      res.status(500).json({ error: "Failed to fetch form assignments" });
    }
  });

  // Portal - Get single form assignment with template and fields
  app.get("/api/portal/forms/assignments/:id", async (req, res) => {
    const { ipAddress, userAgent } = getRequestInfo(req);
    
    try {
      const sessionToken = req.cookies.portalSessionToken;

      if (!sessionToken) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const session = await storage.getPortalSessionByToken(sessionToken);
      
      if (!session) {
        return res.status(401).json({ error: "Invalid or expired session" });
      }

      await storage.updatePortalSessionActivity(session.id);

      const assignmentId = parseInt(req.params.id);

      const assignment = await db
        .select()
        .from(formAssignments)
        .where(
          and(
            eq(formAssignments.id, assignmentId),
            eq(formAssignments.clientId, session.clientId)
          )
        )
        .limit(1);

      if (!assignment.length) {
        return res.status(404).json({ error: "Form assignment not found" });
      }

      const template = await db
        .select()
        .from(formTemplates)
        .where(eq(formTemplates.id, assignment[0].templateId))
        .limit(1);

      if (!template.length) {
        return res.status(404).json({ error: "Form template not found" });
      }

      const fields = await db
        .select()
        .from(formFields)
        .where(eq(formFields.templateId, template[0].id))
        .orderBy(asc(formFields.sortOrder));

      const parsedFields = fields.map(field => {
        let parsedOptions = field.options;
        if (field.options && typeof field.options === 'string') {
          try {
            parsedOptions = JSON.parse(field.options);
          } catch {
            // If parsing fails, keep as string (for fields that don't use JSON arrays)
            parsedOptions = field.options;
          }
        }
        return {
          ...field,
          options: parsedOptions
        };
      });

      const client = await storage.getClient(session.clientId);
      const therapist = await storage.getUser(assignment[0].assignedById);
      
      // Fetch therapist profile for additional contact info (emergency contact phone as fallback)
      const therapistProfile = therapist ? await storage.getUserProfile(therapist.id) : null;
      
      // Fetch practice settings for autofill variables
      let practiceSettings = {
        name: 'Resilience Counseling Research & Consultation',
        address: '111 Waterloo St Unit 406, London, ON N6B 2M4',
        phone: '+1 (548)866-0366',
        email: 'mail@resiliencec.com',
        website: 'www.resiliencec.com'
      };
      
      try {
        const practiceOptions = await storage.getSystemOptionsByCategory('practice_settings');
        practiceSettings.name = practiceOptions.find(o => o.optionKey === 'practice_name')?.optionLabel || practiceSettings.name;
        practiceSettings.address = practiceOptions.find(o => o.optionKey === 'practice_address')?.optionLabel || practiceSettings.address;
        practiceSettings.phone = practiceOptions.find(o => o.optionKey === 'practice_phone')?.optionLabel || practiceSettings.phone;
        practiceSettings.email = practiceOptions.find(o => o.optionKey === 'practice_email')?.optionLabel || practiceSettings.email;
        practiceSettings.website = practiceOptions.find(o => o.optionKey === 'practice_website')?.optionLabel || practiceSettings.website;
      } catch (error) {
        // Use defaults if practice settings not found
      }
      
      if (client) {
        await AuditLogger.logAction({
          userId: client.id,
          username: client.portalEmail || client.email || 'unknown',
          action: 'form_viewed',
          result: 'success',
          resourceType: 'form_assignment',
          resourceId: assignmentId.toString(),
          clientId: session.clientId,
          ipAddress,
          userAgent,
          hipaaRelevant: true,
          riskLevel: 'medium',
          details: JSON.stringify({ portal: true, formName: template[0].name }),
          accessReason: 'Client portal form view',
        });
      }

      res.json({
        ...assignment[0],
        template: {
          ...template[0],
          fields: parsedFields
        },
        clientData: client ? {
          fullName: client.fullName,
          clientId: client.clientId,
          email: client.email,
          phone: client.phone,
          dateOfBirth: client.dateOfBirth,
        } : null,
        therapistData: therapist ? {
          fullName: therapist.fullName,
          email: therapist.email,
          phone: therapist.phone || therapistProfile?.emergencyContactPhone || '',
        } : null,
        practiceData: {
          name: practiceSettings.name,
          address: practiceSettings.address,
          phone: practiceSettings.phone,
          email: practiceSettings.email,
          website: practiceSettings.website,
        },
      });
    } catch (error) {
      console.error("Portal form assignment error:", error);
      res.status(500).json({ error: "Failed to fetch form assignment" });
    }
  });

  // Portal - Get form responses for an assignment
  app.get("/api/portal/forms/responses/:assignmentId", async (req, res) => {
    try {
      const sessionToken = req.cookies.portalSessionToken;

      if (!sessionToken) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const session = await storage.getPortalSessionByToken(sessionToken);
      
      if (!session) {
        return res.status(401).json({ error: "Invalid or expired session" });
      }

      await storage.updatePortalSessionActivity(session.id);

      const assignmentId = parseInt(req.params.assignmentId);

      const assignment = await db
        .select()
        .from(formAssignments)
        .where(
          and(
            eq(formAssignments.id, assignmentId),
            eq(formAssignments.clientId, session.clientId)
          )
        )
        .limit(1);

      if (!assignment.length) {
        return res.status(404).json({ error: "Form assignment not found" });
      }

      const responses = await db
        .select()
        .from(formResponses)
        .where(eq(formResponses.assignmentId, assignmentId));

      res.json(responses);
    } catch (error) {
      console.error("Portal form responses error:", error);
      res.status(500).json({ error: "Failed to fetch form responses" });
    }
  });

  // Portal - Save/update form response (auto-save)
  app.post("/api/portal/forms/responses", async (req, res) => {
    const { ipAddress, userAgent } = getRequestInfo(req);
    
    try {
      const sessionToken = req.cookies.portalSessionToken;

      if (!sessionToken) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const session = await storage.getPortalSessionByToken(sessionToken);
      
      if (!session) {
        return res.status(401).json({ error: "Invalid or expired session" });
      }

      await storage.updatePortalSessionActivity(session.id);

      const { assignmentId, fieldId, value } = req.body;

      if (!assignmentId || !fieldId) {
        return res.status(400).json({ error: "Assignment ID and field ID are required" });
      }

      const assignment = await db
        .select()
        .from(formAssignments)
        .where(
          and(
            eq(formAssignments.id, assignmentId),
            eq(formAssignments.clientId, session.clientId)
          )
        )
        .limit(1);

      if (!assignment.length) {
        return res.status(404).json({ error: "Form assignment not found" });
      }

      const existingResponse = await db
        .select()
        .from(formResponses)
        .where(
          and(
            eq(formResponses.assignmentId, assignmentId),
            eq(formResponses.fieldId, fieldId)
          )
        )
        .limit(1);

      let response;
      if (existingResponse.length) {
        const updated = await db
          .update(formResponses)
          .set({ 
            value,
            updatedAt: new Date()
          })
          .where(eq(formResponses.id, existingResponse[0].id))
          .returning();
        response = updated[0];
      } else {
        const inserted = await db
          .insert(formResponses)
          .values({
            assignmentId,
            fieldId,
            value
          })
          .returning();
        response = inserted[0];
      }

      if (assignment[0].status === 'pending') {
        await db
          .update(formAssignments)
          .set({ status: 'in_progress' })
          .where(eq(formAssignments.id, assignmentId));
      }

      res.json(response);
    } catch (error) {
      console.error("Portal form response save error:", error);
      res.status(500).json({ error: "Failed to save form response" });
    }
  });

  // Portal - Get form signature
  app.get("/api/portal/forms/signature/:assignmentId", async (req, res) => {
    try {
      const sessionToken = req.cookies.portalSessionToken;

      if (!sessionToken) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const session = await storage.getPortalSessionByToken(sessionToken);
      
      if (!session) {
        return res.status(401).json({ error: "Invalid or expired session" });
      }

      await storage.updatePortalSessionActivity(session.id);

      const assignmentId = parseInt(req.params.assignmentId);

      const assignment = await db
        .select()
        .from(formAssignments)
        .where(
          and(
            eq(formAssignments.id, assignmentId),
            eq(formAssignments.clientId, session.clientId)
          )
        )
        .limit(1);

      if (!assignment.length) {
        return res.status(404).json({ error: "Form assignment not found" });
      }

      const signature = await db
        .select()
        .from(formSignatures)
        .where(eq(formSignatures.assignmentId, assignmentId))
        .limit(1);

      if (!signature.length) {
        return res.status(404).json({ error: "Signature not found" });
      }

      res.json({
        id: signature[0].id,
        assignmentId: signature[0].assignmentId,
        signatureData: signature[0].signatureData,
        signerName: signature[0].signerName,
        signerRole: signature[0].signerRole,
        signedAt: signature[0].signedAt,
        ipAddress: signature[0].ipAddress,
        userAgent: signature[0].userAgent
      });
    } catch (error) {
      console.error("Portal form signature fetch error:", error);
      res.status(500).json({ error: "Failed to fetch signature" });
    }
  });

  // Portal - Save form signature
  app.post("/api/portal/forms/signature", async (req, res) => {
    const { ipAddress, userAgent } = getRequestInfo(req);
    
    try {
      const sessionToken = req.cookies.portalSessionToken;

      if (!sessionToken) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const session = await storage.getPortalSessionByToken(sessionToken);
      
      if (!session) {
        return res.status(401).json({ error: "Invalid or expired session" });
      }

      await storage.updatePortalSessionActivity(session.id);

      const { assignmentId, signatureData } = req.body;

      if (!assignmentId) {
        return res.status(400).json({ error: "Assignment ID is required" });
      }

      const assignment = await db
        .select()
        .from(formAssignments)
        .where(
          and(
            eq(formAssignments.id, assignmentId),
            eq(formAssignments.clientId, session.clientId)
          )
        )
        .limit(1);

      if (!assignment.length) {
        return res.status(404).json({ error: "Form assignment not found" });
      }

      if (!signatureData || signatureData.trim() === "") {
        const existingSignature = await db
          .select()
          .from(formSignatures)
          .where(eq(formSignatures.assignmentId, assignmentId))
          .limit(1);

        if (existingSignature.length) {
          await db
            .delete(formSignatures)
            .where(eq(formSignatures.id, existingSignature[0].id));

          const client = await storage.getClient(session.clientId);
          
          if (client) {
            await AuditLogger.logAction({
              userId: client.id,
              username: client.portalEmail || client.email || 'unknown',
              action: 'form_signature_cleared',
              result: 'success',
              resourceType: 'form_signature',
              resourceId: existingSignature[0].id.toString(),
              clientId: session.clientId,
              ipAddress,
              userAgent,
              hipaaRelevant: true,
              riskLevel: 'medium',
              details: JSON.stringify({ portal: true, assignmentId }),
              accessReason: 'Client portal form signature cleared',
            });
          }
        }

        return res.json({ deleted: true });
      }

      const existingSignature = await db
        .select()
        .from(formSignatures)
        .where(eq(formSignatures.assignmentId, assignmentId))
        .limit(1);

      // Get client info for signature
      const client = await storage.getClient(session.clientId);
      
      if (!client) {
        return res.status(404).json({ error: "Client not found" });
      }

      let signature;
      if (existingSignature.length) {
        const updated = await db
          .update(formSignatures)
          .set({
            signatureData: signatureData,
            signerName: client.fullName,
            signerRole: 'client',
            signedAt: new Date(),
            ipAddress,
            userAgent
          })
          .where(eq(formSignatures.id, existingSignature[0].id))
          .returning();
        signature = updated[0];
      } else {
        const inserted = await db
          .insert(formSignatures)
          .values({
            assignmentId,
            signatureData: signatureData,
            signerName: client.fullName,
            signerRole: 'client',
            signedAt: new Date(),
            ipAddress,
            userAgent,
            agreedToTerms: true
          })
          .returning();
        signature = inserted[0];
      }
      
      await AuditLogger.logAction({
        userId: client.id,
        username: client.portalEmail || client.email || 'unknown',
        action: 'form_signed',
        result: 'success',
        resourceType: 'form_signature',
        resourceId: signature.id.toString(),
        clientId: session.clientId,
        ipAddress,
        userAgent,
        hipaaRelevant: true,
        riskLevel: 'high',
        details: JSON.stringify({ portal: true, assignmentId }),
        accessReason: 'Client portal form signature capture',
      });

      res.json(signature);
    } catch (error) {
      console.error("Portal form signature error:", error);
      res.status(500).json({ error: "Failed to save signature" });
    }
  });

  // Portal - Submit completed form
  app.post("/api/portal/forms/submit/:assignmentId", async (req, res) => {
    const { ipAddress, userAgent } = getRequestInfo(req);
    
    try {
      const sessionToken = req.cookies.portalSessionToken;

      if (!sessionToken) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const session = await storage.getPortalSessionByToken(sessionToken);
      
      if (!session) {
        return res.status(401).json({ error: "Invalid or expired session" });
      }

      await storage.updatePortalSessionActivity(session.id);

      const assignmentId = parseInt(req.params.assignmentId);

      const assignment = await db
        .select()
        .from(formAssignments)
        .where(
          and(
            eq(formAssignments.id, assignmentId),
            eq(formAssignments.clientId, session.clientId)
          )
        )
        .limit(1);

      if (!assignment.length) {
        return res.status(404).json({ error: "Form assignment not found" });
      }

      if (assignment[0].status === 'completed' || assignment[0].status === 'reviewed') {
        return res.status(400).json({ error: "Form already submitted" });
      }

      const signature = await db
        .select()
        .from(formSignatures)
        .where(eq(formSignatures.assignmentId, assignmentId))
        .limit(1);

      if (!signature.length) {
        return res.status(400).json({ error: "Signature required before submission" });
      }

      const updated = await db
        .update(formAssignments)
        .set({ 
          status: 'completed',
          completedAt: new Date()
        })
        .where(eq(formAssignments.id, assignmentId))
        .returning();

      const client = await storage.getClient(session.clientId);
      
      if (client) {
        await AuditLogger.logAction({
          userId: client.id,
          username: client.portalEmail || client.email || 'unknown',
          action: 'form_submitted',
          result: 'success',
          resourceType: 'form_assignment',
          resourceId: assignmentId.toString(),
          clientId: session.clientId,
          ipAddress,
          userAgent,
          hipaaRelevant: true,
          riskLevel: 'high',
          details: JSON.stringify({ portal: true }),
          accessReason: 'Client portal form submission',
        });
      }

      res.json(updated[0]);
    } catch (error) {
      console.error("Portal form submit error:", error);
      res.status(500).json({ error: "Failed to submit form" });
    }
  });

  // ===== CLINICAL FORMS SYSTEM ROUTES =====
  
  // Get all form templates (active only, excluding deleted)
  app.get("/api/forms/templates", requireAuth, blockAccountant, async (req: AuthenticatedRequest, res) => {
    try {
      if (!req.user) {
        return res.status(401).json({ message: "Authentication required" });
      }

      const templates = await db
        .select()
        .from(formTemplates)
        .where(
          and(
            eq(formTemplates.isDeleted, false),
            eq(formTemplates.isActive, true)
          )
        )
        .orderBy(asc(formTemplates.sortOrder), asc(formTemplates.name));

      res.json(templates);
    } catch (error) {
      console.error("Error fetching form templates:", error);
      res.status(500).json({ message: "Failed to fetch form templates" });
    }
  });

  // Get single form template with fields
  app.get("/api/forms/templates/:id", requireAuth, blockAccountant, async (req: AuthenticatedRequest, res) => {
    try {
      if (!req.user) {
        return res.status(401).json({ message: "Authentication required" });
      }

      const id = parseInt(req.params.id);
      const template = await db
        .select()
        .from(formTemplates)
        .where(
          and(
            eq(formTemplates.id, id),
            eq(formTemplates.isDeleted, false)
          )
        )
        .limit(1);

      if (!template.length) {
        return res.status(404).json({ message: "Form template not found" });
      }

      const fields = await db
        .select()
        .from(formFields)
        .where(eq(formFields.templateId, id))
        .orderBy(asc(formFields.sortOrder));

      res.json({ ...template[0], fields });
    } catch (error) {
      console.error("Error fetching form template:", error);
      res.status(500).json({ message: "Failed to fetch form template" });
    }
  });

  // Create new form template (Admin only)
  app.post("/api/forms/templates", requireAuth, blockAccountant, async (req: AuthenticatedRequest, res) => {
    try {
      if (!req.user) {
        return res.status(401).json({ message: "Authentication required" });
      }

      const isAdmin = req.user.role === 'administrator' || req.user.role === 'admin';
      if (!isAdmin) {
        return res.status(403).json({ message: "Admin access required" });
      }

      const validatedData = insertFormTemplateSchema.parse({
        ...req.body,
        createdById: req.user.id
      });

      const [template] = await db
        .insert(formTemplates)
        .values(validatedData)
        .returning();

      res.status(201).json(template);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid template data", errors: error.errors });
      }
      console.error("Error creating form template:", error);
      res.status(500).json({ message: "Failed to create form template" });
    }
  });

  // Update form template (Admin only)
  app.patch("/api/forms/templates/:id", requireAuth, blockAccountant, async (req: AuthenticatedRequest, res) => {
    try {
      if (!req.user) {
        return res.status(401).json({ message: "Authentication required" });
      }

      const isAdmin = req.user.role === 'administrator' || req.user.role === 'admin';
      if (!isAdmin) {
        return res.status(403).json({ message: "Admin access required" });
      }

      const id = parseInt(req.params.id);
      const validatedData = insertFormTemplateSchema.partial().parse(req.body);

      const [updated] = await db
        .update(formTemplates)
        .set({ ...validatedData, updatedAt: new Date() })
        .where(eq(formTemplates.id, id))
        .returning();

      if (!updated) {
        return res.status(404).json({ message: "Form template not found" });
      }

      res.json(updated);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid template data", errors: error.errors });
      }
      console.error("Error updating form template:", error);
      res.status(500).json({ message: "Failed to update form template" });
    }
  });

  // Soft delete form template (Admin only)
  app.delete("/api/forms/templates/:id", requireAuth, blockAccountant, async (req: AuthenticatedRequest, res) => {
    try {
      if (!req.user) {
        return res.status(401).json({ message: "Authentication required" });
      }

      const isAdmin = req.user.role === 'administrator' || req.user.role === 'admin';
      if (!isAdmin) {
        return res.status(403).json({ message: "Admin access required" });
      }

      const id = parseInt(req.params.id);
      
      // Check if it's a system template
      const [template] = await db
        .select()
        .from(formTemplates)
        .where(eq(formTemplates.id, id))
        .limit(1);

      if (!template) {
        return res.status(404).json({ message: "Form template not found" });
      }

      if (template.isSystemTemplate) {
        return res.status(403).json({ message: "Cannot delete system templates" });
      }

      // Soft delete
      await db
        .update(formTemplates)
        .set({ 
          isDeleted: true, 
          isActive: false, 
          deletedAt: new Date() 
        })
        .where(eq(formTemplates.id, id));

      res.status(204).send();
    } catch (error) {
      console.error("Error deleting form template:", error);
      res.status(500).json({ message: "Failed to delete form template" });
    }
  });

  // Create form field (Admin only)
  app.post("/api/forms/fields", requireAuth, blockAccountant, async (req: AuthenticatedRequest, res) => {
    try {
      if (!req.user) {
        return res.status(401).json({ message: "Authentication required" });
      }

      const isAdmin = req.user.role === 'administrator' || req.user.role === 'admin';
      if (!isAdmin) {
        return res.status(403).json({ message: "Admin access required" });
      }

      const validatedData = insertFormFieldSchema.parse(req.body);
      
      // Server-side sanitization: Sanitize HTML content for info_text fields to prevent XSS
      if (validatedData.fieldType === 'info_text' && validatedData.helpText) {
        validatedData.helpText = sanitizeHtml(validatedData.helpText);
      }

      // Convert comma-separated options to JSON array for fields that need options
      if (validatedData.options && typeof validatedData.options === 'string') {
        const optionsString = validatedData.options.trim();
        // Check if it's already JSON array format
        if (!optionsString.startsWith('[')) {
          // Convert comma-separated to JSON array
          const optionsArray = optionsString.split(',').map(opt => opt.trim()).filter(opt => opt.length > 0);
          validatedData.options = JSON.stringify(optionsArray);
        }
        // If it's already JSON array format, keep it as-is
      }

      const [field] = await db
        .insert(formFields)
        .values(validatedData)
        .returning();

      res.status(201).json(field);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid field data", errors: error.errors });
      }
      console.error("Error creating form field:", error);
      res.status(500).json({ message: "Failed to create form field" });
    }
  });

  // Update form field (Admin only)
  app.patch("/api/forms/fields/:id", requireAuth, blockAccountant, async (req: AuthenticatedRequest, res) => {
    try {
      if (!req.user) {
        return res.status(401).json({ message: "Authentication required" });
      }

      const isAdmin = req.user.role === 'administrator' || req.user.role === 'admin';
      if (!isAdmin) {
        return res.status(403).json({ message: "Admin access required" });
      }

      const id = parseInt(req.params.id);
      
      // Fetch existing field to determine type for proper sanitization
      const [existingField] = await db
        .select()
        .from(formFields)
        .where(eq(formFields.id, id));
      
      if (!existingField) {
        return res.status(404).json({ message: "Form field not found" });
      }
      
      // Validate update data with schema
      const validatedData = updateFormFieldSchema.parse(req.body);
      
      // Determine the field type (use new type if provided, otherwise existing)
      const fieldType = validatedData.fieldType || existingField.fieldType;
      
      // Server-side sanitization: Sanitize HTML content for info_text fields to prevent XSS
      if (fieldType === 'info_text' && validatedData.helpText !== undefined) {
        validatedData.helpText = sanitizeHtml(validatedData.helpText as string);
      }
      
      // Enforce required=false for heading/info_text fields
      if (fieldType === 'heading' || fieldType === 'info_text') {
        validatedData.isRequired = false;
      }

      // Convert comma-separated options to JSON array for fields that need options
      if (validatedData.options !== undefined && validatedData.options && typeof validatedData.options === 'string') {
        const optionsString = validatedData.options.trim();
        // Check if it's already JSON array format
        if (!optionsString.startsWith('[')) {
          // Convert comma-separated to JSON array
          const optionsArray = optionsString.split(',').map(opt => opt.trim()).filter(opt => opt.length > 0);
          validatedData.options = JSON.stringify(optionsArray);
        }
        // If it's already JSON array format, keep it as-is
      }

      const [updated] = await db
        .update(formFields)
        .set(validatedData)
        .where(eq(formFields.id, id))
        .returning();

      if (!updated) {
        return res.status(404).json({ message: "Form field not found" });
      }

      res.json(updated);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid field data", errors: error.errors });
      }
      console.error("Error updating form field:", error);
      res.status(500).json({ message: "Failed to update form field" });
    }
  });

  // Delete form field (Admin only)
  app.delete("/api/forms/fields/:id", requireAuth, blockAccountant, async (req: AuthenticatedRequest, res) => {
    try {
      if (!req.user) {
        return res.status(401).json({ message: "Authentication required" });
      }

      const isAdmin = req.user.role === 'administrator' || req.user.role === 'admin';
      if (!isAdmin) {
        return res.status(403).json({ message: "Admin access required" });
      }

      const id = parseInt(req.params.id);
      
      await db
        .delete(formFields)
        .where(eq(formFields.id, id));

      res.status(204).send();
    } catch (error) {
      console.error("Error deleting form field:", error);
      res.status(500).json({ message: "Failed to delete form field" });
    }
  });

  // Get form assignments for a client
  app.get("/api/forms/assignments/client/:clientId", requireAuth, blockAccountant, async (req: AuthenticatedRequest, res) => {
    try {
      if (!req.user) {
        return res.status(401).json({ message: "Authentication required" });
      }

      const clientId = parseInt(req.params.clientId);
      
      const assignments = await db
        .select({
          id: formAssignments.id,
          status: formAssignments.status,
          dueDate: formAssignments.dueDate,
          assignedAt: formAssignments.createdAt,
          completedAt: formAssignments.completedAt,
          template: {
            id: formTemplates.id,
            name: formTemplates.name,
            category: formTemplates.category,
            requiresSignature: formTemplates.requiresSignature
          }
        })
        .from(formAssignments)
        .innerJoin(formTemplates, eq(formAssignments.templateId, formTemplates.id))
        .where(eq(formAssignments.clientId, clientId))
        .orderBy(desc(formAssignments.createdAt));

      res.json(assignments);
    } catch (error) {
      console.error("Error fetching form assignments:", error);
      res.status(500).json({ message: "Failed to fetch form assignments" });
    }
  });

  // Assign form to client (Therapist/Admin)
  app.post("/api/forms/assignments", requireAuth, blockAccountant, async (req: AuthenticatedRequest, res) => {
    try {
      if (!req.user) {
        return res.status(401).json({ message: "Authentication required" });
      }

      // Only therapists, supervisors, and admins can assign forms
      const allowedRoles = ['therapist', 'supervisor', 'administrator', 'admin'];
      if (!allowedRoles.includes(req.user.role.toLowerCase())) {
        return res.status(403).json({ message: "Insufficient permissions to assign forms" });
      }

      // Coerce ids to numbers so a string id (e.g. when the client component
      // is embedded in a record drawer) doesn't fail validation. Blank values
      // are left untouched so Zod reports a clean "Required" 400 rather than
      // silently coercing "" to 0 and hitting a foreign-key error later.
      const coerceId = (v: unknown) =>
        v === '' || v == null ? v : Number(v);
      const validatedData = insertFormAssignmentSchema.parse({
        ...req.body,
        templateId: coerceId(req.body?.templateId),
        clientId: coerceId(req.body?.clientId),
        assignedById: Number(req.user.id)
      });

      const [assignment] = await db
        .insert(formAssignments)
        .values(validatedData)
        .returning();

      res.status(201).json(assignment);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid assignment data", errors: error.errors });
      }
      console.error("Error creating form assignment:", error);
      res.status(500).json({ message: "Failed to assign form" });
    }
  });

  // Get single form assignment with template and fields
  app.get("/api/forms/assignments/:id", requireAuth, blockAccountant, async (req: AuthenticatedRequest, res) => {
    try {
      if (!req.user) {
        return res.status(401).json({ message: "Authentication required" });
      }

      const id = parseInt(req.params.id);
      
      const [assignment] = await db
        .select()
        .from(formAssignments)
        .where(eq(formAssignments.id, id))
        .limit(1);

      if (!assignment) {
        return res.status(404).json({ message: "Form assignment not found" });
      }

      // Get template with fields
      const [template] = await db
        .select()
        .from(formTemplates)
        .where(eq(formTemplates.id, assignment.templateId))
        .limit(1);

      const fields = await db
        .select()
        .from(formFields)
        .where(eq(formFields.templateId, assignment.templateId))
        .orderBy(asc(formFields.sortOrder));

      // Get existing responses
      const responses = await db
        .select()
        .from(formResponses)
        .where(eq(formResponses.assignmentId, id));

      // Get signature if exists
      const signatures = await db
        .select()
        .from(formSignatures)
        .where(eq(formSignatures.assignmentId, id));

      res.json({ 
        ...assignment, 
        template: { ...template, fields }, 
        responses,
        signatures
      });
    } catch (error) {
      console.error("Error fetching form assignment:", error);
      res.status(500).json({ message: "Failed to fetch form assignment" });
    }
  });

  // Delete form assignment
  app.delete("/api/forms/assignments/:id", requireAuth, blockAccountant, async (req: AuthenticatedRequest, res) => {
    const { ipAddress, userAgent } = getRequestInfo(req);
    
    try {
      if (!req.user) {
        return res.status(401).json({ message: "Authentication required" });
      }

      // Only therapists, supervisors, and admins can delete form assignments
      const allowedRoles = ['therapist', 'supervisor', 'administrator', 'admin'];
      if (!allowedRoles.includes(req.user.role.toLowerCase())) {
        return res.status(403).json({ message: "Insufficient permissions to delete form assignments" });
      }

      const id = parseInt(req.params.id);
      
      // Get assignment info for audit log before deletion
      const [assignment] = await db
        .select()
        .from(formAssignments)
        .where(eq(formAssignments.id, id))
        .limit(1);

      if (!assignment) {
        return res.status(404).json({ message: "Form assignment not found" });
      }

      // Delete related data first
      await db.delete(formResponses).where(eq(formResponses.assignmentId, id));
      await db.delete(formSignatures).where(eq(formSignatures.assignmentId, id));
      
      // Delete the assignment
      await db.delete(formAssignments).where(eq(formAssignments.id, id));

      // Audit log
      await AuditLogger.logAction({
        userId: req.user.id,
        username: req.user.username,
        action: 'form_assignment_deleted',
        result: 'success',
        resourceType: 'form_assignment',
        resourceId: id.toString(),
        clientId: assignment.clientId,
        ipAddress,
        userAgent,
        hipaaRelevant: true,
        riskLevel: 'medium',
        details: JSON.stringify({ 
          assignmentId: id,
          clientId: assignment.clientId,
          templateId: assignment.templateId,
          status: assignment.status
        }),
        accessReason: 'Form assignment deletion',
      });

      res.status(204).send();
    } catch (error) {
      console.error("Error deleting form assignment:", error);
      res.status(500).json({ message: "Failed to delete form assignment" });
    }
  });

  // Submit form responses (Client portal or therapist)
  app.post("/api/forms/assignments/:id/responses", requireAuth, blockAccountant, async (req: AuthenticatedRequest, res) => {
    try {
      if (!req.user) {
        return res.status(401).json({ message: "Authentication required" });
      }

      const assignmentId = parseInt(req.params.id);
      const { responses } = req.body;

      if (!Array.isArray(responses)) {
        return res.status(400).json({ message: "Responses must be an array" });
      }

      // Delete existing responses and insert new ones (upsert pattern)
      await db
        .delete(formResponses)
        .where(eq(formResponses.assignmentId, assignmentId));

      const validatedResponses = responses.map(r => 
        insertFormResponseSchema.parse({ ...r, assignmentId })
      );

      const created = await db
        .insert(formResponses)
        .values(validatedResponses)
        .returning();

      // Update assignment status
      await db
        .update(formAssignments)
        .set({ 
          status: 'in_progress',
          updatedAt: new Date()
        })
        .where(eq(formAssignments.id, assignmentId));

      res.status(201).json(created);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid response data", errors: error.errors });
      }
      console.error("Error saving form responses:", error);
      res.status(500).json({ message: "Failed to save form responses" });
    }
  });

  // Submit signature and complete form
  app.post("/api/forms/assignments/:id/signature", requireAuth, blockAccountant, async (req: AuthenticatedRequest, res) => {
    const { ipAddress, userAgent } = getRequestInfo(req);
    
    try {
      if (!req.user) {
        return res.status(401).json({ message: "Authentication required" });
      }

      const assignmentId = parseInt(req.params.id);
      const validatedData = insertFormSignatureSchema.parse({
        ...req.body,
        assignmentId,
        ipAddress,
        userAgent
      });

      const [signature] = await db
        .insert(formSignatures)
        .values(validatedData)
        .returning();

      // Mark assignment as completed
      await db
        .update(formAssignments)
        .set({ 
          status: 'completed',
          completedAt: new Date(),
          submittedAt: new Date(),
          updatedAt: new Date()
        })
        .where(eq(formAssignments.id, assignmentId));

      res.status(201).json(signature);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid signature data", errors: error.errors });
      }
      console.error("Error saving signature:", error);
      res.status(500).json({ message: "Failed to save signature" });
    }
  });

  // Mark form as reviewed by therapist
  app.patch("/api/forms/assignments/:id/review", requireAuth, blockAccountant, async (req: AuthenticatedRequest, res) => {
    try {
      if (!req.user) {
        return res.status(401).json({ message: "Authentication required" });
      }

      // Only therapists, supervisors, and admins can review forms
      const allowedRoles = ['therapist', 'supervisor', 'administrator', 'admin'];
      if (!allowedRoles.includes(req.user.role.toLowerCase())) {
        return res.status(403).json({ message: "Insufficient permissions to review forms" });
      }

      const id = parseInt(req.params.id);
      const { reviewNotes } = req.body;

      const [updated] = await db
        .update(formAssignments)
        .set({ 
          reviewedAt: new Date(),
          reviewedById: req.user.id,
          reviewNotes,
          updatedAt: new Date()
        })
        .where(eq(formAssignments.id, id))
        .returning();

      if (!updated) {
        return res.status(404).json({ message: "Form assignment not found" });
      }

      res.json(updated);
    } catch (error) {
      console.error("Error reviewing form:", error);
      res.status(500).json({ message: "Failed to review form" });
    }
  });

  // Download form assignment as PDF (HTML for browser print)
  app.get("/api/forms/assignments/:id/download/pdf", requireAuth, blockAccountant, async (req: AuthenticatedRequest, res) => {
    const { ipAddress, userAgent } = getRequestInfo(req);
    
    try {
      if (!req.user) {
        return res.status(401).json({ message: "Authentication required" });
      }

      const assignmentId = parseInt(req.params.id);
      if (isNaN(assignmentId)) {
        return res.status(400).json({ message: "Invalid assignment ID" });
      }

      // Fetch assignment with all related data
      const [assignment] = await db
        .select()
        .from(formAssignments)
        .where(eq(formAssignments.id, assignmentId))
        .limit(1);

      if (!assignment) {
        return res.status(404).json({ message: "Form assignment not found" });
      }

      // Only allow PDF download for completed forms
      if (assignment.status !== 'completed') {
        return res.status(400).json({ message: "Form must be completed before generating PDF" });
      }

      // Fetch client
      const client = await storage.getClient(assignment.clientId);
      if (!client) {
        return res.status(404).json({ message: "Client not found" });
      }

      // Fetch assigned therapist for form auto-fill placeholders
      const therapist = await storage.getUser(assignment.assignedById);
      
      // Fetch therapist profile for additional contact info (emergency contact phone as fallback)
      const therapistProfile = therapist ? await storage.getUserProfile(therapist.id) : null;

      // Authorization: admin, supervisor, assigned therapist, or supervising therapist
      const isAdmin = req.user.role === 'administrator' || req.user.role === 'admin';
      const isAssignedTherapist = assignment.assignedById === req.user.id;
      
      let isSupervisor = false;
      if (!isAdmin && !isAssignedTherapist) {
        const supervisorAssignments = await storage.getSupervisorAssignments(req.user.id);
        isSupervisor = supervisorAssignments.some(
          sa => sa.therapistId === assignment.assignedById
        );
      }

      if (!isAdmin && !isAssignedTherapist && !isSupervisor) {
        return res.status(403).json({ message: "You do not have permission to download this form" });
      }

      // Fetch template with fields
      const [template] = await db
        .select()
        .from(formTemplates)
        .where(eq(formTemplates.id, assignment.templateId))
        .limit(1);

      const fields = await db
        .select()
        .from(formFields)
        .where(eq(formFields.templateId, assignment.templateId))
        .orderBy(asc(formFields.sortOrder));

      // Fetch responses
      const responses = await db
        .select()
        .from(formResponses)
        .where(eq(formResponses.assignmentId, assignmentId));

      // Fetch signature
      const [signature] = await db
        .select()
        .from(formSignatures)
        .where(eq(formSignatures.assignmentId, assignmentId))
        .limit(1);

      // Fetch practice settings
      let practiceSettings = {
        name: 'Resilience Counseling Research & Consultation',
        address: '111 Waterloo St Unit 406, London, ON N6B 2M4',
        phone: '+1 (548)866-0366',
        email: 'mail@resiliencec.com',
        website: 'www.resiliencec.com'
      };

      try {
        const practiceOptions = await storage.getSystemOptionsByCategory('practice_settings');
        practiceSettings.name = practiceOptions.find(o => o.optionKey === 'practice_name')?.optionLabel || practiceSettings.name;
        practiceSettings.address = practiceOptions.find(o => o.optionKey === 'practice_address')?.optionLabel || practiceSettings.address;
        practiceSettings.phone = practiceOptions.find(o => o.optionKey === 'practice_phone')?.optionLabel || practiceSettings.phone;
        practiceSettings.email = practiceOptions.find(o => o.optionKey === 'practice_email')?.optionLabel || practiceSettings.email;
        practiceSettings.website = practiceOptions.find(o => o.optionKey === 'practice_website')?.optionLabel || practiceSettings.website;
      } catch (error) {
        // Use defaults if practice settings not found
      }

      // Import HTML generation module (HTML doubles as the print-ready fallback)
      const { generateFormAssignmentHTML } = await import("./pdf/form-assignment-pdf");
      const { generatePDFFromHTML } = await import("./pdf/client-report-pdf");

      // Prepare assignment data for PDF
      const assignmentData = {
        ...assignment,
        client: {
          id: client.id,
          fullName: client.fullName,
          clientId: client.clientId,
          dateOfBirth: client.dateOfBirth,
          email: client.portalEmail || client.email,
          phoneNumber: (client as any).phoneNumber
        },
        therapist: therapist ? {
          id: therapist.id,
          fullName: therapist.fullName,
          email: therapist.email,
          phoneNumber: therapist.phone || therapistProfile?.emergencyContactPhone || ''
        } : undefined,
        template: template ? {
          id: template.id,
          name: template.name,
          description: template.description
        } : undefined,
        fields: fields.map(f => ({
          id: f.id,
          label: f.label,
          fieldType: f.fieldType,
          helpText: f.helpText,
          required: f.isRequired,
          options: f.options ? (Array.isArray(f.options) ? f.options : JSON.parse(f.options as string)) : null,
          placeholder: f.placeholder,
          sortOrder: f.sortOrder
        }))
      };

      // Map responses to expected format (database uses 'value', PDF generator expects 'responseValue')
      const formattedResponses = responses.map(r => ({
        fieldId: r.fieldId,
        responseValue: r.value
      }));

      // Generate HTML (also used as the print-ready fallback)
      const html = generateFormAssignmentHTML(
        assignmentData as any,
        formattedResponses as any,
        signature || null,
        practiceSettings
      );

      const baseFilename = `form-${(template?.name || 'form').replace(/\s+/g, '-')}-${new Date().toISOString().split('T')[0]}`;

      // Try to render a real PDF (with internal retry); fall back to print-ready HTML on failure
      let pdfBuffer: Buffer | null = null;
      try {
        pdfBuffer = await generatePDFFromHTML(html);
      } catch (pdfError) {
        console.error('Form assignment PDF rendering failed after retry, falling back to print-ready HTML:', pdfError);
      }

      // HIPAA Audit: Log PDF download (record whether a PDF or HTML fallback was served)
      await AuditLogger.logDocumentAccess(
        req.user.id,
        req.user.username,
        assignmentId,
        assignment.clientId,
        'document_downloaded',
        ipAddress,
        userAgent,
        {
          assignmentId,
          templateId: assignment.templateId,
          templateName: template?.name,
          format: pdfBuffer ? 'pdf' : 'html',
          documentType: 'form_assignment',
          assignedById: assignment.assignedById
        }
      );

      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, private');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      res.removeHeader('ETag');

      if (pdfBuffer) {
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${baseFilename}.pdf"`);
        res.setHeader('Content-Length', pdfBuffer.length);
        res.send(pdfBuffer);
      } else {
        // Fallback: return the print-ready HTML so the user can still print to PDF
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.setHeader('Content-Disposition', `inline; filename="${baseFilename}.html"`);
        res.send(html);
      }

    } catch (error) {
      console.error('Error generating form PDF:', error);
      res.status(500).json({ message: "Failed to generate PDF" });
    }
  });

  // ===== ADMIN TEST ENDPOINTS =====
  
  // Test email endpoint (Admin only)
  app.post('/api/admin/test-email', requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      // Only allow admins to send test emails
      if (req.user?.role !== 'admin') {
        return res.status(403).json({ error: 'Admin access required' });
      }

      const { toEmail } = req.body;
      if (!toEmail) {
        return res.status(400).json({ error: 'toEmail is required' });
      }

      const SparkPost = (await import('sparkpost')).default;
      const sp = new SparkPost(process.env.SPARKPOST_API_KEY);
      const fromEmail = getEmailFromAddress();
      
      await sp.transmissions.send({
        content: {
          from: fromEmail,
          subject: 'Test Email from SmartHub',
          html: `
            <h1>Test Email</h1>
            <p>This is a test email from SmartHub.</p>
            <p>Sender: ${fromEmail}</p>
            <p>Sent at: ${new Date().toISOString()}</p>
          `
        },
        recipients: [{ address: toEmail }]
      });

      res.json({ 
        success: true, 
        message: `Test email sent to ${toEmail}`,
        from: fromEmail
      });
    } catch (error: any) {
      console.error('Test email error:', error);
      res.status(500).json({ error: error.message || 'Failed to send test email' });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}
