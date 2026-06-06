// Shared helper functions extracted from routes.ts.
// These are module-level utilities (no closures over registerRoutes state) used
// across the route handlers: email senders, privacy redaction, consent checks,
// id generation, request helpers and the public calendar-feed rate limiter.
import * as fs from "fs";
import SparkPost from "sparkpost";
import { fromZonedTime, formatInTimeZone } from "date-fns-tz";

import { storage } from "./storage";
import { db } from "./db";
import { clientHistory } from "@shared/schema";

// Helper function to get the email sender address from environment
export function getEmailFromAddress(): string {
  const from = process.env.EMAIL_FROM;
  if (!from) {
    throw new Error('EMAIL_FROM not configured');
  }
  return from;
}

// Helper function to get the Chromium executable path
// First tries the Nix path (for Replit), falls back to system Chrome/Chromium
export function getChromiumExecutablePath(): string | undefined {
  const nixPath = '/nix/store/zi4f80l169xlmivz8vja8wlphq74qqk0-chromium-125.0.6422.141/bin/chromium';
  if (fs.existsSync(nixPath)) {
    return nixPath;
  }
  // Return undefined to let Puppeteer find system-installed Chrome/Chromium automatically
  return undefined;
}

// Helper function to convert EST date/time to UTC
export function convertESTToUTC(dateStr: string, timeStr: string): Date {
  const PRACTICE_TIMEZONE = 'America/New_York';
  const dateTimeString = `${dateStr} ${timeStr}:00`;
  // fromZonedTime interprets the string as EST and returns equivalent UTC Date
  return fromZonedTime(dateTimeString, PRACTICE_TIMEZONE);
}

// Helper function to generate unique client ID
export async function generateClientId(): Promise<string> {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');

  // Get count of clients created this month to generate sequential ID
  const count = await storage.getClientCountByMonth(year, parseInt(month));
  const sequentialId = String(count + 1).padStart(4, '0');

  return `CL-${year}-${sequentialId}`;
}

// Security: Safe serializer to exclude sensitive user fields from API responses
export function sanitizeUser(user: any) {
  const {
    password: _,
    passwordResetToken: __,
    passwordResetExpiry: ___,
    emailVerificationToken: ____,
    // Secret calendar feed token must never leak through generic user
    // serialization — it is only ever returned to its owner via the dedicated
    // GET /api/calendar/feed endpoint.
    calendarFeedToken: _____,
    ...safeUser
  } = user;
  return safeUser;
}

// Security: Safe serializer for arrays of users
export function sanitizeUsers(users: any[]) {
  return users.map(sanitizeUser);
}

// Simple in-memory rate limiter for the PUBLIC (unauthenticated) calendar feed.
// Calendar apps poll on a schedule (typically hours apart), so a generous cap
// here never affects real subscribers but blunts abusive polling / DoS of an
// internet-exposed route that runs a non-trivial DB query.
const calendarFeedHits = new Map<string, { count: number; resetAt: number }>();
const CALENDAR_FEED_WINDOW_MS = 10 * 60 * 1000; // 10 minutes
const CALENDAR_FEED_MAX = 60; // requests per IP per window
export function calendarFeedRateLimited(ip: string): boolean {
  const now = Date.now();
  // Opportunistically sweep expired entries so the map cannot grow unbounded.
  if (calendarFeedHits.size > 5000) {
    calendarFeedHits.forEach((entry, key) => {
      if (now > entry.resetAt) calendarFeedHits.delete(key);
    });
  }
  const entry = calendarFeedHits.get(ip);
  if (!entry || now > entry.resetAt) {
    calendarFeedHits.set(ip, { count: 1, resetAt: now + CALENDAR_FEED_WINDOW_MS });
    return false;
  }
  entry.count += 1;
  return entry.count > CALENDAR_FEED_MAX;
}

// Helper function to get the base URL from request
export function getBaseUrl(req: any): string {
  // Use BASE_URL if set, otherwise build from request
  if (process.env.BASE_URL) {
    return process.env.BASE_URL;
  }

  // Build URL from request headers
  const protocol = req.headers['x-forwarded-proto'] || (req.secure ? 'https' : 'http');
  const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost:5000';
  return `${protocol}://${host}`;
}

