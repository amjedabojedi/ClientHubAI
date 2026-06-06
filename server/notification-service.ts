import { db } from "./db";
import { storage } from "./storage";
import { eq, and, or, sql, desc, asc, inArray } from "drizzle-orm";
import {
  notifications,
  notificationTriggers,
  notificationPreferences,
  notificationTemplates,
  scheduledNotifications,
  users,
  clients,
  supervisorAssignments,
  sessions,
} from "@shared/schema";
import SparkPost from "sparkpost";
import { format, toZonedTime, fromZonedTime } from "date-fns-tz";
import { clientInitials } from "@shared/privacy";
import { checkSmsConsent } from "./routes-helpers";
import { isSmsConfigured, normalizePhoneE164, sendSms } from "./sms-service";
import { AuditLogger } from "./audit-logger";
import type {
  InsertNotification,
  NotificationTrigger,
  NotificationPreference,
  NotificationTemplate,
  InsertScheduledNotification,
  User,
} from "@shared/schema";

// Practice timezone for all therapist-facing scheduling (8 AM digest, day boundaries).
const PRACTICE_TZ = "America/New_York";
// Daily-email idempotency: how many times we'll retry a failed therapist send
// within the same Eastern day before giving up (avoids retry storms).
const DAILY_SCHEDULE_EMAIL_MAX_ATTEMPTS = 3;
// Deferred catch-up summary: how many times we'll retry a failed summary send
// for a user before marking their queued rows 'failed' (avoids a retry storm).
const DEFERRED_SUMMARY_EMAIL_MAX_ATTEMPTS = 3;
// notificationPreferences.triggerType key for the daily schedule digest.
const DAILY_SCHEDULE_EMAIL_TRIGGER = "daily_schedule_email";
// notificationPreferences.triggerType key for the user's account-wide delivery
// settings (quiet hours window + weekend muting). These are not tied to a single
// event; one reserved row per user carries them.
const GLOBAL_NOTIFICATION_PREFERENCES_TRIGGER = "__global__";

