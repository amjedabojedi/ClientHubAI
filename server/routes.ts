import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { generateSessionNoteSummary, generateSmartSuggestions, generateClinicalReport } from "./ai/openai";
import { insertClientSchema, insertSessionSchema, insertTaskSchema, insertNoteSchema, insertDocumentSchema, insertSessionNoteSchema, insertLibraryCategorySchema, insertLibraryEntrySchema } from "@shared/schema";
import { z } from "zod";
import * as fs from "fs";
import * as path from "path";

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

  app.post("/api/clients/:clientId/documents", async (req, res) => {
    try {
      console.log("Document upload request:", { ...req.body, fileContent: req.body.fileContent ? `${req.body.fileContent.length} bytes` : 'no content' });
      const clientId = parseInt(req.params.clientId);
      const { fileContent, ...documentData } = req.body;
      
      const validatedData = insertDocumentSchema.parse({
        ...documentData,
        clientId,
        uploadedById: 3 // Default to first therapist for now
      });
      console.log("Validated data:", validatedData);
      
      // Create document record
      const document = await storage.createDocument(validatedData);
      console.log("Created document:", document);
      
      // Store actual file content if provided
      if (fileContent) {
        const uploadsDir = path.join(process.cwd(), 'uploads');
        if (!fs.existsSync(uploadsDir)) {
          fs.mkdirSync(uploadsDir, { recursive: true });
        }
        
        const filePath = path.join(uploadsDir, `${document.id}-${document.fileName}`);
        const buffer = Buffer.from(fileContent, 'base64');
        fs.writeFileSync(filePath, buffer);
        
        console.log(`File stored at: ${filePath}`);
      }
      
      res.status(201).json(document);
    } catch (error) {
      if (error instanceof z.ZodError) {
        console.error("Validation error:", error.errors);
        return res.status(400).json({ message: "Invalid document data", errors: error.errors });
      }
      console.error("Error creating document:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/clients/:clientId/documents/:id/preview", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const clientId = parseInt(req.params.clientId);
      
      // Get document info from database
      const documents = await storage.getDocumentsByClient(clientId);
      const document = documents.find(doc => doc.id === id);
      
      if (!document) {
        return res.status(404).json({ message: "Document not found" });
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
            console.log(`Serving PDF file for preview: ${filePath}`);
            
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
          console.error('Error processing PDF:', error);
          res.status(500).json({ error: 'Failed to process PDF content: ' + error.message });
        }
      } else if (isImage) {
        // For images, show image icon preview
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
            <text x="200" y="285" text-anchor="middle" font-family="Arial, sans-serif" font-size="10" fill="#6b7280">${Math.round(document.fileSize / 1024)} KB • Image</text>
          </svg>
        `);
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
      console.error("Error getting document preview:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Serve PDF file directly
  app.get("/api/clients/:clientId/documents/:id/file", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const clientId = parseInt(req.params.clientId);
      
      // Get document info from database
      const documents = await storage.getDocumentsByClient(clientId);
      const document = documents.find(doc => doc.id === id);
      
      if (!document) {
        return res.status(404).json({ message: "Document not found" });
      }
      
      const filePath = path.join(process.cwd(), 'uploads', `${document.id}-${document.fileName}`);
      
      if (fs.existsSync(filePath)) {
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename="${document.fileName}"`);
        res.sendFile(path.resolve(filePath));
      } else {
        res.status(404).json({ message: "File not found on server" });
      }
    } catch (error) {
      console.error('Error serving PDF file:', error);
      res.status(500).json({ message: "Error serving PDF file" });
    }
  });

  app.get("/api/clients/:clientId/documents/:id/download", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const clientId = parseInt(req.params.clientId);
      
      // Get document info from database
      const documents = await storage.getDocumentsByClient(clientId);
      const document = documents.find(doc => doc.id === id);
      
      if (!document) {
        return res.status(404).json({ message: "Document not found" });
      }
      
      // In a real implementation, you would serve the actual file from storage
      // For now, return a placeholder response
      res.setHeader('Content-Type', document.mimeType || 'application/octet-stream');
      res.setHeader('Content-Disposition', `attachment; filename="${document.fileName}"`);
      res.send(`This is a placeholder for the document: ${document.fileName}`);
    } catch (error) {
      console.error("Error downloading document:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.delete("/api/clients/:clientId/documents/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      await storage.deleteDocument(id);
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting document:", error);
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
      const sessionData = sessionId ? (await storage.getSessionsByClient(clientId)).find(s => s.id === sessionId) : null;
      
      const { generateAITemplate } = await import("./ai/openai");
      const result = await generateAITemplate(clientData, sessionData, formData, customInstructions);
      
      res.json(result);
    } catch (error) {
      console.error('AI template generation error:', error);
      res.status(500).json({ error: "Failed to generate AI template: " + error.message });
    }
  });

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

  // Library entry connections routes
  app.get("/api/library/connections", async (req, res) => {
    try {
      const entryId = req.query.entryId ? parseInt(req.query.entryId as string) : undefined;
      const connections = await storage.getLibraryEntryConnections(entryId);
      res.json(connections);
    } catch (error) {
      console.error("Error fetching library connections:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/library/entries/:id/connected", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const connectedEntries = await storage.getConnectedEntries(id);
      res.json(connectedEntries);
    } catch (error) {
      console.error("Error fetching connected entries:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post("/api/library/connections", async (req, res) => {
    try {
      const connection = await storage.createLibraryEntryConnection(req.body);
      res.status(201).json(connection);
    } catch (error) {
      console.error("Error creating library connection:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.put("/api/library/connections/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const connection = await storage.updateLibraryEntryConnection(id, req.body);
      res.json(connection);
    } catch (error) {
      console.error("Error updating library connection:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.delete("/api/library/connections/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      await storage.deleteLibraryEntryConnection(id);
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting library connection:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}