// GDPR Consent Validation: Check if client has granted consent for AI processing
// FAIL-CLOSED: Returns false on errors to comply with GDPR "no processing without consent" requirement
export async function checkAIProcessingConsent(clientId: number): Promise<{ hasConsent: boolean; message?: string; error?: string }> {
  try {
    const consents = await storage.getClientConsents(clientId);

    // Find the most recent AI processing consent
    const aiConsents = consents.filter(c => c.consentType === 'ai_processing');

    if (aiConsents.length === 0) {
      return {
        hasConsent: false,
        message: 'AI processing consent has not been granted. Please update your privacy settings in the client portal.'
      };
    }

    // Get the most recent consent
    const latestConsent = aiConsents.sort((a, b) =>
      new Date(b.grantedAt || 0).getTime() - new Date(a.grantedAt || 0).getTime()
    )[0];

    // Check if consent is granted and not withdrawn
    if (!latestConsent.granted || latestConsent.withdrawnAt) {
      return {
        hasConsent: false,
        message: 'AI processing consent has been withdrawn. To use AI features, please grant consent in your privacy settings.'
      };
    }

    return { hasConsent: true };
  } catch (error) {
    console.error('[GDPR CRITICAL] Error checking AI consent:', error);
    // FAIL-CLOSED: Deny processing on errors to comply with GDPR
    // This prevents database outages or bugs from bypassing consent requirements
    return {
      hasConsent: false,
      message: 'Unable to verify AI processing consent due to a system error. Please try again later or contact support.',
      error: (error as Error).message
    };
  }
}

// SMS Consent Validation: Check if a client has granted consent to receive SMS
// appointment notifications. Mirrors checkAIProcessingConsent and is FAIL-CLOSED:
// any error (or missing/withdrawn consent) returns hasConsent=false so a bug or
// outage can never cause an unsolicited text. SMS is OFF by default for every
// client until a staff member records the client's explicit approval.
export async function checkSmsConsent(clientId: number): Promise<{ hasConsent: boolean; message?: string; error?: string }> {
  try {
    const consents = await storage.getClientConsents(clientId);

    const smsConsents = consents.filter(c => c.consentType === 'sms_notifications');

    if (smsConsents.length === 0) {
      return {
        hasConsent: false,
        message: 'SMS notification consent has not been recorded for this client.'
      };
    }

    // Get the most recent SMS consent record
    const latestConsent = smsConsents.sort((a, b) =>
      new Date(b.grantedAt || 0).getTime() - new Date(a.grantedAt || 0).getTime()
    )[0];

    if (!latestConsent.granted || latestConsent.withdrawnAt) {
      return {
        hasConsent: false,
        message: 'SMS notification consent has been withdrawn for this client.'
      };
    }

    return { hasConsent: true };
  } catch (error) {
    console.error('[SMS CONSENT] Error checking SMS consent:', error);
    // FAIL-CLOSED: never send a text when consent can't be verified.
    return {
      hasConsent: false,
      message: 'Unable to verify SMS consent due to a system error.',
      error: (error as Error).message
    };
  }
}

