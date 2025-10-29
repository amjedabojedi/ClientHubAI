// Core Express and Node.js
import type { Express } from "express";
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
// Auth will be implemented later, for now removing to test audit logging
import { generateSessionNoteSummary, generateSmartSuggestions, generateClinicalReport } from "./ai/openai";
import notificationRoutes from "./notification-routes";
import { NotificationService } from "./notification-service";
import { db } from "./db";

// Helper function to get the email sender address from environment
function getEmailFromAddress(): string {
  return process.env.EMAIL_FROM || 'noreply@mail.resiliencecrm.com';
}
import { users, auditLogs, loginAttempts, clients, sessionBilling, sessions, clientHistory, services } from "@shared/schema";
import { eq, and, or, gte, lte, desc, asc, sql, ilike, inArray } from "drizzle-orm";
import { AuditLogger, getRequestInfo } from "./audit-logger";
import { setAuditContext, auditClientAccess, auditSessionAccess, auditDocumentAccess, auditAssessmentAccess } from "./audit-middleware";
import { AzureBlobStorage } from "./azure-blob-storage";
import { zoomService } from "./zoom-service";
import type { AuthenticatedRequest } from "./auth-middleware";
import { requireAuth } from "./auth-middleware";

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
  insertServiceSchema,
  insertRoomSchema,
  insertRoomBookingSchema,
  insertSessionBillingSchema,
  insertRoleSchema,
  insertPermissionSchema,
  insertRolePermissionSchema,
  insertOptionCategorySchema,
  insertSystemOptionSchema,
  insertClientHistorySchema
} from "@shared/schema";

// Helper function to convert EST date/time to UTC
function convertESTToUTC(dateStr: string, timeStr: string): Date {
  const PRACTICE_TIMEZONE = 'America/New_York';
  const dateTimeString = `${dateStr} ${timeStr}:00`;
  // fromZonedTime interprets the string as EST and returns equivalent UTC Date
  return fromZonedTime(dateTimeString, PRACTICE_TIMEZONE);
}

// Initialize Stripe
if (!process.env.STRIPE_SECRET_KEY) {
  console.warn('STRIPE_SECRET_KEY not found - payment functionality will be disabled');
}
const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2023-10-16",
}) : null;

// Initialize Azure Blob Storage
const azureStorage = new AzureBlobStorage(
  process.env.AZURE_STORAGE_CONNECTION_STRING || '',
  process.env.AZURE_BLOB_CONTAINER_NAME || 'documents'
);

// Helper function to generate unique client ID
async function generateClientId(): Promise<string> {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  
  // Get count of clients created this month to generate sequential ID
  const count = await storage.getClientCountByMonth(year, parseInt(month));
  const sequentialId = String(count + 1).padStart(4, '0');
  
  return `CL-${year}-${sequentialId}`;
}

// Security: Safe serializer to exclude sensitive user fields from API responses
function sanitizeUser(user: any) {
  const {
    password: _,
    passwordResetToken: __,
    passwordResetExpiry: ___,
    emailVerificationToken: ____,
    ...safeUser
  } = user;
  return safeUser;
}

// Security: Safe serializer for arrays of users
function sanitizeUsers(users: any[]) {
  return users.map(sanitizeUser);
}

// Helper function to get the base URL from request
function getBaseUrl(req: any): string {
  // Use BASE_URL if set, otherwise build from request
  if (process.env.BASE_URL) {
    return process.env.BASE_URL;
  }
  
  // Build URL from request headers
  const protocol = req.headers['x-forwarded-proto'] || (req.secure ? 'https' : 'http');
  const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost:5000';
  return `${protocol}://${host}`;
}

// Helper function to send portal activation email
async function sendActivationEmail(clientEmail: string, clientName: string, activationToken: string, baseUrl?: string) {
  if (!process.env.SPARKPOST_API_KEY) {
    console.log('[ACTIVATION] SparkPost API key not configured - activation email not sent');
    return;
  }

  try {
    const sp = new SparkPost(process.env.SPARKPOST_API_KEY);
    const fromEmail = 'noreply@resiliencecrm.com';
    // Use provided baseUrl or fall back to env variable or localhost
    const appUrl = baseUrl || process.env.BASE_URL || 'http://localhost:5000';
    const activationUrl = `${appUrl}/portal/activate/${activationToken}`;

    await sp.transmissions.send({
      content: {
        from: fromEmail,
        subject: 'Activate Your TherapyFlow Portal Account',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #2563eb;">Welcome to TherapyFlow Client Portal</h2>
            <p>Hi ${clientName},</p>
            <p>Your therapist has enabled portal access for you. Click the button below to activate your account and set your password:</p>
            <div style="text-align: center; margin: 30px 0;">
              <a href="${activationUrl}" style="background-color: #2563eb; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">
                Activate My Account
              </a>
            </div>
            <p>Or copy and paste this link into your browser:</p>
            <p style="color: #666; font-size: 14px; word-break: break-all;">${activationUrl}</p>
            <p style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #ddd; color: #666; font-size: 12px;">
              If you didn't request portal access, please contact your therapist.
            </p>
          </div>
        `
      },
      recipients: [{ address: clientEmail }]
    });

    console.log(`[ACTIVATION] Activation email sent to ${clientEmail}`);
  } catch (error) {
    console.error('[ACTIVATION] Error sending activation email:', error);
  }
}

// Helper function to send password reset email
async function sendPasswordResetEmail(clientEmail: string, clientName: string, resetToken: string, baseUrl?: string) {
  if (!process.env.SPARKPOST_API_KEY) {
    console.log('[PASSWORD_RESET] SparkPost API key not configured - reset email not sent');
    return;
  }

  try {
    const sp = new SparkPost(process.env.SPARKPOST_API_KEY);
<<<<<<< HEAD
    const fromEmail = getEmailFromAddress();
=======
    const fromEmail = 'noreply@resiliencecrm.com';
>>>>>>> dd734e8 (Update email sender address for all outgoing system notifications)
    // Use provided baseUrl or fall back to env variable or localhost
    const appUrl = baseUrl || process.env.BASE_URL || 'http://localhost:5000';
    const resetUrl = `${appUrl}/portal/reset-password/${resetToken}`;

    await sp.transmissions.send({
      content: {
        from: fromEmail,
        subject: 'Reset Your TherapyFlow Portal Password',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #2563eb;">Password Reset Request</h2>
            <p>Hi ${clientName},</p>
            <p>We received a request to reset your TherapyFlow Client Portal password. Click the button below to set a new password:</p>
            <div style="text-align: center; margin: 30px 0;">
              <a href="${resetUrl}" style="background-color: #2563eb; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">
                Reset My Password
              </a>
            </div>
            <p>Or copy and paste this link into your browser:</p>
            <p style="color: #666; font-size: 14px; word-break: break-all;">${resetUrl}</p>
            <p style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #ddd; color: #666; font-size: 12px;">
              If you didn't request a password reset, you can safely ignore this email. Your password will not be changed.
            </p>
          </div>
        `
      },
      recipients: [{ address: clientEmail }]
    });

    console.log(`[PASSWORD_RESET] Reset email sent to ${clientEmail}`);
  } catch (error) {
    console.error('[PASSWORD_RESET] Error sending reset email:', error);
  }
}

