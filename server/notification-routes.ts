import { Router } from "express";
import { storage } from "./storage";
import { notificationService } from "./notification-service";
import { z } from "zod";
import { insertNotificationSchema, insertNotificationTriggerSchema, insertNotificationPreferenceSchema, insertNotificationTemplateSchema } from "@shared/schema";

const router = Router();

// ===== USER NOTIFICATIONS ENDPOINTS =====

/**
 * GET /api/notifications - Get user's notifications
 */
router.get("/", async (req, res) => {
  try {
    const userId = (req as any).user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const limit = parseInt(req.query.limit as string) || 50;
    const notifications = await storage.getUserNotifications(userId, limit);
    
    res.json(notifications);
  } catch (error) {
    console.error("Failed to get notifications:", error);
    res.status(500).json({ error: "Failed to get notifications" });
  }
});

/**
 * GET /api/notifications/unread-count - Get unread notification count
 */
router.get("/unread-count", async (req, res) => {
  try {
    const userId = (req as any).user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const count = await storage.getUnreadNotificationCount(userId);
    res.json({ count });
  } catch (error) {
    console.error("Failed to get unread count:", error);
    res.status(500).json({ error: "Failed to get unread count" });
  }
});

/**
 * PUT /api/notifications/:id/read - Mark notification as read
 */
router.put("/:id/read", async (req, res) => {
  try {
    const userId = (req as any).user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const notificationId = parseInt(req.params.id);
    await storage.markNotificationAsRead(notificationId, userId);
    
    res.json({ success: true });
  } catch (error) {
    console.error("Failed to mark notification as read:", error);
    res.status(500).json({ error: "Failed to mark notification as read" });
  }
});

/**
 * PUT /api/notifications/mark-all-read - Mark all notifications as read
 */
router.put("/mark-all-read", async (req, res) => {
  try {
    const userId = (req as any).user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Authentication required" });
    }

    await storage.markAllNotificationsAsRead(userId);
    res.json({ success: true });
  } catch (error) {
    console.error("Failed to mark all notifications as read:", error);
    res.status(500).json({ error: "Failed to mark all notifications as read" });
  }
});

/**
 * DELETE /api/notifications/:id - Delete notification
 */
router.delete("/:id", async (req, res) => {
  try {
    const userId = (req as any).user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const notificationId = parseInt(req.params.id);
    await storage.deleteNotification(notificationId, userId);
    
    res.json({ success: true });
  } catch (error) {
    console.error("Failed to delete notification:", error);
    res.status(500).json({ error: "Failed to delete notification" });
  }
});

/**
 * POST /api/notifications - Create a notification (admin/system use)
 */
