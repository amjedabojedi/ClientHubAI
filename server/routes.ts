// Core Express and Node.js
import type { Express } from "express";
import { createServer, type Server } from "http";
import * as fs from "fs";
import * as path from "path";
import multer from "multer";

// Validation
import { z } from "zod";

// Internal Services
import { storage } from "./storage";
import { generateSessionNoteSummary, generateSmartSuggestions, generateClinicalReport } from "./ai/openai";
import notificationRoutes from "./notification-routes";
import { db } from "./db";
import { users } from "@shared/schema";
import { eq } from "drizzle-orm";

// Database Schemas
import { 
  insertClientSchema, 
  insertUserSchema,
  insertUserProfileSchema,
  insertSupervisorAssignmentSchema,
  insertUserActivityLogSchema,
  insertSessionSchema, 
  insertTaskSchema, 
  insertTaskCommentSchema,
  insertNoteSchema, 
  insertDocumentSchema, 
  insertSessionNoteSchema, 
  insertLibraryCategorySchema, 
  insertLibraryEntrySchema, 
  insertAssessmentTemplateSchema, 
  insertAssessmentSectionSchema, 
  insertAssessmentQuestionSchema, 
  insertAssessmentQuestionOptionSchema, 
  insertAssessmentAssignmentSchema, 
  insertAssessmentResponseSchema, 
  insertAssessmentReportSchema,
  insertServiceSchema,
  insertRoomSchema,
  insertRoomBookingSchema,
  insertSessionBillingSchema,
  insertRoleSchema,
  insertPermissionSchema,
  insertRolePermissionSchema,
  insertOptionCategorySchema,
  insertSystemOptionSchema
} from "@shared/schema";

// Helper function to generate unique client ID
async function generateClientId(): Promise<string> {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  
  // Get count of clients created this month to generate sequential ID
  const count = await storage.getClientCountByMonth(year, parseInt(month));
  const sequentialId = String(count + 1).padStart(4, '0');
  
  return `CL-${year}-${sequentialId}`;
}

