import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { generateSessionNoteSummary, generateSmartSuggestions, generateClinicalReport } from "./ai/openai";
import { insertClientSchema, insertSessionSchema, insertTaskSchema, insertNoteSchema, insertSessionNoteSchema, insertLibraryCategorySchema, insertLibraryEntrySchema } from "@shared/schema";
import { z } from "zod";

export async function registerRoutes(app: Express): Promise<Server> {
  // Client routes
  app.get("/api/clients", async (req, res) => {
    try {
      const {
        page = "1",
        pageSize = "25",
        search,
        status,
        therapistId,
        clientType,
        hasPortalAccess,
        hasPendingTasks,
        sortBy = "createdAt",
        sortOrder = "desc"
      } = req.query;

      const params = {
        page: parseInt(page as string),
        pageSize: parseInt(pageSize as string),
        search: search as string,
        status: status as string,
        therapistId: therapistId ? parseInt(therapistId as string) : undefined,
        clientType: clientType as string,
        hasPortalAccess: hasPortalAccess === "true" ? true : hasPortalAccess === "false" ? false : undefined,
        hasPendingTasks: hasPendingTasks === "true" ? true : hasPendingTasks === "false" ? false : undefined,
        sortBy: sortBy as string,
        sortOrder: sortOrder as "asc" | "desc"
      };

      const result = await storage.getClients(params);
      res.json(result);
    } catch (error) {
      console.error("Error fetching clients:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Client stats - moved before the :id route to avoid conflicts
  app.get("/api/clients/stats", async (req, res) => {
    try {
      const stats = await storage.getClientStats();
      res.json(stats);
    } catch (error) {
      console.error("Error fetching client stats:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/clients/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid client ID" });
      }
      
      const client = await storage.getClient(id);
      
      if (!client) {
        return res.status(404).json({ message: "Client not found" });
      }
      
      res.json(client);
    } catch (error) {
      console.error("Error fetching client:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post("/api/clients", async (req, res) => {
    try {
      const validatedData = insertClientSchema.parse(req.body);
      const client = await storage.createClient(validatedData);
      res.status(201).json(client);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid client data", errors: error.errors });
      }
      console.error("Error creating client:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.put("/api/clients/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const validatedData = insertClientSchema.partial().parse(req.body);
      const client = await storage.updateClient(id, validatedData);
      res.json(client);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid client data", errors: error.errors });
      }
      console.error("Error updating client:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.delete("/api/clients/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      await storage.deleteClient(id);
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting client:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Sessions routes
  app.get("/api/sessions", async (req, res) => {
    try {
      // Get all sessions with date filtering if provided
      const { date, viewMode } = req.query;
      // For now, return all sessions - this can be enhanced with date filtering
      const sessions = await storage.getAllSessions();
      res.json(sessions);
    } catch (error) {
      console.error("Error fetching sessions:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post("/api/sessions", async (req, res) => {
    try {
      const validatedData = insertSessionSchema.parse(req.body);
      const session = await storage.createSession(validatedData);
      res.status(201).json(session);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid session data", errors: error.errors });
      }
      console.error("Error creating session:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/clients/:clientId/sessions", async (req, res) => {
    try {
      const clientId = parseInt(req.params.clientId);
      const sessions = await storage.getSessionsByClient(clientId);
      res.json(sessions);
    } catch (error) {
      console.error("Error fetching sessions:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post("/api/sessions", async (req, res) => {
    try {
      const validatedData = insertSessionSchema.parse(req.body);
      const session = await storage.createSession(validatedData);
      res.status(201).json(session);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid session data", errors: error.errors });
      }
      console.error("Error creating session:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Tasks routes
  app.get("/api/clients/:clientId/tasks", async (req, res) => {
    try {
      const clientId = parseInt(req.params.clientId);
      const tasks = await storage.getTasksByClient(clientId);
      res.json(tasks);
    } catch (error) {
      console.error("Error fetching tasks:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post("/api/tasks", async (req, res) => {
    try {
      const validatedData = insertTaskSchema.parse(req.body);
      const task = await storage.createTask(validatedData);
      res.status(201).json(task);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid task data", errors: error.errors });
      }
      console.error("Error creating task:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.put("/api/tasks/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const validatedData = insertTaskSchema.partial().parse(req.body);
      const task = await storage.updateTask(id, validatedData);
      res.json(task);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid task data", errors: error.errors });
      }
      console.error("Error updating task:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Notes routes
  app.get("/api/clients/:clientId/notes", async (req, res) => {
    try {
      const clientId = parseInt(req.params.clientId);
      const notes = await storage.getNotesByClient(clientId);
      res.json(notes);
    } catch (error) {
      console.error("Error fetching notes:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post("/api/notes", async (req, res) => {
    try {
      const validatedData = insertNoteSchema.parse(req.body);
      const note = await storage.createNote(validatedData);
      res.status(201).json(note);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid note data", errors: error.errors });
      }
      console.error("Error creating note:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Documents routes
  app.get("/api/clients/:clientId/documents", async (req, res) => {
    try {
      const clientId = parseInt(req.params.clientId);
      const documents = await storage.getDocumentsByClient(clientId);
      res.json(documents);
    } catch (error) {
      console.error("Error fetching documents:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Therapists route
  app.get("/api/therapists", async (req, res) => {
    try {
      const therapists = await storage.getAllTherapists();
      res.json(therapists);
    } catch (error) {
      console.error("Error fetching therapists:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Pending tasks count
  app.get("/api/tasks/pending/count", async (req, res) => {
    try {
      const count = await storage.getPendingTasksCount();
      res.json({ count });
    } catch (error) {
      console.error("Error fetching pending tasks count:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Session Notes routes
  app.get("/api/sessions/:sessionId/notes", async (req, res) => {
    try {
      const sessionId = parseInt(req.params.sessionId);
      const sessionNotes = await storage.getSessionNotesBySession(sessionId);
      res.json(sessionNotes);
    } catch (error) {
      console.error("Error fetching session notes:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/clients/:clientId/session-notes", async (req, res) => {
    try {
      const clientId = parseInt(req.params.clientId);
      const sessionNotes = await storage.getSessionNotesByClient(clientId);
      res.json(sessionNotes);
    } catch (error) {
      console.error("Error fetching client session notes:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/session-notes/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const sessionNote = await storage.getSessionNote(id);
      
      if (!sessionNote) {
        return res.status(404).json({ message: "Session note not found" });
      }
      
      res.json(sessionNote);
    } catch (error) {
      console.error("Error fetching session note:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post("/api/session-notes", async (req, res) => {
    try {
      const validatedData = insertSessionNoteSchema.parse(req.body);
      const sessionNote = await storage.createSessionNote(validatedData);
      
      // Generate AI content if enabled
      if (validatedData.aiEnabled && process.env.OPENAI_API_KEY) {
        try {
          // Update status to processing
          await storage.updateSessionNote(sessionNote.id, { aiProcessingStatus: 'processing' });
          
          const aiContent = await generateSessionNoteSummary({
            sessionFocus: validatedData.sessionFocus,
            symptoms: validatedData.symptoms,
            shortTermGoals: validatedData.shortTermGoals,
            intervention: validatedData.intervention,
            progress: validatedData.progress,
            remarks: validatedData.remarks,
            recommendations: validatedData.recommendations,
            moodBefore: validatedData.moodBefore,
            moodAfter: validatedData.moodAfter,
            customPrompt: validatedData.customAiPrompt,
            sessionType: 'therapy session'
          });
          
          // Update with generated content
          await storage.updateSessionNote(sessionNote.id, {
            generatedContent: aiContent.generatedContent,
            draftContent: aiContent.generatedContent,
            aiProcessingStatus: 'completed'
          });
        } catch (aiError) {
          console.error('AI generation failed:', aiError);
          await storage.updateSessionNote(sessionNote.id, { aiProcessingStatus: 'error' });
        }
      }
      
      res.status(201).json(sessionNote);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid session note data", errors: error.errors });
      }
      console.error("Error creating session note:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.put("/api/session-notes/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const validatedData = insertSessionNoteSchema.partial().parse(req.body);
      const sessionNote = await storage.updateSessionNote(id, validatedData);
      res.json(sessionNote);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid session note data", errors: error.errors });
      }
      console.error("Error updating session note:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.delete("/api/session-notes/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      await storage.deleteSessionNote(id);
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting session note:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // AI-powered routes
  app.get("/api/ai/templates", async (req, res) => {
    try {
      const { getAllTemplates } = await import("./ai/openai");
      const templates = getAllTemplates();
      res.json({ templates });
    } catch (error) {
      console.error('Templates error:', error);
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
      console.error('Template generation error:', error);
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
      console.error('Field options error:', error);
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
      console.error('Connected suggestions error:', error);
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
      console.error('Smart suggestions error:', error);
      res.status(500).json({ error: "Failed to generate suggestions" });
    }
  });

  app.post("/api/ai/generate-clinical-report", async (req, res) => {
    try {
      const sessionNoteData = req.body;
      
      if (!process.env.OPENAI_API_KEY) {
        return res.status(503).json({ error: "AI features not available" });
      }
      
      const report = await generateClinicalReport(sessionNoteData);
      res.json({ report });
    } catch (error) {
      console.error('Clinical report generation error:', error);
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
        sessionFocus: sessionNote.sessionFocus,
        symptoms: sessionNote.symptoms,
        shortTermGoals: sessionNote.shortTermGoals,
        intervention: sessionNote.intervention,
        progress: sessionNote.progress,
        remarks: sessionNote.remarks,
        recommendations: sessionNote.recommendations,
        moodBefore: sessionNote.moodBefore,
        moodAfter: sessionNote.moodAfter,
        customPrompt: customPrompt || sessionNote.customAiPrompt,
        sessionType: sessionNote.session?.sessionType || 'therapy session'
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
      console.error('AI regeneration error:', error);
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
      console.error("Error fetching library categories:", error);
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
      console.error("Error fetching library category:", error);
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
      console.error("Error creating library category:", error);
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
      console.error("Error updating library category:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.delete("/api/library/categories/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      await storage.deleteLibraryCategory(id);
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting library category:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/library/entries", async (req, res) => {
    try {
      const categoryId = req.query.categoryId ? parseInt(req.query.categoryId as string) : undefined;
      const entries = await storage.getLibraryEntries(categoryId);
      res.json(entries);
    } catch (error) {
      console.error("Error fetching library entries:", error);
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
      console.error("Error fetching library entry:", error);
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
      console.error("Error creating library entry:", error);
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
      console.error("Error updating library entry:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.delete("/api/library/entries/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      await storage.deleteLibraryEntry(id);
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting library entry:", error);
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
      console.error("Error searching library entries:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post("/api/library/entries/:id/increment-usage", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      await storage.incrementLibraryEntryUsage(id);
      res.status(204).send();
    } catch (error) {
      console.error("Error incrementing library entry usage:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}