router.post("/", async (req, res) => {
  try {
    const userId = (req as any).user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Authentication required" });
    }

    // Validate request body
    const validatedData = insertNotificationSchema.parse(req.body);\n    const notification = await storage.createNotification(validatedData);\n    \n    res.status(201).json(notification);\n  } catch (error) {\n    if (error instanceof z.ZodError) {\n      return res.status(400).json({ error: \"Invalid notification data\", details: error.errors });\n    }\n    console.error(\"Failed to create notification:\", error);\n    res.status(500).json({ error: \"Failed to create notification\" });\n  }\n});\n\n// ===== USER PREFERENCES ENDPOINTS =====\n\n/**\n * GET /api/notifications/preferences - Get user's notification preferences\n */\nrouter.get(\"/preferences\", async (req, res) => {\n  try {\n    const userId = (req as any).user?.id;\n    if (!userId) {\n      return res.status(401).json({ error: \"Authentication required\" });\n    }\n\n    const preferences = await storage.getUserNotificationPreferences(userId);\n    res.json(preferences);\n  } catch (error) {\n    console.error(\"Failed to get user preferences:\", error);\n    res.status(500).json({ error: \"Failed to get user preferences\" });\n  }\n});\n\n/**\n * PUT /api/notifications/preferences/:triggerType - Set user notification preference\n */\nrouter.put(\"/preferences/:triggerType\", async (req, res) => {\n  try {\n    const userId = (req as any).user?.id;\n    if (!userId) {\n      return res.status(401).json({ error: \"Authentication required\" });\n    }\n\n    const triggerType = req.params.triggerType;\n    const validatedData = insertNotificationPreferenceSchema.partial().parse(req.body);\n    \n    const preference = await storage.setUserNotificationPreference(userId, triggerType, validatedData);\n    res.json(preference);\n  } catch (error) {\n    if (error instanceof z.ZodError) {\n      return res.status(400).json({ error: \"Invalid preference data\", details: error.errors });\n    }\n    console.error(\"Failed to set user preference:\", error);\n    res.status(500).json({ error: \"Failed to set user preference\" });\n  }\n});\n\n// ===== ADMIN/TRIGGER MANAGEMENT ENDPOINTS =====\n\n/**\n * GET /api/notifications/triggers - Get notification triggers (admin only)\n */\nrouter.get(\"/triggers\", async (req, res) => {\n  try {\n    const userRole = (req as any).user?.role;\n    if (!userRole || !['admin', 'supervisor'].includes(userRole)) {\n      return res.status(403).json({ error: \"Admin access required\" });\n    }\n\n    const eventType = req.query.eventType as string;\n    const triggers = await storage.getNotificationTriggers(eventType);\n    res.json(triggers);\n  } catch (error) {\n    console.error(\"Failed to get triggers:\", error);\n    res.status(500).json({ error: \"Failed to get triggers\" });\n  }\n});\n\n/**\n * POST /api/notifications/triggers - Create notification trigger (admin only)\n */\nrouter.post(\"/triggers\", async (req, res) => {\n  try {\n    const userRole = (req as any).user?.role;\n    if (!userRole || !['admin', 'supervisor'].includes(userRole)) {\n      return res.status(403).json({ error: \"Admin access required\" });\n    }\n\n    const validatedData = insertNotificationTriggerSchema.parse(req.body);\n    const trigger = await storage.createNotificationTrigger(validatedData);\n    \n    res.status(201).json(trigger);\n  } catch (error) {\n    if (error instanceof z.ZodError) {\n      return res.status(400).json({ error: \"Invalid trigger data\", details: error.errors });\n    }\n    console.error(\"Failed to create trigger:\", error);\n    res.status(500).json({ error: \"Failed to create trigger\" });\n  }\n});\n\n/**\n * PUT /api/notifications/triggers/:id - Update notification trigger (admin only)\n */\nrouter.put(\"/triggers/:id\", async (req, res) => {\n  try {\n    const userRole = (req as any).user?.role;\n    if (!userRole || !['admin', 'supervisor'].includes(userRole)) {\n      return res.status(403).json({ error: \"Admin access required\" });\n    }\n\n    const triggerId = parseInt(req.params.id);\n    const validatedData = insertNotificationTriggerSchema.partial().parse(req.body);\n    \n    const trigger = await storage.updateNotificationTrigger(triggerId, validatedData);\n    res.json(trigger);\n  } catch (error) {\n    if (error instanceof z.ZodError) {\n      return res.status(400).json({ error: \"Invalid trigger data\", details: error.errors });\n    }\n    console.error(\"Failed to update trigger:\", error);\n    res.status(500).json({ error: \"Failed to update trigger\" });\n  }\n});\n\n/**\n * DELETE /api/notifications/triggers/:id - Delete notification trigger (admin only)\n */\nrouter.delete(\"/triggers/:id\", async (req, res) => {\n  try {\n    const userRole = (req as any).user?.role;\n    if (!userRole || !['admin', 'supervisor'].includes(userRole)) {\n      return res.status(403).json({ error: \"Admin access required\" });\n    }\n\n    const triggerId = parseInt(req.params.id);\n    await storage.deleteNotificationTrigger(triggerId);\n    \n    res.json({ success: true });\n  } catch (error) {\n    console.error(\"Failed to delete trigger:\", error);\n    res.status(500).json({ error: \"Failed to delete trigger\" });\n  }\n});\n\n// ===== TEMPLATE MANAGEMENT ENDPOINTS =====\n\n/**\n * GET /api/notifications/templates - Get notification templates (admin only)\n */\nrouter.get(\"/templates\", async (req, res) => {\n  try {\n    const userRole = (req as any).user?.role;\n    if (!userRole || !['admin', 'supervisor'].includes(userRole)) {\n      return res.status(403).json({ error: \"Admin access required\" });\n    }\n\n    const type = req.query.type as string;\n    const templates = await storage.getNotificationTemplates(type);\n    res.json(templates);\n  } catch (error) {\n    console.error(\"Failed to get templates:\", error);\n    res.status(500).json({ error: \"Failed to get templates\" });\n  }\n});\n\n/**\n * POST /api/notifications/templates - Create notification template (admin only)\n */\nrouter.post(\"/templates\", async (req, res) => {\n  try {\n    const userRole = (req as any).user?.role;\n    if (!userRole || !['admin', 'supervisor'].includes(userRole)) {\n      return res.status(403).json({ error: \"Admin access required\" });\n    }\n\n    const validatedData = insertNotificationTemplateSchema.parse(req.body);\n    const template = await storage.createNotificationTemplate(validatedData);\n    \n    res.status(201).json(template);\n  } catch (error) {\n    if (error instanceof z.ZodError) {\n      return res.status(400).json({ error: \"Invalid template data\", details: error.errors });\n    }\n    console.error(\"Failed to create template:\", error);\n    res.status(500).json({ error: \"Failed to create template\" });\n  }\n});\n\n/**\n * PUT /api/notifications/templates/:id - Update notification template (admin only)\n */\nrouter.put(\"/templates/:id\", async (req, res) => {\n  try {\n    const userRole = (req as any).user?.role;\n    if (!userRole || !['admin', 'supervisor'].includes(userRole)) {\n      return res.status(403).json({ error: \"Admin access required\" });\n    }\n\n    const templateId = parseInt(req.params.id);\n    const validatedData = insertNotificationTemplateSchema.partial().parse(req.body);\n    \n    const template = await storage.updateNotificationTemplate(templateId, validatedData);\n    res.json(template);\n  } catch (error) {\n    if (error instanceof z.ZodError) {\n      return res.status(400).json({ error: \"Invalid template data\", details: error.errors });\n    }\n    console.error(\"Failed to update template:\", error);\n    res.status(500).json({ error: \"Failed to update template\" });\n  }\n});\n\n/**\n * DELETE /api/notifications/templates/:id - Delete notification template (admin only)\n */\nrouter.delete(\"/templates/:id\", async (req, res) => {\n  try {\n    const userRole = (req as any).user?.role;\n    if (!userRole || !['admin', 'supervisor'].includes(userRole)) {\n      return res.status(403).json({ error: \"Admin access required\" });\n    }\n\n    const templateId = parseInt(req.params.id);\n    await storage.deleteNotificationTemplate(templateId);\n    \n    res.json({ success: true });\n  } catch (error) {\n    console.error(\"Failed to delete template:\", error);\n    res.status(500).json({ error: \"Failed to delete template\" });\n  }\n});\n\n// ===== SYSTEM/TESTING ENDPOINTS =====\n\n/**\n * POST /api/notifications/test-event - Test event processing (admin only)\n */\nrouter.post(\"/test-event\", async (req, res) => {\n  try {\n    const userRole = (req as any).user?.role;\n    if (!userRole || !['admin', 'supervisor'].includes(userRole)) {\n      return res.status(403).json({ error: \"Admin access required\" });\n    }\n\n    const { eventType, entityData } = req.body;\n    if (!eventType || !entityData) {\n      return res.status(400).json({ error: \"eventType and entityData are required\" });\n    }\n\n    await storage.processNotificationEvent(eventType, entityData);\n    res.json({ success: true, message: \"Event processed\" });\n  } catch (error) {\n    console.error(\"Failed to process test event:\", error);\n    res.status(500).json({ error: \"Failed to process test event\" });\n  }\n});\n\n/**\n * GET /api/notifications/stats - Get notification statistics (admin only)\n */\nrouter.get(\"/stats\", async (req, res) => {\n  try {\n    const userRole = (req as any).user?.role;\n    if (!userRole || !['admin', 'supervisor'].includes(userRole)) {\n      return res.status(403).json({ error: \"Admin access required\" });\n    }\n\n    const stats = await storage.getNotificationStats();\n    res.json(stats);\n  } catch (error) {\n    console.error(\"Failed to get notification stats:\", error);\n    res.status(500).json({ error: \"Failed to get notification stats\" });\n  }\n});\n\n/**\n * POST /api/notifications/cleanup - Cleanup expired notifications (admin only)\n */\nrouter.post(\"/cleanup\", async (req, res) => {\n  try {\n    const userRole = (req as any).user?.role;\n    if (!userRole || !['admin', 'supervisor'].includes(userRole)) {\n      return res.status(403).json({ error: \"Admin access required\" });\n    }\n\n    await storage.cleanupExpiredNotifications();\n    res.json({ success: true, message: \"Expired notifications cleaned up\" });\n  } catch (error) {\n    console.error(\"Failed to cleanup notifications:\", error);\n    res.status(500).json({ error: \"Failed to cleanup notifications\" });\n  }\n});\n\nexport default router;