export async function registerRoutes(app: Express): Promise<Server> {
  // Authentication routes
  app.post("/api/auth/login", async (req, res) => {
    try {
      const { username, password } = req.body;
      
      if (!username || !password) {
        return res.status(400).json({ error: "Username and password are required" });
      }

      // Simple authentication for demo purposes
      // TODO: In production, implement proper password hashing with bcrypt
      const users = await storage.getUsers();
      const user = users.find(u => u.username === username);
      
      if (!user || password !== user.password) {
        return res.status(401).json({ error: "Invalid credentials" });
      }

      // Return user data without password
      const { password: _, ...userWithoutPassword } = user;

      res.json(userWithoutPassword);
    } catch (error) {
      // Error logged
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Client routes with role-based access control
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
        hasNoSessions,
        sortBy = "createdAt",
        sortOrder = "desc",
        currentUserId,
        currentUserRole
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
        hasNoSessions: hasNoSessions === "true" ? true : hasNoSessions === "false" ? false : undefined,
        sortBy: sortBy as string,
        sortOrder: sortOrder as "asc" | "desc"
      };

      // Role-based access control
      if (currentUserRole === "supervisor" && currentUserId) {
        const userId = parseInt(currentUserId as string);
        // Get therapists supervised by this supervisor
        const supervisorAssignments = await storage.getSupervisorAssignments(userId);
        const supervisedTherapistIds = supervisorAssignments.map(assignment => assignment.therapistId);
        
        if (supervisedTherapistIds.length === 0) {
          // Supervisor has no assigned therapists, return empty result
          return res.json({ clients: [], totalCount: 0, page: 1, pageSize: 25, totalPages: 0 });
        }
        
        // Filter clients to only those assigned to supervised therapists
        (params as any).supervisedTherapistIds = supervisedTherapistIds;
      } else if (currentUserRole === "therapist" && currentUserId) {
        // Therapists can only see their own clients
        params.therapistId = parseInt(currentUserId as string);
      }
      // Admins can see all clients (no filtering needed)

      const result = await storage.getClients(params);
      res.json(result);
    } catch (error) {

      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Client stats - moved before the :id route to avoid conflicts
  app.get("/api/clients/stats", async (req, res) => {
    try {
      const stats = await storage.getClientStats();
      res.json(stats);
    } catch (error) {
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Client export endpoint - moved before the :id route to avoid conflicts  
  app.get("/api/clients/export", async (req, res) => {
    try {
      const allClients = await storage.getAllClientsForExport();
      
      // Set CSV headers
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename="clients_export.csv"');
      
      // Create CSV header
      const csvHeader = [
        'Client ID', 'Full Name', 'Email', 'Phone', 'Date of Birth', 'Gender',
        'Address', 'Postal Code', 'Emergency Contact', 'Emergency Contact Phone',
        'Status', 'Stage', 'Client Type', 'Start Date', 'Assigned Therapist',
        'Insurance Provider', 'Policy Number', 'Copay Amount', 'Deductible',
        'Referral Source', 'Referral Date', 'Reference Number', 'Has Portal Access',
        'Email Notifications', 'Created At'
      ].join(',') + '\n';
      
      // Create CSV rows
      const csvRows = allClients.map(client => [
        client.clientId || '',
        `"${client.fullName || ''}"`,
        client.email || '',
        client.phone || '',
        client.dateOfBirth || '',
        client.gender || '',
        `"${client.address || ''}"`,
        client.postalCode || '',
        `"${client.emergencyContactName || ''}"`,
        client.emergencyContactPhone || '',
        client.status || '',
        client.stage || '',
        client.clientType || '',
        client.startDate || '',
        client.assignedTherapist || '',
        client.insuranceProvider || '',
        client.policyNumber || '',
        client.copayAmount || '',
        client.deductible || '',
        client.referralSource || '',
        client.referralDate || '',
        client.referenceNumber || '',
        client.hasPortalAccess ? 'true' : 'false',
        client.emailNotifications ? 'true' : 'false',
        client.createdAt ? new Date(client.createdAt).toISOString().split('T')[0] : ''
      ].join(','));
      
      const csvContent = csvHeader + csvRows.join('\n');
      res.send(csvContent);
    } catch (error) {
      res.status(500).json({ message: "Failed to export clients" });
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
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post("/api/clients", async (req, res) => {
    try {
      const clientData = { ...req.body };
      delete clientData.id; // Remove any id field if present
      
      // Clean up empty strings to undefined to prevent PostgreSQL date errors
      Object.keys(clientData).forEach(key => {
        if (clientData[key] === "" || clientData[key] === null) {
          clientData[key] = undefined;
        }
      });
      
      const validatedData = insertClientSchema.parse(clientData);
      
      const client = await storage.createClient(validatedData);
      res.status(201).json(client);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid client data", errors: error.errors });
      }
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.put("/api/clients/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      
      const clientData = { ...req.body };
      // Clean up empty strings to undefined to prevent PostgreSQL date errors
      Object.keys(clientData).forEach(key => {
        if (clientData[key] === "" || clientData[key] === null) {
          clientData[key] = undefined;
        }
      });
      
      const validatedData = insertClientSchema.partial().parse(clientData);
      const client = await storage.updateClient(id, validatedData);
      res.json(client);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid client data", errors: error.errors });
      }
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.delete("/api/clients/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid client ID" });
      }
      
      await storage.deleteClient(id);
      res.status(204).send();
    } catch (error: any) {

      res.status(500).json({ 
        message: "Failed to delete client. Client may have related records (sessions, tasks, documents, etc.)",
        details: error.message 
      });
    }
  });



  // Session bulk upload endpoint - OPTIMIZED VERSION
  app.post("/api/sessions/bulk-upload", async (req, res) => {
    try {
      const { sessions } = req.body;
      
      if (!Array.isArray(sessions)) {
        return res.status(400).json({ message: "Invalid input: sessions must be an array" });
      }

      const results = {
        total: sessions.length,
        successful: 0,
        failed: 0,
        errors: [] as any[]
      };

      // OPTIMIZATION: Pre-fetch all lookup data to avoid repeated database calls
      
      // Get all clients and create clientId -> client mapping
      const allClients = await storage.getAllClientsForExport();
      const clientLookup = new Map<string, any>();
      allClients.forEach((client: any) => {
        if (client.clientId) {
          clientLookup.set(client.clientId.trim(), client);
        }
      });
      
      // Get all users and create username -> user mapping for therapists
      const allUsers = await storage.getUsers();
      const therapistLookup = new Map<string, any>();
      allUsers.forEach((user: any) => {
        if (user.username) {
          therapistLookup.set(user.username.trim(), user);
        }
      });
      
      // Get all services and create code -> service mapping
      const allServices = await storage.getServices();
      const serviceLookup = new Map<string, any>();
      allServices.forEach((service: any) => {
        if (service.serviceCode) {
          serviceLookup.set(service.serviceCode.trim(), service);
        }
      });
      
      // Get all rooms and create number -> room mapping
      const allRooms = await storage.getRooms();
      const roomLookup = new Map<string, any>();
      allRooms.forEach((room: any) => {
        if (room.roomNumber) {
          roomLookup.set(room.roomNumber.trim(), room);
        }
      });
      
      
      // Process sessions in batches for better performance
      const BATCH_SIZE = 100;
      const validatedSessions = [];
      
      for (let i = 0; i < sessions.length; i++) {
        const sessionData = sessions[i];
        
        try {
          // Clean and prepare session data using cached lookups
          const cleanData: any = {};

          // Handle required fields - clean and normalize client ID
          if (!sessionData.clientId || sessionData.clientId.trim() === '') {
            throw new Error('Client ID is required');
          }
          
          // Clean client ID and lookup using cache
          const cleanClientId = sessionData.clientId.trim();
          const client = clientLookup.get(cleanClientId);
          if (!client) {
            throw new Error(`Client with ID '${cleanClientId}' not found`);
          }
          cleanData.clientId = client.id;

          // Handle therapist using cached lookup
          if (sessionData.therapistUsername && sessionData.therapistUsername.trim() !== '') {
            const therapist = therapistLookup.get(sessionData.therapistUsername.trim());
            if (!therapist) {
              throw new Error(`Therapist with username '${sessionData.therapistUsername}' not found`);
            }
            cleanData.therapistId = therapist.id;
          } else if (client.assignedTherapistId) {
            cleanData.therapistId = client.assignedTherapistId;
          } else {
            cleanData.therapistId = null;
          }

          // Handle date and time
          if (!sessionData.sessionDate) {
            throw new Error('Session date is required');
          }
          
          // Convert Excel serial date to proper date format
          let sessionDateTime;
          const rawDate = sessionData.sessionDate;
          
          // Check if it's an Excel serial number (typically > 1000 for recent dates)
          if (typeof rawDate === 'number' && rawDate > 1000) {
            // Excel serial date conversion (days since January 1, 1900)
            // Excel treats 1900 as a leap year (it wasn't), so we adjust
            const excelEpoch = new Date(1899, 11, 30); // December 30, 1899 (Excel day 0)
            const dateFromSerial = new Date(excelEpoch.getTime() + rawDate * 24 * 60 * 60 * 1000);
            
            if (sessionData.sessionTime && sessionData.sessionTime.trim() !== '') {
              // Combine with time
              const timeStr = sessionData.sessionTime.includes(':') ? sessionData.sessionTime : `${sessionData.sessionTime}:00`;
              sessionDateTime = new Date(`${dateFromSerial.toISOString().split('T')[0]}T${timeStr}:00`);
            } else {
              // Default to start of day in UTC
              sessionDateTime = new Date(`${dateFromSerial.toISOString().split('T')[0]}T00:00:00Z`);
            }
          } else if (typeof rawDate === 'string') {
            // Handle string dates
            const cleanDate = rawDate.trim();
            
            // Check if it's already in YYYY-MM-DD format (preferred)
            if (/^\d{4}-\d{2}-\d{2}$/.test(cleanDate)) {
              if (sessionData.sessionTime && sessionData.sessionTime.trim() !== '') {
                const timeStr = sessionData.sessionTime.includes(':') ? sessionData.sessionTime : `${sessionData.sessionTime}:00`;
                sessionDateTime = new Date(`${cleanDate}T${timeStr}:00Z`);
              } else {
                // Force UTC to prevent timezone shifts for date-only entries
                sessionDateTime = new Date(`${cleanDate}T00:00:00Z`);
              }
            }
            // Check if it's MM/DD/YY format and convert to proper format
            else if (/^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(cleanDate)) {
              const [month, day, year] = cleanDate.split('/');
              const fullYear = year.length === 2 ? (parseInt(year) < 50 ? `20${year}` : `19${year}`) : year;
              
              if (sessionData.sessionTime && sessionData.sessionTime.trim() !== '') {
                const timeStr = sessionData.sessionTime.includes(':') ? sessionData.sessionTime : `${sessionData.sessionTime}:00`;
                sessionDateTime = new Date(`${month}/${day}/${fullYear} ${timeStr}`);
              } else {
                sessionDateTime = new Date(`${month}/${day}/${fullYear}`);
              }
            } else {
              // Try parsing as-is for other formats
              if (sessionData.sessionTime && sessionData.sessionTime.trim() !== '') {
                sessionDateTime = new Date(`${cleanDate}T${sessionData.sessionTime}:00`);
              } else {
                sessionDateTime = new Date(`${cleanDate}T00:00:00`);
              }
            }
          } else {
            throw new Error('Invalid session date format');
          }
          
          if (isNaN(sessionDateTime.getTime())) {
            throw new Error('Invalid session date and time');
          }
          
          cleanData.sessionDate = sessionDateTime;

          // Handle session type - normalize case
          if (!sessionData.sessionType) {
            throw new Error('Session type is required');
          }
          const cleanSessionType = sessionData.sessionType.trim().toLowerCase();
          const validSessionTypes = ['assessment', 'psychotherapy', 'consultation'];
          if (!validSessionTypes.includes(cleanSessionType)) {
            throw new Error(`Invalid session type '${sessionData.sessionType}'. Must be one of: assessment, psychotherapy, consultation`);
          }
          cleanData.sessionType = cleanSessionType;

          // Look up service using cached lookup
          if (!sessionData.serviceCode) {
            throw new Error('Service code is required');
          }
          const cleanServiceCode = sessionData.serviceCode.trim();
          const service = serviceLookup.get(cleanServiceCode);
          if (!service) {
            throw new Error(`Service code '${cleanServiceCode}' not found in services`);
          }
          cleanData.serviceId = service.id;
          cleanData.calculatedRate = service.baseRate || '0.00';

          // Look up room using cached lookup
          if (!sessionData.roomNumber) {
            throw new Error('Room number is required');
          }
          const room = roomLookup.get(sessionData.roomNumber.trim());
          if (!room) {
            throw new Error(`Room with number '${sessionData.roomNumber}' not found`);
          }
          cleanData.roomId = room.id;

          // Optional fields
          if (sessionData.notes) {
            cleanData.notes = sessionData.notes;
          }

          // Handle session mode (optional)
          if (sessionData.sessionMode && sessionData.sessionMode.trim() !== '') {
            const cleanSessionMode = sessionData.sessionMode.trim().toLowerCase().replace('-', '_');
            const validSessionModes = ['in_person', 'virtual', 'phone'];
            if (validSessionModes.includes(cleanSessionMode)) {
              cleanData.sessionMode = cleanSessionMode;
            } else {
              cleanData.sessionMode = 'in_person'; // Default if invalid
            }
          } else {
            cleanData.sessionMode = 'in_person'; // Default mode
          }

          // Handle session status
          if (sessionData.status && sessionData.status.trim() !== '') {
            const cleanStatus = sessionData.status.trim().toLowerCase();
            const validStatuses = ['scheduled', 'completed', 'cancelled', 'no_show', 'rescheduled'];
            if (validStatuses.includes(cleanStatus)) {
              cleanData.status = cleanStatus;
            } else {
              cleanData.status = 'scheduled'; // Default if invalid
            }
          } else {
            cleanData.status = 'scheduled'; // Default status
          }

          // Validate session data
          const validatedData = insertSessionSchema.parse(cleanData);
          validatedSessions.push({ data: validatedData, rowIndex: i });
          
        } catch (error) {
          results.failed++;
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';

          results.errors.push({
            row: i + 1,
            data: sessionData,
            message: errorMessage
          });
        }
      }
      
      // OPTIMIZATION: Bulk insert validated sessions in batches
      
      for (let batchStart = 0; batchStart < validatedSessions.length; batchStart += BATCH_SIZE) {
        const batchEnd = Math.min(batchStart + BATCH_SIZE, validatedSessions.length);
        const batch = validatedSessions.slice(batchStart, batchEnd);
        
        try {
          // Extract just the session data for bulk insert
          const sessionDataBatch = batch.map(item => item.data);
          await storage.createSessionsBulk(sessionDataBatch);
          results.successful += batch.length;
        } catch (error) {
          // If batch fails, try individual inserts to identify specific failures
          
          for (const item of batch) {
            try {
              await storage.createSession(item.data);
              results.successful++;
            } catch (individualError) {
              results.failed++;
              const errorMessage = individualError instanceof Error ? individualError.message : 'Unknown error';
              results.errors.push({
                row: item.rowIndex + 1,
                data: sessions[item.rowIndex],
                message: errorMessage
              });
            }
          }
        }
      }
      
      res.json(results);
    } catch (error: any) {
      res.status(500).json({ 
        message: "Session bulk upload failed", 
        details: error.message || "Internal server error" 
      });
    }
  });

  // Bulk upload endpoint
  app.post("/api/clients/bulk-upload", async (req, res) => {
    try {
      const { clients } = req.body;
      
      if (!Array.isArray(clients)) {
        return res.status(400).json({ message: "Invalid input: clients must be an array" });
      }

      const results = {
        total: clients.length,
        successful: 0,
        failed: 0,
        errors: [] as any[]
      };

      for (let i = 0; i < clients.length; i++) {
        const clientData = clients[i];
        
        try {
          // Clean and prepare client data - only keep non-empty values
          const cleanData: any = {
            // Required field
            fullName: clientData.fullName || '',
            // Generate unique client ID if not provided
            clientId: clientData.clientId || await generateClientId(),
          };

          // Only add fields that have actual values (not null, undefined, or empty strings)
          Object.keys(clientData).forEach(key => {
            if (key !== 'fullName' && key !== 'clientId' && clientData[key] != null && clientData[key] !== '') {
              let value = clientData[key];
              
              // Handle therapist assignment by username
              if (key === 'assignedTherapist') {
                // Look up therapist by username and get their ID
                // This will be handled after the loop
                cleanData['_therapistUsername'] = value;
              }
              // Handle gender field - convert uppercase to lowercase
              else if (key === 'gender') {
                const genderValue = String(value).toLowerCase();
                if (['male', 'female', 'non_binary', 'prefer_not_to_say'].includes(genderValue)) {
                  cleanData[key] = genderValue;
                }
              }
              // Handle string fields that might come as numbers from Excel
              else if (['phone', 'referenceNumber', 'emergencyContactPhone', 'postalCode', 'policyNumber'].includes(key)) {
                cleanData[key] = String(value);
              }
              // Handle date fields - convert Date objects, ISO strings, or Excel serial dates to YYYY-MM-DD format
              else if (['dateOfBirth', 'startDate', 'referralDate', 'lastSessionDate', 'nextAppointmentDate'].includes(key)) {
                if (value instanceof Date) {
                  cleanData[key] = value.toISOString().split('T')[0]; // Convert to YYYY-MM-DD format
                } else if (typeof value === 'string' && value.includes('T')) {
                  // Handle ISO date strings (like "2024-01-15T00:00:00.000Z")
                  cleanData[key] = new Date(value).toISOString().split('T')[0];
                } else if (typeof value === 'number' && value > 1) {
                  // Handle Excel serial date numbers (days since January 1, 1900)
                  // Excel considers 1900 as a leap year (which it wasn't), so we need to adjust
                  const excelEpoch = new Date(1900, 0, 1); // January 1, 1900
                  const adjustedDays = value > 59 ? value - 1 : value; // Adjust for Excel's leap year bug
                  const date = new Date(excelEpoch.getTime() + (adjustedDays - 1) * 24 * 60 * 60 * 1000);
                  cleanData[key] = date.toISOString().split('T')[0];
                } else if (typeof value === 'string') {
                  // Try to parse as a regular date string
                  const parsedDate = new Date(value);
                  if (!isNaN(parsedDate.getTime())) {
                    cleanData[key] = parsedDate.toISOString().split('T')[0];
                  } else {
                    cleanData[key] = String(value);
                  }
                } else {
                  cleanData[key] = String(value);
                }
              }
              // Handle decimal fields - Drizzle decimal fields expect strings
              else if (['copayAmount', 'deductible'].includes(key)) {
                cleanData[key] = String(parseFloat(value));
              }
              else if (['dependents', 'assignedTherapistId'].includes(key)) {
                cleanData[key] = parseInt(value);
              }
              // Handle boolean fields
              else if (['emailNotifications', 'hasPortalAccess'].includes(key)) {
                cleanData[key] = Boolean(value);
              }
              // Handle all other fields as strings
              else {
                cleanData[key] = String(value);
              }
            }
          });

          // Handle therapist assignment if provided
          if (cleanData['_therapistUsername']) {
            try {
              // Try to find therapist by username first, then by full name
              let therapist = await storage.getUserByUsername(cleanData['_therapistUsername']);
              
              if (!therapist) {
                // Try to find by full name (supports names from Excel)
                therapist = await storage.getUserByName(cleanData['_therapistUsername']);
              }
              
              if (therapist) {
                cleanData.assignedTherapistId = therapist.id;
              } else {
                results.errors.push({
                  row: i + 1,
                  data: clientData,
                  message: `Warning: Therapist '${cleanData['_therapistUsername']}' not found. Client created without therapist assignment.`
                });
              }
              delete cleanData['_therapistUsername'];
            } catch (error) {
              results.errors.push({
                row: i + 1,
                data: clientData,
                message: `Warning: Therapist '${cleanData['_therapistUsername']}' not found. Client created without therapist assignment.`
              });
              delete cleanData['_therapistUsername'];
            }
          }
          // No auto-assignment if no therapist is specified - leave unassigned
          
          // Skip empty rows and validate required fields
          if (!cleanData.fullName || cleanData.fullName.trim() === '') {
            results.failed++;
            results.errors.push({
              row: i + 1,
              data: clientData,
              message: 'Missing required field: fullName'
            });
            continue;
          }
          
          // Validate and create client
          const validatedData = insertClientSchema.parse(cleanData);
          await storage.createClient(validatedData);
          results.successful++;
        } catch (error) {
          results.failed++;
          results.errors.push({
            row: i + 1,
            data: clientData,
            message: error instanceof z.ZodError ? 
              error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ') :
              error instanceof Error ? error.message : 'Unknown error'
          });
        }
      }

      res.json(results);
    } catch (error: any) {

      res.status(500).json({ 
        message: "Bulk upload failed", 
        details: error.message || "Internal server error" 
      });
    }
  });

  // Sessions routes with pagination and filtering
  app.get("/api/sessions", async (req, res) => {
    try {
      const { 
        currentUserId, 
        currentUserRole, 
        page = 1, 
        limit = 50,
        startDate,
        endDate,
        therapistId,
        status,
        serviceCode,
        clientId
      } = req.query;
      
      // Default to current month if no date filters provided
      const now = new Date();
      const defaultStartDate = new Date(now.getFullYear(), now.getMonth(), 1);
      const defaultEndDate = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      
      const filters = {
        startDate: startDate ? new Date(startDate as string) : defaultStartDate,
        endDate: endDate ? new Date(endDate as string) : defaultEndDate,
        therapistId: therapistId ? parseInt(therapistId as string) : undefined,
        status: status as string,
        serviceCode: serviceCode as string,
        clientId: clientId ? parseInt(clientId as string) : undefined,
        page: parseInt(page as string),
        limit: parseInt(limit as string)
      };
      
      let sessions = await storage.getAllSessions();
      
      // Apply date filter (always applied for performance)
      sessions = sessions.filter(session => {
        const sessionDate = new Date(session.sessionDate);
        return sessionDate >= filters.startDate && sessionDate <= filters.endDate;
      });
      
      // Role-based filtering
      if (currentUserRole === "therapist" && currentUserId) {
        const therapistIdFilter = parseInt(currentUserId as string);
        sessions = sessions.filter(session => session.therapistId === therapistIdFilter);
      } else if (currentUserRole === "supervisor" && currentUserId) {
        const supervisorId = parseInt(currentUserId as string);
        const supervisorAssignments = await storage.getSupervisorAssignments(supervisorId);
        
        if (supervisorAssignments.length === 0) {
          return res.json({ sessions: [], total: 0, totalPages: 0, currentPage: 1 });
        }
        
        const supervisedTherapistIds = supervisorAssignments.map(assignment => assignment.therapistId);
        sessions = sessions.filter(session => supervisedTherapistIds.includes(session.therapistId));
      }
      
      // Apply additional filters
      if (filters.therapistId && therapistId !== 'all') {
        sessions = sessions.filter(session => session.therapistId === filters.therapistId);
      }
      
      if (filters.status && filters.status !== 'all') {
        sessions = sessions.filter(session => session.status === filters.status);
      }

      if (filters.serviceCode && filters.serviceCode !== 'all') {
        // Filter by service code by matching serviceId to service table
        sessions = sessions.filter(session => {
          return session.service?.serviceCode === filters.serviceCode;
        });
      }
      
      if (filters.clientId) {
        sessions = sessions.filter(session => session.clientId === filters.clientId);
      }
      
      // Sort by date (newest first)
      sessions.sort((a, b) => new Date(b.sessionDate).getTime() - new Date(a.sessionDate).getTime());
      
      // Pagination
      const total = sessions.length;
      const totalPages = Math.ceil(total / filters.limit);
      const startIndex = (filters.page - 1) * filters.limit;
      const paginatedSessions = sessions.slice(startIndex, startIndex + filters.limit);
      
      res.json({
        sessions: paginatedSessions,
        total,
        totalPages,
        currentPage: filters.page,
        limit: filters.limit,
        appliedFilters: {
          startDate: filters.startDate.toISOString().split('T')[0],
          endDate: filters.endDate.toISOString().split('T')[0],
          therapistId: filters.therapistId,
          status: filters.status,
          clientId: filters.clientId
        }
      });
    } catch (error) {
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post("/api/sessions", async (req, res) => {
    try {
      // Convert sessionDate string to Date object if needed
      const sessionData = {
        ...req.body,
        sessionDate: typeof req.body.sessionDate === 'string' 
          ? new Date(req.body.sessionDate) 
          : req.body.sessionDate
      };
      
      const validatedData = insertSessionSchema.parse(sessionData);
      const session = await storage.createSession(validatedData);
      res.status(201).json(session);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid session data", errors: error.errors });
      }
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.put("/api/sessions/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const validatedData = insertSessionSchema.partial().parse(req.body);
      const session = await storage.updateSession(id, validatedData);
      res.json(session);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid session data", errors: error.errors });
      }
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/clients/:clientId/sessions", async (req, res) => {
    try {
      const clientId = parseInt(req.params.clientId);
      const sessions = await storage.getSessionsByClient(clientId);
      res.json(sessions);
    } catch (error) {
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Get session conflicts for a client
  app.get("/api/clients/:clientId/session-conflicts", async (req, res) => {
    try {
      const clientId = parseInt(req.params.clientId);
      const conflicts = await storage.getClientSessionConflicts(clientId);
      res.json(conflicts);
    } catch (error) {
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Monthly sessions route for calendar
  app.get("/api/sessions/:year/:month/month", async (req, res) => {
    try {
      const year = parseInt(req.params.year);
      const month = parseInt(req.params.month);
      const { currentUserId, currentUserRole } = req.query;
      
      if (isNaN(year) || isNaN(month) || month < 1 || month > 12) {
        return res.status(400).json({ message: "Invalid year or month" });
      }
      
      let sessions = await storage.getSessionsByMonth(year, month);
      
      // Role-based filtering
      if (currentUserRole === "therapist" && currentUserId) {
        const therapistId = parseInt(currentUserId as string);
        sessions = sessions.filter(session => session.therapistId === therapistId);
      } else if (currentUserRole === "supervisor" && currentUserId) {
        const supervisorId = parseInt(currentUserId as string);
        const supervisorAssignments = await storage.getSupervisorAssignments(supervisorId);
        
        if (supervisorAssignments.length === 0) {
          return res.json([]);
        }
        
        const supervisedTherapistIds = supervisorAssignments.map(assignment => assignment.therapistId);
        sessions = sessions.filter(session => supervisedTherapistIds.includes(session.therapistId));
      }
      
      res.json(sessions);
    } catch (error) {

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
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Enhanced Task Management Routes
  app.get("/api/tasks", async (req, res) => {
    try {
      const {
        page = "1",
        pageSize = "25",
        search,
        status,
        priority,
        assignedToId,
        clientId,
        sortBy = "createdAt",
        sortOrder = "desc",
        includeCompleted = "false",
        currentUserId,
        currentUserRole
      } = req.query;

      let filteredAssignedToId = assignedToId ? parseInt(assignedToId as string) : undefined;

      // Role-based filtering
      if (currentUserRole === "therapist" && currentUserId) {
        // Therapists can only see tasks assigned to them
        const therapistId = parseInt(currentUserId as string);
        filteredAssignedToId = therapistId;
      } else if (currentUserRole === "supervisor" && currentUserId) {
        // Supervisors can only see tasks for their supervised therapists
        const supervisorId = parseInt(currentUserId as string);
        const supervisorAssignments = await storage.getSupervisorAssignments(supervisorId);
        
        if (supervisorAssignments.length === 0) {
          return res.json({ tasks: [], total: 0, totalPages: 0 });
        }
        
        const supervisedTherapistIds = supervisorAssignments.map(assignment => assignment.therapistId);
        
        if (assignedToId) {
          const requestedTherapistId = parseInt(assignedToId as string);
          if (!supervisedTherapistIds.includes(requestedTherapistId)) {
            return res.json({ tasks: [], total: 0, totalPages: 0 });
          }
        }
      }

      const params = {
        page: parseInt(page as string),
        pageSize: parseInt(pageSize as string),
        search: search as string,
        status: status as string,
        priority: priority as string,
        assignedToId: filteredAssignedToId,
        clientId: clientId ? parseInt(clientId as string) : undefined,
        sortBy: sortBy as string,
        sortOrder: sortOrder as "asc" | "desc",
        includeCompleted: includeCompleted === "true"
      };

      const result = await storage.getAllTasks(params);
      res.json(result);
    } catch (error) {

      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/tasks/stats", async (req, res) => {
    try {
      const stats = await storage.getTaskStats();
      res.json(stats);
    } catch (error) {
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/tasks/recent", async (req, res) => {
    try {
      const limit = req.query.limit ? parseInt(req.query.limit as string) : 10;
      // For now, return empty array - will be properly implemented when adding task methods
      res.json([]);
    } catch (error) {
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/tasks/upcoming", async (req, res) => {
    try {
      const limit = req.query.limit ? parseInt(req.query.limit as string) : 10;
      // For now, return empty array - will be properly implemented when adding task methods
      res.json([]);
    } catch (error) {
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/tasks/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const task = await storage.getTask(id);
      
      if (!task) {
        return res.status(404).json({ message: "Task not found" });
      }
      
      res.json(task);
    } catch (error) {
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post("/api/tasks", async (req, res) => {
    try {
      const taskData = { ...req.body };
      
      // Validate that clientId is provided and is a valid number
      if (!taskData.clientId || taskData.clientId === null || taskData.clientId === undefined || isNaN(parseInt(taskData.clientId))) {
        return res.status(400).json({ 
          message: "Client ID is required", 
          errors: [{ path: ["clientId"], message: "Client must be selected" }] 
        });
      }
      
      // Ensure clientId is converted to integer
      taskData.clientId = parseInt(taskData.clientId);
      
      // Clean up empty strings to undefined to prevent PostgreSQL date errors
      Object.keys(taskData).forEach(key => {
        if (taskData[key] === "" || taskData[key] === null) {
          taskData[key] = undefined;
        }
      });
      
      const validatedData = insertTaskSchema.parse(taskData);
      const task = await storage.createTask(validatedData);
      res.status(201).json(task);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid task data", errors: error.errors });
      }
      if ((error as any).code === '23502') {
        return res.status(400).json({ 
          message: "Client ID is required", 
          errors: [{ path: ["clientId"], message: "Client must be selected" }] 
        });
      }
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.put("/api/tasks/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      
      const taskData = { ...req.body };
      // Clean up empty strings to undefined to prevent PostgreSQL date errors
      Object.keys(taskData).forEach(key => {
        if (taskData[key] === "" || taskData[key] === null) {
          taskData[key] = undefined;
        }
      });
      
      const validatedData = insertTaskSchema.partial().parse(taskData);
      const task = await storage.updateTask(id, validatedData);
      res.json(task);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid task data", errors: error.errors });
      }
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.delete("/api/tasks/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      await storage.deleteTask(id);
      res.status(204).send();
    } catch (error) {
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // ===== TASK COMMENTS API ROUTES =====
  // Get all comments for a specific task
  app.get("/api/tasks/:taskId/comments", async (req, res) => {
    try {
      const taskId = parseInt(req.params.taskId);
      const comments = await storage.getTaskComments(taskId);
      res.json(comments);
    } catch (error) {
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Create a new task comment
  app.post("/api/tasks/:taskId/comments", async (req, res) => {
    try {
      const taskId = parseInt(req.params.taskId);
      const commentData = { ...req.body, taskId };
      const validatedData = insertTaskCommentSchema.parse(commentData);
      const comment = await storage.createTaskComment(validatedData);
      res.status(201).json(comment);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid comment data", errors: error.errors });
      }
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Update a task comment
  app.put("/api/tasks/:taskId/comments/:commentId", async (req, res) => {
    try {
      const commentId = parseInt(req.params.commentId);
      const validatedData = insertTaskCommentSchema.partial().parse(req.body);
      const comment = await storage.updateTaskComment(commentId, validatedData);
      res.json(comment);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid comment data", errors: error.errors });
      }
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Delete a task comment
  app.delete("/api/tasks/:taskId/comments/:commentId", async (req, res) => {
    try {
      const commentId = parseInt(req.params.commentId);
      await storage.deleteTaskComment(commentId);
      res.status(204).send();
    } catch (error) {
      // Error logged
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
      // Error logged
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
      // Error logged
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
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Client Assessment Assignment routes
  app.get("/api/clients/:clientId/assessments", async (req, res) => {
    try {
      const clientId = parseInt(req.params.clientId);
      const assessments = await storage.getClientAssessments(clientId);
      res.json(assessments);
    } catch (error) {
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post("/api/clients/:clientId/assessments", async (req, res) => {
    try {
      const clientId = parseInt(req.params.clientId);
      const { templateId, assignedBy, status = 'assigned' } = req.body;
      
      const assessmentData = {
        clientId,
        templateId,
        assignedBy,
        assignedDate: new Date(),
        status,
        responses: null,
        completedDate: null
      };
      
      const assessment = await storage.assignAssessmentToClient(assessmentData);
      res.status(201).json(assessment);
    } catch (error) {
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post("/api/clients/:clientId/documents", async (req, res) => {
    try {

      const clientId = parseInt(req.params.clientId);
      const { fileContent, ...documentData } = req.body;
      
      const validatedData = insertDocumentSchema.parse({
        ...documentData,
        clientId,
        uploadedById: 3 // Default to first therapist for now
      });

      
      // Create document record
      const document = await storage.createDocument(validatedData);

      
      // Store actual file content if provided
      if (fileContent) {
        const uploadsDir = path.join(process.cwd(), 'uploads');
        if (!fs.existsSync(uploadsDir)) {
          fs.mkdirSync(uploadsDir, { recursive: true });
        }
        
        const filePath = path.join(uploadsDir, `${document.id}-${document.fileName}`);
        const buffer = Buffer.from(fileContent, 'base64');
        fs.writeFileSync(filePath, buffer);
        

      }
      
      res.status(201).json(document);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid document data", errors: error.errors });
      }
      // Error logged
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
          res.status(500).json({ error: 'Failed to process PDF content: ' + (error instanceof Error ? error.message : 'Unknown error') });
        }
      } else if (isImage) {
        // For images, serve the actual image file
        const filePath = path.join(process.cwd(), 'uploads', `${document.id}-${document.fileName}`);
        
        if (fs.existsSync(filePath)) {
          res.setHeader('Content-Type', document.mimeType || 'image/jpeg');
          res.sendFile(path.resolve(filePath));
        } else {
          // Fallback to icon if file not found
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
              <text x="200" y="285" text-anchor="middle" font-family="Arial, sans-serif" font-size="10" fill="#6b7280">${Math.round(document.fileSize / 1024)} KB • Image (File Not Found)</text>
            </svg>
          `);
        }
      } else if (isText) {
        // For text files, serve the actual text content
        const filePath = path.join(process.cwd(), 'uploads', `${document.id}-${document.fileName}`);
        
        if (fs.existsSync(filePath)) {
          try {
            const textContent = fs.readFileSync(filePath, 'utf-8');
            res.setHeader('Content-Type', 'application/json');
            res.json({
              type: 'text',
              content: textContent,
              fileName: document.fileName,
              fileSize: document.fileSize
            });
          } catch (error) {
            res.setHeader('Content-Type', 'application/json');
            res.json({
              type: 'text',
              content: `Error reading text file: ${error instanceof Error ? error.message : 'Unknown error'}`,
              fileName: document.fileName,
              fileSize: document.fileSize
            });
          }
        } else {
          res.setHeader('Content-Type', 'application/json');
          res.json({
            type: 'text',
            content: `Text file not found on server.\n\nThe file ${document.fileName} was uploaded but the content is not available for preview.`,
            fileName: document.fileName,
            fileSize: document.fileSize
          });
        }
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
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Serve PDF file directly for viewing
  app.get("/api/clients/:clientId/documents/:id/file", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const clientId = parseInt(req.params.clientId);
      
      // Validate parameters
      if (isNaN(id) || isNaN(clientId)) {
        return res.status(400).json({ message: "Invalid document or client ID" });
      }
      
      // Get document info from database
      const documents = await storage.getDocumentsByClient(clientId);
      const document = documents.find(doc => doc.id === id);
      
      if (!document) {
        return res.status(404).json({ message: "Document not found" });
      }
      
      // Only serve PDF files through this endpoint
      if (document.mimeType !== 'application/pdf') {
        return res.status(400).json({ message: "This endpoint only serves PDF files" });
      }
      
      const filePath = path.join(process.cwd(), 'uploads', `${document.id}-${document.fileName}`);
      
      if (fs.existsSync(filePath)) {
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename="${document.fileName}"`);
        res.setHeader('X-Frame-Options', 'SAMEORIGIN');
        res.setHeader('Content-Security-Policy', "frame-ancestors 'self'");
        res.sendFile(path.resolve(filePath));
      } else {
        res.status(404).json({ message: "File not found on server" });
      }
    } catch (error) {
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
      
      const filePath = path.join(process.cwd(), 'uploads', `${document.id}-${document.fileName}`);
      
      if (fs.existsSync(filePath)) {
        res.setHeader('Content-Type', document.mimeType || 'application/octet-stream');
        res.setHeader('Content-Disposition', `attachment; filename="${document.fileName}"`);
        res.sendFile(path.resolve(filePath));
      } else {
        res.status(404).json({ message: "File not found on server" });
      }
    } catch (error) {
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.delete("/api/clients/:clientId/documents/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const clientId = parseInt(req.params.clientId);
      
      // Get document info before deleting from database
      const documents = await storage.getDocumentsByClient(clientId);
      const document = documents.find(doc => doc.id === id);
      
      if (!document) {
        return res.status(404).json({ message: "Document not found" });
      }
      
      // Delete from database first
      await storage.deleteDocument(id);
      
      // Then delete the physical file if it exists
      const filePath = path.join(process.cwd(), 'uploads', `${document.id}-${document.fileName}`);
      if (fs.existsSync(filePath)) {
        try {
          fs.unlinkSync(filePath);
        } catch (fileError) {
          // Log file deletion error but don't fail the request since DB deletion succeeded
        }
      }
      
      res.status(204).send();
    } catch (error) {
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Therapists route
  app.get("/api/therapists", async (req, res) => {
    try {
      const { currentUserId, currentUserRole } = req.query;
      
      if (currentUserRole === "supervisor" && currentUserId) {
        const supervisorId = parseInt(currentUserId as string);
        // Get only therapists supervised by this supervisor
        const supervisorAssignments = await storage.getSupervisorAssignments(supervisorId);
        
        if (supervisorAssignments.length === 0) {
          return res.json([]);
        }
        
        const users = await storage.getUsers();
        const supervisedTherapistIds = supervisorAssignments.map(assignment => assignment.therapistId);
        const supervisedTherapists = users.filter(u => 
          u.role === 'therapist' && supervisedTherapistIds.includes(u.id)
        );
        
        return res.json(supervisedTherapists);
      } else if (currentUserRole === "therapist" && currentUserId) {
        // Therapists can only see themselves
        const users = await storage.getUsers();
        const therapist = users.find(u => u.id === parseInt(currentUserId as string) && u.role === 'therapist');
        return res.json(therapist ? [therapist] : []);
      }
      
      // Admins can see all therapists
      const users = await storage.getUsers();
      const therapists = users.filter(u => u.role === 'therapist');
      res.json(therapists);
    } catch (error) {

      res.status(500).json({ message: "Internal server error" });
    }
  });

  // User Management Routes
  app.get("/api/users", async (req, res) => {
    try {
      const users = await storage.getUsers();
      res.json(users);
    } catch (error) {
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/users/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const user = await storage.getUser(id);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }
      res.json(user);
    } catch (error) {
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post("/api/users", async (req, res) => {
    try {
      const validatedData = insertUserSchema.parse(req.body);
      const user = await storage.createUser(validatedData);
      res.status(201).json(user);
    } catch (error: any) {
      if (error instanceof z.ZodError) {

        return res.status(400).json({ message: "Invalid user data", errors: error.errors });
      }
      
      // Handle database constraint violations
      if (error.code === '23505') {
        if (error.constraint === 'users_email_unique') {
          return res.status(400).json({ message: "Email address already exists. Please use a different email." });
        }
        if (error.constraint === 'users_username_unique') {
          return res.status(400).json({ message: "Username already exists. Please choose a different username." });
        }
      }
      

      res.status(500).json({ message: "Failed to create user. Please try again." });
    }
  });

  app.put("/api/users/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const validatedData = insertUserSchema.partial().parse(req.body);
      const user = await storage.updateUser(id, validatedData);
      res.json(user);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid user data", errors: error.errors });
      }
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // User Self-Service Routes (for logged-in users to manage their own profiles)
  app.get("/api/users/me", async (req, res) => {
    try {
      // For now, simulate getting current user by ID 6 (admin)
      // In a real app, this would come from session/token
      const currentUserId = 6;
      
      // Use direct database query since storage method has an issue
      const [user] = await db.select().from(users).where(eq(users.id, currentUserId));
      
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }
      res.json(user);
    } catch (error) {
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.put("/api/users/me", async (req, res) => {
    try {
      // For now, simulate updating current user by ID 6 (admin)
      // In a real app, this would come from session/token
      const currentUserId = 6;
      const validatedData = insertUserSchema.partial().parse(req.body);
      const user = await storage.updateUser(currentUserId, validatedData);
      res.json(user);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid user data", errors: error.errors });
      }
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/users/me/profile", async (req, res) => {
    try {
      // For now, simulate getting current user by ID 6 (admin)
      // In a real app, this would come from session/token
      const currentUserId = 6;
      const profile = await storage.getUserProfile(currentUserId);
      res.json(profile);
    } catch (error) {
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post("/api/users/me/profile", async (req, res) => {
    try {
      // For now, simulate creating profile for current user by ID 6 (admin)
      // In a real app, this would come from session/token
      const currentUserId = 6;
      const validatedData = insertUserProfileSchema.parse({
        ...req.body,
        userId: currentUserId
      });
      const profile = await storage.createUserProfile(validatedData);
      res.status(201).json(profile);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid profile data", errors: error.errors });
      }
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.put("/api/users/me/profile", async (req, res) => {
    try {
      // For now, simulate updating profile for current user by ID 6 (admin)
      // In a real app, this would come from session/token
      const currentUserId = 6;
      const validatedData = insertUserProfileSchema.partial().parse(req.body);
      const profile = await storage.updateUserProfile(currentUserId, validatedData);
      res.json(profile);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid profile data", errors: error.errors });
      }
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // User Profile Routes
  app.get("/api/users/:userId/profile", async (req, res) => {
    try {
      const userId = parseInt(req.params.userId);
      const profile = await storage.getUserProfile(userId);
      if (!profile) {
        return res.status(404).json({ message: "User profile not found" });
      }
      res.json(profile);
    } catch (error) {
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post("/api/users/:userId/profile", async (req, res) => {
    try {
      const userId = parseInt(req.params.userId);
      const validatedData = insertUserProfileSchema.parse({
        ...req.body,
        userId
      });
      const profile = await storage.createUserProfile(validatedData);
      res.status(201).json(profile);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid profile data", errors: error.errors });
      }
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.put("/api/users/:userId/profile", async (req, res) => {
    try {
      const userId = parseInt(req.params.userId);
      const validatedData = insertUserProfileSchema.partial().parse(req.body);
      const profile = await storage.updateUserProfile(userId, validatedData);
      res.json(profile);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid profile data", errors: error.errors });
      }
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.delete("/api/users/:userId/profile", async (req, res) => {
    try {
      const userId = parseInt(req.params.userId);
      await storage.deleteUserProfile(userId);
      res.status(204).send();
    } catch (error) {
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Supervisor Assignment Routes
  app.get("/api/supervisors/:supervisorId/assignments", async (req, res) => {
    try {
      const supervisorId = parseInt(req.params.supervisorId);
      const assignments = await storage.getSupervisorAssignments(supervisorId);
      res.json(assignments);
    } catch (error) {
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/supervisor-assignments", async (req, res) => {
    try {
      const assignments = await storage.getAllSupervisorAssignments();
      res.json(assignments);
    } catch (error) {
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/therapists/:therapistId/supervisor", async (req, res) => {
    try {
      const therapistId = parseInt(req.params.therapistId);
      const supervisor = await storage.getTherapistSupervisor(therapistId);
      if (!supervisor) {
        return res.status(404).json({ message: "No supervisor assigned" });
      }
      res.json(supervisor);
    } catch (error) {
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post("/api/supervisor-assignments", async (req, res) => {
    try {
      const validatedData = insertSupervisorAssignmentSchema.parse(req.body);
      const assignment = await storage.createSupervisorAssignment(validatedData);
      res.status(201).json(assignment);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid assignment data", errors: error.errors });
      }
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.put("/api/supervisor-assignments/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const validatedData = insertSupervisorAssignmentSchema.partial().parse(req.body);
      const assignment = await storage.updateSupervisorAssignment(id, validatedData);
      res.json(assignment);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid assignment data", errors: error.errors });
      }
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.delete("/api/supervisor-assignments/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      await storage.deleteSupervisorAssignment(id);
      res.status(204).send();
    } catch (error) {
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // User Activity Log Routes
  app.post("/api/users/:userId/activity", async (req, res) => {
    try {
      const userId = parseInt(req.params.userId);
      const validatedData = insertUserActivityLogSchema.parse({
        ...req.body,
        userId
      });
      const activity = await storage.logUserActivity(validatedData);
      res.status(201).json(activity);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid activity data", errors: error.errors });
      }
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/users/:userId/activity", async (req, res) => {
    try {
      const userId = parseInt(req.params.userId);
      const limit = req.query.limit ? parseInt(req.query.limit as string) : 50;
      const activities = await storage.getUserActivityHistory(userId, limit);
      res.json(activities);
    } catch (error) {
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Pending tasks count
  app.get("/api/tasks/pending/count", async (req, res) => {
    try {
      const count = await storage.getPendingTasksCount();
      res.json({ count });
    } catch (error) {
      // Error logged
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
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/clients/:clientId/session-notes", async (req, res) => {
    try {
      const clientId = parseInt(req.params.clientId);
      const sessionNotes = await storage.getSessionNotesByClient(clientId);
      res.json(sessionNotes);
    } catch (error) {
      // Error logged
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
      // Error logged
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
            sessionFocus: validatedData.sessionFocus || undefined,
            symptoms: validatedData.symptoms || undefined,
            shortTermGoals: validatedData.shortTermGoals || undefined,
            intervention: validatedData.intervention || undefined,
            progress: validatedData.progress || undefined,
            remarks: validatedData.remarks || undefined,
            recommendations: validatedData.recommendations || undefined,

            customPrompt: validatedData.customAiPrompt || undefined,
            sessionType: 'therapy session'
          });
          
          // Update with generated content
          await storage.updateSessionNote(sessionNote.id, {
            generatedContent: aiContent.generatedContent,
            draftContent: aiContent.generatedContent,
            aiProcessingStatus: 'completed'
          });
        } catch (aiError) {
          await storage.updateSessionNote(sessionNote.id, { aiProcessingStatus: 'error' });
        }
      }
      
      res.status(201).json(sessionNote);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid session note data", errors: error.errors });
      }
      // Error logged
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
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.delete("/api/session-notes/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      await storage.deleteSessionNote(id);
      res.status(204).send();
    } catch (error) {
      // Error logged
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
      res.status(500).json({ error: "Failed to generate AI template: " + (error instanceof Error ? error.message : 'Unknown error') });
    }
  });

  app.get("/api/ai/templates", async (req, res) => {
    try {
      const { getAllTemplates } = await import("./ai/openai");
      const templates = getAllTemplates();
      res.json({ templates });
    } catch (error) {
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
        sessionFocus: sessionNote.sessionFocus || undefined,
        symptoms: sessionNote.symptoms || undefined,
        shortTermGoals: sessionNote.shortTermGoals || undefined,
        intervention: sessionNote.intervention || undefined,
        progress: sessionNote.progress || undefined,
        remarks: sessionNote.remarks || undefined,
        recommendations: sessionNote.recommendations || undefined,
        customPrompt: customPrompt || sessionNote.customAiPrompt || undefined,
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
      // Error logged
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
      // Error logged
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
      // Error logged
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
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.delete("/api/library/categories/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      await storage.deleteLibraryCategory(id);
      res.status(204).send();
    } catch (error) {
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/library/entries", async (req, res) => {
    try {
      const categoryId = req.query.categoryId ? parseInt(req.query.categoryId as string) : undefined;
      const entries = await storage.getLibraryEntries(categoryId);
      res.json(entries);
    } catch (error) {
      // Error logged
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
      // Error logged
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
      // Error logged
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
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.delete("/api/library/entries/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      await storage.deleteLibraryEntry(id);
      res.status(204).send();
    } catch (error) {
      // Error logged
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
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post("/api/library/entries/:id/increment-usage", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      await storage.incrementLibraryEntryUsage(id);
      res.status(204).send();
    } catch (error) {
      // Error logged
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
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/library/entries/:id/connected", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const connectedEntries = await storage.getConnectedEntries(id);
      res.json(connectedEntries);
    } catch (error) {
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post("/api/library/connections", async (req, res) => {
    try {
      const connection = await storage.createLibraryEntryConnection(req.body);
      res.status(201).json(connection);
    } catch (error) {
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.put("/api/library/connections/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const connection = await storage.updateLibraryEntryConnection(id, req.body);
      res.json(connection);
    } catch (error) {
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.delete("/api/library/connections/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      await storage.deleteLibraryEntryConnection(id);
      res.status(204).send();
    } catch (error) {
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Assessment Template Routes
  app.get("/api/assessments/templates", async (req, res) => {
    try {
      const templates = await storage.getAssessmentTemplates();
      res.json(templates);
    } catch (error) {
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/assessments/templates/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid template ID" });
      }

      const template = await storage.getAssessmentTemplate(id);
      if (!template) {
        return res.status(404).json({ message: "Assessment template not found" });
      }

      res.json(template);
    } catch (error) {
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post("/api/assessments/templates", async (req, res) => {
    try {
      const templateData = req.body;
      const template = await storage.createAssessmentTemplate(templateData);
      res.status(201).json(template);
    } catch (error) {
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.patch("/api/assessments/templates/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid template ID" });
      }

      const templateData = req.body;
      const template = await storage.updateAssessmentTemplate(id, templateData);
      res.json(template);
    } catch (error) {
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.delete("/api/assessments/templates/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid template ID" });
      }

      // First delete all assignments that reference this template
      try {
        await storage.deleteAssessmentAssignmentsByTemplateId(id);
      } catch (error) {
        // Continue if no assignments exist
      }
      
      // Then delete the template
      await storage.deleteAssessmentTemplate(id);
      res.json({ message: "Assessment template deleted successfully" });
    } catch (error) {
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Assessment Assignment Routes
  app.get("/api/assessments/assignments", async (req, res) => {
    try {
      const clientId = req.query.clientId ? parseInt(req.query.clientId as string) : undefined;
      const assignments = await storage.getAssessmentAssignments(clientId);
      res.json(assignments);
    } catch (error) {
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/assessments/assignments/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid assignment ID" });
      }

      const assignment = await storage.getAssessmentAssignment(id);
      if (!assignment) {
        return res.status(404).json({ message: "Assessment assignment not found" });
      }

      res.json(assignment);
    } catch (error) {
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post("/api/assessments/assignments", async (req, res) => {
    try {
      const assignmentData = req.body;
      const assignment = await storage.createAssessmentAssignment(assignmentData);
      res.status(201).json(assignment);
    } catch (error) {
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.patch("/api/assessments/assignments/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid assignment ID" });
      }

      const assignmentData = req.body;
      const assignment = await storage.updateAssessmentAssignment(id, assignmentData);
      res.json(assignment);
    } catch (error) {
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Assessment Response Routes
  app.get("/api/assessments/assignments/:assignmentId/responses", async (req, res) => {
    try {
      const assignmentId = parseInt(req.params.assignmentId);
      if (isNaN(assignmentId)) {
        return res.status(400).json({ message: "Invalid assignment ID" });
      }

      const responses = await storage.getAssessmentResponses(assignmentId);
      res.json(responses);
    } catch (error) {
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post("/api/assessments/responses", async (req, res) => {
    try {
      const responseData = req.body;
      const response = await storage.createAssessmentResponse(responseData);
      res.status(201).json(response);
    } catch (error) {
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Assessment sections routes
  app.get("/api/assessments/templates/:templateId/sections", async (req, res) => {
    try {
      const templateId = parseInt(req.params.templateId);
      const sections = await storage.getAssessmentSections(templateId);
      res.json(sections);
    } catch (error) {
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post("/api/assessments/sections", async (req, res) => {
    try {
      const sectionData = req.body;
      const section = await storage.createAssessmentSection(sectionData);
      res.status(201).json(section);
    } catch (error) {
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.patch("/api/assessments/sections/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const sectionData = req.body;
      const section = await storage.updateAssessmentSection(id, sectionData);
      res.json(section);
    } catch (error) {
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Assessment questions routes
  app.post("/api/assessments/questions", async (req, res) => {
    try {
      const questionData = req.body;
      const question = await storage.createAssessmentQuestion(questionData);
      
      // Debug: ensure question has ID
      if (!question || !question.id) {
        throw new Error("Question creation failed - no ID returned");
      }
      
      res.status(201).json(question);
    } catch (error) {
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.patch("/api/assessments/questions/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const questionData = req.body;
      const question = await storage.updateAssessmentQuestion(id, questionData);
      res.json(question);
    } catch (error) {
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Assessment Question Options Routes
  app.get("/api/assessments/questions/:questionId/options", async (req, res) => {
    try {
      const questionId = parseInt(req.params.questionId);
      if (isNaN(questionId)) {
        return res.status(400).json({ message: "Invalid question ID" });
      }
      const options = await storage.getAssessmentQuestionOptions(questionId);
      res.json(options);
    } catch (error) {
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post("/api/assessments/question-options", async (req, res) => {
    try {
      const validatedData = insertAssessmentQuestionOptionSchema.parse(req.body);
      const option = await storage.createAssessmentQuestionOption(validatedData);
      res.status(201).json(option);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid option data", errors: error.errors });
      }
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Bulk create question options for performance
  app.post("/api/assessments/question-options/bulk", async (req, res) => {
    try {
      const { options } = req.body;
      if (!Array.isArray(options)) {
        return res.status(400).json({ message: "Options must be an array" });
      }
      
      const validatedOptions = options.map(option => 
        insertAssessmentQuestionOptionSchema.parse(option)
      );
      
      const createdOptions = await Promise.all(
        validatedOptions.map(option => storage.createAssessmentQuestionOption(option))
      );
      res.status(201).json(createdOptions);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid option data", errors: error.errors });
      }
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.patch("/api/assessments/question-options/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const validatedData = insertAssessmentQuestionOptionSchema.partial().parse(req.body);
      const option = await storage.updateAssessmentQuestionOption(id, validatedData);
      res.json(option);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid option data", errors: error.errors });
      }
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.delete("/api/assessments/question-options/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      await storage.deleteAssessmentQuestionOption(id);
      res.status(204).send();
    } catch (error) {
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.delete("/api/assessments/questions/:questionId/options", async (req, res) => {
    try {
      const questionId = parseInt(req.params.questionId);
      await storage.deleteAllAssessmentQuestionOptions(questionId);
      res.status(204).send();
    } catch (error) {
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.delete("/api/assessments/questions/:questionId", async (req, res) => {
    try {
      const questionId = parseInt(req.params.questionId);
      if (isNaN(questionId)) {
        return res.status(400).json({ message: "Invalid question ID" });
      }
      // First delete all options for this question
      await storage.deleteAllAssessmentQuestionOptions(questionId);
      // Then delete the question itself
      await storage.deleteAssessmentQuestion(questionId);
      res.status(204).send();
    } catch (error) {
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Assessment Report Routes
  app.get("/api/assessments/assignments/:assignmentId/report", async (req, res) => {
    try {
      const assignmentId = parseInt(req.params.assignmentId);
      if (isNaN(assignmentId)) {
        return res.status(400).json({ message: "Invalid assignment ID" });
      }

      const report = await storage.getAssessmentReport(assignmentId);
      if (!report) {
        return res.status(404).json({ message: "Assessment report not found" });
      }

      res.json(report);
    } catch (error) {
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post("/api/assessments/reports", async (req, res) => {
    try {
      const reportData = req.body;
      const report = await storage.createAssessmentReport(reportData);
      res.status(201).json(report);
    } catch (error) {
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Service Management API
  app.get("/api/services", async (req, res) => {
    try {
      const services = await storage.getServices();
      res.json(services);
    } catch (error) {
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post("/api/services", async (req, res) => {
    try {
      const validatedData = insertServiceSchema.parse(req.body);
      const service = await storage.createService(validatedData);
      res.status(201).json(service);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid service data", errors: error.errors });
      }
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Update service (including price)
  app.put("/api/services/:id", async (req, res) => {
    try {
      const serviceId = parseInt(req.params.id);
      if (isNaN(serviceId)) {
        return res.status(400).json({ message: "Invalid service ID" });
      }

      const updateData = req.body;
      const service = await storage.updateService(serviceId, updateData);
      res.json(service);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid service data", errors: error.errors });
      }
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Delete service
  app.delete("/api/services/:id", async (req, res) => {
    try {
      const serviceId = parseInt(req.params.id);
      if (isNaN(serviceId)) {
        return res.status(400).json({ message: "Invalid service ID" });
      }

      await storage.deleteService(serviceId);
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Room Management API
  app.get("/api/rooms", async (req, res) => {
    try {
      const rooms = await storage.getRooms();
      res.json(rooms);
    } catch (error) {
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post("/api/rooms", async (req, res) => {
    try {
      const validatedData = insertRoomSchema.parse(req.body);
      const room = await storage.createRoom(validatedData);
      res.status(201).json(room);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid room data", errors: error.errors });
      }
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Update room
  app.put("/api/rooms/:id", async (req, res) => {
    try {
      const roomId = parseInt(req.params.id);
      if (isNaN(roomId)) {
        return res.status(400).json({ message: "Invalid room ID" });
      }

      const updateData = req.body;
      const room = await storage.updateRoom(roomId, updateData);
      res.json(room);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid room data", errors: error.errors });
      }
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Delete room
  app.delete("/api/rooms/:id", async (req, res) => {
    try {
      const roomId = parseInt(req.params.id);
      if (isNaN(roomId)) {
        return res.status(400).json({ message: "Invalid room ID" });
      }

      await storage.deleteRoom(roomId);
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Room Availability Check
  app.get("/api/rooms/availability", async (req, res) => {
    try {
      const { date, startTime, endTime, excludeSessionId } = req.query;
      
      if (!date || !startTime || !endTime) {
        return res.status(400).json({ message: "Date, start time, and end time are required" });
      }
      
      const availability = await storage.checkRoomAvailability(
        date as string,
        startTime as string,
        endTime as string,
        excludeSessionId ? parseInt(excludeSessionId as string) : undefined
      );
      
      res.json(availability);
    } catch (error) {
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Enhanced Session Management with Billing
  app.put("/api/sessions/:id/status", async (req, res) => {
    try {
      const sessionId = parseInt(req.params.id);
      const { status } = req.body;
      
      if (isNaN(sessionId)) {
        return res.status(400).json({ message: "Invalid session ID" });
      }
      
      // Update session status
      const updatedSession = await storage.updateSessionStatus(sessionId, status);
      
      // Trigger billing when session is completed
      if (status === 'completed') {
        try {
          // Check if billing already exists
          const existingBilling = await storage.getSessionBilling(sessionId);
          if (!existingBilling) {
            await storage.createSessionBilling(sessionId);
          }
        } catch (billingError) {
          // Continue with session update even if billing fails
        }
      }
      
      res.json(updatedSession);
    } catch (error) {
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Session Billing API
  app.get("/api/sessions/:id/billing", async (req, res) => {
    try {
      const sessionId = parseInt(req.params.id);
      
      if (isNaN(sessionId)) {
        return res.status(400).json({ message: "Invalid session ID" });
      }
      
      const billing = await storage.getSessionBilling(sessionId);
      res.json(billing);
    } catch (error) {
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post("/api/sessions/:id/billing", async (req, res) => {
    try {
      const sessionId = parseInt(req.params.id);
      
      if (isNaN(sessionId)) {
        return res.status(400).json({ message: "Invalid session ID" });
      }
      
      const billing = await storage.createSessionBilling(sessionId);
      res.json(billing);
    } catch (error) {
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/billing/reports", async (req, res) => {
    try {
      const { startDate, endDate, therapistId, status } = req.query;
      
      const reports = await storage.getBillingReports({
        startDate: startDate as string,
        endDate: endDate as string,
        therapistId: therapistId ? parseInt(therapistId as string) : undefined,
        status: status as string
      });
      
      res.json(reports);
    } catch (error) {
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Billing routes
  app.get("/api/sessions/:sessionId/billing", async (req, res) => {
    try {
      const sessionId = parseInt(req.params.sessionId);
      const billing = await storage.getBillingRecordsBySession(sessionId);
      res.json(billing);
    } catch (error) {
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/clients/:clientId/billing", async (req, res) => {
    try {
      const clientId = parseInt(req.params.clientId);
      const billing = await storage.getBillingRecordsByClient(clientId);
      res.json(billing);
    } catch (error) {
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.patch("/api/billing/:billingId/status", async (req, res) => {
    try {
      const billingId = parseInt(req.params.billingId);
      const { status } = req.body;
      
      if (!['pending', 'billed', 'paid', 'denied', 'refunded'].includes(status)) {
        return res.status(400).json({ message: "Invalid billing status" });
      }
      
      await storage.updateBillingStatus(billingId, status);
      res.json({ message: "Billing status updated successfully" });
    } catch (error) {
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Invoice Generation Routes
  app.post("/api/clients/:clientId/invoice", async (req, res) => {
    try {
      const clientId = parseInt(req.params.clientId);
      const { action, billingId } = req.body;
      
      if (!['download', 'print', 'email'].includes(action)) {
        return res.status(400).json({ message: "Invalid action. Use 'download', 'print', or 'email'" });
      }
      
      // Get client data
      const client = await storage.getClient(clientId);
      if (!client) {
        return res.status(404).json({ message: "Client not found" });
      }
      
      // Get billing records - either specific one or all for client
      let billingRecords;
      if (billingId) {
        // Get single billing record
        const allRecords = await storage.getBillingRecordsByClient(clientId);
        const singleRecord = allRecords.find(r => r.id === billingId);
        if (!singleRecord) {
          return res.status(404).json({ message: "Billing record not found" });
        }
        billingRecords = [singleRecord];
      } else {
        // Get all billing records for client
        billingRecords = await storage.getBillingRecordsByClient(clientId);
        if (billingRecords.length === 0) {
          return res.status(404).json({ message: "No billing records found for this client" });
        }
      }
      
      // Generate invoice HTML
      const subtotal = billingRecords.reduce((sum, record) => sum + Number(record.totalAmount || 0), 0);
      const insuranceCoverage = billingRecords.reduce((sum, record) => sum + (Number(record.totalAmount || 0) * 0.8), 0);
      const copayTotal = billingRecords.reduce((sum, record) => sum + Number(record.copayAmount || 0), 0);
      
      // Generate unique invoice number
      const invoiceNumber = billingId ? `INV-${client.clientId}-${billingId}` : `INV-${client.clientId}-${new Date().getFullYear()}`;
      const serviceDate = billingRecords.length === 1 ? new Date() : null;
      
      const invoiceHtml = `
        <!DOCTYPE html>
        <html>
        <head>
          <title>Invoice - ${client.fullName}${billingId ? ` - ${billingRecords[0].serviceCode}` : ''}</title>
          <style>
            body { font-family: Arial, sans-serif; margin: 40px; }
            .header { display: flex; justify-content: space-between; margin-bottom: 40px; }
            .invoice-title { font-size: 24px; font-weight: bold; color: #1e293b; }
            .company-info { text-align: right; color: #64748b; }
            .client-info { display: flex; gap: 60px; margin-bottom: 40px; }
            .section-title { font-size: 18px; font-weight: bold; color: #1e293b; margin-bottom: 10px; }
            table { width: 100%; border-collapse: collapse; margin-bottom: 30px; }
            th, td { border: 1px solid #e2e8f0; padding: 12px; text-align: left; }
            th { background-color: #f8fafc; }
            .totals { width: 300px; margin-left: auto; }
            .total-row { display: flex; justify-content: space-between; margin-bottom: 8px; }
            .total-due { font-weight: bold; font-size: 18px; border-top: 2px solid #1e293b; padding-top: 8px; }
            .payment-terms { background-color: #f8fafc; padding: 20px; border-radius: 8px; margin-top: 40px; }
            @media print { body { margin: 0; } }
          </style>
        </head>
        <body>
          <div class="header">
            <div>
              <h1 class="invoice-title">INVOICE</h1>
              <p>Invoice #: ${invoiceNumber}</p>
              <p>Date: ${new Date().toLocaleDateString()}</p>
              ${serviceDate ? `<p>Service Date: ${new Date(serviceDate).toLocaleDateString()}</p>` : ''}
            </div>
            <div class="company-info">
              <h3>Healthcare Services</h3>
              <p>Professional Mental Health Services</p>
              <p>Licensed Clinical Practice</p>
            </div>
          </div>
          
          <div class="client-info">
            <div>
              <h3 class="section-title">Bill To:</h3>
              <p>${client.fullName}</p>
              <p>${client.address || ''}</p>
              <p>${client.phone || ''}</p>
              <p>${client.email || ''}</p>
            </div>
            <div>
              <h3 class="section-title">Insurance Info:</h3>
              <p>Provider: ${client.insuranceProvider || 'N/A'}</p>
              <p>Policy: ${client.policyNumber || 'N/A'}</p>
              <p>Group: ${client.groupNumber || 'N/A'}</p>
            </div>
          </div>
          
          <table>
            <thead>
              <tr>
                <th>Service</th>
                <th>CPT Code</th>
                <th>Date</th>
                <th style="text-align: right;">Amount</th>
              </tr>
            </thead>
            <tbody>
              ${billingRecords.map(record => `
                <tr>
                  <td>${record.service?.serviceName || 'Professional Service'}</td>
                  <td>${record.service?.serviceCode || record.serviceCode}</td>
                  <td>${new Date(record.session.sessionDate).toLocaleDateString()}</td>
                  <td style="text-align: right;">$${Number(record.totalAmount).toFixed(2)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
          
          <div class="totals">
            <div class="total-row">
              <span>${billingRecords.length === 1 ? 'Service Amount:' : 'Subtotal:'}</span>
              <span>$${subtotal.toFixed(2)}</span>
            </div>
            ${billingRecords.some(r => r.insuranceCovered) ? `
            <div class="total-row">
              <span>Insurance Coverage:</span>
              <span>-$${insuranceCoverage.toFixed(2)}</span>
            </div>` : ''}
            <div class="total-row">
              <span>Copay Amount:</span>
              <span>$${copayTotal.toFixed(2)}</span>
            </div>
            <div class="total-row total-due">
              <span>Total Due:</span>
              <span>$${copayTotal > 0 ? copayTotal.toFixed(2) : subtotal.toFixed(2)}</span>
            </div>
          </div>
          
          <div class="payment-terms">
            <h3>Payment Terms</h3>
            <p>Payment is due within 30 days of invoice date. Late payments may incur additional fees.</p>
            <p>Thank you for choosing our mental health services.</p>
          </div>
        </body>
        </html>
      `;
      
      if (action === 'download') {
        // For PDF generation, you'd normally use puppeteer or similar
        // For now, return HTML that can be saved as PDF
        res.setHeader('Content-Type', 'text/html');
        res.setHeader('Content-Disposition', `attachment; filename="invoice-${client.clientId}-${new Date().toISOString().split('T')[0]}.html"`);
        res.send(invoiceHtml);
      } else if (action === 'print') {
        // Return HTML for printing
        res.setHeader('Content-Type', 'text/html');
        res.send(invoiceHtml);
      } else if (action === 'email') {
        // Email invoice using SendGrid if available
        if (process.env.SENDGRID_API_KEY && client.email) {
          try {
            const sgMail = require('@sendgrid/mail');
            sgMail.setApiKey(process.env.SENDGRID_API_KEY);
            
            const msg = {
              to: client.email,
              from: 'noreply@healthcare-services.com',
              subject: `Invoice - ${client.fullName}`,
              html: invoiceHtml,
            };
            
            await sgMail.send(msg);
            res.json({ message: "Invoice sent successfully to " + client.email });
          } catch (error) {
            res.status(500).json({ message: "Failed to send invoice email" });
          }
        } else {
          res.status(503).json({ message: "Email service not configured or client email not available" });
        }
      }
    } catch (error) {
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Payment Status Update Route
  app.put("/api/billing/:billingId/payment", async (req, res) => {
    try {
      const billingId = parseInt(req.params.billingId);
      const { status, amount, date, reference, method, notes } = req.body;
      
      if (!['pending', 'billed', 'paid', 'denied', 'refunded'].includes(status)) {
        return res.status(400).json({ message: "Invalid payment status" });
      }
      
      await storage.updatePaymentDetails(billingId, {
        status,
        amount,
        date,
        reference,
        method,
        notes
      });
      
      res.json({ message: "Payment details updated successfully" });
    } catch (error) {
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Assessment completion workflow endpoints
  
  // Get assignment details with full relationships
  app.get('/api/assessments/assignments/:assignmentId', async (req, res) => {
    try {
      const { assignmentId } = req.params;
      const assignment = await storage.getAssessmentAssignmentById(parseInt(assignmentId));
      res.json(assignment);
    } catch (error) {
      res.status(500).json({ message: 'Internal server error' });
    }
  });

  // Get template sections with questions
  app.get('/api/assessments/templates/:templateId/sections', async (req, res) => {
    try {
      const { templateId } = req.params;
      const sections = await storage.getAssessmentTemplateSections(parseInt(templateId));
      res.json(sections);
    } catch (error) {
      res.status(500).json({ message: 'Internal server error' });
    }
  });

  // Get assignment responses
  app.get('/api/assessments/assignments/:assignmentId/responses', async (req, res) => {
    try {
      const { assignmentId } = req.params;
      const responses = await storage.getAssessmentResponses(parseInt(assignmentId));
      res.json(responses);
    } catch (error) {
      res.status(500).json({ message: 'Internal server error' });
    }
  });

  // Save assessment response
  app.post('/api/assessments/responses', async (req, res) => {
    try {
      const response = await storage.saveAssessmentResponse(req.body);
      res.json(response);
    } catch (error) {
      res.status(500).json({ message: 'Internal server error' });
    }
  });

  // Update assignment status
  app.patch('/api/assessments/assignments/:assignmentId', async (req, res) => {
    try {
      const { assignmentId } = req.params;
      const assignment = await storage.updateAssessmentAssignment(parseInt(assignmentId), req.body);
      res.json(assignment);
    } catch (error) {
      res.status(500).json({ message: 'Internal server error' });
    }
  });

  // Delete assessment assignment
  app.delete('/api/assessments/assignments/:assignmentId', async (req, res) => {
    try {
      const { assignmentId } = req.params;
      await storage.deleteAssessmentAssignment(parseInt(assignmentId));
      res.json({ message: 'Assessment assignment deleted successfully' });
    } catch (error) {
      res.status(500).json({ message: 'Internal server error' });
    }
  });

  // ===== ROLE MANAGEMENT ROUTES =====
  
  // Get all roles
  app.get("/api/roles", async (req, res) => {
    try {
      const roles = await storage.getRoles();
      res.json(roles);
    } catch (error) {
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Get specific role
  app.get("/api/roles/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const role = await storage.getRole(id);
      if (!role) {
        return res.status(404).json({ message: "Role not found" });
      }
      res.json(role);
    } catch (error) {
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Create role
  app.post("/api/roles", async (req, res) => {
    try {
      const validatedData = insertRoleSchema.parse(req.body);
      const { permissions = [], ...roleData } = validatedData as any;
      
      // Create the role
      const role = await storage.createRole(roleData);
      
      // Assign permissions if provided
      if (permissions.length > 0) {
        await storage.updateRolePermissions(role.id, permissions);
      }
      
      // Return role with permissions
      const roleWithPermissions = await storage.getRole(role.id);
      res.status(201).json(roleWithPermissions);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid role data", errors: error.errors });
      }
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Update role
  app.put("/api/roles/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const validatedData = insertRoleSchema.partial().parse(req.body);
      const { permissions = [], ...roleData } = validatedData as any;
      
      // Update the role
      const role = await storage.updateRole(id, roleData);
      
      // Update permissions if provided
      if (Array.isArray(permissions)) {
        await storage.updateRolePermissions(id, permissions);
      }
      
      // Return updated role with permissions
      const roleWithPermissions = await storage.getRole(id);
      res.json(roleWithPermissions);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid role data", errors: error.errors });
      }
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Delete role
  app.delete("/api/roles/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      
      // Check if role is system role
      const role = await storage.getRole(id);
      if (role?.isSystem) {
        return res.status(400).json({ message: "Cannot delete system role" });
      }
      
      await storage.deleteRole(id);
      res.status(204).send();
    } catch (error) {
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // ===== PERMISSION MANAGEMENT ROUTES =====
  
  // Get all permissions
  app.get("/api/permissions", async (req, res) => {
    try {
      const permissions = await storage.getPermissions();
      res.json(permissions);
    } catch (error) {
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Get specific permission
  app.get("/api/permissions/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const permission = await storage.getPermission(id);
      if (!permission) {
        return res.status(404).json({ message: "Permission not found" });
      }
      res.json(permission);
    } catch (error) {
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Create permission
  app.post("/api/permissions", async (req, res) => {
    try {
      const validatedData = insertPermissionSchema.parse(req.body);
      const permission = await storage.createPermission(validatedData);
      res.status(201).json(permission);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid permission data", errors: error.errors });
      }
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Update permission
  app.put("/api/permissions/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const validatedData = insertPermissionSchema.partial().parse(req.body);
      const permission = await storage.updatePermission(id, validatedData);
      res.json(permission);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid permission data", errors: error.errors });
      }
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Delete permission
  app.delete("/api/permissions/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      await storage.deletePermission(id);
      res.status(204).send();
    } catch (error) {
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // ===== SYSTEM OPTIONS API ROUTES =====
  // (Following same pattern as Services/Rooms)

  // Option Categories Management
  app.get("/api/system-options/categories", async (req, res) => {
    try {
      const categories = await storage.getOptionCategories();
      res.json(categories);
    } catch (error) {
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/system-options/categories/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid category ID" });
      }
      const category = await storage.getOptionCategory(id);
      if (!category) {
        return res.status(404).json({ message: "Category not found" });
      }
      res.json(category);
    } catch (error) {
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post("/api/system-options/categories", async (req, res) => {
    try {
      const validatedData = insertOptionCategorySchema.parse(req.body);
      const category = await storage.createOptionCategory(validatedData);
      res.status(201).json(category);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid category data", errors: error.errors });
      }
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.put("/api/system-options/categories/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid category ID" });
      }
      const validatedData = insertOptionCategorySchema.partial().parse(req.body);
      const category = await storage.updateOptionCategory(id, validatedData);
      res.json(category);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid category data", errors: error.errors });
      }
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.delete("/api/system-options/categories/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid category ID" });
      }
      await storage.deleteOptionCategory(id);
      res.status(204).send();
    } catch (error) {
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // System Options Management
  app.get("/api/system-options", async (req, res) => {
    try {
      const categoryId = req.query.categoryId ? parseInt(req.query.categoryId as string) : undefined;
      const options = await storage.getSystemOptions(categoryId);
      res.json(options);
    } catch (error) {
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/system-options/by-category/:categoryKey", async (req, res) => {
    try {
      const categoryKey = req.params.categoryKey;
      const options = await storage.getSystemOptionsByCategory(categoryKey);
      res.json(options);
    } catch (error) {
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/system-options/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid option ID" });
      }
      const option = await storage.getSystemOption(id);
      if (!option) {
        return res.status(404).json({ message: "Option not found" });
      }
      res.json(option);
    } catch (error) {
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post("/api/system-options", async (req, res) => {
    try {
      const validatedData = insertSystemOptionSchema.parse(req.body);
      const option = await storage.createSystemOption(validatedData);
      res.status(201).json(option);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid option data", errors: error.errors });
      }
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.put("/api/system-options/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid option ID" });
      }
      
      const { oldOptionKey, ...validatedData } = req.body;
      const parsedData = insertSystemOptionSchema.partial().parse(validatedData);
      
      // Update the option and migrate data if key changed
      const option = await storage.updateSystemOptionWithMigration(id, parsedData, oldOptionKey);
      res.json(option);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid option data", errors: error.errors });
      }

      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.delete("/api/system-options/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid option ID" });
      }
      await storage.deleteSystemOption(id);
      res.status(204).send();
    } catch (error) {
      // Error logged
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // ===== CHECKLIST TEMPLATE MANAGEMENT =====
  // Database-backed storage for checklist templates and items

  app.get('/api/checklist-templates', async (req, res) => {
    try {
      const templates = await storage.getChecklistTemplates();
      res.json(templates);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post('/api/checklist-templates', async (req, res) => {
    try {
      const template = await storage.createChecklistTemplate(req.body);
      res.json(template);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.delete('/api/checklist-templates/:id', async (req, res) => {
    try {
      const templateId = parseInt(req.params.id);
      await storage.deleteChecklistTemplate(templateId);
      res.status(204).send();
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get('/api/checklist-items', async (req, res) => {
    try {
      const templateId = req.query.templateId ? parseInt(req.query.templateId as string) : undefined;
      const items = await storage.getChecklistItems(templateId);
      res.json(items);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post('/api/checklist-items', async (req, res) => {
    try {
      const item = await storage.createChecklistItem(req.body);
      res.json(item);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.delete('/api/checklist-items/:id', async (req, res) => {
    try {
      const itemId = parseInt(req.params.id);
      await storage.deleteChecklistItem(itemId);
      res.status(204).send();
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Client Checklist Routes
  app.get('/api/clients/:clientId/checklists', async (req, res) => {
    try {
      const clientId = parseInt(req.params.clientId);
      const checklists = await storage.getClientChecklists(clientId);
      res.json(checklists);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post('/api/clients/:clientId/checklists', async (req, res) => {
    try {
      const clientId = parseInt(req.params.clientId);
      const { templateId, dueDate } = req.body;
      const assignment = await storage.assignChecklistToClient(clientId, templateId, dueDate);
      res.json(assignment);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get('/api/client-checklist-items/:clientChecklistId', async (req, res) => {
    try {
      const clientChecklistId = parseInt(req.params.clientChecklistId);
      const items = await storage.getClientChecklistItems(clientChecklistId);
      res.json(items);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.put('/api/client-checklist-items/:id', async (req, res) => {
    try {
      const itemId = parseInt(req.params.id);
      const updatedItem = await storage.updateClientChecklistItem(itemId, req.body);
      res.json(updatedItem);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ===== NOTIFICATION SYSTEM ROUTES =====
  app.use('/api/notifications', notificationRoutes);

  const httpServer = createServer(app);
  return httpServer;
}
