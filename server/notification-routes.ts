import { Router } from "express";
import { storage } from "./storage";
import { notificationService } from "./notification-service";
import { z } from "zod";
import { insertNotificationSchema, insertNotificationTriggerSchema, insertNotificationPreferenceSchema, insertNotificationTemplateSchema } from "@shared/schema";
import { AuthenticatedRequest, requireAuth } from "./auth-middleware";

// Type-safe request after authentication - user is guaranteed to exist
type SafeAuthRequest = AuthenticatedRequest & { 
  user: { 
    id: number; 
    username: string; 
    role: string; 
    exp: number; 
  } 
};

const router = Router();

// ===== USER NOTIFICATIONS ENDPOINTS =====

/**
 * GET /api/notifications - Get user's notifications
 */
router.get("/", requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const { id: userId } = (req as SafeAuthRequest).user;
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
router.get("/unread-count", requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const { id: userId } = (req as SafeAuthRequest).user;
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
router.put("/:id/read", requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const { id: userId } = (req as SafeAuthRequest).user;
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
router.put("/mark-all-read", requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const { id: userId } = (req as SafeAuthRequest).user;
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
router.delete("/:id", requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const { id: userId } = (req as SafeAuthRequest).user;
    const notificationId = parseInt(req.params.id);
    await storage.deleteNotification(notificationId, userId);
    
    res.json({ success: true });
  } catch (error) {
    console.error("Failed to delete notification:", error);
    res.status(500).json({ error: "Failed to delete notification" });
  }
});

/**
 * POST /api/notifications - Create a notification (admin/supervisor only)
 */
router.post("/", requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const { id: userId, role } = (req as SafeAuthRequest).user;
    
    // Check admin/supervisor permissions
    if (role !== 'administrator' && role !== 'clinical_supervisor') {
      return res.status(403).json({ error: "Insufficient permissions - admin/supervisor required" });
    }

    // Validate request body
    const validatedData = insertNotificationSchema.parse(req.body);
    
    // Server determines the target user - prevent privilege escalation
    const finalNotificationData = {
      ...validatedData,
      // Only administrators can create notifications for other users
      userId: role === 'administrator' ? validatedData.userId || userId : userId
    };

    const notification = await storage.createNotification(finalNotificationData);
    
    res.status(201).json(notification);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Invalid notification data", details: error.errors });
    }
    console.error("Failed to create notification:", error);
    res.status(500).json({ error: "Failed to create notification" });
  }
});

// ===== USER PREFERENCES ENDPOINTS =====

/**
 * GET /api/notifications/preferences - Get user's notification preferences
 */
router.get("/preferences", requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const { id: userId } = (req as SafeAuthRequest).user;
    const preferences = await storage.getUserNotificationPreferences(userId);
    res.json(preferences);
  } catch (error) {
    console.error("Failed to get user preferences:", error);
    res.status(500).json({ error: "Failed to get user preferences" });
  }
});

/**
 * PUT /api/notifications/preferences/:triggerType - Set user notification preference
 */
router.put("/preferences/:triggerType", requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const { id: userId } = (req as SafeAuthRequest).user;
    const triggerType = req.params.triggerType;
    const validatedData = insertNotificationPreferenceSchema.partial().parse(req.body);
    
    const preference = await storage.setUserNotificationPreference(userId, triggerType, validatedData);
    res.json(preference);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Invalid preference data", details: error.errors });
    }
    console.error("Failed to set user preference:", error);
    res.status(500).json({ error: "Failed to set user preference" });
  }
});

// ===== ADMIN/TRIGGER MANAGEMENT ENDPOINTS =====

/**
 * GET /api/notifications/triggers - Get notification triggers (admin/supervisor only)
 */
router.get("/triggers", requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const { role } = (req as SafeAuthRequest).user;
    
    // Check admin/supervisor permissions
    if (role !== 'administrator' && role !== 'clinical_supervisor') {
      return res.status(403).json({ error: "Admin/supervisor access required" });
    }

    const eventType = req.query.eventType as string;
    const triggers = await storage.getNotificationTriggers(eventType);
    res.json(triggers);
  } catch (error) {
    console.error("Failed to get triggers:", error);
    res.status(500).json({ error: "Failed to get triggers" });
  }
});

/**
 * POST /api/notifications/triggers - Create notification trigger (admin only)
 */
router.post("/triggers", requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const { role } = (req as SafeAuthRequest).user;
    
    if (role !== 'administrator' && role !== 'clinical_supervisor') {
      return res.status(403).json({ error: "Admin/supervisor access required" });
    }

    const validatedData = insertNotificationTriggerSchema.parse(req.body);
    const trigger = await storage.createNotificationTrigger(validatedData);
    
    res.status(201).json(trigger);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Invalid trigger data", details: error.errors });
    }

    res.status(500).json({ error: "Failed to create trigger" });
  }
});

/**
 * PUT /api/notifications/triggers/:id - Update notification trigger (admin only)
 */
