import { db } from "./db";
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
  sessions
} from "@shared/schema";
import SparkPost from "sparkpost";
import { format, toZonedTime } from 'date-fns-tz';
import type { 
  InsertNotification, 
  NotificationTrigger,
  NotificationPreference,
  NotificationTemplate,
  InsertScheduledNotification,
  User 
} from "@shared/schema";

// Flexible trigger condition interface
interface TriggerCondition {
  field: string;
  operator: 'equals' | 'not_equals' | 'contains' | 'greater_than' | 'less_than' | 'in_array';
  value: any;
  logicalOperator?: 'AND' | 'OR';
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
  
  // ===== CORE NOTIFICATION METHODS =====
  
  /**
   * Creates a new notification for a user
   */
  async createNotification(notificationData: InsertNotification): Promise<void> {
    try {
      await db.insert(notifications).values(notificationData);
    } catch (error) {

      throw error;
    }
  }

  /**
   * Creates multiple notifications in a batch
   */
  async createNotificationsBatch(notificationsData: InsertNotification[]): Promise<void> {
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
      .where(and(
        eq(notifications.userId, userId),
        eq(notifications.isRead, false)
      ));
    
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
        readAt: new Date() 
      })
      .where(and(
        eq(notifications.id, notificationId),
        eq(notifications.userId, userId)
      ));
  }

  /**
   * Marks all notifications as read for a user
   */
  async markAllAsRead(userId: number): Promise<void> {
    await db
      .update(notifications)
      .set({ 
        isRead: true, 
        readAt: new Date() 
      })
      .where(and(
        eq(notifications.userId, userId),
        eq(notifications.isRead, false)
      ));
  }

  // ===== TRIGGER EVALUATION SYSTEM =====
  
  /**
   * Processes an event and creates notifications based on triggers
   */
  async processEvent(eventType: string, entityData: any): Promise<void> {
    
    try {
      // Get all active triggers for this event type
      const triggers = await db
        .select()
        .from(notificationTriggers)
        .where(and(
          eq(notificationTriggers.eventType, eventType as any),
          eq(notificationTriggers.isActive, true)
        ));
        

      // Process each trigger
      for (const trigger of triggers) {
        try {
          // Check if trigger conditions are met
          const conditionsMet = await this.evaluateTriggerConditions(trigger, entityData);
          
          if (conditionsMet) {
            // Handle scheduled vs immediate notifications
            if (trigger.isScheduled && entityData.sessionDate) {
              // For scheduled triggers (24hr reminders), calculate when to send
              const sessionDate = new Date(entityData.sessionDate);
              const now = new Date();
              const hoursUntilSession = (sessionDate.getTime() - now.getTime()) / (1000 * 60 * 60);
              
              if (hoursUntilSession > 24) {
                // Schedule for 24 hours before session
                const executeAt = new Date(sessionDate.getTime() - (24 * 60 * 60 * 1000));
                await this.scheduleNotification(trigger, entityData, executeAt);
              } else if (hoursUntilSession > 0) {
                // Less than 24 hours away - send immediately
                const recipients = await this.calculateRecipients(trigger, entityData);
                await this.createNotificationsFromTrigger(trigger, entityData, recipients);
              }
            } else {
              // Immediate notification (non-scheduled triggers)
              const recipients = await this.calculateRecipients(trigger, entityData);
              await this.createNotificationsFromTrigger(trigger, entityData, recipients);
            }
          }
        } catch (error) {
          console.error(`Error processing notification trigger ${trigger.id}:`, error);
          // Continue with other triggers even if one fails
        }
      }
    } catch (error) {
      console.error(`Error in notification processEvent:`, error);
      throw error;
    }
  }

  /**
   * Schedules a notification for future delivery
   */
  async scheduleNotification(trigger: NotificationTrigger, entityData: any, executeAt: Date): Promise<void> {
    try {
      const scheduledData: InsertScheduledNotification = {
        triggerId: trigger.id,
        sessionId: entityData.id || null,
        entityType: trigger.entityType,
        entityId: entityData.id,
        entityData: JSON.stringify(entityData),
        executeAt,
        status: 'pending',
        retryCount: 0
      };

      // Check for duplicate (idempotent insert)
      const existing = await db
        .select()
        .from(scheduledNotifications)
        .where(and(
          eq(scheduledNotifications.sessionId, entityData.id),
          eq(scheduledNotifications.triggerId, trigger.id),
          eq(scheduledNotifications.status, 'pending')
        ));

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
        .where(and(
          eq(scheduledNotifications.status, 'pending'),
          sql`${scheduledNotifications.executeAt} <= ${now}`
        ))
        .limit(100); // Process in batches

      for (const scheduled of dueNotifications) {
        try {
          // Get the trigger
          const [trigger] = await db
            .select()
            .from(notificationTriggers)
            .where(eq(notificationTriggers.id, scheduled.triggerId));

          if (!trigger) {
            console.error(`Trigger ${scheduled.triggerId} not found for scheduled notification ${scheduled.id}`);
            continue;
          }

          // Parse entity data
          const entityData = JSON.parse(scheduled.entityData);

          // Calculate recipients and send notifications
          const recipients = await this.calculateRecipients(trigger, entityData);
          await this.createNotificationsFromTrigger(trigger, entityData, recipients);

          // Mark as sent
          await db
            .update(scheduledNotifications)
            .set({ 
              status: 'sent', 
              processedAt: new Date() 
            })
            .where(eq(scheduledNotifications.id, scheduled.id));
        } catch (error) {
          // Mark as failed and increment retry count
          await db
            .update(scheduledNotifications)
            .set({ 
              status: 'failed',
              retryCount: scheduled.retryCount + 1,
              lastError: error instanceof Error ? error.message : 'Unknown error',
              processedAt: new Date()
            })
            .where(eq(scheduledNotifications.id, scheduled.id));

          console.error(`Error processing scheduled notification ${scheduled.id}:`, error);
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
  private async evaluateTriggerConditions(trigger: NotificationTrigger, entityData: any): Promise<boolean> {
    try {
      if (!trigger.conditionRules || trigger.conditionRules === '{}') {
        return true; // No conditions or empty conditions means always trigger
      }

      const parsedConditions = JSON.parse(trigger.conditionRules);
      
      // Handle both object format like {"sessionType": "intake"} and array format
      let conditions: TriggerCondition[] = [];
      
      if (Array.isArray(parsedConditions)) {
        conditions = parsedConditions;
      } else if (typeof parsedConditions === 'object' && parsedConditions !== null) {
        // Convert object format to condition array
        conditions = Object.entries(parsedConditions).map(([field, value]) => ({
          field,
          operator: 'equals' as const,
          value
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
  private evaluateCondition(fieldValue: any, condition: TriggerCondition): boolean {
    switch (condition.operator) {
      case 'equals':
        return fieldValue === condition.value;
      case 'not_equals':
        return fieldValue !== condition.value;
      case 'contains':
        return String(fieldValue).includes(condition.value);
      case 'greater_than':
        return Number(fieldValue) > Number(condition.value);
      case 'less_than':
        return Number(fieldValue) < Number(condition.value);
      case 'in_array':
        return Array.isArray(condition.value) && condition.value.includes(fieldValue);
      default:
        return false;
    }
  }

  /**
   * Gets field value from entity data using dot notation
   */
  private getFieldValue(entityData: any, fieldPath: string): any {
    const value = fieldPath.split('.').reduce((obj, key) => obj?.[key], entityData);
    
    // Special handling for date fields to format them in EST timezone
    if (fieldPath === 'sessionDate' && value) {
      return this.formatDateEST(value);
    }
    
    return value;
  }

  /**
   * Calculates who should receive notifications based on recipient rules
   */
  private async calculateRecipients(trigger: NotificationTrigger, entityData: any): Promise<User[]> {
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
          .where(and(
            inArray(users.role, recipientRules.roles),
            eq(users.isActive, true)
          ));
        recipients.push(...roleUsers);
      }

      // Get specific users
      if (recipientRules.specificUsers && recipientRules.specificUsers.length > 0) {
        const specificUsers = await db
          .select()
          .from(users)
          .where(and(
            sql`${users.id} = ANY(${recipientRules.specificUsers})`,
            eq(users.isActive, true)
          ));
        recipients.push(...specificUsers);
      }

      // Get assigned therapist (for client-related events)  
      if (recipientRules.assignedTherapist && entityData.assignedToId) {
        const therapist = await db
          .select()
          .from(users)
          .where(and(
            eq(users.id, entityData.assignedToId),
            eq(users.isActive, true)
          ));
        if (therapist[0]) recipients.push(therapist[0]);
      }

      // Get supervisor of assigned therapist (for document review notifications)
      if (recipientRules.supervisorOfTherapist && entityData.assignedTherapistId) {
        const supervisorAssignment = await db
          .select()
          .from(supervisorAssignments)
          .innerJoin(users, eq(supervisorAssignments.supervisorId, users.id))
          .where(and(
            eq(supervisorAssignments.therapistId, entityData.assignedTherapistId),
            eq(supervisorAssignments.isActive, true),
            eq(users.isActive, true)
          ));
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
            username: client[0].fullName || 'Client',
            password: '', // Not needed for notifications
            fullName: client[0].fullName || 'Client',
            email: client[0].email,
            role: 'client',
            isActive: true,
            createdAt: client[0].createdAt || new Date(),
            updatedAt: client[0].updatedAt || new Date(),
            customRoleId: null,
            status: 'active',
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
            createdBy: null
          };
          recipients.push(clientAsUser);
        }
      }

      // Remove duplicates
      const uniqueRecipients = recipients.filter((user, index, self) => 
        index === self.findIndex(u => u.id === user.id)
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
    recipients: User[]
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
      const actualUsers = recipients.filter(r => r.role !== 'client');
      const allRecipients = recipients; // Keep all for email sending

      // Create in-app notifications ONLY for actual users (not clients)
      // Clients don't have user accounts, so they can't see in-app notifications
      if (actualUsers.length > 0) {
        const notificationsData: InsertNotification[] = actualUsers.map(recipient => {
          const title = template ? this.renderTemplate(template.subject, entityData) : trigger.name;
          const message = template ? this.renderTemplate(template.bodyTemplate, entityData) : `${trigger.name} triggered`;
          const actionUrl = template?.actionUrlTemplate ? this.renderTemplate(template.actionUrlTemplate, entityData) : null;

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
            relatedEntityId: entityData.id
          };
        });

        // Batch create notifications for actual users only
        await this.createNotificationsBatch(notificationsData);
      }
      
      // Send emails to ALL recipients (users and clients)
      // Emails work for everyone with an email address
      await this.sendEmailNotifications(allRecipients, trigger, template, entityData);
      
    } catch (error) {
      console.error(`Error creating notifications from trigger:`, error);
      throw error;
    }
  }

  /**
   * Sends email notifications using SparkPost
   */
  private async sendEmailNotifications(
    recipients: User[], 
    trigger: NotificationTrigger, 
    template: NotificationTemplate | null, 
    entityData: any
  ): Promise<void> {
    // Check if SparkPost is configured
    if (!process.env.SPARKPOST_API_KEY) {
      return;
    }

    try {
      const sp = new SparkPost(process.env.SPARKPOST_API_KEY);
      const fromEmail = 'noreply@send.rcrc.ca';

      for (const recipient of recipients) {
        try {
          // Check if user has email notifications enabled for this trigger type
          const preferences = await db
            .select()
            .from(notificationPreferences)
            .where(and(
              eq(notificationPreferences.userId, recipient.id),
              eq(notificationPreferences.triggerType, trigger.eventType)
            ));

          const hasEmailEnabled = preferences.length === 0 || // Default to enabled if no preference set
            preferences.some(pref => {
              if (!pref.deliveryMethods) return false;
              const methods = typeof pref.deliveryMethods === 'string' 
                ? [pref.deliveryMethods] 
                : pref.deliveryMethods as string[];
              return methods.includes('email');
            });

          if (!hasEmailEnabled || !recipient.email) {
            continue;
          }

          // Prepare purpose-specific email content based on trigger type
          const subject = template ? this.renderTemplate(template.subject, entityData) : trigger.name;
          let body = template ? this.renderTemplate(template.bodyTemplate, entityData) : this.generatePurposeSpecificEmailBody(trigger.eventType, entityData, recipient);
          
          // Special handling for Zoom meeting notifications
          if (trigger.eventType === 'session_scheduled' && entityData.zoomEnabled) {
            if (entityData.zoomMeetingData) {
              body += this.generateZoomEmailContent(entityData.zoomMeetingData, entityData);
            } else {
              body += this.generateZoomFailedContent();
            }
          }

          // Send email
          await sp.transmissions.send({
            content: {
              from: fromEmail,
              subject: subject,
              html: this.formatEmailAsHtml(body, entityData),
              text: body
            },
            recipients: [{ address: recipient.email }]
          });
        } catch (emailError) {
          console.error(`[NOTIFICATION] Failed to send email to ${recipient.email}:`, emailError);
          // Continue with other recipients even if one fails
        }
      }
    } catch (error) {
      console.error('[NOTIFICATION] Error in sendEmailNotifications:', error);
    }
  }

  /**
   * Generates Zoom meeting content for email notifications
   */
  private generateZoomEmailContent(zoomMeetingData: any, sessionData: any): string {
    if (!zoomMeetingData) return '';

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
  private generatePurposeSpecificEmailBody(eventType: string, entityData: any, recipient: any): string {
    const isClient = recipient.role === 'client' || recipient.id === entityData.clientId;
    
    switch (eventType) {
      case 'session_scheduled':
        return this.generateSessionEmailBody(entityData, recipient, isClient);
      
      case 'session_rescheduled':
        return this.generateSessionRescheduledEmailBody(entityData, recipient, isClient);
      
      case 'client_created':
        return this.generateClientCreatedEmailBody(entityData, recipient, isClient);
      
      case 'client_assigned':
        return this.generateClientAssignedEmailBody(entityData, recipient, isClient);
      
      case 'task_assigned':
        return this.generateTaskAssignedEmailBody(entityData, recipient, isClient);
      
      case 'task_overdue':
        return this.generateTaskOverdueEmailBody(entityData, recipient, isClient);
      
      case 'document_needs_review':
        return this.generateDocumentReviewEmailBody(entityData, recipient, isClient);
      
      case 'document_reviewed':
        return this.generateDocumentReviewedEmailBody(entityData, recipient, isClient);
      
      case 'document_uploaded':
        return this.generateDocumentUploadedEmailBody(entityData, recipient, isClient);
      
      case 'session_overdue':
        return this.generateSessionOverdueEmailBody(entityData, recipient, isClient);
      
      default:
        return this.generateGenericEmailBody(eventType, entityData, recipient, isClient);
    }
  }

  /**
   * Generates session-specific email content
   */
  private generateSessionEmailBody(entityData: any, recipient: any, isClient: boolean): string {
    const sessionDate = this.formatDateEST(entityData.sessionDate);
    
    // Check if Zoom is enabled and has meeting details
    const hasZoomDetails = entityData.zoomEnabled && entityData.zoomJoinUrl;
    
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
${entityData.zoomPassword ? `• Password: ${entityData.zoomPassword}` : ''}

📋 Important Instructions:
• Please join the meeting 5 minutes before your scheduled time
• Ensure you have a stable internet connection
• Test your camera and microphone beforehand
• Find a quiet, private space for your session

Need help with Zoom? Visit: https://support.zoom.us/hc/en-us/articles/201362613

━━━━━━━━━━━━━━━━━━━━━━━━━━`;
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
TherapyFlow Team`;

      return emailBody;
    } else {
      return `
Session Scheduled Notification

📊 SESSION DETAILS:
━━━━━━━━━━━━━━━━━━━━━━━━━━
Session Type: ${entityData.sessionType}
Date & Time: ${sessionDate}
Therapist: ${entityData.therapistName}
Duration: ${entityData.duration || 60} minutes

👥 ADMINISTRATIVE INFO:
• Session ID: ${entityData.id}
• Room: ${entityData.roomId ? `Room ${entityData.roomId}` : 'Not assigned'}

This notification was sent because you are listed as an administrator.`;
    }
  }

  /**
   * Generates session rescheduled email content
   */
  private generateSessionRescheduledEmailBody(entityData: any, recipient: any, isClient: boolean): string {
    const oldSessionDate = this.formatDateEST(entityData.oldSessionDate);
    const newSessionDate = this.formatDateEST(entityData.sessionDate);
    
    // Check if Zoom is enabled and has meeting details
    const hasZoomDetails = entityData.zoomEnabled && entityData.zoomJoinUrl;
    
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
${entityData.zoomPassword ? `• Password: ${entityData.zoomPassword}` : ''}

📋 Important Instructions:
• Please join the meeting 5 minutes before your scheduled time
• Ensure you have a stable internet connection
• Test your camera and microphone beforehand
• Find a quiet, private space for your session

Need help with Zoom? Visit: https://support.zoom.us/hc/en-us/articles/201362613

━━━━━━━━━━━━━━━━━━━━━━━━━━`;
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
TherapyFlow Team`;

      return emailBody;
    } else {
      return `
Session Rescheduled Notification

📊 RESCHEDULING DETAILS:
━━━━━━━━━━━━━━━━━━━━━━━━━━
Previous Date & Time: ${oldSessionDate}
New Date & Time: ${newSessionDate}

Session Type: ${entityData.sessionType}
Therapist: ${entityData.therapistName}
Client: ${entityData.clientName}
Duration: ${entityData.duration || 60} minutes

👥 ADMINISTRATIVE INFO:
• Session ID: ${entityData.id}
• Room: ${entityData.roomId ? `Room ${entityData.roomId}` : 'Not assigned'}

This notification was sent because you are listed as an administrator or involved in this session.`;
    }
  }

  /**
   * Generates client creation email content
   */
  private generateClientCreatedEmailBody(entityData: any, recipient: any, isClient: boolean): string {
    return `
New Client Added to System

👤 CLIENT DETAILS:
━━━━━━━━━━━━━━━━━━━━━━━━━━
Name: ${entityData.fullName}
Client ID: ${entityData.id}
Email: ${entityData.email || 'Not provided'}
Phone: ${entityData.phone || 'Not provided'}
Added: ${this.formatDateEST(entityData.createdAt)}

📋 ACTION REQUIRED:
A new client has been added to the system. Please review their profile and ensure all intake requirements are met.

• Verify contact information
• Review insurance details
• Assign to appropriate therapist
• Schedule initial assessment

View client profile: [Link to client profile]

This notification was sent because you are responsible for client intake processing.`;
  }

  /**
   * Generates client assignment email content
   */
  private generateClientAssignedEmailBody(entityData: any, recipient: any, isClient: boolean): string {
    if (isClient) {
      return `
Dear ${recipient.fullName},

Welcome to TherapyFlow!

👋 THERAPIST ASSIGNMENT:
━━━━━━━━━━━━━━━━━━━━━━━━━━
You have been assigned to ${entityData.therapistName} for your therapy services.

Your therapist will contact you soon to schedule your first appointment.

📞 NEXT STEPS:
• Wait for your therapist to contact you
• Prepare any questions you'd like to discuss
• Complete any intake paperwork provided

Best regards,
TherapyFlow Team`;
    } else {
      return `
Client Assignment Notification

👤 ASSIGNMENT DETAILS:
━━━━━━━━━━━━━━━━━━━━━━━━━━
Client: ${entityData.clientName}
Assigned to: ${entityData.therapistName}
Assignment Date: ${this.formatDateEST(entityData.assignmentDate)}

📋 ACTION REQUIRED:
You have been assigned a new client. Please review their case and schedule an initial assessment.

• Review client profile and history
• Contact client to schedule first session
• Prepare treatment planning documentation

This notification was sent because you are the assigned therapist.`;
    }
  }

  /**
   * Generates task assignment email content
   */
  private generateTaskAssignedEmailBody(entityData: any, recipient: any, isClient: boolean): string {
    const dueDate = entityData.dueDate ? this.formatDateEST(entityData.dueDate) : 'No due date set';
    
    return `
Task Assignment Notification

📋 TASK DETAILS:
━━━━━━━━━━━━━━━━━━━━━━━━━━
Title: ${entityData.title}
Priority: ${entityData.priority || 'Normal'}
Due Date: ${dueDate}
Assigned by: ${entityData.createdByName}

📝 DESCRIPTION:
${entityData.description || 'No additional details provided.'}

🎯 ACTION REQUIRED:
A new task has been assigned to you. Please review the details and begin work as appropriate.

This notification was sent because you are responsible for completing this task.`;
  }

  /**
   * Generates task overdue email content
   */
  private generateTaskOverdueEmailBody(entityData: any, recipient: any, isClient: boolean): string {
    const dueDate = this.formatDateEST(entityData.dueDate);
    
    return `
⚠️ OVERDUE TASK ALERT

📋 OVERDUE TASK:
━━━━━━━━━━━━━━━━━━━━━━━━━━
Title: ${entityData.title}
Due Date: ${dueDate}
Priority: ${entityData.priority || 'Normal'}

🚨 IMMEDIATE ACTION REQUIRED:
This task is past its due date and requires immediate attention.

Please complete this task as soon as possible or update its status if already completed.

This notification was sent because you are responsible for this overdue task.`;
  }

  /**
   * Generates document review email content
   */
  private generateDocumentReviewEmailBody(entityData: any, recipient: any, isClient: boolean): string {
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
  private generateDocumentReviewedEmailBody(entityData: any, recipient: any, isClient: boolean): string {
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
Your document has been reviewed and ${entityData.reviewStatus === 'approved' ? 'approved' : 'requires revision'}.

${entityData.reviewComments ? `Reviewer comments: ${entityData.reviewComments}` : ''}

This notification was sent because you submitted the document for review.`;
  }

  /**
   * Generates document uploaded email content
   */
  private generateDocumentUploadedEmailBody(entityData: any, recipient: any, isClient: boolean): string {
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
  private generateSessionOverdueEmailBody(entityData: any, recipient: any, isClient: boolean): string {
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
  private generateGenericEmailBody(eventType: string, entityData: any, recipient: any, isClient: boolean): string {
    return `
${eventType.replace(/_/g, ' ').toUpperCase()} Notification

📋 DETAILS:
━━━━━━━━━━━━━━━━━━━━━━━━━━
An event has occurred that requires your attention.

Event Type: ${eventType}
Date: ${this.formatDateEST(new Date())}

Please log into TherapyFlow to review the details and take any necessary action.

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
    const dateObj = typeof date === 'string' ? new Date(date) : date;
    const zonedDate = toZonedTime(dateObj, 'America/New_York');
    return format(zonedDate, 'EEEE, MMMM d, yyyy \'at\' h:mm a (zzz)', {
      timeZone: 'America/New_York'
    });
  }

  /**
   * Formats email content as HTML
   */
  private formatEmailAsHtml(content: string, entityData: any): string {
    const htmlContent = content
      .replace(/\n/g, '<br>')
      .replace(/━/g, '─')
      .replace(/📹/g, '🎥')
      .replace(/📋/g, '📝');

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
          <h2>TherapyFlow Notification</h2>
        </div>
        <div class="content">
          ${htmlContent}
        </div>
        <div style="margin-top: 30px; padding: 15px; border-top: 1px solid #ddd; font-size: 12px; color: #666;">
          <p>This is an automated message from TherapyFlow. Please do not reply to this email.</p>
        </div>
      </body>
    </html>`;
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
  async setUserPreference(userId: number, triggerType: string, preferences: Partial<NotificationPreference>): Promise<void> {
    try {
      // Check if preference exists
      const existing = await db
        .select()
        .from(notificationPreferences)
        .where(and(
          eq(notificationPreferences.userId, userId),
          eq(notificationPreferences.triggerType, triggerType as any)
        ));

      if (existing.length > 0) {
        // Update existing
        await db
          .update(notificationPreferences)
          .set({ ...preferences, updatedAt: new Date() })
          .where(and(
            eq(notificationPreferences.userId, userId),
            eq(notificationPreferences.triggerType, triggerType as any)
          ));
      } else {
        // Create new
        await db
          .insert(notificationPreferences)
          .values({
            userId,
            triggerType: triggerType as any,
            ...preferences
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
        .where(and(
          sql`${notifications.expiresAt} IS NOT NULL`,
          sql`${notifications.expiresAt} < NOW()`
        ));
    } catch (error) {

    }
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
        unread: unreadResult[0]?.count || 0
      };
    } catch (error) {

      return { total: 0, unread: 0 };
    }
  }
}

// Export singleton instance
export const notificationService = new NotificationService();