// Helper function to send portal activation email
export async function sendActivationEmail(clientEmail: string, clientName: string, activationToken: string, baseUrl?: string) {
  if (!process.env.SPARKPOST_API_KEY) {
    console.log('[ACTIVATION] SparkPost API key not configured - activation email not sent');
    return;
  }

  try {
    const sp = new SparkPost(process.env.SPARKPOST_API_KEY);
    const fromEmail = getEmailFromAddress();
    // Use provided baseUrl or fall back to env variable or localhost
    const appUrl = baseUrl || process.env.BASE_URL || 'http://localhost:5000';
    const activationUrl = `${appUrl}/portal/activate/${activationToken}`;

    await sp.transmissions.send({
      content: {
        from: fromEmail,
        subject: 'Activate Your SmartHub Portal Account',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #2563eb;">Welcome to SmartHub Client Portal</h2>
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
export async function sendPasswordResetEmail(clientEmail: string, clientName: string, resetToken: string, baseUrl?: string) {
  if (!process.env.SPARKPOST_API_KEY) {
    console.log('[PASSWORD_RESET] SparkPost API key not configured - reset email not sent');
    return;
  }

  try {
    const sp = new SparkPost(process.env.SPARKPOST_API_KEY);
    const fromEmail = getEmailFromAddress();
    // Use provided baseUrl or fall back to env variable or localhost
    const appUrl = baseUrl || process.env.BASE_URL || 'http://localhost:5000';
    const resetUrl = `${appUrl}/portal/reset-password/${resetToken}`;

    await sp.transmissions.send({
      content: {
        from: fromEmail,
        subject: 'Reset Your SmartHub Portal Password',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #2563eb;">Password Reset Request</h2>
            <p>Hi ${clientName},</p>
            <p>We received a request to reset your SmartHub Client Portal password. Click the button below to set a new password:</p>
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
export async function sendAppointmentConfirmationEmail(
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
    const fromEmail = getEmailFromAddress();
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
        subject: 'Appointment Confirmed - SmartHub',
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
export async function trackClientHistory(params: {
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

// Helper function to check assessment authorization for RESPONSES
// Rule: Therapists/supervisors can save responses for assessments they have access to.
// Clients can save their own responses. Admins can only view.
export async function checkAssessmentResponsePermission(
  assignmentId: number,
  userId: number,
  userRole: string,
  responderId?: number
): Promise<{ allowed: boolean; notFound?: boolean; message?: string; assignment?: any }> {
  const assignment = await storage.getAssessmentAssignmentById(assignmentId);

  if (!assignment) {
    return { allowed: false, notFound: true, message: 'Assessment assignment not found' };
  }

  // Admin can only VIEW, not edit responses
  if (userRole === 'administrator' || userRole === 'admin') {
    return {
      allowed: false,
      message: 'Administrators can view assessments but cannot edit them.',
      assignment
    };
  }

  // Therapists and supervisors can save responses if:
  // 1. They are the responder (their userId matches responderId in the payload)
  // 2. They are saving their own responses (not spoofing another user)
  if (userRole === 'therapist' || userRole === 'supervisor') {
    // If responderId is provided, ensure the user is saving as themselves
    if (responderId !== undefined && responderId !== userId) {
      return {
        allowed: false,
        message: 'You can only save responses as yourself.',
        assignment
      };
    }
    // Therapists and supervisors can respond to assessments
    return { allowed: true, assignment };
  }

  // Client role - check if they are the client assigned to this assessment
  if (userRole === 'client') {
    const client = await storage.getClient(assignment.clientId);
    if (client && (client as any).portalUserId === userId) {
      return { allowed: true, assignment };
    }
    return {
      allowed: false,
      message: 'You can only respond to assessments assigned to you.',
      assignment
    };
  }

  // Creator (assignedById) can always save responses (fallback for other roles)
  if (assignment.assignedById === userId) {
    return { allowed: true, assignment };
  }

  return {
    allowed: false,
    message: 'Access denied. You do not have permission to save responses for this assessment.',
    assignment
  };
}

// Helper function to check assessment authorization for MANAGEMENT (delete, report generation, etc.)
// Rule: Only the creator (assignedById) can manage. Admin can only view.
export async function checkAssessmentEditPermission(
  assignmentId: number,
  userId: number,
  userRole: string
): Promise<{ allowed: boolean; notFound?: boolean; message?: string; assignment?: any }> {
  const assignment = await storage.getAssessmentAssignmentById(assignmentId);

  if (!assignment) {
    return { allowed: false, notFound: true, message: 'Assessment assignment not found' };
  }

  // Admin can only VIEW, not edit
  if (userRole === 'administrator' || userRole === 'admin') {
    return {
      allowed: false,
      message: 'Administrators can view assessments but cannot edit them. Only the creator can make changes.',
      assignment
    };
  }

  // Only the creator (assignedById) can edit/manage
  if (assignment.assignedById !== userId) {
    return {
      allowed: false,
      message: 'Access denied. Only the user who created this assessment can make changes.',
      assignment
    };
  }

  return { allowed: true, assignment };
}

// Format client name for accountant view: first name + last initial (e.g. "John D.")
export function formatClientInitial(clientObj: any): string {
  const full = (clientObj.fullName || clientObj.firstName || '').trim();
  if (!full) return 'Unknown';
  const parts = full.split(/\s+/);
  if (parts.length === 1) return parts[0];
  const first = parts[0];
  const lastInitial = parts[parts.length - 1].charAt(0).toUpperCase();
  return `${first} ${lastInitial}.`;
}

// Helper to redact client data from any object for accountant role
export function redactClientData(clientObj: any): any {
  if (!clientObj) return clientObj;
  const displayName = formatClientInitial(clientObj);
  return {
    ...clientObj,
    fullName: displayName,
    firstName: displayName,
    lastName: '',
    email: undefined,
    phone: undefined,
    dateOfBirth: undefined,
    address: undefined,
    postalCode: undefined,
    gender: undefined,
    maritalStatus: undefined,
    emergencyContact: undefined,
    emergencyContactName: undefined,
    emergencyContactPhone: undefined,
    emergencyContactRelationship: undefined,
    notes: undefined,
    nationality: undefined,
    civilId: undefined,
    insuranceProvider: undefined,
    insurancePhone: undefined,
    referrerName: undefined,
    referralDate: undefined,
    referralSource: undefined,
    referralType: undefined,
    referringPerson: undefined,
    referralNotes: undefined,
  };
}

// Helper to redact client data from session objects for accountant role
export function redactSessionClient(session: any): any {
  if (!session) return session;
  return {
    ...session,
    client: redactClientData(session.client),
  };
}

// Helper to redact client data from billing report objects for accountant role
export function redactBillingClient(record: any): any {
  if (!record) return record;
  return {
    ...record,
    clientName: record.client ? formatClientInitial(record.client) : record.clientName,
    client: redactClientData(record.client),
  };
}