router.put("/triggers/:id", requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const { role } = (req as SafeAuthRequest).user;
    
    if (role !== 'administrator' && role !== 'clinical_supervisor') {
      return res.status(403).json({ error: "Admin/supervisor access required" });
    }

    const triggerId = parseInt(req.params.id);
    const validatedData = insertNotificationTriggerSchema.partial().parse(req.body);
    
    const trigger = await storage.updateNotificationTrigger(triggerId, validatedData);
    res.json(trigger);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Invalid trigger data", details: error.errors });
    }

    res.status(500).json({ error: "Failed to update trigger" });
  }
});

/**
 * DELETE /api/notifications/triggers/:id - Delete notification trigger (admin only)
 */
router.delete("/triggers/:id", requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const { role } = (req as SafeAuthRequest).user;
    
    if (role !== 'administrator' && role !== 'clinical_supervisor') {
      return res.status(403).json({ error: "Admin/supervisor access required" });
    }

    const triggerId = parseInt(req.params.id);
    await storage.deleteNotificationTrigger(triggerId);
    
    res.json({ success: true });
  } catch (error) {

    res.status(500).json({ error: "Failed to delete trigger" });
  }
});

// ===== TEMPLATE MANAGEMENT ENDPOINTS =====

/**
 * GET /api/notifications/templates - Get notification templates (public access for viewing)
 */
router.get("/templates", async (req, res) => {
  try {
    const type = req.query.type as string;
    const templates = await storage.getNotificationTemplates(type);
    res.json(templates);
  } catch (error) {

    res.status(500).json({ error: "Failed to get templates" });
  }
});

/**
 * POST /api/notifications/templates - Create notification template (admin only)
 */
router.post("/templates", requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const { role } = (req as SafeAuthRequest).user;
    
    if (role !== 'administrator' && role !== 'clinical_supervisor') {
      return res.status(403).json({ error: "Admin/supervisor access required" });
    }

    const validatedData = insertNotificationTemplateSchema.parse(req.body);
    const template = await storage.createNotificationTemplate(validatedData);
    
    res.status(201).json(template);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Invalid template data", details: error.errors });
    }

    res.status(500).json({ error: "Failed to create template" });
  }
});

/**
 * PUT /api/notifications/templates/:id - Update notification template (admin only for now)
 */
router.put("/templates/:id", requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const { role } = (req as SafeAuthRequest).user;
    
    if (role !== 'administrator' && role !== 'clinical_supervisor') {
      return res.status(403).json({ error: "Admin/supervisor access required" });
    }

    const templateId = parseInt(req.params.id);
    const validatedData = insertNotificationTemplateSchema.partial().parse(req.body);
    
    const template = await storage.updateNotificationTemplate(templateId, validatedData);
    res.json(template);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Invalid template data", details: error.errors });
    }

    res.status(500).json({ error: "Failed to update template" });
  }
});

/**
 * DELETE /api/notifications/templates/:id - Delete notification template (admin only)
 */
router.delete("/templates/:id", requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const { role } = (req as SafeAuthRequest).user;
    
    if (role !== 'administrator' && role !== 'clinical_supervisor') {
      return res.status(403).json({ error: "Admin/supervisor access required" });
    }

    const templateId = parseInt(req.params.id);
    await storage.deleteNotificationTemplate(templateId);
    
    res.json({ success: true });
  } catch (error) {

    res.status(500).json({ error: "Failed to delete template" });
  }
});

// ===== SYSTEM/TESTING ENDPOINTS =====

/**
 * POST /api/notifications/test-event - Test event processing (admin only)
 */
router.post("/test-event", requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const { role } = (req as SafeAuthRequest).user;
    
    if (role !== 'administrator' && role !== 'clinical_supervisor') {
      return res.status(403).json({ error: "Admin/supervisor access required" });
    }

    const { eventType, entityData } = req.body;
    if (!eventType || !entityData) {
      return res.status(400).json({ error: "eventType and entityData are required" });
    }

    await storage.processNotificationEvent(eventType, entityData);
    res.json({ success: true, message: "Event processed" });
  } catch (error) {

    res.status(500).json({ error: "Failed to process test event" });
  }
});

/**
 * GET /api/notifications/stats - Get notification statistics (admin only)
 */
router.get("/stats", requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const { role } = (req as SafeAuthRequest).user;
    
    if (role !== 'administrator' && role !== 'clinical_supervisor') {
      return res.status(403).json({ error: "Admin/supervisor access required" });
    }

    const stats = await storage.getNotificationStats();
    res.json(stats);
  } catch (error) {

    res.status(500).json({ error: "Failed to get notification stats" });
  }
});

/**
 * POST /api/notifications/cleanup - Cleanup expired notifications (admin only)
 */
router.post("/cleanup", requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const { role } = (req as SafeAuthRequest).user;
    
    if (role !== 'administrator' && role !== 'clinical_supervisor') {
      return res.status(403).json({ error: "Admin/supervisor access required" });
    }

    await storage.cleanupExpiredNotifications();
    res.json({ success: true, message: "Expired notifications cleaned up" });
  } catch (error) {

    res.status(500).json({ error: "Failed to cleanup notifications" });
  }
});

export default router;