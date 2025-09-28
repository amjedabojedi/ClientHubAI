import { db } from "./db";
import { eq, and, or, sql, desc, asc, inArray } from "drizzle-orm";
import { 
  notifications, 
  notificationTriggers, 
  notificationPreferences, 
  notificationTemplates,
  users,
  clients,
  supervisorAssignments
} from "@shared/schema";
import SparkPost from "sparkpost";
import { format, toZonedTime } from 'date-fns-tz';
import type { 
  InsertNotification, 
  NotificationTrigger,
  NotificationPreference,
  NotificationTemplate,
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
            // Calculate recipients
            const recipients = await this.calculateRecipients(trigger, entityData);
            // Create notifications for each recipient
            await this.createNotificationsFromTrigger(trigger, entityData, recipients);
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
      console.error(`DEBUG: Trigger ${trigger.id} condition evaluation error:`, error);
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

      // Create notifications for each recipient
      const notificationsData: InsertNotification[] = recipients.map(recipient => {
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

      // Batch create notifications
      await this.createNotificationsBatch(notificationsData);
      
      // Send emails for recipients who have email notifications enabled
      await this.sendEmailNotifications(recipients, trigger, template, entityData);
      
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
      console.log('[NOTIFICATION] SparkPost not configured - skipping email notifications');
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
            console.log(`[NOTIFICATION] Skipping email for user ${recipient.id} - email disabled or no email address`);
            continue;
          }

          // Prepare role-specific email content
          const subject = template ? this.renderTemplate(template.subject, entityData) : trigger.name;
          let body = template ? this.renderTemplate(template.bodyTemplate, entityData) : this.generateRoleSpecificEmailBody(entityData, recipient);
          
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

          console.log(`[NOTIFICATION] Email sent successfully to ${recipient.email} for ${trigger.eventType}`);
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
   * Generates role-specific email body based on recipient
   */
  private generateRoleSpecificEmailBody(entityData: any, recipient: any): string {
    const sessionDate = this.formatDateEST(entityData.sessionDate);
    
    // Determine if this is a client or staff member
    const isClient = recipient.role === 'client' || recipient.id === entityData.clientId;
    
    if (isClient) {
      // Client-focused email content
      return `
Dear ${recipient.fullName},

Your therapy session has been confirmed!

📅 APPOINTMENT DETAILS:
━━━━━━━━━━━━━━━━━━━━━━━━━━
Session Type: ${entityData.sessionType}
Date & Time: ${sessionDate}
Therapist: ${entityData.therapistName}
Duration: ${entityData.duration || 60} minutes

📋 PREPARATION REMINDERS:
• Please arrive 5-10 minutes early
• Bring any questions or topics you'd like to discuss
• If you need to cancel or reschedule, please give at least 24 hours notice

We look forward to seeing you at your appointment.

Best regards,
TherapyFlow Team`;
    } else {
      // Staff/Administrator-focused email content
      return `
Session Scheduled Notification

📊 SESSION DETAILS:
━━━━━━━━━━━━━━━━━━━━━━━━━━
Client: ${entityData.clientName}
Session Type: ${entityData.sessionType}
Date & Time: ${sessionDate}
Therapist: ${entityData.therapistName}
Duration: ${entityData.duration || 60} minutes

👥 ADMINISTRATIVE INFO:
• Session ID: ${entityData.id}
• Client ID: ${entityData.clientId}
• Room: ${entityData.roomId ? `Room ${entityData.roomId}` : 'Not assigned'}

This notification was sent because you are listed as an administrator.`;
    }
  }

  /**
   * Generates default session email body when no template is available
   */
  private generateSessionEmailBody(entityData: any): string {
    const sessionDate = this.formatDateEST(entityData.sessionDate);
    return `A ${entityData.sessionType} session has been scheduled for ${entityData.clientName} on ${sessionDate} with ${entityData.therapistName}.`;
  }

  /**
   * Generates content when Zoom was requested but failed to create
   */
  private generateZoomFailedContent(): string {
    return `

⚠️ VIRTUAL MEETING SETUP:
━━━━━━━━━━━━━━━━━━━━━━━━━━

A Zoom meeting was requested for this session, but there was an issue setting it up automatically. Your therapist will provide the meeting details separately or may switch to an in-person session.

If you have any questions, please contact your therapist directly.

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