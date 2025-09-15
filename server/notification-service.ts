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
    console.log(`DEBUG: NotificationService.processEvent called with eventType: ${eventType}`);
    console.log(`DEBUG: Entity data:`, JSON.stringify(entityData, null, 2));
    
    try {
      // Get all active triggers for this event type
      const triggers = await db
        .select()
        .from(notificationTriggers)
        .where(and(
          eq(notificationTriggers.eventType, eventType as any),
          eq(notificationTriggers.isActive, true)
        ));
        
      console.log(`DEBUG: Found ${triggers.length} active triggers for ${eventType}`);

      // Process each trigger
      for (const trigger of triggers) {
        console.log(`DEBUG: Processing trigger ${trigger.id}: "${trigger.name}"`);
        try {
          // Check if trigger conditions are met
          const conditionsMet = await this.evaluateTriggerConditions(trigger, entityData);
          console.log(`DEBUG: Trigger ${trigger.id} conditions met: ${conditionsMet}`);
          
          if (conditionsMet) {
            // Calculate recipients
            const recipients = await this.calculateRecipients(trigger, entityData);
            console.log(`DEBUG: Trigger ${trigger.id} found ${recipients.length} recipients:`, recipients.map(r => r.id));
            
            // Create notifications for each recipient
            await this.createNotificationsFromTrigger(trigger, entityData, recipients);
            console.log(`DEBUG: Trigger ${trigger.id} notifications created successfully`);
          } else {
            console.log(`DEBUG: Trigger ${trigger.id} conditions not met, skipping`);
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
        console.log(`DEBUG: Trigger ${trigger.id} has no conditions, returning true`);
        return true; // No conditions or empty conditions means always trigger
      }

      const parsedConditions = JSON.parse(trigger.conditionRules);
      console.log(`DEBUG: Trigger ${trigger.id} parsed conditions:`, parsedConditions);
      
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
      
      console.log(`DEBUG: Trigger ${trigger.id} evaluating ${conditions.length} conditions`);
      
      for (const condition of conditions) {
        const fieldValue = this.getFieldValue(entityData, condition.field);
        const conditionMet = this.evaluateCondition(fieldValue, condition);
        console.log(`DEBUG: Trigger ${trigger.id} condition ${condition.field} = ${fieldValue}, expected: ${condition.value}, met: ${conditionMet}`);
        
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
    return fieldPath.split('.').reduce((obj, key) => obj?.[key], entityData);
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
      
    } catch (error) {
      console.error(`Error creating notifications from trigger:`, error);
      throw error;
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