// Helper function to send appointment confirmation email
async function sendAppointmentConfirmationEmail(
  clientEmail: string, 
  clientName: string, 
  appointmentDetails: {
    date: string;
    time: string;
    duration: number;
    sessionType: string;
    location: string;
  }
) {
  if (!process.env.SPARKPOST_API_KEY) {
    console.log('[APPOINTMENT] SparkPost API key not configured - confirmation email not sent');
    return;
  }

  try {
    const sp = new SparkPost(process.env.SPARKPOST_API_KEY);
<<<<<<< HEAD
    const fromEmail = getEmailFromAddress();
=======
    const fromEmail = 'noreply@resiliencecrm.com';
>>>>>>> dd734e8 (Update email sender address for all outgoing system notifications)
    const baseUrl = process.env.BASE_URL || 'http://localhost:5000';
    const dashboardUrl = `${baseUrl}/portal/dashboard`;

    // Format date and time for display using America/New_York timezone
    // Parse date at noon to avoid timezone shift issues with YYYY-MM-DD strings
    const dateAtNoon = new Date(`${appointmentDetails.date}T12:00:00`);
    const displayDate = dateAtNoon.toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      timeZone: 'America/New_York'
    });
    
    // Format time correctly by treating the time string as already in America/New_York timezone
    // The time value (e.g., "10:00") is meant to represent 10:00 AM Eastern
    // Use fromZonedTime to parse it as an Eastern time, then format it
    const dateTimeString = `${appointmentDetails.date} ${appointmentDetails.time}`;
    const appointmentDateTimeInEastern = fromZonedTime(dateTimeString, 'America/New_York');
    const displayTime = formatInTimeZone(appointmentDateTimeInEastern, 'America/New_York', 'h:mm a');

    await sp.transmissions.send({
      content: {
        from: fromEmail,
        subject: 'Appointment Confirmed - TherapyFlow',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #2563eb;">Appointment Confirmed</h2>
            <p>Hi ${clientName},</p>
            <p>Your therapy appointment has been successfully scheduled. Here are the details:</p>
            
            <div style="background-color: #f3f4f6; border-radius: 8px; padding: 20px; margin: 20px 0;">
              <table style="width: 100%; border-collapse: collapse;">
                <tr>
                  <td style="padding: 8px 0; font-weight: bold; color: #374151;">Date:</td>
                  <td style="padding: 8px 0; color: #1f2937;">${displayDate}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; font-weight: bold; color: #374151;">Time:</td>
                  <td style="padding: 8px 0; color: #1f2937;">${displayTime}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; font-weight: bold; color: #374151;">Duration:</td>
                  <td style="padding: 8px 0; color: #1f2937;">${appointmentDetails.duration} minutes</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; font-weight: bold; color: #374151;">Session Type:</td>
                  <td style="padding: 8px 0; color: #1f2937; text-transform: capitalize;">${appointmentDetails.sessionType}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; font-weight: bold; color: #374151;">Location:</td>
                  <td style="padding: 8px 0; color: #1f2937;">${appointmentDetails.location}</td>
                </tr>
              </table>
            </div>

            <p>Please arrive 5-10 minutes early to complete any necessary paperwork.</p>

            <div style="text-align: center; margin: 30px 0;">
              <a href="${dashboardUrl}" style="background-color: #2563eb; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">
                View My Appointments
              </a>
            </div>

            <p style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #ddd; color: #666; font-size: 12px;">
              If you need to reschedule or have any questions, please contact your therapist's office.
            </p>
          </div>
        `
      },
      recipients: [{ address: clientEmail }]
    });

    console.log(`[APPOINTMENT] Confirmation email sent to ${clientEmail}`);
  } catch (error) {
    console.error('[APPOINTMENT] Error sending confirmation email:', error);
  }
}

// Helper function to track client history events
async function trackClientHistory(params: {
  clientId: number;
  eventType: string;
  fromValue?: string | null;
  toValue?: string | null;
  description?: string;
  metadata?: any;
  createdBy?: number;
  createdByName?: string;
  auditLogId?: number;
}) {
  try {
    await db.insert(clientHistory).values({
      clientId: params.clientId,
      eventType: params.eventType,
      eventSource: 'api',
      fromValue: params.fromValue || null,
      toValue: params.toValue || null,
      description: params.description || null,
      metadata: params.metadata ? JSON.stringify(params.metadata) : null,
      createdBy: params.createdBy || null,
      createdByName: params.createdByName || null,
      auditLogId: params.auditLogId || null,
    });
  } catch (error) {
    console.error('Failed to track client history:', error);
    // Don't throw - history tracking should not break the main operation
  }
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
      
      const updateData = {
        fullName: req.body.fullName,
        email: req.body.email,
        updatedAt: new Date()
      };
      
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
  app.get("/api/clients", requireAuth, async (req: AuthenticatedRequest, res) => {
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
  app.get("/api/clients/stats", requireAuth, async (req: AuthenticatedRequest, res) => {
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
  app.get("/api/clients/export", requireAuth, async (req: AuthenticatedRequest, res) => {
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

  app.get("/api/clients/:id", requireAuth, auditClientAccess('client_viewed'), async (req: AuthenticatedRequest, res) => {
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
      
      res.json(client);
    } catch (error) {
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post("/api/clients", requireAuth, auditClientAccess('client_created'), async (req: AuthenticatedRequest, res) => {
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
          referenceNumber: client.referenceNumber,
          stage: client.stage || 'initial',
          createdAt: client.createdAt
        });
      } catch (notificationError) {
        console.error('Client created notification failed:', notificationError);
      }
      
      res.status(201).json(client);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid client data", errors: error.errors });
      }
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.put("/api/clients/:id", requireAuth, auditClientAccess('client_updated'), async (req: AuthenticatedRequest, res) => {
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
            assignedTherapist: assignedTherapist?.fullName || 'Unknown Therapist',
            assignedTherapistId: client.assignedTherapistId,
            referenceNumber: client.referenceNumber,
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

  app.delete("/api/clients/:id", requireAuth, async (req: AuthenticatedRequest, res) => {
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

  // Portal Access Management Endpoints
  
  // PUT /api/clients/:id/portal-access - Enable/disable portal access
  app.put("/api/clients/:id/portal-access", requireAuth, async (req: AuthenticatedRequest, res) => {
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
  app.post("/api/clients/:id/send-portal-activation", requireAuth, async (req: AuthenticatedRequest, res) => {
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
  app.get("/api/clients/:id/history", requireAuth, async (req: AuthenticatedRequest, res) => {
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
  app.get("/api/clients/:id/stage-durations", requireAuth, async (req: AuthenticatedRequest, res) => {
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
  app.post("/api/clients/bulk-upload", requireAuth, async (req: AuthenticatedRequest, res) => {
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
        clientId
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
        page: filters.page,
        limit: filters.limit,
        includeHiddenServices: isAdmin
      });
      
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
            throw new Error("This therapist is no longer available at this time. Please refresh and select another time.");
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
              throw new Error("This room is no longer available at this time. Please refresh and select another room.");
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
      // Error logged
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
              await db.update(sessionBilling)
                .set({
                  serviceCode: newService.serviceCode,
                  ratePerUnit: newService.baseRate,
                  totalAmount: newService.baseRate
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
      
      // Trigger billing when session status changes to completed
      if (sessionData.status === 'completed') {
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

  app.get("/api/clients/:clientId/sessions", requireAuth, async (req: AuthenticatedRequest, res) => {
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

  // Get session conflicts for a client
  app.get("/api/clients/:clientId/session-conflicts", requireAuth, async (req: AuthenticatedRequest, res) => {
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
        supervisedTherapistIds = supervisorAssignments.map(assignment => assignment.therapistId);
      }
      
      // Only admins can see sessions with hidden services
      const includeHiddenServices = req.user.role === 'admin' || req.user.role === 'administrator';
      
      // Call storage method with role-based parameters - storage handles filtering
      const recentSessions = await storage.getRecentSessions(limit, therapistId, supervisedTherapistIds, includeHiddenServices);
      
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
      const upcomingSessions = await storage.getUpcomingSessions(limit, therapistId, supervisedTherapistIds, includeHiddenServices);
      
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
        supervisedTherapistIds = supervisorAssignments.map(assignment => assignment.therapistId);
      }
      
      // Only admins can see sessions with hidden services
      const includeHiddenServices = req.user.role === 'admin' || req.user.role === 'administrator';
      
      // Call storage method with role-based parameters - storage handles filtering
      const overdueSessions = await storage.getOverdueSessions(limit, therapistId, supervisedTherapistIds, includeHiddenServices);
      
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
                clientName: session.client.fullName,
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
  app.get("/api/clients/:clientId/tasks", requireAuth, async (req: AuthenticatedRequest, res) => {
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
      
      res.json({
        ...result,
        tasks: tasksWithComments
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
        supervisedTherapistIds = supervisorAssignments.map(assignment => assignment.therapistId);
      }
      
      // Call storage method with role-based parameters - storage handles filtering
      const recentTasks = await storage.getRecentTasks(limit, therapistId, supervisedTherapistIds);
      
      res.json(recentTasks);
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
        supervisedTherapistIds = supervisorAssignments.map(assignment => assignment.therapistId);
      }
      
      // Call storage method with role-based parameters - storage handles filtering
      const upcomingTasks = await storage.getUpcomingTasks(limit, therapistId, supervisedTherapistIds);
      
      res.json(upcomingTasks);
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
      
      res.json(task);
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
  app.get("/api/clients/:clientId/notes", requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const clientId = parseInt(req.params.clientId);
      const notes = await storage.getNotesByClient(clientId);
      res.json(notes);
    } catch (error) {
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post("/api/notes", requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const validatedData = insertNoteSchema.parse(req.body);
      const note = await storage.createNote(validatedData);
      res.status(201).json(note);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid note data", errors: error.errors });
      }
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Documents routes
  app.get("/api/clients/:clientId/documents", requireAuth, async (req: AuthenticatedRequest, res) => {
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
  app.get("/api/clients/:clientId/assessments", requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const clientId = parseInt(req.params.clientId);
      const assessments = await storage.getClientAssessments(clientId);
      res.json(assessments);
    } catch (error) {
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post("/api/clients/:clientId/assessments", requireAuth, async (req: AuthenticatedRequest, res) => {
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

  app.post("/api/clients/:clientId/documents", requireAuth, async (req: AuthenticatedRequest, res) => {
    try {

      const clientId = parseInt(req.params.clientId);
      const { fileContent, ...documentData } = req.body;
      
      // Get authenticated user from request
      const authenticatedUser = req.user;
      if (!authenticatedUser?.id) {
        return res.status(401).json({ message: "Authentication required for document upload" });
      }

      const validatedData = insertDocumentSchema.parse({
        ...documentData,
        clientId,
        uploadedById: authenticatedUser.id
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
        // Trigger document upload notification
        const notificationData = {
          id: document.id,
          clientId: client.id,
          clientName: client.fullName,
          documentType: document.category || 'Document',
          documentId: document.id,
          assignedTherapistId: client.assignedTherapistId,
          uploadedBy: document.uploadedById,
          fileName: document.fileName
        };

        await notificationService.processEvent('document_uploaded', notificationData);
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

  app.get("/api/clients/:clientId/documents/:id/preview", requireAuth, async (req: AuthenticatedRequest, res) => {
    const { ipAddress, userAgent } = getRequestInfo(req);
    
    try {
      const id = parseInt(req.params.id);
      const clientId = parseInt(req.params.clientId);
      
      // Get document info from database
      const documents = await storage.getDocumentsByClient(clientId);
      const document = documents.find(doc => doc.id === id);
      
      if (!document) {
        return res.status(404).json({ message: "Document not found" });
      }
      
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
        // For PDFs, serve the actual PDF file for viewing
        try {
          const filePath = path.join(process.cwd(), 'uploads', `${document.id}-${document.fileName}`);
          
          if (fs.existsSync(filePath)) {

            
            // Return PDF file URL for the browser to display
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
            // File doesn't exist - return explanation
            const pdfContent = `PDF file not found on server.

The file ${document.fileName} (${Math.round(document.fileSize / 1024)} KB) was uploaded but the actual file content is not available for preview.

To see the actual content, you would need to:
1. Re-upload the file with actual file content
2. Or download the file to view it locally

This happens because only the file metadata was stored, not the actual file content.`;
            
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
          res.status(500).json({ error: 'Failed to process PDF content: ' + (error instanceof Error ? error.message : 'Unknown error') });
        }
      } else if (isImage) {
        // For images, serve from Azure Blob Storage
        try {
          const blobName = azureStorage.generateBlobName(document.id, document.fileName);
          const downloadResult = await azureStorage.downloadFile(blobName);
          
          if (downloadResult.success) {
            res.setHeader('Content-Type', document.mimeType || 'image/jpeg');
            res.send(downloadResult.data);
          } else {
            // Fallback to icon if file not found
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
  app.get("/api/clients/:clientId/documents/:id/file", requireAuth, async (req: AuthenticatedRequest, res) => {
    const { ipAddress, userAgent } = getRequestInfo(req);
    
    try {
      const id = parseInt(req.params.id);
      const clientId = parseInt(req.params.clientId);
      
      // Validate parameters
      if (isNaN(id) || isNaN(clientId)) {
        return res.status(400).json({ message: "Invalid document or client ID" });
      }
      
      // Get document info from database
      const documents = await storage.getDocumentsByClient(clientId);
      const document = documents.find(doc => doc.id === id);
      
      if (!document) {
        return res.status(404).json({ message: "Document not found" });
      }
      
      // Only serve PDF files through this endpoint
      if (document.mimeType !== 'application/pdf') {
        return res.status(400).json({ message: "This endpoint only serves PDF files" });
      }
      
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
          { fileName: document.originalName, fileType: document.mimeType, accessType: 'pdf_view' }
        );
      }
      
      // Download from Azure Blob Storage
      const blobName = azureStorage.generateBlobName(document.id, document.fileName);
      const downloadResult = await azureStorage.downloadFile(blobName);
      
      if (downloadResult.success) {
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
  app.get("/api/clients/:clientId/documents/:id/viewer", requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const id = parseInt(req.params.id);
      const clientId = parseInt(req.params.clientId);
      
      // Validate parameters
      if (isNaN(id) || isNaN(clientId)) {
        return res.status(400).json({ message: "Invalid document or client ID" });
      }
      
      // Get document info from database
      const documents = await storage.getDocumentsByClient(clientId);
      const document = documents.find(doc => doc.id === id);
      
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
  app.get("/api/clients/:clientId/documents/:id/docx-viewer", requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const id = parseInt(req.params.id);
      const clientId = parseInt(req.params.clientId);
      
      // Validate parameters
      if (isNaN(id) || isNaN(clientId)) {
        return res.status(400).json({ message: "Invalid document or client ID" });
      }
      
      // Get document info from database
      const documents = await storage.getDocumentsByClient(clientId);
      const document = documents.find(doc => doc.id === id);
      
      if (!document) {
        return res.status(404).json({ message: "Document not found" });
      }
      
      // Only serve Word documents through this endpoint
      const isDocx = document.mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || 
                     document.fileName?.toLowerCase().endsWith('.docx') || 
                     document.fileName?.toLowerCase().endsWith('.doc');
      
      if (!isDocx) {
        return res.status(400).json({ message: "This endpoint only serves Word documents" });
      }
      
      // Download from Azure Blob Storage
      const blobName = azureStorage.generateBlobName(document.id, document.fileName);
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

  app.get("/api/clients/:clientId/documents/:id/download", requireAuth, async (req: AuthenticatedRequest, res) => {
    const { ipAddress, userAgent } = getRequestInfo(req);
    
    try {
      const id = parseInt(req.params.id);
      const clientId = parseInt(req.params.clientId);
      
      // Get document info from database
      const documents = await storage.getDocumentsByClient(clientId);
      const document = documents.find(doc => doc.id === id);
      
      if (!document) {
        return res.status(404).json({ message: "Document not found" });
      }
      
      // Download from Azure Blob Storage
      const blobName = azureStorage.generateBlobName(document.id, document.fileName);
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
            { fileName: document.originalName, fileType: document.mimeType }
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

  app.delete("/api/clients/:clientId/documents/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const clientId = parseInt(req.params.clientId);
      
      // Get document info before deleting from database
      const documents = await storage.getDocumentsByClient(clientId);
      const document = documents.find(doc => doc.id === id);
      
      if (!document) {
        return res.status(404).json({ message: "Document not found" });
      }
      
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
  app.patch("/api/clients/:clientId/documents/:id/share", requireAuth, async (req: AuthenticatedRequest, res) => {
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
      const document = documents.find(doc => doc.id === id);
      
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
      }
      

      res.status(500).json({ message: "Failed to create user. Please try again." });
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
      const validatedData = insertUserProfileSchema.parse({
        ...req.body,
        userId
      });
      const profile = await storage.createUserProfile(validatedData);
      res.status(201).json(profile);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid profile data", errors: error.errors });
      }
      // Error logged
      res.status(500).json({ message: "Internal server error" });
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

  app.get("/api/clients/:clientId/session-notes", requireAuth, async (req: AuthenticatedRequest, res) => {
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
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/session-notes/:id", requireAuth, async (req: AuthenticatedRequest, res) => {
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

  app.post("/api/session-notes", requireAuth, async (req: AuthenticatedRequest, res) => {
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

  app.put("/api/session-notes/:id", requireAuth, async (req: AuthenticatedRequest, res) => {
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

  app.delete("/api/session-notes/:id", requireAuth, async (req: AuthenticatedRequest, res) => {
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
  app.post("/api/session-notes/:id/finalize", requireAuth, async (req: AuthenticatedRequest, res) => {
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

  // Generate PDF HTML for session note (for preview only)
  app.get("/api/session-notes/:id/pdf", requireAuth, async (req: AuthenticatedRequest, res) => {
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
        email: 'resiliencecrc@gmail.com',
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
      
      if (!process.env.OPENAI_API_KEY) {
        return res.status(503).json({ error: "AI features not available. Please configure OPENAI_API_KEY." });
      }
      
      if (!customInstructions) {
        return res.status(400).json({ error: "Custom instructions are required" });
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
      
      if (!process.env.OPENAI_API_KEY) {
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

  app.post("/api/ai/connected-suggestions", async (req, res) => {
    try {
      const { templateId, sourceField, sourceValue } = req.body;
      const { getConnectedSuggestions } = await import("./ai/openai");
      const suggestions = await getConnectedSuggestions(templateId, sourceField, sourceValue);
      res.json({ suggestions });
    } catch (error) {
      res.status(500).json({ error: "Failed to get connected suggestions" });
    }
  });

  app.post("/api/ai/generate-suggestions", async (req, res) => {
    try {
      const { field, context } = req.body;
      
      if (!process.env.OPENAI_API_KEY) {
        return res.status(503).json({ error: "AI features not available" });
      }
      
      const suggestions = await generateSmartSuggestions(field, context);
      res.json({ suggestions });
    } catch (error) {
      res.status(500).json({ error: "Failed to generate suggestions" });
    }
  });

  app.post("/api/ai/generate-clinical-report", async (req, res) => {
    try {
      const sessionNoteData = req.body;
      
      if (!process.env.OPENAI_API_KEY) {
        return res.status(503).json({ error: "AI features not available" });
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
      
      if (!process.env.OPENAI_API_KEY) {
        return res.status(503).json({ error: "AI features not available" });
      }
      
      const sessionNote = await storage.getSessionNote(sessionNoteId);
      if (!sessionNote) {
        return res.status(404).json({ error: "Session note not found" });
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
  app.get("/api/library/categories", async (req, res) => {
    try {
      const categories = await storage.getLibraryCategories();
      res.json(categories);
    } catch (error) {
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/library/categories/:id", async (req, res) => {
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

  app.post("/api/library/categories", async (req, res) => {
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

  app.put("/api/library/categories/:id", async (req, res) => {
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

  app.delete("/api/library/categories/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      await storage.deleteLibraryCategory(id);
      res.status(204).send();
    } catch (error) {
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/library/entries", async (req, res) => {
    try {
      const categoryId = req.query.categoryId ? parseInt(req.query.categoryId as string) : undefined;
      const entries = await storage.getLibraryEntries(categoryId);
      res.json(entries);
    } catch (error) {
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/library/entries/:id", async (req, res) => {
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

  app.post("/api/library/entries", async (req, res) => {
    try {
      const validatedData = insertLibraryEntrySchema.parse(req.body);
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

  app.put("/api/library/entries/:id", async (req, res) => {
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

  app.delete("/api/library/entries/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      await storage.deleteLibraryEntry(id);
      res.status(204).send();
    } catch (error) {
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/library/search", async (req, res) => {
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

  app.post("/api/library/entries/:id/increment-usage", async (req, res) => {
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
  app.get("/api/library/connections", async (req, res) => {
    try {
      const entryId = req.query.entryId ? parseInt(req.query.entryId as string) : undefined;
      const connections = await storage.getLibraryEntryConnections(entryId);
      res.json(connections);
    } catch (error) {
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/library/entries/:id/connected", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const connectedEntries = await storage.getConnectedEntries(id);
      res.json(connectedEntries);
    } catch (error) {
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post("/api/library/connections", requireAuth, async (req: AuthenticatedRequest, res) => {
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

  app.put("/api/library/connections/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const connection = await storage.updateLibraryEntryConnection(id, req.body);
      res.json(connection);
    } catch (error) {
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.delete("/api/library/connections/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      await storage.deleteLibraryEntryConnection(id);
      res.status(204).send();
    } catch (error) {
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.delete("/api/library/entries/:entryId/connections", async (req, res) => {
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
  app.get("/api/assessments/templates", async (req, res) => {
    try {
      const templates = await storage.getAssessmentTemplates();
      res.json(templates);
    } catch (error) {
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/assessments/templates/:id", async (req, res) => {
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

  app.post("/api/assessments/templates", async (req, res) => {
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

  app.patch("/api/assessments/templates/:id", async (req, res) => {
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

  app.delete("/api/assessments/templates/:id", async (req, res) => {
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
  app.get("/api/assessments/assignments", async (req, res) => {
    try {
      const clientId = req.query.clientId ? parseInt(req.query.clientId as string) : undefined;
      const assignments = await storage.getAssessmentAssignments(clientId);
      res.json(assignments);
    } catch (error) {
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/assessments/assignments/:id", async (req, res) => {
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

  app.post("/api/assessments/assignments", async (req, res) => {
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
  app.get("/api/assessments/assignments/:assignmentId/responses", async (req, res) => {
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

  app.post("/api/assessments/responses", async (req, res) => {
    try {
      const responseData = req.body;
      const response = await storage.saveAssessmentResponse(responseData);
      res.status(201).json(response);
    } catch (error) {
      console.error('Error saving assessment response:', error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Recalculate scores for an assessment (useful for fixing existing assessments)
  app.post("/api/assessments/:assignmentId/recalculate-scores", async (req, res) => {
    try {
      const assignmentId = parseInt(req.params.assignmentId);
      await storage.recalculateAssessmentScores(assignmentId);
      res.status(200).json({ message: "Scores recalculated successfully" });
    } catch (error) {
      console.error('Error recalculating assessment scores:', error);
      res.status(500).json({ message: "Internal server error" });
    }
  });


  app.post("/api/assessments/sections", async (req, res) => {
    try {
      const validatedData = insertAssessmentSectionSchema.parse(req.body);
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

  app.patch("/api/assessments/sections/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const validatedData = insertAssessmentSectionSchema.partial().parse(req.body);
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

  app.delete("/api/assessments/sections/:id", async (req, res) => {
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
  app.post("/api/assessments/questions", async (req, res) => {
    try {
      const questionData = req.body;
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

  app.patch("/api/assessments/questions/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid question ID" });
      }
      
      const questionData = req.body;
      const question = await storage.updateAssessmentQuestion(id, questionData);
      res.json(question);
    } catch (error) {
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Assessment Question Options Routes
  app.get("/api/assessments/questions/:questionId/options", async (req, res) => {
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

  app.post("/api/assessments/question-options", async (req, res) => {
    try {
      const validatedData = insertAssessmentQuestionOptionSchema.parse(req.body);
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
  app.post("/api/assessments/question-options/bulk", async (req, res) => {
    try {
      const { options } = req.body;
      if (!Array.isArray(options)) {
        return res.status(400).json({ message: "Options must be an array" });
      }
      
      const validatedOptions = options.map(option => 
        insertAssessmentQuestionOptionSchema.parse(option)
      );
      
      const createdOptions = await Promise.all(
        validatedOptions.map(option => storage.createAssessmentQuestionOption(option))
      );
      res.status(201).json(createdOptions);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid option data", errors: error.errors });
      }
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.patch("/api/assessments/question-options/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const validatedData = insertAssessmentQuestionOptionSchema.partial().parse(req.body);
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

  app.delete("/api/assessments/question-options/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      await storage.deleteAssessmentQuestionOption(id);
      res.status(204).send();
    } catch (error) {
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.delete("/api/assessments/questions/:questionId/options", async (req, res) => {
    try {
      const questionId = parseInt(req.params.questionId);
      await storage.deleteAllAssessmentQuestionOptions(questionId);
      res.status(204).send();
    } catch (error) {
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.delete("/api/assessments/questions/:questionId", async (req, res) => {
    try {
      const questionId = parseInt(req.params.questionId);
      if (isNaN(questionId)) {
        return res.status(400).json({ message: "Invalid question ID" });
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
  app.get("/api/assessments/assignments/:assignmentId/report", async (req, res) => {
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

  app.post("/api/assessments/reports", async (req, res) => {
    try {
      const reportData = req.body;
      const report = await storage.createAssessmentReport(reportData);
      res.status(201).json(report);
    } catch (error) {
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Generate AI assessment report
  app.post("/api/assessments/assignments/:assignmentId/generate-report", requireAuth, async (req: AuthenticatedRequest, res) => {
    const { ipAddress, userAgent } = getRequestInfo(req);
    
    try {
      if (!req.user) {
        return res.status(401).json({ message: "Authentication required" });
      }

      const assignmentId = parseInt(req.params.assignmentId);
      if (isNaN(assignmentId)) {
        return res.status(400).json({ message: "Invalid assignment ID" });
      }

      // Get assignment details, responses, and sections
      const assignment = await storage.getAssessmentAssignment(assignmentId);
      if (!assignment) {
        return res.status(404).json({ message: "Assessment assignment not found" });
      }

      const responses = await storage.getAssessmentResponses(assignmentId);
      const sections = await storage.getAssessmentSections(assignment.templateId);

      // Generate the report using AI
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
        'report_generated',
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
    } catch (error) {
      console.error('Error generating assessment report:', error);
      res.status(500).json({ message: "Failed to generate assessment report" });
    }
  });

  // Update assessment report draft (save edited content)
  app.put("/api/assessments/assignments/:assignmentId/report", requireAuth, async (req: AuthenticatedRequest, res) => {
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
      await AuditLogger.logAssessmentAccess(
        req.user.id,
        req.user.username,
        assignmentId,
        existingReport.assignment.clientId,
        'assessment_updated',
        ipAddress,
        userAgent,
        { 
          reportId: updatedReport.id,
          operation: 'draft_saved'
        }
      );

      res.json(updatedReport);
    } catch (error) {
      console.error('Error updating assessment report draft:', error);
      res.status(500).json({ message: "Failed to update assessment report" });
    }
  });

  // Finalize assessment report (matching session notes pattern)
  app.post("/api/assessments/assignments/:assignmentId/report/finalize", requireAuth, async (req: AuthenticatedRequest, res) => {
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

      // Permission check: Only assigned therapist, supervisor, or admin
      const assignment = await storage.getAssessmentAssignment(assignmentId);
      const isAssignedTherapist = assignment?.assignedById === req.user.id;
      const isAdmin = req.user.role === 'administrator';

      // Check if user is a supervisor of the assigned therapist
      let isSupervisor = false;
      if (!isAssignedTherapist && !isAdmin && assignment) {
        const supervisorAssignments = await storage.getSupervisorAssignments(req.user.id);
        isSupervisor = supervisorAssignments.some(
          sa => sa.therapistId === assignment.assignedById
        );
      }

      if (!isAssignedTherapist && !isAdmin && !isSupervisor) {
        return res.status(403).json({ message: "You do not have permission to finalize this report" });
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
  app.post("/api/assessments/assignments/:assignmentId/report/unfinalize", requireAuth, async (req: AuthenticatedRequest, res) => {
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

      // Permission check: Only assigned therapist, supervisor, or admin
      const assignment = await storage.getAssessmentAssignment(assignmentId);
      const isAssignedTherapist = assignment?.assignedById === req.user.id;
      const isAdmin = req.user.role === 'administrator';

      // Check if user is a supervisor of the assigned therapist
      let isSupervisor = false;
      if (!isAssignedTherapist && !isAdmin && assignment) {
        const supervisorAssignments = await storage.getSupervisorAssignments(req.user.id);
        isSupervisor = supervisorAssignments.some(
          sa => sa.therapistId === assignment.assignedById
        );
      }

      if (!isAssignedTherapist && !isAdmin && !isSupervisor) {
        return res.status(403).json({ message: "You do not have permission to unfinalize this report" });
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
      await AuditLogger.logAssessmentAccess(
        req.user.id,
        req.user.username,
        assignmentId,
        existingReport.assignment.clientId,
        'assessment_updated',
        ipAddress,
        userAgent,
        { 
          reportId: updatedReport.id,
          operation: 'report_reopened'
        }
      );

      res.json(updatedReport);
    } catch (error) {
      console.error('Error unfinalizing assessment report:', error);
      res.status(500).json({ message: "Failed to unfinalize assessment report" });
    }
  });

  // Download assessment report as PDF
  app.get("/api/assessments/assignments/:assignmentId/download/pdf", requireAuth, async (req: AuthenticatedRequest, res) => {
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
        email: 'resiliencecrc@gmail.com',
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
          signatureImage: userProfile?.signatureImage,
          profile: {
            licenseType: userProfile?.licenseType,
            licenseNumber: userProfile?.licenseNumber
          }
        } as any;
      }

      // Generate professional HTML (browser will handle PDF printing - matching session notes pattern)
      const { generateAssessmentReportHTML } = await import("./pdf/assessment-report-pdf");
      const html = generateAssessmentReportHTML(assignment, report, practiceSettings);
      
      // HIPAA Audit: Log PDF download
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
          format: 'pdf',
          documentType: 'assessment_report',
          templateName: assignment.template?.name
        }
      );
      
      // Return HTML with proper headers (browser will handle PDF conversion via print)
      res.setHeader('Content-Type', 'text/html');
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, private');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      res.removeHeader('ETag');
      res.send(html);
      
    } catch (error) {
      console.error('Error generating PDF:', error);
      res.status(500).json({ message: "Failed to generate PDF" });
    }
  });

  // Download assessment report as Word document
  app.get("/api/assessments/assignments/:assignmentId/download/docx", requireAuth, async (req: AuthenticatedRequest, res) => {
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
        email: 'resiliencecrc@gmail.com',
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
          signatureImage: userProfile?.signatureImage,
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

      // Report Content - parse HTML to text
      const htmlText = reportContent.replace(/<[^>]*>/g, ''); // Strip HTML tags for Word
      const lines = htmlText.split('\n');
      
      for (const line of lines) {
        if (line.trim()) {
          paragraphs.push(new Paragraph({
            children: [new TextRun({ text: line, font: 'Times New Roman', size: 22 })],
            spacing: { after: 120 }, // Tighter spacing
            alignment: AlignmentType.JUSTIFIED
          }));
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

        if (assignment.assignedBy.profile?.licenseType) {
          paragraphs.push(new Paragraph({
            children: [new TextRun({ 
              text: `${assignment.assignedBy.profile.licenseType}${assignment.assignedBy.profile.licenseNumber ? ' #' + assignment.assignedBy.profile.licenseNumber : ''}`, 
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
        children: [new TextRun({ text: "This report was generated electronically and is valid without a physical signature.", size: 20, color: "9ca3af" })],
        alignment: AlignmentType.CENTER,
        spacing: { after: 100 }
      }));
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
      
      // Trigger billing when session is completed
      if (status === 'completed') {
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
      const { startDate, endDate, therapistId, status, serviceCode, clientSearch, clientType } = req.query;
      
      const reports = await storage.getBillingReports({
        startDate: startDate as string,
        endDate: endDate as string,
        therapistId: therapistId ? parseInt(therapistId as string) : undefined,
        status: status as string,
        serviceCode: serviceCode as string,
        clientSearch: clientSearch as string,
        clientType: clientType as string
      });
      
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

  app.get("/api/clients/:clientId/billing", requireAuth, async (req: AuthenticatedRequest, res) => {
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

  app.get("/api/clients/:clientId/communications", requireAuth, async (req: AuthenticatedRequest, res) => {
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

      res.json(allNotifications);
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
      
      // Generate invoice HTML
      const subtotal = billingRecords.reduce((sum, record) => sum + Number(record.totalAmount || 0), 0);
      const insuranceCoverage = billingRecords.reduce((sum, record) => sum + (Number(record.totalAmount || 0) * 0.8), 0);
      const copayTotal = billingRecords.reduce((sum, record) => sum + Number(record.copayAmount || 0), 0);
      const totalPayments = billingRecords.reduce((sum, record) => sum + Number(record.paymentAmount || 0), 0);
      const remainingDue = subtotal - totalPayments;
      
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
            ${billingRecords.some(r => r.insuranceCovered) ? `
            <div class="total-row">
              <span>Insurance Coverage:</span>
              <span>-$${insuranceCoverage.toFixed(2)}</span>
            </div>` : ''}
            <div class="total-row">
              <span>Copay Amount:</span>
              <span>$${copayTotal.toFixed(2)}</span>
            </div>
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
      
      if (action === 'download') {
        // Generate PDF for download with improved error handling
        try {
          
          const browser = await puppeteer.launch({
            executablePath: '/nix/store/zi4f80l169xlmivz8vja8wlphq74qqk0-chromium-125.0.6422.141/bin/chromium',
            args: [
              '--no-sandbox',
              '--disable-setuid-sandbox',
              '--disable-dev-shm-usage',
              '--disable-gpu',
              '--disable-extensions',
              '--disable-default-apps',
              '--disable-web-security',
              '--single-process',
              '--no-zygote'
            ],
            headless: true,
            timeout: 45000,
            protocolTimeout: 45000
          });
          
          const page = await browser.newPage();
          await page.setViewport({ width: 1200, height: 800 });
          await page.emulateMediaType('print');
          await page.setContent(invoiceHtml, { waitUntil: 'domcontentloaded' });
          
          // Wait for fonts to load
          await new Promise(resolve => setTimeout(resolve, 1500));
          
          const pdfBuffer = await page.pdf({
            format: 'A4',
            printBackground: true,
            margin: {
              top: '20mm',
              right: '10mm',
              bottom: '20mm',
              left: '10mm'
            }
          });
          
          await browser.close();
          
          // Send PDF file for download
          const filename = `Invoice-${client.clientId}-${new Date().toISOString().split('T')[0]}.pdf`;
          res.writeHead(200, {
            'Content-Type': 'application/pdf',
            'Content-Disposition': `attachment; filename="${filename}"`,
            'Content-Length': pdfBuffer.length
          });
          res.end(pdfBuffer, 'binary');
          return;
          
        } catch (pdfError: any) {
          console.error('PDF generation failed for download:', {
            error: pdfError?.message || 'Unknown error',
            stack: pdfError?.stack?.split('\n').slice(0, 3).join('\n') || 'No stack',
            clientId: client.clientId,
            timestamp: new Date().toISOString()
          });
          
          // Fallback to enhanced HTML if PDF generation fails
          const enhancedHtml = invoiceHtml.replace(
            '</head>',
            `<style>
              @media screen { body { background: #f5f5f5; padding: 20px; font-family: 'Times New Roman', serif; } 
                .invoice-container { background: white; max-width: 800px; margin: 0 auto; padding: 40px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); border-radius: 8px; } }
              @media print { body { background: white; padding: 0; } .invoice-container { box-shadow: none; border-radius: 0; } }
            </style></head><body><div class="invoice-container">`
          ).replace('</body>', '</div></body>');
          
          const filename = `Invoice-${client.clientId}-${new Date().toISOString().split('T')[0]}.html`;
          res.setHeader('Content-Type', 'text/html');
          res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
          return res.send(enhancedHtml);
        }
      } else if (action === 'print') {
        // Return HTML for printing
        res.setHeader('Content-Type', 'text/html');
        res.send(invoiceHtml);
      } else if (action === 'email') {
        // Email invoice using SparkPost if available
        if (process.env.SPARKPOST_API_KEY && client.email) {
          try {
            const sp = new SparkPost(process.env.SPARKPOST_API_KEY);
            
            // Use the configured send domain for emails
<<<<<<< HEAD
            const fromEmail = getEmailFromAddress();
=======
            const fromEmail = 'noreply@resiliencecrm.com';
>>>>>>> dd734e8 (Update email sender address for all outgoing system notifications)
            
            // Generate PDF for email attachment with improved reliability
            let pdfBuffer;
            try {
              const browser = await puppeteer.launch({
                executablePath: '/nix/store/zi4f80l169xlmivz8vja8wlphq74qqk0-chromium-125.0.6422.141/bin/chromium',
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
              });
              
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
                  const browser = await puppeteer.launch({
                    executablePath: '/nix/store/zi4f80l169xlmivz8vja8wlphq74qqk0-chromium-125.0.6422.141/bin/chromium',
                    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
                    headless: true,
                    timeout: 60000,
                    protocolTimeout: 60000
                  });
                  
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
              recipients: [{ 
                address: {
                  email: client.email,
                  name: client.fullName
                }
              }],
              content: {
                from: {
                  name: practiceSettings.name,
                  email: fromEmail
                },
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
      const { status, amount, date, reference, method, notes, clientId } = req.body;
      
      // Use centralized storage method to get billing data for authorization
      // clientId is passed from frontend to use getBillingForInvoice
      if (!clientId) {
        return res.status(400).json({ message: "Client ID is required" });
      }
      
      const invoiceData = await storage.getBillingForInvoice(clientId, billingId);
      
      if (!invoiceData) {
        return res.status(404).json({ message: "Billing record not found" });
      }

      // Authorization check: Allow administrators or therapists assigned to the client
      if (req.user?.role === 'administrator' || req.user?.role === 'admin') {
        // Admins can record any payment
      } else if (req.user?.role === 'therapist') {
        // Therapists can only record payments for their assigned clients
        if (invoiceData.client.assignedTherapistId !== req.user.id) {
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
        notes
      });
      
      res.json({ message: "Payment details updated successfully" });
    } catch (error) {
      console.error('[PAYMENT ERROR]', error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Assessment completion workflow endpoints
  
  // Get assignment details with full relationships
  app.get('/api/assessments/assignments/:assignmentId', requireAuth, async (req: AuthenticatedRequest, res) => {
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
  app.get('/api/assessments/templates/:templateId/sections', requireAuth, async (req: AuthenticatedRequest, res) => {
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
  app.get('/api/assessments/assignments/:assignmentId/responses', requireAuth, async (req: AuthenticatedRequest, res) => {
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

  // Save assessment response
  app.post('/api/assessments/responses', requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const response = await storage.saveAssessmentResponse(req.body);
      
      // Automatically update assessment status to 'client_in_progress' if it's currently 'pending'
      // This ensures the UI shows "Continue Assessment" after saving any data
      if (req.body.assignmentId) {
        const assignment = await storage.getAssessmentAssignmentById(req.body.assignmentId);
        if (assignment && assignment.status === 'pending') {
          await storage.updateAssessmentAssignment(req.body.assignmentId, {
            status: 'client_in_progress'
          });
        }
      }
      
      res.json(response);
    } catch (error) {
      res.status(500).json({ message: 'Internal server error' });
    }
  });

  // Update assignment status
  app.patch('/api/assessments/assignments/:assignmentId', requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      if (!req.user) {
        return res.status(401).json({ message: "Authentication required" });
      }
      
      const { assignmentId } = req.params;
      const existingAssignment = await storage.getAssessmentAssignmentById(parseInt(assignmentId));
      
      if (!existingAssignment) {
        return res.status(404).json({ message: 'Assessment assignment not found' });
      }
      
      // Role-based authorization: therapists can only update assessments for their assigned clients
      if (req.user.role === 'therapist') {
        const client = await storage.getClient(existingAssignment.clientId);
        if (!client || client.assignedTherapistId !== req.user.id) {
          return res.status(403).json({ message: "Access denied. You can only update assessments for your assigned clients." });
        }
      } else if (req.user.role === 'supervisor') {
        const client = await storage.getClient(existingAssignment.clientId);
        if (!client) {
          return res.status(404).json({ message: 'Client not found' });
        }
        const supervisorAssignments = await storage.getSupervisorAssignments(req.user.id);
        const supervisedTherapistIds = supervisorAssignments.map(a => a.therapistId);
        if (client.assignedTherapistId && !supervisedTherapistIds.includes(client.assignedTherapistId)) {
          return res.status(403).json({ message: "Access denied. You can only update assessments for clients of therapists you supervise." });
        }
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
  app.delete('/api/assessments/assignments/:assignmentId', requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      if (!req.user) {
        return res.status(401).json({ message: "Authentication required" });
      }
      
      const { assignmentId } = req.params;
      const existingAssignment = await storage.getAssessmentAssignmentById(parseInt(assignmentId));
      
      if (!existingAssignment) {
        return res.status(404).json({ message: 'Assessment assignment not found' });
      }
      
      // Role-based authorization: therapists can only delete assessments for their assigned clients
      if (req.user.role === 'therapist') {
        const client = await storage.getClient(existingAssignment.clientId);
        if (!client || client.assignedTherapistId !== req.user.id) {
          return res.status(403).json({ message: "Access denied. You can only delete assessments for your assigned clients." });
        }
      } else if (req.user.role === 'supervisor') {
        const client = await storage.getClient(existingAssignment.clientId);
        if (!client) {
          return res.status(404).json({ message: 'Client not found' });
        }
        const supervisorAssignments = await storage.getSupervisorAssignments(req.user.id);
        const supervisedTherapistIds = supervisorAssignments.map(a => a.therapistId);
        if (client.assignedTherapistId && !supervisedTherapistIds.includes(client.assignedTherapistId)) {
          return res.status(403).json({ message: "Access denied. You can only delete assessments for clients of therapists you supervise." });
        }
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
      
      // Build query with filters
      let query = db.select({
        id: auditLogs.id,
        userId: auditLogs.userId,
        username: auditLogs.username,
        action: auditLogs.action,
        result: auditLogs.result,
        resourceType: auditLogs.resourceType,
        resourceId: auditLogs.resourceId,
        clientId: auditLogs.clientId,
        clientName: clients.fullName,
        ipAddress: auditLogs.ipAddress,
        userAgent: auditLogs.userAgent,
        riskLevel: auditLogs.riskLevel,
        hipaaRelevant: auditLogs.hipaaRelevant,
        details: auditLogs.details,
        timestamp: auditLogs.timestamp,
      })
      .from(auditLogs)
      .leftJoin(clients, eq(auditLogs.clientId, clients.id));

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
        whereConditions.push(eq(auditLogs.action, action as string));
      }
      
      if (userId && userId !== '') {
        whereConditions.push(ilike(auditLogs.username, `%${userId}%`));
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

      // Get top active users
      const userActivity = await db.select({
        username: auditLogs.username,
        activityCount: sql`count(*)`,
        lastActivity: sql`max(${auditLogs.timestamp})`,
      })
      .from(auditLogs)
      .groupBy(auditLogs.username)
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
        .where(eq(sessions.clientId, session.clientId))
        .orderBy(desc(sessions.sessionDate))
        .limit(100);

      // Get all rooms for lookup
      const allRooms = await storage.getRooms();
      const roomMap = new Map(allRooms.map(r => [r.id, r]));
      
      // Get all services for lookup
      const allServices = await storage.getServices();
      const serviceMap = new Map(allServices.map(s => [s.id, s]));

      // Format sessions for portal display in America/New_York timezone
      const { formatInTimeZone } = await import('date-fns-tz');
      const formattedSessions = clientSessionsRaw.map(s => {
        const room = s.roomId ? roomMap.get(s.roomId) : null;
        const service = s.serviceId ? serviceMap.get(s.serviceId) : null;
        
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
            eq(sessions.therapistId, client.assignedTherapistId),
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
            therapistId: client.assignedTherapistId,
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
      const rawInvoices = await storage.getClientInvoices(session.clientId);
      
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
                name: `${invoice.serviceName || invoice.serviceCode} - ${invoice.sessionType}`,
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
        customer_email: client.portalEmail || client.email,
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
            paymentDate: new Date(),
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
              serviceName: services.name,
              serviceCode: services.code,
            })
            .from(sessionBilling)
            .leftJoin(sessions, eq(sessionBilling.sessionId, sessions.id))
            .leftJoin(services, eq(sessionBilling.serviceCode, services.code))
            .where(eq(sessionBilling.id, invoiceId))
            .limit(1);

          if (client && client.email && invoiceDetails.length > 0) {
            const invoice = invoiceDetails[0];
            const amount = (session.amount_total / 100).toFixed(2);
            
            if (process.env.SPARKPOST_API_KEY) {
              const SparkPost = (await import('sparkpost')).default;
              const sp = new SparkPost(process.env.SPARKPOST_API_KEY);
<<<<<<< HEAD
              const fromEmail = getEmailFromAddress();
=======
              const fromEmail = 'noreply@resiliencecrm.com';
>>>>>>> dd734e8 (Update email sender address for all outgoing system notifications)
              
              await sp.transmissions.send({
                options: {
                  sandbox: false,
                },
                content: {
                  from: fromEmail,
                  subject: 'Payment Receipt - TherapyFlow',
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
                        This is an automated receipt from TherapyFlow. Please do not reply to this email.
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
      const insuranceCoverage = billing.insuranceCovered ? subtotal * 0.8 : 0;
      const copayTotal = billing.insuranceCovered ? parseFloat(billing.copayAmount || '0') : 0;
      const totalPayments = parseFloat(billing.paymentAmount || '0');
      const remainingDue = subtotal - totalPayments;

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

      // Download from Azure Blob Storage
      try {
        const blobName = azureStorage.generateBlobName(document.id, document.fileName);
        const downloadResult = await azureStorage.downloadFile(blobName);
        
        if (downloadResult.success) {
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
                fileSize: document.fileSize
              }
            );
          }

          const fileBuffer = downloadResult.data;

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
          subject: 'Test Email from TherapyFlow',
          html: `
            <h1>Test Email</h1>
            <p>This is a test email from TherapyFlow.</p>
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
