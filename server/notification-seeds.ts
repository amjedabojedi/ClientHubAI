import { db } from "./db";
import { notificationTriggers } from "@shared/schema";
import { eq } from "drizzle-orm";

/**
 * Canonical notification trigger definitions
 * These are the source of truth for all environments
 */
export const NOTIFICATION_TRIGGER_SEEDS = [
  {
    name: "Session Scheduled Notification",
    description: "Notify client and therapist when a new session is scheduled",
    eventType: "session_scheduled",
    entityType: "session",
    conditionRules: "{}",
    recipientRules: JSON.stringify({
      roles: ["administrator"],
      assignedTherapist: true,
      sessionClient: true
    }),
    templateId: null,
    priority: "medium",
    delayMinutes: 0,
    batchWindowMinutes: null,
    maxBatchSize: null,
    isActive: true
  },
  {
    name: "Session Rescheduled",
    description: "Notify client when their therapy session date/time is changed",
    eventType: "session_rescheduled",
    entityType: "session",
    conditionRules: "{}",
    recipientRules: JSON.stringify({
      sessionClient: true,
      assignedTherapist: false,
      roles: []
    }),
    templateId: null,
    priority: "medium",
    delayMinutes: 0,
    batchWindowMinutes: null,
    maxBatchSize: null,
    isActive: true
  },
  {
    name: "Session 24hr Advance Reminder",
    description: "Remind client 24 hours before their session",
    eventType: "session_scheduled",
    entityType: "session",
    conditionRules: "{}",
    recipientRules: JSON.stringify({
      roles: ["administrator"],
      assignedTherapist: true,
      sessionClient: true
    }),
    templateId: null,
    priority: "medium",
    delayMinutes: 0,
    batchWindowMinutes: null,
    maxBatchSize: null,
    isActive: false  // Disabled - needs scheduled job implementation
  },
  {
    name: "Intake Session Reminder",
    description: "Special reminder for intake sessions",
    eventType: "session_scheduled",
    entityType: "session",
    conditionRules: JSON.stringify({ sessionType: "intake" }),
    recipientRules: JSON.stringify({
      roles: ["administrator"],
      assignedTherapist: true,
      sessionClient: true
    }),
    templateId: null,
    priority: "high",
    delayMinutes: 0,
    batchWindowMinutes: null,
    maxBatchSize: null,
    isActive: true
  },
  {
    name: "Intake Session 24hr Advance Reminder",
    description: "24-hour reminder for intake sessions",
    eventType: "session_scheduled",
    entityType: "session",
    conditionRules: JSON.stringify({ sessionType: "intake" }),
    recipientRules: JSON.stringify({
      roles: ["administrator"],
      assignedTherapist: true,
      sessionClient: true
    }),
    templateId: null,
    priority: "high",
    delayMinutes: 0,
    batchWindowMinutes: null,
    maxBatchSize: null,
    isActive: false  // Disabled - needs scheduled job implementation
  }
];

/**
 * Synchronizes notification triggers from code to database
 * Uses UPSERT logic to be idempotent and safe to run multiple times
 */
export async function syncNotificationTriggers(): Promise<void> {
  console.log('[NOTIFICATION SEEDS] Starting trigger synchronization...');
  
  try {
    for (const triggerSeed of NOTIFICATION_TRIGGER_SEEDS) {
      // Check if trigger exists
      const existing = await db
        .select()
        .from(notificationTriggers)
        .where(eq(notificationTriggers.name, triggerSeed.name));

      if (existing.length > 0) {
        // Update existing trigger with canonical configuration
        await db
          .update(notificationTriggers)
          .set({
            description: triggerSeed.description,
            eventType: triggerSeed.eventType as any,
            entityType: triggerSeed.entityType as any,
            conditionRules: triggerSeed.conditionRules,
            recipientRules: triggerSeed.recipientRules,
            priority: triggerSeed.priority as any,
            delayMinutes: triggerSeed.delayMinutes,
            batchWindowMinutes: triggerSeed.batchWindowMinutes,
            maxBatchSize: triggerSeed.maxBatchSize,
            isActive: triggerSeed.isActive,
            updatedAt: new Date()
          })
          .where(eq(notificationTriggers.name, triggerSeed.name));
        
        console.log(`[NOTIFICATION SEEDS] Updated trigger: ${triggerSeed.name}`);
      } else {
        // Insert new trigger
        await db
          .insert(notificationTriggers)
          .values({
            ...triggerSeed,
            createdAt: new Date(),
            updatedAt: new Date()
          });
        
        console.log(`[NOTIFICATION SEEDS] Created trigger: ${triggerSeed.name}`);
      }
    }
    
    console.log('[NOTIFICATION SEEDS] Trigger synchronization completed successfully');
  } catch (error) {
    console.error('[NOTIFICATION SEEDS] Error synchronizing triggers:', error);
    throw error;
  }
}