// Parses a stored 'HH:MM' or 'HH:MM:SS' string into minutes-since-midnight, or
// null if it isn't a valid time-of-day.
function parseTimeToMinutes(value: string | null | undefined): number | null {
  if (!value) return null;
  const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(value.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

// True when `nowMinutes` falls inside the quiet-hours window. Windows may wrap
// past midnight (e.g. 22:00 -> 08:00), which is the common after-hours case.
function isWithinQuietWindow(
  nowMinutes: number,
  startMinutes: number,
  endMinutes: number,
): boolean {
  if (startMinutes === endMinutes) return false; // Empty/degenerate window.
  if (startMinutes < endMinutes) {
    // Same-day window, e.g. 13:00 -> 14:00.
    return nowMinutes >= startMinutes && nowMinutes < endMinutes;
  }
  // Wrapping window, e.g. 22:00 -> 08:00.
  return nowMinutes >= startMinutes || nowMinutes < endMinutes;
}

// Helper function to get the email sender address from environment
function getEmailFromAddress(): string {
  const from = process.env.EMAIL_FROM;
  if (!from) {
    throw new Error("EMAIL_FROM not configured");
  }
  return from;
}

// Flexible trigger condition interface
interface TriggerCondition {
  field: string;
  operator:
    | "equals"
    | "not_equals"
    | "contains"
    | "greater_than"
    | "less_than"
    | "in_array";
  value: any;
  logicalOperator?: "AND" | "OR";
}

// Flexible recipient rules interface
interface RecipientRules {
  roles?: string[];
  specificUsers?: number[];
  assignedTherapist?: boolean;
  supervisorOfTherapist?: boolean;
  clientTherapist?: boolean;
  sessionClient?: boolean; // Include client for session notifications
  departmentMembers?: string[];
  customQuery?: string;
}

// Main notification service class
export class NotificationService {
  // Cache for practice settings to avoid repeated DB queries
  private practiceSettingsCache: any = null;

  // ===== CORE NOTIFICATION METHODS =====

  /**
   * Fetches practice settings from system options
   */
  private async getPracticeSettings(): Promise<any> {
    // Return cached settings if available
    if (this.practiceSettingsCache) {
      return this.practiceSettingsCache;
    }

    // Default practice settings
    let practiceSettings = {
      name: 'Resilience Counseling Research & Consultation',
      address: '111 Waterloo St Unit 406, London, ON N6B 2M4',
      phone: '+1 (548)866-0366',
      email: 'mail@resiliencec.com',
      website: 'www.resiliencec.com'
    };
    
    try {
      const practiceOptions = await storage.getSystemOptionsByCategory('practice_settings');
      
      // Update settings if found in database
      const nameOpt = practiceOptions.find(o => o.optionKey === 'practice_name');
      const addressOpt = practiceOptions.find(o => o.optionKey === 'practice_address');
      const phoneOpt = practiceOptions.find(o => o.optionKey === 'practice_phone');
      const emailOpt = practiceOptions.find(o => o.optionKey === 'practice_email');
      const websiteOpt = practiceOptions.find(o => o.optionKey === 'practice_website');
      
      if (nameOpt) practiceSettings.name = nameOpt.optionLabel;
      if (addressOpt) practiceSettings.address = addressOpt.optionLabel;
      if (phoneOpt) practiceSettings.phone = phoneOpt.optionLabel;
      if (emailOpt) practiceSettings.email = emailOpt.optionLabel;
      if (websiteOpt) practiceSettings.website = websiteOpt.optionLabel;
    } catch (error) {
      // Use defaults if practice settings not found
      console.log('[EMAIL] Using default practice settings');
    }

    // Cache the settings
    this.practiceSettingsCache = practiceSettings;
    return practiceSettings;
  }

  /**
   * Creates a new notification for a user
   */
  async createNotification(
    notificationData: InsertNotification,
  ): Promise<void> {
    try {
      await db.insert(notifications).values(notificationData);
    } catch (error) {
      throw error;
    }
  }

  /**
   * Creates multiple notifications in a batch
   */
  async createNotificationsBatch(
    notificationsData: InsertNotification[],
  ): Promise<void> {
    try {
      if (notificationsData.length > 0) {
        await db.insert(notifications).values(notificationsData);
      }
    } catch (error) {
      throw error;
    }
  }

  /**
   * Gets unread notifications for a user
   */
  async getUserNotifications(userId: number, limit: number = 50) {
    return await db
      .select()
      .from(notifications)
      .where(eq(notifications.userId, userId))
      .orderBy(desc(notifications.createdAt))
      .limit(limit);
  }

  /**
   * Gets unread notification count for a user
   */
  async getUnreadCount(userId: number): Promise<number> {
    const result = await db
      .select({ count: sql<number>`count(*)` })
      .from(notifications)
      .where(
        and(eq(notifications.userId, userId), eq(notifications.isRead, false)),
      );

    return result[0]?.count || 0;
  }

  /**
   * Marks notification as read
   */
  async markAsRead(notificationId: number, userId: number): Promise<void> {
    await db
      .update(notifications)
      .set({
        isRead: true,
        readAt: new Date(),
      })
      .where(
        and(
          eq(notifications.id, notificationId),
          eq(notifications.userId, userId),
        ),
      );
  }

  /**
   * Marks all notifications as read for a user
   */
  async markAllAsRead(userId: number): Promise<void> {
    await db
      .update(notifications)
      .set({
        isRead: true,
        readAt: new Date(),
      })
      .where(
        and(eq(notifications.userId, userId), eq(notifications.isRead, false)),
      );
  }

  // ===== TRIGGER EVALUATION SYSTEM =====

  /**
   * Processes an event and creates notifications based on triggers
   */
  async processEvent(
    eventType: string,
    entityData: any,
    options?: { scheduledOnly?: boolean },
  ): Promise<void> {
    try {
      console.log(
        `[NOTIFICATION] Processing event: ${eventType}, entityId: ${entityData.id}${options?.scheduledOnly ? " (scheduledOnly)" : ""}`,
      );

      // Get all active triggers for this event type
      const triggers = await db
        .select()
        .from(notificationTriggers)
        .where(
          and(
            eq(notificationTriggers.eventType, eventType as any),
            eq(notificationTriggers.isActive, true),
          ),
        );

      console.log(
        `[NOTIFICATION] Found ${triggers.length} active triggers for ${eventType}`,
      );

      // Process each trigger
      for (const trigger of triggers) {
        try {
          // When scheduledOnly is set (recurring series), only process scheduled
          // reminders and skip immediate confirmation triggers — the series sends
          // a single combined confirmation separately.
          if (options?.scheduledOnly && !trigger.isScheduled) {
            continue;
          }
          console.log(
            `[NOTIFICATION] Processing trigger: ${trigger.name} (scheduled: ${trigger.isScheduled})`,
          );

          // Check if trigger conditions are met
          const conditionsMet = await this.evaluateTriggerConditions(
            trigger,
            entityData,
          );
          console.log(
            `[NOTIFICATION] Trigger conditions met: ${conditionsMet}`,
          );

          if (conditionsMet) {
            // Handle scheduled vs immediate notifications
            if (trigger.isScheduled && entityData.sessionDate) {
              // For scheduled triggers (24hr reminders), calculate when to send
              const sessionDate = new Date(entityData.sessionDate);
              const now = new Date();
              const hoursUntilSession =
                (sessionDate.getTime() - now.getTime()) / (1000 * 60 * 60);

              console.log(
                `[NOTIFICATION] Scheduled trigger - hours until session: ${hoursUntilSession.toFixed(1)}`,
              );

              if (hoursUntilSession > 24) {
                // Schedule for 24 hours before session
                const executeAt = new Date(
                  sessionDate.getTime() - 24 * 60 * 60 * 1000,
                );
                console.log(
                  `[NOTIFICATION] Scheduling for: ${executeAt.toISOString()}`,
                );
                await this.scheduleNotification(trigger, entityData, executeAt);
              } else if (hoursUntilSession > 0) {
                // Less than 24 hours away - send immediately
                console.log(
                  `[NOTIFICATION] Less than 24hrs - sending immediately`,
                );
                const recipients = await this.calculateRecipients(
                  trigger,
                  entityData,
                );
                console.log(
                  `[NOTIFICATION] Calculated ${recipients.length} recipients`,
                );
                await this.createNotificationsFromTrigger(
                  trigger,
                  entityData,
                  recipients,
                );
              }
            } else {
              // Immediate notification (non-scheduled triggers)
              console.log(
                `[NOTIFICATION] Immediate notification - calculating recipients`,
              );
              const recipients = await this.calculateRecipients(
                trigger,
                entityData,
              );
              console.log(
                `[NOTIFICATION] Calculated ${recipients.length} recipients for immediate send`,
              );
              await this.createNotificationsFromTrigger(
                trigger,
                entityData,
                recipients,
              );
            }
          }
        } catch (error) {
          console.error(
            `[NOTIFICATION] Error processing trigger ${trigger.id}:`,
            error,
          );
          // Continue with other triggers even if one fails
        }
      }
    } catch (error) {
      console.error(`[NOTIFICATION] Error in processEvent:`, error);
      throw error;
    }
  }

  /**
   * Schedules a notification for future delivery
   */
  async scheduleNotification(
    trigger: NotificationTrigger,
    entityData: any,
    executeAt: Date,
  ): Promise<void> {
    try {
      const scheduledData: InsertScheduledNotification = {
        triggerId: trigger.id,
        sessionId: entityData.id || null,
        entityType: trigger.entityType,
        entityId: entityData.id,
        entityData: JSON.stringify(entityData),
        executeAt,
        status: "pending",
        retryCount: 0,
      };

      // Check for duplicate (idempotent insert)
      const existing = await db
        .select()
        .from(scheduledNotifications)
        .where(
          and(
            eq(scheduledNotifications.sessionId, entityData.id),
            eq(scheduledNotifications.triggerId, trigger.id),
            eq(scheduledNotifications.status, "pending"),
          ),
        );

      if (existing.length === 0) {
        await db.insert(scheduledNotifications).values(scheduledData);
      }
    } catch (error) {
      console.error(`Error scheduling notification:`, error);
      throw error;
    }
  }

  /**
   * Processes all pending scheduled notifications that are due
   */
  async processDueNotifications(): Promise<void> {
    try {
      const now = new Date();

      // Get all pending notifications that are due (with row locking)
      const dueNotifications = await db
        .select()
        .from(scheduledNotifications)
        .where(
          and(
            eq(scheduledNotifications.status, "pending"),
            sql`${scheduledNotifications.executeAt} <= ${now.toISOString()}`,
          ),
        )
        .limit(100); // Process in batches

      for (const scheduled of dueNotifications) {
        try {
          // Get the trigger
          const [trigger] = await db
            .select()
            .from(notificationTriggers)
            .where(eq(notificationTriggers.id, scheduled.triggerId));

          if (!trigger) {
            console.error(
              `Trigger ${scheduled.triggerId} not found for scheduled notification ${scheduled.id}`,
            );
            continue;
          }

          // Parse entity data
          const entityData = JSON.parse(scheduled.entityData);

          // Calculate recipients and send notifications
          const recipients = await this.calculateRecipients(
            trigger,
            entityData,
          );
          await this.createNotificationsFromTrigger(
            trigger,
            entityData,
            recipients,
          );

          // Mark as sent
          await db
            .update(scheduledNotifications)
            .set({
              status: "sent",
              processedAt: new Date(),
            })
            .where(eq(scheduledNotifications.id, scheduled.id));
        } catch (error) {
          // Mark as failed and increment retry count
          await db
            .update(scheduledNotifications)
            .set({
              status: "failed",
              retryCount: scheduled.retryCount + 1,
              lastError:
                error instanceof Error ? error.message : "Unknown error",
              processedAt: new Date(),
            })
            .where(eq(scheduledNotifications.id, scheduled.id));

          console.error(
            `Error processing scheduled notification ${scheduled.id}:`,
            error,
          );
        }
      }
    } catch (error) {
      console.error(`Error in processDueNotifications:`, error);
      throw error;
    }
  }

  /**
   * Evaluates if trigger conditions are met
   */
  private async evaluateTriggerConditions(
    trigger: NotificationTrigger,
    entityData: any,
  ): Promise<boolean> {
    try {
      if (!trigger.conditionRules || trigger.conditionRules === "{}") {
        return true; // No conditions or empty conditions means always trigger
      }

      const parsedConditions = JSON.parse(trigger.conditionRules);

      // Handle both object format like {"sessionType": "intake"} and array format
      let conditions: TriggerCondition[] = [];

      if (Array.isArray(parsedConditions)) {
        conditions = parsedConditions;
      } else if (
        typeof parsedConditions === "object" &&
        parsedConditions !== null
      ) {
        // Convert object format to condition array
        conditions = Object.entries(parsedConditions).map(([field, value]) => ({
          field,
          operator: "equals" as const,
          value,
        }));
      }

      for (const condition of conditions) {
        const fieldValue = this.getFieldValue(entityData, condition.field);
        const conditionMet = this.evaluateCondition(fieldValue, condition);

        if (!conditionMet) {
          return false; // All conditions must be met (AND logic for now)
        }
      }

      return true;
    } catch (error) {
      console.error(`Trigger ${trigger.id} condition evaluation error:`, error);
      return false;
    }
  }

  /**
   * Evaluates a single condition
   */
  private evaluateCondition(
    fieldValue: any,
    condition: TriggerCondition,
  ): boolean {
    switch (condition.operator) {
      case "equals":
        return fieldValue === condition.value;
      case "not_equals":
        return fieldValue !== condition.value;
      case "contains":
        return String(fieldValue).includes(condition.value);
      case "greater_than":
        return Number(fieldValue) > Number(condition.value);
      case "less_than":
        return Number(fieldValue) < Number(condition.value);
      case "in_array":
        return (
          Array.isArray(condition.value) && condition.value.includes(fieldValue)
        );
      default:
        return false;
    }
  }

  /**
   * Gets field value from entity data using dot notation
   */
  private getFieldValue(entityData: any, fieldPath: string): any {
    const value = fieldPath
      .split(".")
      .reduce((obj, key) => obj?.[key], entityData);

    // Special handling for date fields to format them in EST timezone
    if (fieldPath === "sessionDate" && value) {
      return this.formatDateEST(value);
    }

    return value;
  }

  /**
   * Calculates who should receive notifications based on recipient rules
   */
  private async calculateRecipients(
    trigger: NotificationTrigger,
    entityData: any,
  ): Promise<User[]> {
    try {
      if (!trigger.recipientRules) {
        return [];
      }

      const recipientRules: RecipientRules = JSON.parse(trigger.recipientRules);
      const recipients: User[] = [];

      // Get users by roles
      if (recipientRules.roles && recipientRules.roles.length > 0) {
        const roleUsers = await db
          .select()
          .from(users)
          .where(
            and(
              inArray(users.role, recipientRules.roles),
              eq(users.isActive, true),
            ),
          );
        recipients.push(...roleUsers);
      }

      // Get specific users
      if (
        recipientRules.specificUsers &&
        recipientRules.specificUsers.length > 0
      ) {
        const specificUsers = await db
          .select()
          .from(users)
          .where(
            and(
              inArray(users.id, recipientRules.specificUsers),
              eq(users.isActive, true),
            ),
          );
        recipients.push(...specificUsers);
      }

      // Get assigned therapist (for client-related events)
      if (
        recipientRules.assignedTherapist &&
        (entityData.therapistId || entityData.assignedToId)
      ) {
        const therapistId = entityData.therapistId || entityData.assignedToId;
        const therapist = await db
          .select()
          .from(users)
          .where(and(eq(users.id, therapistId), eq(users.isActive, true)));
        if (therapist[0]) recipients.push(therapist[0]);
      }

      // Get supervisor of assigned therapist (for document review notifications)
      if (
        recipientRules.supervisorOfTherapist &&
        entityData.assignedTherapistId
      ) {
        const supervisorAssignment = await db
          .select()
          .from(supervisorAssignments)
          .innerJoin(users, eq(supervisorAssignments.supervisorId, users.id))
          .where(
            and(
              eq(
                supervisorAssignments.therapistId,
                entityData.assignedTherapistId,
              ),
              eq(supervisorAssignments.isActive, true),
              eq(users.isActive, true),
            ),
          );
        if (supervisorAssignment[0]) {
          recipients.push(supervisorAssignment[0].users);
        }
      }

      // Get client for session notifications (if emailNotifications enabled)
      if (recipientRules.sessionClient && entityData.clientId) {
        const client = await db
          .select()
          .from(clients)
          .where(eq(clients.id, entityData.clientId));

        if (client[0] && client[0].emailNotifications && client[0].email) {
          // Convert client to User-like object for notification system
          const clientAsUser: User = {
            id: client[0].id,
            username: client[0].fullName || "Client",
            password: "", // Not needed for notifications
            fullName: client[0].fullName || "Client",
            email: client[0].email,
            role: "client",
            isActive: true,
            createdAt: client[0].createdAt || new Date(),
            updatedAt: client[0].updatedAt || new Date(),
            customRoleId: null,
            status: "active",
            lastLogin: null,
            passwordResetToken: null,
            passwordResetExpiry: null,
            emailVerified: false,
            emailVerificationToken: null,
            phone: client[0].phone || null,
            title: null,
            department: null,
            bio: null,
            profilePicture: null,
            signatureImage: null,
            zoomAccountId: null,
            zoomClientId: null,
            zoomClientSecret: null,
            zoomAccessToken: null,
            zoomTokenExpiry: null,
            createdBy: null,
            calendarFeedToken: null,
            calendarFeedEnabledAt: null,
          };
          recipients.push(clientAsUser);
        }
      }

      // Remove duplicates
      const uniqueRecipients = recipients.filter(
        (user, index, self) =>
          index === self.findIndex((u) => u.id === user.id),
      );

      return uniqueRecipients;
    } catch (error) {
      return [];
    }
  }

  /**
   * Creates notifications from trigger and template
   */
  private async createNotificationsFromTrigger(
    trigger: NotificationTrigger,
    entityData: any,
    recipients: User[],
  ): Promise<void> {
    try {
      // Get template if specified
      let template: NotificationTemplate | null = null;
      if (trigger.templateId) {
        const templateResult = await db
          .select()
          .from(notificationTemplates)
          .where(eq(notificationTemplates.id, trigger.templateId));
        template = templateResult[0] || null;
      }

      // Separate recipients into actual users (in users table) and clients (fake user objects)
      // Clients are marked with role='client' when converted from client records
      const actualUsers = recipients.filter((r) => r.role !== "client");
      const clientRecipients = recipients.filter((r) => r.role === "client");
      const allRecipients = recipients; // Keep all for email sending

      // Create in-app notifications for actual users (not clients)
      // Clients don't have user accounts, so they can't see in-app notifications
      // Respect each user's in-app preference for this trigger type. Default is
      // enabled when the user has no preference row (matches email behavior).
      let inAppUsers = actualUsers;
      if (actualUsers.length > 0) {
        const inAppPrefs = await db
          .select()
          .from(notificationPreferences)
          .where(
            and(
              inArray(
                notificationPreferences.userId,
                actualUsers.map((u) => u.id),
              ),
              eq(notificationPreferences.triggerType, trigger.eventType),
            ),
          );
        const inAppDisabledUserIds = new Set(
          inAppPrefs
            .filter((pref) => pref.enableInApp === false)
            .map((pref) => pref.userId),
        );
        inAppUsers = actualUsers.filter(
          (u) => !inAppDisabledUserIds.has(u.id),
        );
      }

      if (inAppUsers.length > 0) {
        const notificationsData: InsertNotification[] = inAppUsers.map(
          (recipient) => {
            // Use template if available, otherwise generate smart defaults
            let title: string;
            let message: string;

            if (template) {
              title = this.renderTemplate(template.subject, entityData);
              message = this.renderTemplate(template.bodyTemplate, entityData);
            } else {
              // Generate smart notification based on event type
              const smartNotification = this.generateSmartBellNotification(
                trigger.eventType,
                entityData,
              );
              title = smartNotification.title;
              message = smartNotification.message;
            }

            const actionUrl = template?.actionUrlTemplate
              ? this.renderTemplate(template.actionUrlTemplate, entityData)
              : null;

            return {
              userId: recipient.id,
              type: trigger.eventType,
              title,
              message,
              data: JSON.stringify(entityData),
              priority: trigger.priority,
              actionUrl,
              actionLabel: template?.actionLabel || null,
              groupingKey: `${trigger.eventType}_${entityData.id}`,
              relatedEntityType: trigger.entityType,
              relatedEntityId: entityData.id,
            };
          },
        );

        // Batch create notifications for actual users only
        await this.createNotificationsBatch(notificationsData);
      }

      // Track client emails for Communications tab using system user
      // Clients don't have user accounts, so we use system user (id=6) for tracking
      if (clientRecipients.length > 0) {
        const SYSTEM_USER_ID = 6; // System admin user for client email tracking
        const clientEmailTrackingData: InsertNotification[] =
          clientRecipients.map((client) => {
            const title = template
              ? this.renderTemplate(template.subject, entityData)
              : trigger.name;
            const message = template
              ? this.renderTemplate(template.bodyTemplate, entityData)
              : `${trigger.name} triggered`;

            return {
              userId: SYSTEM_USER_ID, // Use system user, not client ID
              type: trigger.eventType,
              title: `${title} (sent to ${client.fullName})`,
              message: `Email sent to ${client.email}: ${message}`,
              data: JSON.stringify({
                ...entityData,
                isClientEmail: true,
                clientEmail: client.email,
                clientId: client.id,
              }),
              priority: trigger.priority,
              actionUrl: null,
              actionLabel: null,
              groupingKey: `${trigger.eventType}_client_${client.id}_${entityData.id}`,
              relatedEntityType: "client",
              relatedEntityId: client.id, // Link to client, not session
            };
          });

        // Save client email tracking records under system user
        await this.createNotificationsBatch(clientEmailTrackingData);
      }

      // Send emails to ALL recipients (users and clients)
      // Emails work for everyone with an email address
      await this.sendEmailNotifications(
        allRecipients,
        trigger,
        template,
        entityData,
      );

      // Send SMS as an additional, opt-in channel. This is deliberately
      // independent of the email recipient list above: a client only becomes an
      // email recipient when emailNotifications is on, but SMS must reach a
      // consenting client even if they declined email. sendSmsNotifications
      // re-derives the session client from entityData and enforces consent.
      await this.sendSmsNotifications(allRecipients, trigger, entityData);
    } catch (error) {
      console.error(`Error creating notifications from trigger:`, error);
      throw error;
    }
  }

  /**
   * Sends SMS notifications via Twilio. Two distinct, independently-gated paths:
   *
   *   1. Session client (consent-gated). When the trigger targets the session
   *      client (recipientRules.sessionClient) we re-derive the client from
   *      entityData.clientId — NOT from the email recipient list — so a client
   *      who opted out of email but approved SMS is still reached. A text is
   *      only sent when checkSmsConsent() passes (FAIL-CLOSED) AND the client's
   *      phone normalizes to E.164. Every attempt (sent / blocked / failed) is
   *      audit-logged for HIPAA traceability. Message bodies never contain PHI.
   *
   *   2. Staff users (preference-gated). Real users in `recipients` receive SMS
   *      only when they have enableSms=true for this trigger type (default OFF)
   *      and a valid phone. This is what finally makes the enableSms preference
   *      effective.
   */
  private async sendSmsNotifications(
    recipients: User[],
    trigger: NotificationTrigger,
    entityData: any,
  ): Promise<void> {
    if (!isSmsConfigured()) {
      console.log("[SMS] Twilio not configured - SMS notifications disabled");
      return;
    }

    const body = this.generateSmsBody(trigger, entityData);
    if (!body) {
      // No SMS template for this event type — SMS only covers appointment
      // booking/reschedule confirmations and reminders.
      return;
    }

    // --- Path 1: session client, consent-gated --------------------------------
    try {
      let targetsClient = false;
      if (trigger.recipientRules) {
        try {
          const rules = JSON.parse(trigger.recipientRules);
          targetsClient = !!rules.sessionClient;
        } catch {
          targetsClient = false;
        }
      }

      if (targetsClient && entityData?.clientId) {
        const clientId = Number(entityData.clientId);
        const client = await storage.getClient(clientId);
        const phone = normalizePhoneE164(client?.phone);

        const consent = await checkSmsConsent(clientId);
        if (!consent.hasConsent) {
          // Blocked by missing/withdrawn consent (or a verification error).
          await this.auditSms(
            clientId,
            "sms_notification_blocked",
            "blocked",
            trigger.eventType,
            { reason: consent.message || "no SMS consent", hasPhone: !!phone },
          );
        } else if (!phone) {
          // Consent present but we have no usable number — skip and record.
          await this.auditSms(
            clientId,
            "sms_notification_blocked",
            "blocked",
            trigger.eventType,
            { reason: "missing or invalid phone number" },
          );
        } else {
          const result = await sendSms(phone, body);
          if (result.success) {
            await this.auditSms(
              clientId,
              "sms_notification_sent",
              "success",
              trigger.eventType,
              { messageSid: result.sid },
            );
            console.log(
              `[SMS] ✓ Sent ${trigger.eventType} text to client ${clientId}`,
            );
          } else {
            await this.auditSms(
              clientId,
              "sms_notification_failed",
              "failure",
              trigger.eventType,
              { error: result.error },
            );
            console.error(
              `[SMS] ✗ Failed to text client ${clientId}: ${result.error}`,
            );
          }
        }
      }
    } catch (error) {
      console.error("[SMS] Error in client SMS path:", error);
      // Fail-closed AND fully audited: an unexpected error must never both skip
      // the text silently and leave no record. Record a blocked attempt so the
      // "every attempt is audit-logged" guarantee holds even on the error path.
      const clientId = Number(entityData?.clientId);
      if (Number.isFinite(clientId)) {
        await this.auditSms(
          clientId,
          "sms_notification_blocked",
          "blocked",
          trigger.eventType,
          {
            reason: "unexpected error while processing SMS (fail-closed)",
            error: error instanceof Error ? error.message : String(error),
          },
        );
      }
    }

    // --- Path 2: staff users, preference-gated --------------------------------
    try {
      const staff = recipients.filter((r) => r.role !== "client" && r.phone);
      if (staff.length > 0) {
        const prefs = await db
          .select()
          .from(notificationPreferences)
          .where(
            and(
              inArray(
                notificationPreferences.userId,
                staff.map((u) => u.id),
              ),
              eq(notificationPreferences.triggerType, trigger.eventType),
            ),
          );
        // enableSms is OFF by default: a staff user only gets SMS when they have
        // an explicit preference row with enableSms=true for this trigger.
        const smsEnabledUserIds = new Set(
          prefs.filter((p) => p.enableSms === true).map((p) => p.userId),
        );

        for (const user of staff) {
          if (!smsEnabledUserIds.has(user.id)) continue;
          const phone = normalizePhoneE164(user.phone);
          if (!phone) continue;
          const result = await sendSms(phone, body);
          if (!result.success) {
            console.error(
              `[SMS] ✗ Failed to text staff user ${user.id}: ${result.error}`,
            );
          }
        }
      }
    } catch (error) {
      console.error("[SMS] Error in staff SMS path:", error);
    }
  }

  /**
   * Audit a single SMS attempt. Never throws — an audit failure must not abort
   * the surrounding notification flow (AuditLogger has its own durable fallback).
   */
  private async auditSms(
    clientId: number,
    action:
      | "sms_notification_sent"
      | "sms_notification_failed"
      | "sms_notification_blocked",
    result: "success" | "failure" | "blocked",
    eventType: string,
    details: Record<string, unknown>,
  ): Promise<void> {
    try {
      await AuditLogger.logAction({
        userId: null,
        username: "system",
        action,
        result,
        resourceType: "sms_notification",
        resourceId: String(clientId),
        clientId,
        ipAddress: "system",
        userAgent: "notification-service",
        hipaaRelevant: true,
        riskLevel: "medium",
        details: JSON.stringify({ eventType, ...details }),
        accessReason: "Appointment SMS notification (consent-gated)",
      });
    } catch (error) {
      console.error("[SMS] Failed to audit SMS attempt:", error);
    }
  }

  /**
   * Build the SMS body for a trigger. Returns null for event types that SMS
   * does not cover. Bodies are intentionally PHI-free: no client name, no
   * clinical detail — only the practice name, date/time and a STOP notice.
   */
  private generateSmsBody(
    trigger: NotificationTrigger,
    entityData: any,
  ): string | null {
    const when = this.formatSmsDateTime(entityData?.sessionDate);
    const practice = "SmartHub";
    const stop = "Reply STOP to opt out.";

    // A scheduled trigger is the advance reminder regardless of its eventType:
    // the 24hr reminders are modeled as scheduled `session_scheduled` triggers,
    // so branch on isScheduled first to use reminder wording (not "confirmed").
    if (trigger.isScheduled) {
      return `${practice} reminder: You have an appointment on ${when}. ${stop}`;
    }

    switch (trigger.eventType) {
      case "session_scheduled":
        return `${practice}: Your appointment is confirmed for ${when}. ${stop}`;
      case "session_rescheduled":
        return `${practice}: Your appointment has been rescheduled to ${when}. ${stop}`;
      case "session_reminder":
      case "appointment_reminder":
        return `${practice} reminder: You have an appointment on ${when}. ${stop}`;
      default:
        return null;
    }
  }

  /** Format a session timestamp in the practice timezone for SMS. */
  private formatSmsDateTime(value: any): string {
    if (!value) return "your scheduled time";
    try {
      const date = value instanceof Date ? value : new Date(value);
      if (isNaN(date.getTime())) return "your scheduled time";
      return format(toZonedTime(date, PRACTICE_TZ), "EEE, MMM d 'at' h:mm a", {
        timeZone: PRACTICE_TZ,
      });
    } catch {
      return "your scheduled time";
    }
  }

  /**
   * Sends email notifications using SparkPost
   */
  private async sendEmailNotifications(
    recipients: User[],
    trigger: NotificationTrigger,
    template: NotificationTemplate | null,
    entityData: any,
  ): Promise<void> {
    // Check if SparkPost is configured
    if (!process.env.SPARKPOST_API_KEY) {
      console.log("[EMAIL] SparkPost API key not configured - emails disabled");
      return;
    }

    try {
      const sp = new SparkPost(process.env.SPARKPOST_API_KEY);
      const fromEmail = getEmailFromAddress();

      console.log(
        `[EMAIL] Processing ${recipients.length} recipients for ${trigger.eventType}`,
      );

      for (const recipient of recipients) {
        try {
          // Check if user has email notifications enabled for this trigger type
          const preferences = await db
            .select()
            .from(notificationPreferences)
            .where(
              and(
                eq(notificationPreferences.userId, recipient.id),
                eq(notificationPreferences.triggerType, trigger.eventType),
              ),
            );

          const hasEmailEnabled =
            preferences.length === 0 || // Default to enabled if no preference set
            preferences.some((pref) => {
              if (pref.enableEmail) return true;
              if (!pref.deliveryMethods) return false;
              const methods =
                typeof pref.deliveryMethods === "string"
                  ? [pref.deliveryMethods]
                  : (pref.deliveryMethods as string[]);
              return methods.includes("email");
            });

          if (!hasEmailEnabled) {
            console.log(
              `[EMAIL] Skipping ${recipient.email} - email notifications disabled`,
            );
            continue;
          }

          if (!recipient.email) {
            console.log(
              `[EMAIL] Skipping recipient ${recipient.id} - no email address`,
            );
            continue;
          }

          // Prepare purpose-specific email content based on trigger type
          const subject = template
            ? this.renderTemplate(template.subject, entityData)
            : trigger.name;
          let body = template
            ? this.renderTemplate(template.bodyTemplate, entityData)
            : await this.generatePurposeSpecificEmailBody(
                trigger.eventType,
                entityData,
                recipient,
              );

          // Note: Zoom details are now integrated into generatePurposeSpecificEmailBody
          // No need to append separately as it was causing duplicate content

          // Respect the recipient's account-wide quiet hours / weekend muting.
          // Only gate real staff accounts — clients have no global preference row
          // and should always receive their transactional emails. The in-app
          // record (created above) preserves the event so nothing is lost.
          if (recipient.role !== "client") {
            const suppression = await this.isDeliverySuppressedByQuietHours(
              recipient.id,
            );
            if (suppression.suppressed) {
              if (suppression.deferToSummary) {
                // Defer instead of drop: queue the already-rendered email so a
                // catch-up summary can deliver it once the user is no longer
                // muted (see processDeferredSummaryEmails).
                await storage.enqueueDeferredNotificationEmail({
                  userId: recipient.id,
                  triggerType: trigger.eventType,
                  subject,
                  body,
                  reason: suppression.reason ?? "quiet hours",
                  status: "pending",
                  attempts: 0,
                });
                console.log(
                  `[EMAIL] Deferring ${recipient.email} to summary - suppressed by ${suppression.reason}`,
                );
              } else {
                console.log(
                  `[EMAIL] Skipping ${recipient.email} - suppressed by ${suppression.reason}`,
                );
              }
              continue;
            }
          }

          console.log(
            `[EMAIL] Sending ${trigger.eventType} email to ${recipient.email}...`,
          );

          // Send email
          const result = await sp.transmissions.send({
            content: {
              from: fromEmail,
              subject: subject,
              html: this.formatEmailAsHtml(body, entityData),
              text: body,
            },
            recipients: [{ address: recipient.email }],
          });

          console.log(
            `[EMAIL] ✓ Successfully sent to ${recipient.email} (ID: ${result.results.id})`,
          );
        } catch (emailError) {
          console.error(
            `[EMAIL] ✗ Failed to send email to ${recipient.email}:`,
            emailError,
          );
          // Continue with other recipients even if one fails
        }
      }
    } catch (error) {
      console.error("[EMAIL] Error in sendEmailNotifications:", error);
    }
  }

  /**
   * Generates Zoom meeting content for email notifications
   */
  private generateZoomEmailContent(
    zoomMeetingData: any,
    sessionData: any,
  ): string {
    if (!zoomMeetingData) return "";

    return `

📹 VIRTUAL MEETING DETAILS:
━━━━━━━━━━━━━━━━━━━━━━━━━━

Your therapy session will be conducted via Zoom video conference.

Meeting Details:
• Join URL: ${zoomMeetingData.joinUrl}
• Meeting ID: ${zoomMeetingData.meetingId}
• Password: ${zoomMeetingData.password}

📋 Important Instructions:
• Please join the meeting 5 minutes before your scheduled time
• Ensure you have a stable internet connection
• Test your camera and microphone beforehand
• Find a quiet, private space for your session

Need help with Zoom? Visit: https://support.zoom.us/hc/en-us/articles/201362613

━━━━━━━━━━━━━━━━━━━━━━━━━━`;
  }

  /**
   * Generates purpose-specific email body based on trigger type and recipient
   */
  private async generatePurposeSpecificEmailBody(
    eventType: string,
    entityData: any,
    recipient: any,
  ): Promise<string> {
    const isClient =
      recipient.role === "client" || recipient.id === entityData.clientId;

    switch (eventType) {
      case "session_scheduled":
        return await this.generateSessionEmailBody(entityData, recipient, isClient);

      case "session_rescheduled":
        return await this.generateSessionRescheduledEmailBody(
          entityData,
          recipient,
          isClient,
        );

      case "client_created":
        return this.generateClientCreatedEmailBody(
          entityData,
          recipient,
          isClient,
        );

      case "client_assigned":
        return this.generateClientAssignedEmailBody(
          entityData,
          recipient,
          isClient,
        );

      case "task_assigned":
        return this.generateTaskAssignedEmailBody(
          entityData,
          recipient,
          isClient,
        );

      case "task_overdue":
        return this.generateTaskOverdueEmailBody(
          entityData,
          recipient,
          isClient,
        );

      case "document_needs_review":
        return this.generateDocumentReviewEmailBody(
          entityData,
          recipient,
          isClient,
        );

      case "document_reviewed":
        return this.generateDocumentReviewedEmailBody(
          entityData,
          recipient,
          isClient,
        );

      case "document_uploaded":
        return this.generateDocumentUploadedEmailBody(
          entityData,
          recipient,
          isClient,
        );

      case "session_overdue":
        return this.generateSessionOverdueEmailBody(
          entityData,
          recipient,
          isClient,
        );

      default:
        return this.generateGenericEmailBody(
          eventType,
          entityData,
          recipient,
          isClient,
        );
    }
  }

  /**
   * Generates session-specific email content
   */
  private async generateSessionEmailBody(
    entityData: any,
    recipient: any,
    isClient: boolean,
  ): Promise<string> {
    const sessionDate = this.formatDateEST(entityData.sessionDate);

    // Check if Zoom is enabled and has meeting details
    const hasZoomDetails = entityData.zoomEnabled && entityData.zoomJoinUrl;
    
    // Get practice settings
    const practice = await this.getPracticeSettings();

    if (isClient) {
      let emailBody = `
Dear ${recipient.fullName},

Your therapy session has been confirmed!

📅 APPOINTMENT DETAILS:
━━━━━━━━━━━━━━━━━━━━━━━━━━
Session Type: ${entityData.sessionType}
Date & Time: ${sessionDate}
Therapist: ${entityData.therapistName}
Duration: ${entityData.duration || 60} minutes`;

      // Add Zoom details if available
      if (hasZoomDetails) {
        emailBody += `

📹 VIRTUAL MEETING DETAILS:
━━━━━━━━━━━━━━━━━━━━━━━━━━

Your therapy session will be conducted via Zoom video conference.

Meeting Details:
• Join URL: ${entityData.zoomJoinUrl}
• Meeting ID: ${entityData.zoomMeetingId}
${entityData.zoomPassword ? `• Password: ${entityData.zoomPassword}` : ""}

📋 Important Instructions:
• Please join the meeting 5 minutes before your scheduled time
• Ensure you have a stable internet connection
• Test your camera and microphone beforehand
• Find a quiet, private space for your session

Need help with Zoom? Visit: https://support.zoom.us/hc/en-us/articles/201362613

━━━━━━━━━━━━━━━━━━━━━━━━━━`;
      } else {
        // Add clinic address for in-person sessions only
        emailBody += `

🏢 CLINIC ADDRESS:
━━━━━━━━━━━━━━━━━━━━━━━━━━
${practice.name}
${practice.address}
Phone: ${practice.phone}`;
      }

      emailBody += `

📋 IMPORTANT REMINDERS:`;

      // Only show "arrive early" for in-person sessions
      if (!hasZoomDetails) {
        emailBody += `
• Please arrive 5-10 minutes early`;
      }

      emailBody += `
• If you need to cancel or reschedule, please give at least 24 hours notice

We look forward to seeing you at your appointment.

Best regards,
SmartHub Team`;

      return emailBody;
    } else {
      // Therapist/Admin email - professional and informative
      let emailBody = `
Dear ${recipient.fullName},

A new therapy session has been scheduled.

📅 APPOINTMENT DETAILS:
━━━━━━━━━━━━━━━━━━━━━━━━━━
Client: ${entityData.clientName}
Session Type: ${entityData.sessionType}
Date & Time: ${sessionDate}
Duration: ${entityData.duration || 60} minutes`;

      // Add location for in-person sessions
      if (entityData.roomName) {
        emailBody += `\nLocation: ${entityData.roomName}`;
      }

      // Check if Zoom is enabled and has meeting details
      const hasZoomDetails = entityData.zoomEnabled && entityData.zoomJoinUrl;

      // Add Zoom details if available
      if (hasZoomDetails) {
        emailBody += `

📹 VIRTUAL MEETING DETAILS:
━━━━━━━━━━━━━━━━━━━━━━━━━━

This session will be conducted via Zoom video conference.

Meeting Details:
• Join URL: ${entityData.zoomJoinUrl}
• Meeting ID: ${entityData.zoomMeetingId}
${entityData.zoomPassword ? `• Password: ${entityData.zoomPassword}` : ""}

The client will receive these Zoom details in their confirmation email.

━━━━━━━━━━━━━━━━━━━━━━━━━━`;
      }

      emailBody += `

📋 STATUS:
The client has been notified via email and the session is now visible on your calendar.

Best regards,
SmartHub Team`;

      return emailBody;
    }
  }

  /**
   * Generates session rescheduled email content
   */
  private async generateSessionRescheduledEmailBody(
    entityData: any,
    recipient: any,
    isClient: boolean,
  ): Promise<string> {
    const oldSessionDate = this.formatDateEST(entityData.oldSessionDate);
    const newSessionDate = this.formatDateEST(entityData.sessionDate);

    // Check if Zoom is enabled and has meeting details
    const hasZoomDetails = entityData.zoomEnabled && entityData.zoomJoinUrl;
    
    // Get practice settings
    const practice = await this.getPracticeSettings();

    if (isClient) {
      let emailBody = `
Dear ${recipient.fullName},

Your therapy session has been rescheduled.

📅 RESCHEDULING DETAILS:
━━━━━━━━━━━━━━━━━━━━━━━━━━
Previous Date & Time: ${oldSessionDate}
New Date & Time: ${newSessionDate}

Session Type: ${entityData.sessionType}
Therapist: ${entityData.therapistName}
Duration: ${entityData.duration || 60} minutes`;

      // Add Zoom details if available
      if (hasZoomDetails) {
        emailBody += `

📹 VIRTUAL MEETING DETAILS:
━━━━━━━━━━━━━━━━━━━━━━━━━━

Your therapy session will be conducted via Zoom video conference.

Meeting Details:
• Join URL: ${entityData.zoomJoinUrl}
• Meeting ID: ${entityData.zoomMeetingId}
${entityData.zoomPassword ? `• Password: ${entityData.zoomPassword}` : ""}

📋 Important Instructions:
• Please join the meeting 5 minutes before your scheduled time
• Ensure you have a stable internet connection
• Test your camera and microphone beforehand
• Find a quiet, private space for your session

Need help with Zoom? Visit: https://support.zoom.us/hc/en-us/articles/201362613

━━━━━━━━━━━━━━━━━━━━━━━━━━`;
      } else {
        // Add clinic address for in-person sessions only
        emailBody += `

🏢 CLINIC ADDRESS:
━━━━━━━━━━━━━━━━━━━━━━━━━━
${practice.name}
${practice.address}
Phone: ${practice.phone}`;
      }

      emailBody += `

📋 IMPORTANT REMINDERS:`;

      // Only show "arrive early" for in-person sessions
      if (!hasZoomDetails) {
        emailBody += `
• Please arrive 5-10 minutes early`;
      }

      emailBody += `
• If you need to cancel or reschedule again, please give at least 24 hours notice

We look forward to seeing you at your rescheduled appointment.

Best regards,
SmartHub Team`;

      return emailBody;
    } else {
      // Therapist/Admin email - professional and informative
      let emailBody = `
Dear ${recipient.fullName},

A therapy session has been rescheduled.

📅 RESCHEDULING DETAILS:
━━━━━━━━━━━━━━━━━━━━━━━━━━
Client: ${entityData.clientName}
Session Type: ${entityData.sessionType}

Previous Date & Time: ${oldSessionDate}
New Date & Time: ${newSessionDate}

Duration: ${entityData.duration || 60} minutes`;

      // Add location for in-person sessions
      if (entityData.roomName) {
        emailBody += `\nLocation: ${entityData.roomName}`;
      }

      // Check if Zoom is enabled and has meeting details
      const hasZoomDetails = entityData.zoomEnabled && entityData.zoomJoinUrl;

      // Add Zoom details if available
      if (hasZoomDetails) {
        emailBody += `

📹 VIRTUAL MEETING DETAILS:
━━━━━━━━━━━━━━━━━━━━━━━━━━

This session will be conducted via Zoom video conference.

Meeting Details:
• Join URL: ${entityData.zoomJoinUrl}
• Meeting ID: ${entityData.zoomMeetingId}
${entityData.zoomPassword ? `• Password: ${entityData.zoomPassword}` : ""}

The client will receive these updated Zoom details in their rescheduled notification email.

━━━━━━━━━━━━━━━━━━━━━━━━━━`;
      }

      emailBody += `

📋 STATUS:
The client has been notified of the schedule change and the session is updated on your calendar.

Best regards,
SmartHub Team`;

      return emailBody;
    }
  }

  /**
   * Generates client creation email content
   */
  private generateClientCreatedEmailBody(
    entityData: any,
    recipient: any,
    isClient: boolean,
  ): string {
    // Privacy: do NOT include the client's name or PII in the email body.
    // Reviewers identify the file in SmartHub via the reference number.
    const refNumber = entityData.referenceNumber || `#${entityData.id}`;
    return `
New Client Added to System

👤 CLIENT DETAILS:
━━━━━━━━━━━━━━━━━━━━━━━━━━
Reference Number: ${refNumber}
Added: ${this.formatDateEST(entityData.createdAt)}

📋 ACTION REQUIRED:
A new client has been added to the system. Please log in to SmartHub and review the file using the reference number above.

• Verify contact information
• Review insurance details
• Assign to appropriate therapist
• Schedule initial assessment

This notification was sent because you are responsible for client intake processing.`;
  }

  /**
   * Generates client assignment email content
   */
  private generateClientAssignedEmailBody(
    entityData: any,
    recipient: any,
    isClient: boolean,
  ): string {
    if (isClient) {
      return `
Dear ${recipient.fullName},

Welcome to SmartHub!

👋 THERAPIST ASSIGNMENT:
━━━━━━━━━━━━━━━━━━━━━━━━━━
You have been assigned to ${entityData.therapistName} for your therapy services.

Your therapist will contact you soon to schedule your first appointment.

📞 NEXT STEPS:
• Wait for your therapist to contact you
• Prepare any questions you'd like to discuss
• Complete any intake paperwork provided

Best regards,
SmartHub Team`;
    } else {
      // Privacy: do NOT include the client's name in the email. Therapists
      // identify the file via the reference number.
      const refNumber = entityData.referenceNumber || `#${entityData.clientId || entityData.id}`;
      return `
Client Assignment Notification

👤 ASSIGNMENT DETAILS:
━━━━━━━━━━━━━━━━━━━━━━━━━━
Reference Number: ${refNumber}
Assigned to: ${entityData.therapistName}
Assignment Date: ${this.formatDateEST(entityData.assignmentDate)}

📋 ACTION REQUIRED:
You have been assigned a new client. Please log in to SmartHub to review the file using the reference number above.

• Open the client profile in SmartHub
• Contact the client to schedule the first session
• Prepare treatment planning documentation

This notification was sent because you are the assigned therapist.`;
    }
  }

  /**
   * Generates task assignment email content
   */
  private generateTaskAssignedEmailBody(
    entityData: any,
    recipient: any,
    isClient: boolean,
  ): string {
    const dueDate = entityData.dueDate
      ? this.formatDateEST(entityData.dueDate)
      : "No due date set";

    return `
Task Assignment Notification

📋 TASK DETAILS:
━━━━━━━━━━━━━━━━━━━━━━━━━━
Title: ${entityData.title}
Priority: ${entityData.priority || "Normal"}
Due Date: ${dueDate}
Assigned by: ${entityData.createdByName}

📝 DESCRIPTION:
${entityData.description || "No additional details provided."}

🎯 ACTION REQUIRED:
A new task has been assigned to you. Please review the details and begin work as appropriate.

This notification was sent because you are responsible for completing this task.`;
  }

  /**
   * Generates task overdue email content
   */
  private generateTaskOverdueEmailBody(
    entityData: any,
    recipient: any,
    isClient: boolean,
  ): string {
    const dueDate = this.formatDateEST(entityData.dueDate);

    return `
⚠️ OVERDUE TASK ALERT

📋 OVERDUE TASK:
━━━━━━━━━━━━━━━━━━━━━━━━━━
Title: ${entityData.title}
Due Date: ${dueDate}
Priority: ${entityData.priority || "Normal"}

🚨 IMMEDIATE ACTION REQUIRED:
This task is past its due date and requires immediate attention.

Please complete this task as soon as possible or update its status if already completed.

This notification was sent because you are responsible for this overdue task.`;
  }

  /**
   * Generates document review email content
   */
  private generateDocumentReviewEmailBody(
    entityData: any,
    recipient: any,
    isClient: boolean,
  ): string {
    return `
Document Review Required

📄 DOCUMENT DETAILS:
━━━━━━━━━━━━━━━━━━━━━━━━━━
Document: ${entityData.documentName}
Client: ${entityData.clientName}
Uploaded by: ${entityData.uploadedByName}
Upload Date: ${this.formatDateEST(entityData.uploadDate)}

📋 ACTION REQUIRED:
A document has been uploaded that requires clinical review and approval.

• Review document content for clinical accuracy
• Approve or provide feedback for revision
• Update document status in the system

This notification was sent because you are responsible for clinical document oversight.`;
  }

  /**
   * Generates document reviewed email content
   */
  private generateDocumentReviewedEmailBody(
    entityData: any,
    recipient: any,
    isClient: boolean,
  ): string {
    return `
Document Review Completed

📄 REVIEW DETAILS:
━━━━━━━━━━━━━━━━━━━━━━━━━━
Document: ${entityData.documentName}
Client: ${entityData.clientName}
Reviewed by: ${entityData.reviewedByName}
Review Date: ${this.formatDateEST(entityData.reviewDate)}
Status: ${entityData.reviewStatus}

📋 REVIEW OUTCOME:
Your document has been reviewed and ${entityData.reviewStatus === "approved" ? "approved" : "requires revision"}.

${entityData.reviewComments ? `Reviewer comments: ${entityData.reviewComments}` : ""}

This notification was sent because you submitted the document for review.`;
  }

  /**
   * Generates document uploaded email content
   */
  private generateDocumentUploadedEmailBody(
    entityData: any,
    recipient: any,
    isClient: boolean,
  ): string {
    return `
Document Uploaded Notification

📄 UPLOAD DETAILS:
━━━━━━━━━━━━━━━━━━━━━━━━━━
Document: ${entityData.documentName}
Client: ${entityData.clientName}
Uploaded by: ${entityData.uploadedByName}
Upload Date: ${this.formatDateEST(entityData.uploadDate)}

📋 INFORMATION:
A new document has been added to the client's record.

This notification was sent because you are involved in this client's care.`;
  }

  /**
   * Generates session overdue email content
   */
  private generateSessionOverdueEmailBody(
    entityData: any,
    recipient: any,
    isClient: boolean,
  ): string {
    const sessionDate = this.formatDateEST(entityData.sessionDate);

    return `
⚠️ SESSION STATUS UPDATE REQUIRED

📅 SESSION DETAILS:
━━━━━━━━━━━━━━━━━━━━━━━━━━
Client: ${entityData.clientName}
Session Date: ${sessionDate}
Session Type: ${entityData.sessionType}
Days Overdue: ${entityData.daysOverdue}

🚨 ACTION REQUIRED:
This session is overdue for status update. Please complete the session documentation or update the session status.

• Mark session as completed if conducted
• Add session notes if applicable
• Update session status if cancelled or rescheduled

This notification was sent because you are responsible for session documentation.`;
  }

  /**
   * Generates generic email content for unknown trigger types
   */
  private generateGenericEmailBody(
    eventType: string,
    entityData: any,
    recipient: any,
    isClient: boolean,
  ): string {
    return `
${eventType.replace(/_/g, " ").toUpperCase()} Notification

📋 DETAILS:
━━━━━━━━━━━━━━━━━━━━━━━━━━
An event has occurred that requires your attention.

Event Type: ${eventType}
Date: ${this.formatDateEST(new Date())}

Please log into SmartHub to review the details and take any necessary action.

This notification was sent because you are involved in this process.`;
  }

  /**
   * Generates content when Zoom was requested but failed to create
   */
  private generateZoomFailedContent(): string {
    return `

📹 VIRTUAL MEETING DETAILS:
━━━━━━━━━━━━━━━━━━━━━━━━━━

This session is scheduled as a virtual Zoom meeting.

📋 IMPORTANT:
Your therapist will send you the Zoom meeting link separately before your session. Please keep in touch with them to receive the meeting details.

If you have any questions about joining the virtual session, please contact your therapist directly.

━━━━━━━━━━━━━━━━━━━━━━━━━━`;
  }

  /**
   * Formats a date to EST/EDT timezone for user display
   */
  private formatDateEST(date: Date | string): string {
    const dateObj = typeof date === "string" ? new Date(date) : date;
    const zonedDate = toZonedTime(dateObj, "America/New_York");
    return format(zonedDate, "EEEE, MMMM d, yyyy 'at' h:mm a (zzz)", {
      timeZone: "America/New_York",
    });
  }

  /**
   * Formats email content as HTML
   */
  private formatEmailAsHtml(content: string, entityData: any): string {
    const htmlContent = content
      .replace(/\n/g, "<br>")
      .replace(/━/g, "─")
      .replace(/📹/g, "🎥")
      .replace(/📋/g, "📝");

    return `
    <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .header { background-color: #f8f9fa; padding: 20px; text-align: center; }
          .content { padding: 20px; }
          .zoom-section { background-color: #e8f4fd; padding: 15px; border-radius: 5px; margin: 15px 0; }
          .meeting-details { background-color: #f8f9fa; padding: 10px; border-radius: 3px; font-family: monospace; }
        </style>
      </head>
      <body>
        <div class="header">
          <h2>SmartHub Notification</h2>
        </div>
        <div class="content">
          ${htmlContent}
        </div>
        <div style="margin-top: 30px; padding: 15px; border-top: 1px solid #ddd; font-size: 12px; color: #666;">
          <p>This is an automated message from SmartHub. Please do not reply to this email.</p>
        </div>
      </body>
    </html>`;
  }

  /**
   * Sends ONE combined confirmation for a recurring series of sessions.
   * Lists every appointment date in a single email to the client (if they have
   * email notifications enabled) and creates a single in-app notification for the
   * therapist. Per-session reminders are scheduled separately via processEvent
   * with { scheduledOnly: true }.
   */
  async sendSeriesScheduledConfirmation(seriesData: {
    clientId: number;
    therapistId: number;
    clientName: string;
    therapistName: string;
    serviceName?: string | null;
    roomName?: string | null;
    sessionDates: (Date | string)[];
    skippedCount?: number;
  }): Promise<void> {
    try {
      const dates = [...seriesData.sessionDates].sort(
        (a, b) => new Date(a).getTime() - new Date(b).getTime(),
      );
      const count = dates.length;
      if (count === 0) return;

      const lines = dates
        .map((d, i) => `${i + 1}. ${this.formatDateEST(d)}`)
        .join("\n");

      const skippedNote =
        seriesData.skippedCount && seriesData.skippedCount > 0
          ? `\n\nNote: ${seriesData.skippedCount} requested date(s) were not booked because of a scheduling conflict.`
          : "";

      const detailLines = [
        `Therapist: ${seriesData.therapistName}`,
        seriesData.serviceName ? `Service: ${seriesData.serviceName}` : null,
        seriesData.roomName ? `Room: ${seriesData.roomName}` : null,
      ]
        .filter(Boolean)
        .join("\n");

      // ===== In-app notification for the therapist =====
      try {
        await this.createNotification({
          userId: seriesData.therapistId,
          type: "session_scheduled",
          title: "Recurring sessions scheduled",
          message: `${count} sessions scheduled with ${seriesData.clientName}`,
          data: JSON.stringify({
            clientId: seriesData.clientId,
            count,
            firstDate: dates[0],
          }),
          priority: "normal",
          actionUrl: `/scheduling`,
          actionLabel: "View Schedule",
          groupingKey: `series_${seriesData.clientId}_${new Date(dates[0]).getTime()}`,
          relatedEntityType: "session",
          relatedEntityId: seriesData.clientId,
        } as InsertNotification);
      } catch (err) {
        console.error("[SERIES] Failed to create therapist in-app notification:", err);
      }

      // ===== Email to client (respecting their email-notification preference) =====
      const client = await db
        .select()
        .from(clients)
        .where(eq(clients.id, seriesData.clientId));

      const clientRow = client[0];
      if (!clientRow || !clientRow.emailNotifications || !clientRow.email) {
        console.log(
          "[SERIES] Client has no email or notifications disabled - skipping series email",
        );
        return;
      }

      const body =
        `Dear ${clientRow.fullName || "Client"},\n\n` +
        `Your recurring appointments have been booked. Here are all ${count} session(s):\n\n` +
        `${lines}\n\n` +
        (detailLines ? `${detailLines}\n` : "") +
        skippedNote +
        `\n\nYou will receive a reminder before each appointment. If you need to cancel or reschedule, please give at least 24 hours notice.\n\n` +
        `Thank you,\nSmartHub`;

      const subject = `Your ${count} recurring appointments are confirmed`;

      // Track client email under system user for the Communications tab
      try {
        const SYSTEM_USER_ID = 6;
        await this.createNotification({
          userId: SYSTEM_USER_ID,
          type: "session_scheduled",
          title: `${subject} (sent to ${clientRow.fullName})`,
          message: `Email sent to ${clientRow.email}: ${count} recurring sessions confirmed`,
          data: JSON.stringify({
            isClientEmail: true,
            clientEmail: clientRow.email,
            clientId: clientRow.id,
            count,
          }),
          priority: "normal",
          actionUrl: null,
          actionLabel: null,
          groupingKey: `series_client_${clientRow.id}_${new Date(dates[0]).getTime()}`,
          relatedEntityType: "client",
          relatedEntityId: clientRow.id,
        } as InsertNotification);
      } catch (err) {
        console.error("[SERIES] Failed to create client email tracking record:", err);
      }

      if (!process.env.SPARKPOST_API_KEY) {
        console.log("[SERIES] SparkPost not configured - series email disabled");
        return;
      }

      const sp = new SparkPost(process.env.SPARKPOST_API_KEY);
      const fromEmail = getEmailFromAddress();
      const result = await sp.transmissions.send({
        content: {
          from: fromEmail,
          subject,
          html: this.formatEmailAsHtml(body, {}),
          text: body,
        },
        recipients: [{ address: clientRow.email }],
      });
      console.log(
        `[SERIES] ✓ Sent series confirmation to ${clientRow.email} (ID: ${result.results.id})`,
      );
    } catch (error) {
      console.error("[SERIES] Error sending series confirmation:", error);
    }
  }

  /**
   * Generates smart bell notification title and message based on event type
   */
  private generateSmartBellNotification(
    eventType: string,
    entityData: any,
  ): { title: string; message: string } {
    const sessionDate = this.formatDateEST(entityData.sessionDate);

    switch (eventType) {
      case "session_scheduled":
        return {
          title: "New Session Scheduled",
          message: `Session with ${entityData.clientName} on ${sessionDate}`,
        };

      case "session_rescheduled":
        const oldDate = this.formatDateEST(entityData.oldSessionDate);
        const newDate = this.formatDateEST(entityData.sessionDate);
        return {
          title: "Session Rescheduled",
          message: `${entityData.clientName}'s session moved from ${oldDate} to ${newDate}`,
        };

      case "session_reminder":
        return {
          title: "Upcoming Session Reminder",
          message: `Session with ${entityData.clientName} is scheduled for ${sessionDate}`,
        };

      case "session_cancelled":
        return {
          title: "Session Cancelled",
          message: `Session with ${entityData.clientName} on ${sessionDate} has been cancelled`,
        };

      case "session_overdue":
        return {
          title: "Overdue Session Documentation",
          message: `Session with ${entityData.clientName} from ${sessionDate} needs documentation`,
        };

      case "client_created":
        return {
          title: "New Client Added",
          message: `${entityData.fullName} has been added to the system`,
        };

      case "client_assigned":
        return {
          title: "Client Assigned",
          message: `${entityData.clientName} has been assigned to ${entityData.therapistName}`,
        };

      case "task_assigned":
        return {
          title: "New Task Assigned",
          message: `Task: ${entityData.title || "Untitled"}`,
        };

      case "task_due_soon":
        return {
          title: "Task Due Soon",
          message: `Task "${entityData.title}" is due soon`,
        };

      case "task_overdue":
        return {
          title: "Task Overdue",
          message: `Task "${entityData.title}" is now overdue`,
        };

      default:
        // Generic fallback for unknown event types
        return {
          title: eventType
            .replace(/_/g, " ")
            .replace(/\b\w/g, (l) => l.toUpperCase()),
          message: `Event notification: ${eventType}`,
        };
    }
  }

  /**
   * Renders template with entity data
   */
  private renderTemplate(template: string, entityData: any): string {
    try {
      return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
        return this.getFieldValue(entityData, key) || match;
      });
    } catch (error) {
      return template;
    }
  }

  // ===== USER PREFERENCES =====

  /**
   * Gets user notification preferences
   */
  async getUserPreferences(userId: number) {
    return await db
      .select()
      .from(notificationPreferences)
      .where(eq(notificationPreferences.userId, userId));
  }

  /**
   * Sets user notification preference
   */
  async setUserPreference(
    userId: number,
    triggerType: string,
    preferences: Partial<NotificationPreference>,
  ): Promise<void> {
    try {
      // Check if preference exists
      const existing = await db
        .select()
        .from(notificationPreferences)
        .where(
          and(
            eq(notificationPreferences.userId, userId),
            eq(notificationPreferences.triggerType, triggerType as any),
          ),
        );

      if (existing.length > 0) {
        // Update existing
        await db
          .update(notificationPreferences)
          .set({ ...preferences, updatedAt: new Date() })
          .where(
            and(
              eq(notificationPreferences.userId, userId),
              eq(notificationPreferences.triggerType, triggerType as any),
            ),
          );
      } else {
        // Create new
        await db.insert(notificationPreferences).values({
          userId,
          triggerType: triggerType as any,
          ...preferences,
        });
      }
    } catch (error) {
      throw error;
    }
  }

  // ===== UTILITY METHODS =====

  /**
   * Cleans up expired notifications
   */
  async cleanupExpiredNotifications(): Promise<void> {
    try {
      await db
        .delete(notifications)
        .where(
          and(
            sql`${notifications.expiresAt} IS NOT NULL`,
            sql`${notifications.expiresAt} < NOW()`,
          ),
        );
    } catch (error) {}
  }

  /**
   * Gets notification statistics
   */
  async getNotificationStats() {
    try {
      const totalResult = await db
        .select({ count: sql<number>`count(*)` })
        .from(notifications);

      const unreadResult = await db
        .select({ count: sql<number>`count(*)` })
        .from(notifications)
        .where(eq(notifications.isRead, false));

      return {
        total: totalResult[0]?.count || 0,
        unread: unreadResult[0]?.count || 0,
      };
    } catch (error) {
      return { total: 0, unread: 0 };
    }
  }

  // ============================================================
  // Daily 8 AM (Eastern) therapist schedule digest
  // ============================================================

  // Guards against overlapping runs if a tick takes longer than the poll interval.
  private dailyScheduleEmailInFlight = false;

  /**
   * Called every minute by the background poller. Only does work once the
   * Eastern clock has reached 8 AM; the per-(therapist, day) record then
   * ensures each therapist is emailed exactly once for that Eastern day, even
   * across a server restart.
   */
  async runDailyScheduleEmailsIfDue(now: Date = new Date()): Promise<void> {
    if (this.dailyScheduleEmailInFlight) return;

    const easternNow = toZonedTime(now, PRACTICE_TZ);
    // Don't send before 8 AM Eastern. If the server was down through 8 AM and
    // starts later in the day, this still fires (better late than never) and
    // the per-day record prevents a duplicate once it has gone out.
    if (easternNow.getHours() < 8) return;

    this.dailyScheduleEmailInFlight = true;
    try {
      const dateStr = format(easternNow, "yyyy-MM-dd", { timeZone: PRACTICE_TZ });
      await this.processDailyScheduleEmails(dateStr);
    } finally {
      this.dailyScheduleEmailInFlight = false;
    }
  }

  /**
   * Idempotently emails every active therapist their appointments for the given
   * Eastern calendar day (yyyy-MM-dd). Therapists already marked 'sent' for the
   * day are skipped; failed sends are retried up to a small cap. Safe to call
   * directly (e.g. from tests) for any date.
   *
   * `therapistIds` optionally restricts the send loop to a specific set of
   * therapists. Production always passes nothing (every active therapist is
   * processed); tests pass their own seeded ids so concurrent rows — the live
   * scheduler, leftover users, or a parallel twin of the same suite — can never
   * interfere with the run under assertion.
   */
  async processDailyScheduleEmails(
    easternDateStr: string,
    therapistIds?: number[],
  ): Promise<{ sent: number; skipped: number; failed: number }> {
    let sent = 0;
    let skipped = 0;
    let failed = 0;

    if (!process.env.SPARKPOST_API_KEY) {
      console.log(
        "[DAILY-SCHEDULE] SparkPost API key not configured - skipping daily schedule emails",
      );
      return { sent, skipped, failed };
    }

    const allTherapists = await storage.getTherapists();
    const therapists =
      therapistIds === undefined
        ? allTherapists
        : allTherapists.filter((t) => therapistIds.includes(t.id));
    if (therapists.length === 0) return { sent, skipped, failed };

    // Eastern-day boundaries expressed as UTC instants for the session query.
    const dayStart = fromZonedTime(`${easternDateStr}T00:00:00`, PRACTICE_TZ);
    const dayEnd = fromZonedTime(`${easternDateStr}T23:59:59.999`, PRACTICE_TZ);

    const sp = new SparkPost(process.env.SPARKPOST_API_KEY);
    let fromEmail: string;
    try {
      fromEmail = getEmailFromAddress();
    } catch (err) {
      console.error("[DAILY-SCHEDULE] EMAIL_FROM not configured:", err);
      return { sent, skipped, failed };
    }

    const dayLabel = format(toZonedTime(dayStart, PRACTICE_TZ), "EEEE, MMMM d, yyyy", {
      timeZone: PRACTICE_TZ,
    });

    for (const therapist of therapists) {
      // Atomically claim the (therapist, day) slot BEFORE sending. This is the
      // idempotency guard: winning the claim writes a 'processing' row first, so
      // a crash between the send and recording the result cannot cause a
      // duplicate on the next run (the stuck 'processing' row is never
      // re-claimed). If we don't win the claim the slot is already sent, in
      // flight, or out of retries — skip it.
      let claim;
      try {
        claim = await storage.claimDailyScheduleEmail(
          therapist.id,
          easternDateStr,
          DAILY_SCHEDULE_EMAIL_MAX_ATTEMPTS,
        );
      } catch (claimErr) {
        // The therapist may have been removed between getTherapists() and the
        // claim insert (a concurrent deletion fails the therapist_id foreign
        // key, PG code 23503). Skip just this therapist instead of aborting the
        // whole run — everyone after them must still get their digest.
        if ((claimErr as any)?.code === "23503") {
          console.warn(
            `[DAILY-SCHEDULE] Skipping therapist ${therapist.id} — removed before claim could be recorded.`,
          );
          skipped++;
          continue;
        }
        throw claimErr;
      }
      if (!claim) {
        skipped++;
        continue;
      }
      const attempts = claim.attempts;

      try {
        if (!therapist.email) {
          // No address to send to — mark failed at the retry cap so the slot is
          // not pointlessly re-claimed on later runs (a missing address won't fix
          // itself within the day).
          await storage.upsertDailyScheduleEmail({
            therapistId: therapist.id,
            sendDate: easternDateStr,
            status: "failed",
            appointmentCount: 0,
            attempts: DAILY_SCHEDULE_EMAIL_MAX_ATTEMPTS,
            error: "Therapist has no email address",
          });
          failed++;
          continue;
        }

        // Respect the therapist's notification preference for this digest, if set.
        if (!(await this.isDailyDigestEmailEnabled(therapist.id))) {
          await storage.upsertDailyScheduleEmail({
            therapistId: therapist.id,
            sendDate: easternDateStr,
            status: "sent", // Honored the preference; nothing more to do today.
            appointmentCount: 0,
            attempts,
            error: null,
          });
          skipped++;
          continue;
        }

        const { sessions: daySessions } = await storage.getSessionsWithFiltering({
          therapistId: therapist.id,
          startDate: dayStart,
          endDate: dayEnd,
          includeHiddenServices: true,
          limit: 1000,
        });

        const allowedStatuses = new Set([
          "scheduled",
          "confirmed",
          "in-progress",
          "in_progress",
        ]);
        const todays = daySessions
          .filter((s) =>
            allowedStatuses.has(String(s.status || "").toLowerCase()),
          )
          .sort(
            (a, b) =>
              new Date(a.sessionDate as any).getTime() -
              new Date(b.sessionDate as any).getTime(),
          );

        const { subject, body } = this.buildDailyScheduleEmail(
          therapist,
          todays,
          dayLabel,
        );

        const result = await sp.transmissions.send({
          content: {
            from: fromEmail,
            subject,
            html: this.formatEmailAsHtml(body, {}),
            text: body,
          },
          recipients: [{ address: therapist.email }],
        });

        console.log(
          `[DAILY-SCHEDULE] ✓ Sent ${todays.length}-appointment digest to ${therapist.email} (ID: ${result.results.id})`,
        );

        await storage.upsertDailyScheduleEmail({
          therapistId: therapist.id,
          sendDate: easternDateStr,
          status: "sent",
          appointmentCount: todays.length,
          attempts,
          error: null,
        });
        sent++;
      } catch (err) {
        console.error(
          `[DAILY-SCHEDULE] ✗ Failed to send digest to therapist ${therapist.id}:`,
          err,
        );
        try {
          await storage.upsertDailyScheduleEmail({
            therapistId: therapist.id,
            sendDate: easternDateStr,
            status: "failed",
            appointmentCount: 0,
            attempts,
            error: err instanceof Error ? err.message : String(err),
          });
        } catch (recordErr) {
          console.error(
            "[DAILY-SCHEDULE] Failed to record send failure:",
            recordErr,
          );
        }
        failed++;
      }
    }

    return { sent, skipped, failed };
  }

  // ============================================================
  // Deferred quiet-hours catch-up summary
  // ============================================================

  // Prevents overlapping summary ticks within this process.
  private deferredSummaryInFlight = false;

  /**
   * Called every minute by the background poller. Flushes any queued (deferred)
   * emails for users who are no longer muted by quiet hours/weekends, sending
   * each such user ONE consolidated catch-up email. Safe to call repeatedly.
   */
  async runDeferredSummaryEmailsIfDue(now: Date = new Date()): Promise<void> {
    if (this.deferredSummaryInFlight) return;
    this.deferredSummaryInFlight = true;
    try {
      await this.processDeferredSummaryEmails(now);
    } finally {
      this.deferredSummaryInFlight = false;
    }
  }

  /**
   * For each user with pending deferred emails, send a single consolidated
   * summary IF they are no longer muted right now (the quiet window has ended /
   * it's a non-muted day). Users still inside their quiet window or muted
   * weekend are left untouched so their summary waits until they're back.
   *
   * Idempotency mirrors the daily digest (see
   * .agents/memory/scheduled-email-idempotency.md): the pending rows are claimed
   * (flipped to 'processing') BEFORE the send, so an overlapping tick or a
   * crash can't double-send. A crash after the provider accepts but before the
   * rows are marked 'sent' leaves them 'processing' and they are never re-sent
   * (at-most-once). An explicit provider rejection releases the rows back to
   * 'pending' for a capped retry. Returns counts for tests/observability.
   */
  async processDeferredSummaryEmails(
    now: Date = new Date(),
  ): Promise<{ sent: number; skipped: number; failed: number }> {
    let sent = 0;
    let skipped = 0;
    let failed = 0;

    if (!process.env.SPARKPOST_API_KEY) {
      console.log(
        "[DEFERRED-SUMMARY] SparkPost API key not configured - skipping",
      );
      return { sent, skipped, failed };
    }

    let fromEmail: string;
    try {
      fromEmail = getEmailFromAddress();
    } catch (err) {
      console.error("[DEFERRED-SUMMARY] EMAIL_FROM not configured:", err);
      return { sent, skipped, failed };
    }

    const userIds = await storage.getPendingDeferredEmailUserIds();
    if (userIds.length === 0) return { sent, skipped, failed };

    const sp = new SparkPost(process.env.SPARKPOST_API_KEY);

    for (const userId of userIds) {
      // Only flush once the user is no longer muted. Still-muted users keep
      // their pending rows for a later tick (when the window ends / weekend
      // passes).
      const suppression = await this.isDeliverySuppressedByQuietHours(
        userId,
        now,
      );
      if (suppression.suppressed) {
        skipped++;
        continue;
      }

      // Claim the user's pending rows BEFORE sending (idempotency guard).
      const claimed = await storage.claimPendingDeferredEmails(userId);
      if (claimed.length === 0) {
        skipped++;
        continue;
      }
      const ids = claimed.map((r) => r.id);

      const recipient = await storage.getUser(userId);
      if (!recipient || !recipient.email) {
        // No address to send to — mark these at the cap so they aren't retried.
        await storage.releaseDeferredEmails(
          ids,
          DEFERRED_SUMMARY_EMAIL_MAX_ATTEMPTS,
          "Recipient has no email address",
        );
        failed++;
        continue;
      }

      try {
        const { subject, body } = this.buildDeferredSummaryEmail(
          recipient,
          claimed,
        );
        const result = await sp.transmissions.send({
          content: {
            from: fromEmail,
            subject,
            html: this.formatEmailAsHtml(body, {}),
            text: body,
          },
          recipients: [{ address: recipient.email }],
        });
        console.log(
          `[DEFERRED-SUMMARY] ✓ Sent ${claimed.length}-item catch-up to ${recipient.email} (ID: ${result.results.id})`,
        );
        await storage.markDeferredEmailsSent(ids);
        sent++;
      } catch (err) {
        console.error(
          `[DEFERRED-SUMMARY] ✗ Failed to send catch-up to user ${userId}:`,
          err,
        );
        await storage.releaseDeferredEmails(
          ids,
          DEFERRED_SUMMARY_EMAIL_MAX_ATTEMPTS,
          err instanceof Error ? err.message : String(err),
        );
        failed++;
      }
    }

    return { sent, skipped, failed };
  }

  /**
   * Builds the consolidated catch-up email from a user's queued items. Each
   * queued row already holds the subject/body that the original per-event email
   * would have sent to THIS SAME recipient, so we simply stitch them together —
   * no extra privacy reduction is needed (same recipient, same content).
   */
  private buildDeferredSummaryEmail(
    recipient: User,
    items: { subject: string; body: string }[],
  ): { subject: string; body: string } {
    const greetingName = recipient.fullName || "there";
    const count = items.length;
    const subject =
      count === 1
        ? "1 notification while you were away"
        : `${count} notifications while you were away`;

    const sections = items
      .map((item, i) => {
        const heading = `${i + 1}. ${item.subject}`;
        return `${heading}\n${item.body}`;
      })
      .join("\n\n──────────\n\n");

    const body = `Hi ${greetingName},

While your email notifications were paused (quiet hours / weekend muting), ${
      count === 1 ? "1 update" : `${count} updates`
    } came in. Here ${count === 1 ? "it is" : "they are"}:

${sections}

— SmartHub`;
    return { subject, body };
  }

  /**
   * Whether the user's account-wide delivery settings (quiet hours + weekend
   * muting) say an outbound email "ping" should be suppressed right now.
   *
   * Quiet hours and weekend muting are stored on a single reserved
   * GLOBAL_NOTIFICATION_PREFERENCES_TRIGGER row per user. Times are interpreted
   * in the practice timezone so the window matches the therapist's local clock.
   * Returns false (deliver) when the user has no global row.
   */
  private async isDeliverySuppressedByQuietHours(
    userId: number,
    now: Date = new Date(),
  ): Promise<{ suppressed: boolean; reason?: string; deferToSummary: boolean }> {
    const rows = await db
      .select()
      .from(notificationPreferences)
      .where(
        and(
          eq(notificationPreferences.userId, userId),
          eq(
            notificationPreferences.triggerType,
            GLOBAL_NOTIFICATION_PREFERENCES_TRIGGER,
          ),
        ),
      );

    const pref = rows[0];
    if (!pref) return { suppressed: false, deferToSummary: false };

    // When defer-to-summary is on, a suppressed email is queued for a later
    // catch-up summary instead of being dropped. Surfaced to the caller so the
    // send loop knows whether to enqueue.
    const deferToSummary = pref.quietHoursDeferToSummary === true;

    const zonedNow = toZonedTime(now, PRACTICE_TZ);

    // Weekend muting: weekendsEnabled === false means mute Sat/Sun.
    if (pref.weekendsEnabled === false) {
      const day = zonedNow.getDay(); // 0 = Sunday, 6 = Saturday
      if (day === 0 || day === 6) {
        return { suppressed: true, reason: "weekend muting", deferToSummary };
      }
    }

    // Quiet hours: only active when both ends of the window are valid times.
    const startMinutes = parseTimeToMinutes(pref.quietHoursStart);
    const endMinutes = parseTimeToMinutes(pref.quietHoursEnd);
    if (startMinutes !== null && endMinutes !== null) {
      const nowMinutes = zonedNow.getHours() * 60 + zonedNow.getMinutes();
      if (isWithinQuietWindow(nowMinutes, startMinutes, endMinutes)) {
        return { suppressed: true, reason: "quiet hours", deferToSummary };
      }
    }

    return { suppressed: false, deferToSummary };
  }

  /**
   * Whether the therapist wants the daily digest by email. Mirrors the gating
   * used by sendEmailNotifications: default ON when no preference row exists,
   * otherwise honor an explicit 'email' delivery method / enableEmail flag.
   */
  private async isDailyDigestEmailEnabled(userId: number): Promise<boolean> {
    const prefs = await db
      .select()
      .from(notificationPreferences)
      .where(
        and(
          eq(notificationPreferences.userId, userId),
          eq(notificationPreferences.triggerType, DAILY_SCHEDULE_EMAIL_TRIGGER),
        ),
      );

    if (prefs.length === 0) return true; // No preference set → default enabled.

    return prefs.some((pref) => {
      if (pref.enableEmail) return true;
      if (!pref.deliveryMethods) return false;
      const methods =
        typeof pref.deliveryMethods === "string"
          ? [pref.deliveryMethods]
          : (pref.deliveryMethods as string[]);
      return methods.includes("email");
    });
  }

  /**
   * Builds the plain-text digest. PRIVACY: any client identity that leaves
   * SmartHub is reduced to two initials via clientInitials() — never the full
   * name, diagnosis, or notes.
   */
  private buildDailyScheduleEmail(
    therapist: User,
    todays: any[],
    dayLabel: string,
  ): { subject: string; body: string } {
    const greetingName = therapist.fullName || "there";
    const subject = `Your schedule for ${dayLabel}`;

    if (todays.length === 0) {
      const body = `Hi ${greetingName},

You have no appointments scheduled for ${dayLabel}.

— SmartHub`;
      return { subject, body };
    }

    const lines = todays.map((s) => {
      const startTime = format(
        toZonedTime(new Date(s.sessionDate), PRACTICE_TZ),
        "h:mm a",
        { timeZone: PRACTICE_TZ },
      );
      const initials = clientInitials(s.client?.fullName);
      const sessionType = s.service?.serviceName || "Session";
      const location = this.formatDailyScheduleLocation(s);
      return `• ${startTime} — ${initials} — ${sessionType}${location ? ` — ${location}` : ""}`;
    });

    const count = todays.length;
    const body = `Hi ${greetingName},

Here ${count === 1 ? "is your appointment" : `are your ${count} appointments`} for ${dayLabel}:

${lines.join("\n")}

All times are Eastern. Client names are shown as initials for privacy.

— SmartHub`;
    return { subject, body };
  }

  /**
   * Location string for a digest line: the physical room, or the Zoom join link
   * for telehealth. Contains no client information.
   */
  private formatDailyScheduleLocation(s: any): string {
    if (s.zoomEnabled) {
      return s.zoomJoinUrl
        ? `Telehealth (Zoom): ${s.zoomJoinUrl}`
        : "Telehealth (Zoom)";
    }
    if (s.room?.roomName) {
      return s.room.roomNumber
        ? `${s.room.roomName} (${s.room.roomNumber})`
        : s.room.roomName;
    }
    return "";
  }
}

// Export singleton instance
export const notificationService = new NotificationService();