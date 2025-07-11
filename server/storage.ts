// Database Schema and Types
import { 
  clients, 
  users, 
  sessions, 
  tasks, 
  notes, 
  documents,
  sessionNotes,
  libraryCategories,
  libraryEntries,
  libraryEntryConnections,
  assessmentTemplates,
  assessmentSections,
  assessmentQuestions,
  assessmentQuestionOptions,
  assessmentAssignments,
  assessmentResponses,
  assessmentReports,
  type Client, 
  type InsertClient,
  type User, 
  type InsertUser,
  type Session,
  type InsertSession,
  type Task,
  type InsertTask,
  type Note,
  type InsertNote,
  type Document,
  type InsertDocument,
  type SessionNote,
  type InsertSessionNote,
  type LibraryCategory,
  type InsertLibraryCategory,
  type LibraryEntry,
  type InsertLibraryEntry,
  type LibraryEntryConnection,
  type InsertLibraryEntryConnection,
  type AssessmentTemplate,
  type InsertAssessmentTemplate,
  type AssessmentSection,
  type InsertAssessmentSection,
  type AssessmentQuestion,
  type InsertAssessmentQuestion,
  type AssessmentQuestionOption,
  type InsertAssessmentQuestionOption,
  type AssessmentAssignment,
  type InsertAssessmentAssignment,
  type AssessmentResponse,
  type InsertAssessmentResponse,
  type AssessmentReport,
  type InsertAssessmentReport
} from "@shared/schema";

// Database Connection and Operators
import { db } from "./db";
import { eq, and, or, ilike, desc, asc, count, sql, alias } from "drizzle-orm";

export interface ClientsQueryParams {
  page?: number;
  pageSize?: number;
  search?: string;
  status?: string;
  therapistId?: number;
  clientType?: string;
  hasPortalAccess?: boolean;
  hasPendingTasks?: boolean;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

export interface ClientsQueryResult {
  clients: (Client & { assignedTherapist?: User; sessionCount: number; taskCount: number })[];
  total: number;
  totalPages: number;
}

// Storage Interface - defines all data operations
export interface IStorage {
  // User Management
  getUser(id: number): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  getAllTherapists(): Promise<User[]>;

  // Client Management
  getClients(params: ClientsQueryParams): Promise<ClientsQueryResult>;
  getClient(id: number): Promise<(Client & { assignedTherapist?: User }) | undefined>;
  getClientByClientId(clientId: string): Promise<Client | undefined>;
  createClient(client: InsertClient): Promise<Client>;
  updateClient(id: number, client: Partial<InsertClient>): Promise<Client>;
  deleteClient(id: number): Promise<void>;
  getClientStats(): Promise<{
    totalClients: number;
    activeClients: number;
    inactiveClients: number;
    newIntakes: number;
    assessmentPhase: number;
    psychotherapy: number;
  }>;

  // Session Management
  getAllSessions(): Promise<(Session & { therapist: User; client: Client })[]>;
  getSessionsByClient(clientId: number): Promise<(Session & { therapist: User })[]>;
  createSession(session: InsertSession): Promise<Session>;
  updateSession(id: number, session: Partial<InsertSession>): Promise<Session>;
  deleteSession(id: number): Promise<void>;

  // Task Management
  getTasksByClient(clientId: number): Promise<(Task & { assignedTo?: User })[]>;
  createTask(task: InsertTask): Promise<Task>;
  updateTask(id: number, task: Partial<InsertTask>): Promise<Task>;
  deleteTask(id: number): Promise<void>;
  getPendingTasksCount(): Promise<number>;

  // Note Management
  getNotesByClient(clientId: number): Promise<(Note & { author: User })[]>;
  createNote(note: InsertNote): Promise<Note>;
  updateNote(id: number, note: Partial<InsertNote>): Promise<Note>;
  deleteNote(id: number): Promise<void>;

  // Document methods
  getDocumentsByClient(clientId: number): Promise<(Document & { uploadedBy: User })[]>;
  createDocument(document: InsertDocument): Promise<Document>;
  deleteDocument(id: number): Promise<void>;

  // Session Notes Management
  getSessionNotesBySession(sessionId: number): Promise<(SessionNote & { therapist: User; client: Client; session: Session })[]>;
  getSessionNotesByClient(clientId: number): Promise<(SessionNote & { therapist: User; session: Session })[]>;
  createSessionNote(sessionNote: InsertSessionNote): Promise<SessionNote>;
  updateSessionNote(id: number, sessionNote: Partial<InsertSessionNote>): Promise<SessionNote>;
  deleteSessionNote(id: number): Promise<void>;
  getSessionNote(id: number): Promise<(SessionNote & { therapist: User; client: Client; session: Session }) | undefined>;

  // Hierarchical Library Management
  getLibraryCategories(): Promise<(LibraryCategory & { children?: LibraryCategory[]; entries?: LibraryEntry[] })[]>;
  getLibraryCategory(id: number): Promise<(LibraryCategory & { children: LibraryCategory[]; entries: LibraryEntry[] }) | undefined>;
  createLibraryCategory(category: InsertLibraryCategory): Promise<LibraryCategory>;
  updateLibraryCategory(id: number, category: Partial<InsertLibraryCategory>): Promise<LibraryCategory>;
  deleteLibraryCategory(id: number): Promise<void>;

  getLibraryEntries(categoryId?: number): Promise<(LibraryEntry & { category: LibraryCategory; createdBy: User; connections?: LibraryEntryConnection[] })[]>;
  getLibraryEntry(id: number): Promise<(LibraryEntry & { category: LibraryCategory; createdBy: User; connections?: LibraryEntryConnection[] }) | undefined>;
  createLibraryEntry(entry: InsertLibraryEntry): Promise<LibraryEntry>;
  updateLibraryEntry(id: number, entry: Partial<InsertLibraryEntry>): Promise<LibraryEntry>;
  deleteLibraryEntry(id: number): Promise<void>;
  searchLibraryEntries(query: string, categoryId?: number): Promise<(LibraryEntry & { category: LibraryCategory; createdBy: User })[]>;
  incrementLibraryEntryUsage(id: number): Promise<void>;

  // Library Entry Connections Management
  getLibraryEntryConnections(entryId?: number): Promise<(LibraryEntryConnection & { fromEntry: LibraryEntry; toEntry: LibraryEntry; createdBy: User })[]>;
  createLibraryEntryConnection(connection: InsertLibraryEntryConnection): Promise<LibraryEntryConnection>;
  updateLibraryEntryConnection(id: number, connection: Partial<InsertLibraryEntryConnection>): Promise<LibraryEntryConnection>;
  deleteLibraryEntryConnection(id: number): Promise<void>;
  getConnectedEntries(entryId: number): Promise<(LibraryEntry & { connectionType: string; connectionStrength: number; category: LibraryCategory })[]>;

  // Assessment Templates Management
  getAssessmentTemplates(): Promise<(AssessmentTemplate & { createdBy: User; sectionsCount: number })[]>;
  getAssessmentTemplate(id: number): Promise<(AssessmentTemplate & { createdBy: User; sections: (AssessmentSection & { questions: (AssessmentQuestion & { options: AssessmentQuestionOption[] })[] })[] }) | undefined>;
  createAssessmentTemplate(template: InsertAssessmentTemplate): Promise<AssessmentTemplate>;
  updateAssessmentTemplate(id: number, template: Partial<InsertAssessmentTemplate>): Promise<AssessmentTemplate>;
  deleteAssessmentTemplate(id: number): Promise<void>;

  // Assessment Sections Management
  createAssessmentSection(section: InsertAssessmentSection): Promise<AssessmentSection>;
  updateAssessmentSection(id: number, section: Partial<InsertAssessmentSection>): Promise<AssessmentSection>;
  deleteAssessmentSection(id: number): Promise<void>;

  // Assessment Questions Management
  createAssessmentQuestion(question: InsertAssessmentQuestion): Promise<AssessmentQuestion>;
  updateAssessmentQuestion(id: number, question: Partial<InsertAssessmentQuestion>): Promise<AssessmentQuestion>;
  deleteAssessmentQuestion(id: number): Promise<void>;

  // Assessment Question Options Management
  createAssessmentQuestionOption(option: InsertAssessmentQuestionOption): Promise<AssessmentQuestionOption>;
  updateAssessmentQuestionOption(id: number, option: Partial<InsertAssessmentQuestionOption>): Promise<AssessmentQuestionOption>;
  deleteAssessmentQuestionOption(id: number): Promise<void>;

  // Assessment Assignments Management
  getAssessmentAssignments(clientId?: number): Promise<(AssessmentAssignment & { template: AssessmentTemplate; client: Client; assignedBy: User })[]>;
  getAssessmentAssignment(id: number): Promise<(AssessmentAssignment & { template: AssessmentTemplate; client: Client; assignedBy: User; responses: AssessmentResponse[] }) | undefined>;
  createAssessmentAssignment(assignment: InsertAssessmentAssignment): Promise<AssessmentAssignment>;
  updateAssessmentAssignment(id: number, assignment: Partial<InsertAssessmentAssignment>): Promise<AssessmentAssignment>;
  deleteAssessmentAssignment(id: number): Promise<void>;

  // Assessment Responses Management
  getAssessmentResponses(assignmentId: number): Promise<(AssessmentResponse & { question: AssessmentQuestion; responder: User })[]>;
  createAssessmentResponse(response: InsertAssessmentResponse): Promise<AssessmentResponse>;
  updateAssessmentResponse(id: number, response: Partial<InsertAssessmentResponse>): Promise<AssessmentResponse>;
  deleteAssessmentResponse(id: number): Promise<void>;

  // Assessment Reports Management
  getAssessmentReport(assignmentId: number): Promise<(AssessmentReport & { assignment: AssessmentAssignment; createdBy: User }) | undefined>;
  createAssessmentReport(report: InsertAssessmentReport): Promise<AssessmentReport>;
  updateAssessmentReport(id: number, report: Partial<InsertAssessmentReport>): Promise<AssessmentReport>;
  deleteAssessmentReport(id: number): Promise<void>;
}

export class DatabaseStorage implements IStorage {
  // User methods
  async getUser(id: number): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user || undefined;
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.username, username));
    return user || undefined;
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const [user] = await db
      .insert(users)
      .values(insertUser)
      .returning();
    return user;
  }

  async getAllTherapists(): Promise<User[]> {
    return await db
      .select()
      .from(users)
      .where(and(eq(users.role, 'therapist'), eq(users.isActive, true)))
      .orderBy(asc(users.fullName));
  }

  // Client methods with optimized queries for 5000+ records
  async getClients(params: ClientsQueryParams): Promise<ClientsQueryResult> {
    const {
      page = 1,
      pageSize = 25,
      search,
      status,
      therapistId,
      clientType,
      hasPortalAccess,
      hasPendingTasks,
      sortBy = 'createdAt',
      sortOrder = 'desc'
    } = params;

    const offset = (page - 1) * pageSize;
    
    // Build where conditions
    const whereConditions = [];
    
    if (search) {
      whereConditions.push(
        or(
          ilike(clients.fullName, `%${search}%`),
          ilike(clients.email, `%${search}%`),
          ilike(clients.phone, `%${search}%`),
          ilike(clients.clientId, `%${search}%`)
        )
      );
    }
    
    if (status) {
      whereConditions.push(eq(clients.status, status as any));
    }
    
    if (therapistId) {
      whereConditions.push(eq(clients.assignedTherapistId, therapistId));
    }
    
    if (clientType) {
      whereConditions.push(eq(clients.clientType, clientType as any));
    }
    
    if (hasPortalAccess !== undefined) {
      whereConditions.push(eq(clients.hasPortalAccess, hasPortalAccess));
    }

    const whereClause = whereConditions.length > 0 ? and(...whereConditions) : undefined;

    // Get total count
    const [{ total }] = await db
      .select({ total: count() })
      .from(clients)
      .where(whereClause);

    // Get clients with related data
    const clientsQuery = db
      .select({
        client: clients,
        assignedTherapist: users,
        sessionCount: sql<number>`(
          SELECT COUNT(*) FROM ${sessions} 
          WHERE ${sessions.clientId} = ${clients.id}
        )`.as('sessionCount'),
        taskCount: sql<number>`(
          SELECT COUNT(*) FROM ${tasks} 
          WHERE ${tasks.clientId} = ${clients.id} 
          AND ${tasks.status} != 'completed'
        )`.as('taskCount')
      })
      .from(clients)
      .leftJoin(users, eq(clients.assignedTherapistId, users.id))
      .where(whereClause)
      .limit(pageSize)
      .offset(offset);

    // Apply sorting
    const sortColumn = sortBy === 'name' ? clients.fullName :
                      sortBy === 'status' ? clients.status :
                      sortBy === 'therapist' ? users.fullName :
                      sortBy === 'lastSession' ? clients.lastSessionDate :
                      clients.createdAt;

    if (sortOrder === 'asc') {
      clientsQuery.orderBy(asc(sortColumn));
    } else {
      clientsQuery.orderBy(desc(sortColumn));
    }

    const results = await clientsQuery;

    const clientsWithCounts = results.map(r => ({
      ...r.client,
      assignedTherapist: r.assignedTherapist || undefined,
      sessionCount: r.sessionCount,
      taskCount: r.taskCount
    }));

    return {
      clients: clientsWithCounts,
      total,
      totalPages: Math.ceil(total / pageSize)
    };
  }

  async getClient(id: number): Promise<(Client & { assignedTherapist?: User }) | undefined> {
    const [result] = await db
      .select({
        client: clients,
        assignedTherapist: users
      })
      .from(clients)
      .leftJoin(users, eq(clients.assignedTherapistId, users.id))
      .where(eq(clients.id, id));

    if (!result) return undefined;

    return {
      ...result.client,
      assignedTherapist: result.assignedTherapist || undefined
    };
  }

  async getClientByClientId(clientId: string): Promise<Client | undefined> {
    const [client] = await db.select().from(clients).where(eq(clients.clientId, clientId));
    return client || undefined;
  }

  async createClient(insertClient: InsertClient): Promise<Client> {
    // Generate client ID
    const year = new Date().getFullYear();
    const [{ maxId }] = await db
      .select({ maxId: sql<number>`COALESCE(MAX(CAST(SUBSTRING(client_id, 9) AS INTEGER)), 0)` })
      .from(clients)
      .where(ilike(clients.clientId, `CL-${year}-%`));

    const nextId = (maxId || 0) + 1;
    const clientId = `CL-${year}-${nextId.toString().padStart(4, '0')}`;

    const [client] = await db
      .insert(clients)
      .values({ ...insertClient, clientId })
      .returning();
    return client;
  }

  async updateClient(id: number, clientData: Partial<InsertClient>): Promise<Client> {
    const [client] = await db
      .update(clients)
      .set({ ...clientData, updatedAt: new Date() })
      .where(eq(clients.id, id))
      .returning();
    return client;
  }

  async deleteClient(id: number): Promise<void> {
    await db.delete(clients).where(eq(clients.id, id));
  }

  async getClientStats(): Promise<{
    totalClients: number;
    activeClients: number;
    inactiveClients: number;
    newIntakes: number;
    assessmentPhase: number;
    psychotherapy: number;
  }> {
    const [stats] = await db
      .select({
        totalClients: count(),
        activeClients: sql<number>`COUNT(*) FILTER (WHERE status = 'active')`,
        inactiveClients: sql<number>`COUNT(*) FILTER (WHERE status = 'inactive')`,
        newIntakes: sql<number>`COUNT(*) FILTER (WHERE stage = 'intake')`,
        assessmentPhase: sql<number>`COUNT(*) FILTER (WHERE stage = 'assessment')`,
        psychotherapy: sql<number>`COUNT(*) FILTER (WHERE stage = 'psychotherapy')`
      })
      .from(clients);

    return stats;
  }

  // Session methods
  async getAllSessions(): Promise<(Session & { therapist: User; client: Client })[]> {
    const results = await db
      .select({
        session: sessions,
        therapist: users,
        client: clients
      })
      .from(sessions)
      .innerJoin(users, eq(sessions.therapistId, users.id))
      .innerJoin(clients, eq(sessions.clientId, clients.id))
      .orderBy(desc(sessions.sessionDate));

    return results.map(r => ({ 
      ...r.session, 
      therapist: r.therapist, 
      client: r.client 
    }));
  }

  async getSessionsByClient(clientId: number): Promise<(Session & { therapist: User })[]> {
    const results = await db
      .select({
        session: sessions,
        therapist: users
      })
      .from(sessions)
      .innerJoin(users, eq(sessions.therapistId, users.id))
      .where(eq(sessions.clientId, clientId))
      .orderBy(desc(sessions.sessionDate));

    return results.map(r => ({ ...r.session, therapist: r.therapist }));
  }

  async createSession(session: InsertSession): Promise<Session> {
    const [newSession] = await db
      .insert(sessions)
      .values(session)
      .returning();
    return newSession;
  }

  async updateSession(id: number, sessionData: Partial<InsertSession>): Promise<Session> {
    const [session] = await db
      .update(sessions)
      .set({ ...sessionData, updatedAt: new Date() })
      .where(eq(sessions.id, id))
      .returning();
    return session;
  }

  async deleteSession(id: number): Promise<void> {
    await db.delete(sessions).where(eq(sessions.id, id));
  }

  // Task methods
  async getTasksByClient(clientId: number): Promise<(Task & { assignedTo?: User })[]> {
    const results = await db
      .select({
        task: tasks,
        assignedTo: users
      })
      .from(tasks)
      .leftJoin(users, eq(tasks.assignedToId, users.id))
      .where(eq(tasks.clientId, clientId))
      .orderBy(desc(tasks.createdAt));

    return results.map(r => ({ ...r.task, assignedTo: r.assignedTo || undefined }));
  }

  async createTask(task: InsertTask): Promise<Task> {
    const [newTask] = await db
      .insert(tasks)
      .values(task)
      .returning();
    return newTask;
  }

  async updateTask(id: number, taskData: Partial<InsertTask>): Promise<Task> {
    const [task] = await db
      .update(tasks)
      .set({ ...taskData, updatedAt: new Date() })
      .where(eq(tasks.id, id))
      .returning();
    return task;
  }

  async deleteTask(id: number): Promise<void> {
    await db.delete(tasks).where(eq(tasks.id, id));
  }

  async getPendingTasksCount(): Promise<number> {
    const [{ count: pendingCount }] = await db
      .select({ count: count() })
      .from(tasks)
      .where(or(eq(tasks.status, 'pending'), eq(tasks.status, 'overdue')));
    
    return pendingCount;
  }

  // Note methods
  async getNotesByClient(clientId: number): Promise<(Note & { author: User })[]> {
    const results = await db
      .select({
        note: notes,
        author: users
      })
      .from(notes)
      .innerJoin(users, eq(notes.authorId, users.id))
      .where(eq(notes.clientId, clientId))
      .orderBy(desc(notes.createdAt));

    return results.map(r => ({ ...r.note, author: r.author }));
  }

  async createNote(note: InsertNote): Promise<Note> {
    const [newNote] = await db
      .insert(notes)
      .values(note)
      .returning();
    return newNote;
  }

  async updateNote(id: number, noteData: Partial<InsertNote>): Promise<Note> {
    const [note] = await db
      .update(notes)
      .set({ ...noteData, updatedAt: new Date() })
      .where(eq(notes.id, id))
      .returning();
    return note;
  }

  async deleteNote(id: number): Promise<void> {
    await db.delete(notes).where(eq(notes.id, id));
  }

  // Document methods
  async getDocumentsByClient(clientId: number): Promise<(Document & { uploadedBy: User })[]> {
    const results = await db
      .select({
        document: documents,
        uploadedBy: users
      })
      .from(documents)
      .innerJoin(users, eq(documents.uploadedById, users.id))
      .where(eq(documents.clientId, clientId))
      .orderBy(desc(documents.createdAt));

    return results.map(r => ({ ...r.document, uploadedBy: r.uploadedBy }));
  }

  async createDocument(document: InsertDocument): Promise<Document> {
    const [newDocument] = await db
      .insert(documents)
      .values(document)
      .returning();
    return newDocument;
  }

  async deleteDocument(id: number): Promise<void> {
    await db.delete(documents).where(eq(documents.id, id));
  }

  // Session Notes methods
  async getSessionNotesBySession(sessionId: number): Promise<(SessionNote & { therapist: User; client: Client; session: Session })[]> {
    const results = await db
      .select({
        sessionNote: sessionNotes,
        therapist: users,
        client: clients,
        session: sessions
      })
      .from(sessionNotes)
      .innerJoin(users, eq(sessionNotes.therapistId, users.id))
      .innerJoin(clients, eq(sessionNotes.clientId, clients.id))
      .innerJoin(sessions, eq(sessionNotes.sessionId, sessions.id))
      .where(eq(sessionNotes.sessionId, sessionId))
      .orderBy(desc(sessionNotes.createdAt));

    return results.map(r => ({ 
      ...r.sessionNote, 
      therapist: r.therapist, 
      client: r.client, 
      session: r.session 
    }));
  }

  async getSessionNotesByClient(clientId: number): Promise<(SessionNote & { therapist: User; session: Session })[]> {
    const results = await db
      .select({
        sessionNote: sessionNotes,
        therapist: users,
        session: sessions
      })
      .from(sessionNotes)
      .innerJoin(users, eq(sessionNotes.therapistId, users.id))
      .innerJoin(sessions, eq(sessionNotes.sessionId, sessions.id))
      .where(eq(sessionNotes.clientId, clientId))
      .orderBy(desc(sessionNotes.createdAt));

    return results.map(r => ({ 
      ...r.sessionNote, 
      therapist: r.therapist, 
      session: r.session 
    }));
  }

  async createSessionNote(sessionNote: InsertSessionNote): Promise<SessionNote> {
    const [newSessionNote] = await db
      .insert(sessionNotes)
      .values(sessionNote)
      .returning();
    return newSessionNote;
  }

  async updateSessionNote(id: number, sessionNoteData: Partial<InsertSessionNote>): Promise<SessionNote> {
    const [sessionNote] = await db
      .update(sessionNotes)
      .set({ ...sessionNoteData, updatedAt: new Date() })
      .where(eq(sessionNotes.id, id))
      .returning();
    return sessionNote;
  }

  async deleteSessionNote(id: number): Promise<void> {
    await db.delete(sessionNotes).where(eq(sessionNotes.id, id));
  }

  async getSessionNote(id: number): Promise<(SessionNote & { therapist: User; client: Client; session: Session }) | undefined> {
    const results = await db
      .select({
        sessionNote: sessionNotes,
        therapist: users,
        client: clients,
        session: sessions
      })
      .from(sessionNotes)
      .innerJoin(users, eq(sessionNotes.therapistId, users.id))
      .innerJoin(clients, eq(sessionNotes.clientId, clients.id))
      .innerJoin(sessions, eq(sessionNotes.sessionId, sessions.id))
      .where(eq(sessionNotes.id, id));

    if (results.length === 0) return undefined;
    
    const r = results[0];
    return { 
      ...r.sessionNote, 
      therapist: r.therapist, 
      client: r.client, 
      session: r.session 
    };
  }

  // Hierarchical Library Implementation
  async getLibraryCategories(): Promise<(LibraryCategory & { children?: LibraryCategory[]; entries?: LibraryEntry[] })[]> {
    const categories = await db
      .select()
      .from(libraryCategories)
      .where(eq(libraryCategories.isActive, true))
      .orderBy(asc(libraryCategories.sortOrder), asc(libraryCategories.name));

    // Build hierarchical structure
    const categoryMap = new Map<number, LibraryCategory & { children: LibraryCategory[]; entries: LibraryEntry[] }>();
    const rootCategories: (LibraryCategory & { children: LibraryCategory[]; entries: LibraryEntry[] })[] = [];

    categories.forEach(cat => {
      categoryMap.set(cat.id, { ...cat, children: [], entries: [] });
    });

    categories.forEach(cat => {
      const categoryWithChildren = categoryMap.get(cat.id)!;
      if (cat.parentId) {
        const parent = categoryMap.get(cat.parentId);
        if (parent) {
          parent.children.push(categoryWithChildren);
        }
      } else {
        rootCategories.push(categoryWithChildren);
      }
    });

    return rootCategories;
  }

  async getLibraryCategory(id: number): Promise<(LibraryCategory & { children: LibraryCategory[]; entries: LibraryEntry[] }) | undefined> {
    const [category] = await db
      .select()
      .from(libraryCategories)
      .where(and(eq(libraryCategories.id, id), eq(libraryCategories.isActive, true)));

    if (!category) return undefined;

    const children = await db
      .select()
      .from(libraryCategories)
      .where(and(eq(libraryCategories.parentId, id), eq(libraryCategories.isActive, true)))
      .orderBy(asc(libraryCategories.sortOrder), asc(libraryCategories.name));

    const entries = await db
      .select()
      .from(libraryEntries)
      .where(and(eq(libraryEntries.categoryId, id), eq(libraryEntries.isActive, true)))
      .orderBy(asc(libraryEntries.sortOrder), asc(libraryEntries.title));

    return { ...category, children, entries };
  }

  async createLibraryCategory(categoryData: InsertLibraryCategory): Promise<LibraryCategory> {
    const [category] = await db.insert(libraryCategories).values(categoryData).returning();
    return category;
  }

  async updateLibraryCategory(id: number, categoryData: Partial<InsertLibraryCategory>): Promise<LibraryCategory> {
    const [category] = await db
      .update(libraryCategories)
      .set({ ...categoryData, updatedAt: new Date() })
      .where(eq(libraryCategories.id, id))
      .returning();
    return category;
  }

  async deleteLibraryCategory(id: number): Promise<void> {
    await db.update(libraryCategories).set({ isActive: false, updatedAt: new Date() }).where(eq(libraryCategories.id, id));
  }

  async getLibraryEntries(categoryId?: number): Promise<(LibraryEntry & { category: LibraryCategory; createdBy: User })[]> {
    let whereConditions = [eq(libraryEntries.isActive, true)];
    
    if (categoryId) {
      whereConditions.push(eq(libraryEntries.categoryId, categoryId));
    }

    const query = db
      .select({ entry: libraryEntries, category: libraryCategories, createdBy: users })
      .from(libraryEntries)
      .leftJoin(libraryCategories, eq(libraryEntries.categoryId, libraryCategories.id))
      .leftJoin(users, eq(libraryEntries.createdById, users.id))
      .where(and(...whereConditions));

    const results = await query.orderBy(asc(libraryEntries.sortOrder), asc(libraryEntries.title));
    return results.map(result => ({ ...result.entry, category: result.category!, createdBy: result.createdBy! }));
  }

  async getLibraryEntry(id: number): Promise<(LibraryEntry & { category: LibraryCategory; createdBy: User }) | undefined> {
    const [result] = await db
      .select({ entry: libraryEntries, category: libraryCategories, createdBy: users })
      .from(libraryEntries)
      .leftJoin(libraryCategories, eq(libraryEntries.categoryId, libraryCategories.id))
      .leftJoin(users, eq(libraryEntries.createdById, users.id))
      .where(and(eq(libraryEntries.id, id), eq(libraryEntries.isActive, true)));

    if (!result) return undefined;
    return { ...result.entry, category: result.category!, createdBy: result.createdBy! };
  }

  async createLibraryEntry(entryData: InsertLibraryEntry): Promise<LibraryEntry> {
    const [entry] = await db.insert(libraryEntries).values(entryData).returning();
    return entry;
  }

  async updateLibraryEntry(id: number, entryData: Partial<InsertLibraryEntry>): Promise<LibraryEntry> {
    const [entry] = await db
      .update(libraryEntries)
      .set({ ...entryData, updatedAt: new Date() })
      .where(eq(libraryEntries.id, id))
      .returning();
    return entry;
  }

  async deleteLibraryEntry(id: number): Promise<void> {
    await db.update(libraryEntries).set({ isActive: false, updatedAt: new Date() }).where(eq(libraryEntries.id, id));
  }

  async searchLibraryEntries(query: string, categoryId?: number): Promise<(LibraryEntry & { category: LibraryCategory; createdBy: User })[]> {
    let whereConditions = [
      eq(libraryEntries.isActive, true),
      or(ilike(libraryEntries.title, `%${query}%`), ilike(libraryEntries.content, `%${query}%`))
    ];
    
    if (categoryId) {
      whereConditions.push(eq(libraryEntries.categoryId, categoryId));
    }

    const dbQuery = db
      .select({ entry: libraryEntries, category: libraryCategories, createdBy: users })
      .from(libraryEntries)
      .leftJoin(libraryCategories, eq(libraryEntries.categoryId, libraryCategories.id))
      .leftJoin(users, eq(libraryEntries.createdById, users.id))
      .where(and(...whereConditions));

    const results = await dbQuery.orderBy(desc(libraryEntries.usageCount), asc(libraryEntries.title));
    return results.map(result => ({ ...result.entry, category: result.category!, createdBy: result.createdBy! }));
  }

  async incrementLibraryEntryUsage(id: number): Promise<void> {
    await db
      .update(libraryEntries)
      .set({ usageCount: sql`${libraryEntries.usageCount} + 1`, updatedAt: new Date() })
      .where(eq(libraryEntries.id, id));
  }

  // Library Entry Connections Management
  async getLibraryEntryConnections(entryId?: number): Promise<(LibraryEntryConnection & { fromEntry: LibraryEntry; toEntry: LibraryEntry; createdBy: User })[]> {
    // For now, let's simplify and just return the connections without the full entry details
    let query = db
      .select()
      .from(libraryEntryConnections)
      .where(eq(libraryEntryConnections.isActive, true));

    if (entryId) {
      query = query.where(or(eq(libraryEntryConnections.fromEntryId, entryId), eq(libraryEntryConnections.toEntryId, entryId)));
    }

    const connections = await query.orderBy(desc(libraryEntryConnections.strength), asc(libraryEntryConnections.createdAt));
    
    // For each connection, fetch the related entries and user separately
    const resultsWithDetails = await Promise.all(
      connections.map(async (connection) => {
        const [fromEntry] = await db.select().from(libraryEntries).where(eq(libraryEntries.id, connection.fromEntryId));
        const [toEntry] = await db.select().from(libraryEntries).where(eq(libraryEntries.id, connection.toEntryId));
        const [createdBy] = await db.select().from(users).where(eq(users.id, connection.createdById));
        
        return {
          ...connection,
          fromEntry: fromEntry!,
          toEntry: toEntry!,
          createdBy: createdBy!
        };
      })
    );
    
    return resultsWithDetails;
  }

  async createLibraryEntryConnection(connectionData: InsertLibraryEntryConnection): Promise<LibraryEntryConnection> {
    const [connection] = await db.insert(libraryEntryConnections).values(connectionData).returning();
    return connection;
  }

  async updateLibraryEntryConnection(id: number, connectionData: Partial<InsertLibraryEntryConnection>): Promise<LibraryEntryConnection> {
    const [connection] = await db
      .update(libraryEntryConnections)
      .set({ ...connectionData, updatedAt: new Date() })
      .where(eq(libraryEntryConnections.id, id))
      .returning();
    return connection;
  }

  async deleteLibraryEntryConnection(id: number): Promise<void> {
    await db.delete(libraryEntryConnections).where(eq(libraryEntryConnections.id, id));
  }

  async getConnectedEntries(entryId: number): Promise<(LibraryEntry & { connectionType: string; connectionStrength: number; category: LibraryCategory })[]> {
    const results = await db
      .select({
        entry: libraryEntries,
        category: libraryCategories,
        connectionType: libraryEntryConnections.connectionType,
        connectionStrength: libraryEntryConnections.strength
      })
      .from(libraryEntryConnections)
      .leftJoin(libraryEntries, or(
        and(eq(libraryEntryConnections.toEntryId, libraryEntries.id), eq(libraryEntryConnections.fromEntryId, entryId)),
        and(eq(libraryEntryConnections.fromEntryId, libraryEntries.id), eq(libraryEntryConnections.toEntryId, entryId))
      ))
      .leftJoin(libraryCategories, eq(libraryEntries.categoryId, libraryCategories.id))
      .where(and(
        eq(libraryEntryConnections.isActive, true),
        eq(libraryEntries.isActive, true),
        or(eq(libraryEntryConnections.fromEntryId, entryId), eq(libraryEntryConnections.toEntryId, entryId))
      ))
      .orderBy(desc(libraryEntryConnections.strength));

    return results.map(result => ({ 
      ...result.entry!, 
      category: result.category!,
      connectionType: result.connectionType!,
      connectionStrength: result.connectionStrength! 
    }));
  }

  // Assessment Templates Management
  async getAssessmentTemplates(): Promise<(AssessmentTemplate & { createdBy: User; sectionsCount: number })[]> {
    const templates = await db
      .select({
        id: assessmentTemplates.id,
        name: assessmentTemplates.name,
        description: assessmentTemplates.description,
        category: assessmentTemplates.category,
        isStandardized: assessmentTemplates.isStandardized,
        isActive: assessmentTemplates.isActive,
        createdById: assessmentTemplates.createdById,
        version: assessmentTemplates.version,
        createdAt: assessmentTemplates.createdAt,
        updatedAt: assessmentTemplates.updatedAt,
        createdBy: users,
        sectionsCount: count(assessmentSections.id)
      })
      .from(assessmentTemplates)
      .leftJoin(users, eq(assessmentTemplates.createdById, users.id))
      .leftJoin(assessmentSections, eq(assessmentTemplates.id, assessmentSections.templateId))
      .where(eq(assessmentTemplates.isActive, true))
      .groupBy(assessmentTemplates.id, users.id)
      .orderBy(desc(assessmentTemplates.createdAt));

    return templates.map(template => ({
      ...template,
      sectionsCount: Number(template.sectionsCount)
    }));
  }

  async getAssessmentTemplate(id: number): Promise<(AssessmentTemplate & { createdBy: User; sections: (AssessmentSection & { questions: (AssessmentQuestion & { options: AssessmentQuestionOption[] })[] })[] }) | undefined> {
    // This would be a complex query - implementing basic version for now
    const [template] = await db
      .select()
      .from(assessmentTemplates)
      .leftJoin(users, eq(assessmentTemplates.createdById, users.id))
      .where(eq(assessmentTemplates.id, id));

    if (!template) return undefined;

    // Get sections with questions and options - simplified implementation
    const sections = await db
      .select()
      .from(assessmentSections)
      .where(eq(assessmentSections.templateId, id))
      .orderBy(asc(assessmentSections.sortOrder));

    return {
      ...template.assessment_templates,
      createdBy: template.users!,
      sections: sections.map(section => ({ ...section, questions: [] })) // Simplified for now
    };
  }

  async createAssessmentTemplate(templateData: InsertAssessmentTemplate): Promise<AssessmentTemplate> {
    const [template] = await db
      .insert(assessmentTemplates)
      .values(templateData)
      .returning();
    return template;
  }

  async updateAssessmentTemplate(id: number, templateData: Partial<InsertAssessmentTemplate>): Promise<AssessmentTemplate> {
    const [template] = await db
      .update(assessmentTemplates)
      .set(templateData)
      .where(eq(assessmentTemplates.id, id))
      .returning();
    return template;
  }

  async deleteAssessmentTemplate(id: number): Promise<void> {
    await db.delete(assessmentTemplates).where(eq(assessmentTemplates.id, id));
  }

  // Assessment Sections Management
  async createAssessmentSection(sectionData: InsertAssessmentSection): Promise<AssessmentSection> {
    const [section] = await db
      .insert(assessmentSections)
      .values(sectionData)
      .returning();
    return section;
  }

  async updateAssessmentSection(id: number, sectionData: Partial<InsertAssessmentSection>): Promise<AssessmentSection> {
    const [section] = await db
      .update(assessmentSections)
      .set(sectionData)
      .where(eq(assessmentSections.id, id))
      .returning();
    return section;
  }

  async deleteAssessmentSection(id: number): Promise<void> {
    await db.delete(assessmentSections).where(eq(assessmentSections.id, id));
  }

  // Assessment Questions Management
  async createAssessmentQuestion(questionData: InsertAssessmentQuestion): Promise<AssessmentQuestion> {
    const [question] = await db
      .insert(assessmentQuestions)
      .values(questionData)
      .returning();
    return question;
  }

  async updateAssessmentQuestion(id: number, questionData: Partial<InsertAssessmentQuestion>): Promise<AssessmentQuestion> {
    const [question] = await db
      .update(assessmentQuestions)
      .set(questionData)
      .where(eq(assessmentQuestions.id, id))
      .returning();
    return question;
  }

  async deleteAssessmentQuestion(id: number): Promise<void> {
    await db.delete(assessmentQuestions).where(eq(assessmentQuestions.id, id));
  }

  // Assessment Question Options Management
  async createAssessmentQuestionOption(optionData: InsertAssessmentQuestionOption): Promise<AssessmentQuestionOption> {
    const [option] = await db
      .insert(assessmentQuestionOptions)
      .values(optionData)
      .returning();
    return option;
  }

  async updateAssessmentQuestionOption(id: number, optionData: Partial<InsertAssessmentQuestionOption>): Promise<AssessmentQuestionOption> {
    const [option] = await db
      .update(assessmentQuestionOptions)
      .set(optionData)
      .where(eq(assessmentQuestionOptions.id, id))
      .returning();
    return option;
  }

  async deleteAssessmentQuestionOption(id: number): Promise<void> {
    await db.delete(assessmentQuestionOptions).where(eq(assessmentQuestionOptions.id, id));
  }

  // Assessment Assignments Management
  async getAssessmentAssignments(clientId?: number): Promise<(AssessmentAssignment & { template: AssessmentTemplate; client: Client; assignedBy: User })[]> {
    const query = db
      .select()
      .from(assessmentAssignments)
      .leftJoin(assessmentTemplates, eq(assessmentAssignments.templateId, assessmentTemplates.id))
      .leftJoin(clients, eq(assessmentAssignments.clientId, clients.id))
      .leftJoin(users, eq(assessmentAssignments.assignedById, users.id))
      .orderBy(desc(assessmentAssignments.createdAt));

    if (clientId) {
      query.where(eq(assessmentAssignments.clientId, clientId));
    }

    const results = await query;
    return results.map(result => ({
      ...result.assessment_assignments,
      template: result.assessment_templates!,
      client: result.clients!,
      assignedBy: result.users!
    }));
  }

  async getAssessmentAssignment(id: number): Promise<(AssessmentAssignment & { template: AssessmentTemplate; client: Client; assignedBy: User; responses: AssessmentResponse[] }) | undefined> {
    const [result] = await db
      .select()
      .from(assessmentAssignments)
      .leftJoin(assessmentTemplates, eq(assessmentAssignments.templateId, assessmentTemplates.id))
      .leftJoin(clients, eq(assessmentAssignments.clientId, clients.id))
      .leftJoin(users, eq(assessmentAssignments.assignedById, users.id))
      .where(eq(assessmentAssignments.id, id));

    if (!result) return undefined;

    // Get responses - simplified for now
    const responses = await db
      .select()
      .from(assessmentResponses)
      .where(eq(assessmentResponses.assignmentId, id));

    return {
      ...result.assessment_assignments,
      template: result.assessment_templates!,
      client: result.clients!,
      assignedBy: result.users!,
      responses
    };
  }

  async createAssessmentAssignment(assignmentData: InsertAssessmentAssignment): Promise<AssessmentAssignment> {
    const [assignment] = await db
      .insert(assessmentAssignments)
      .values(assignmentData)
      .returning();
    return assignment;
  }

  async updateAssessmentAssignment(id: number, assignmentData: Partial<InsertAssessmentAssignment>): Promise<AssessmentAssignment> {
    const [assignment] = await db
      .update(assessmentAssignments)
      .set(assignmentData)
      .where(eq(assessmentAssignments.id, id))
      .returning();
    return assignment;
  }

  async deleteAssessmentAssignment(id: number): Promise<void> {
    await db.delete(assessmentAssignments).where(eq(assessmentAssignments.id, id));
  }

  async deleteAssessmentAssignmentsByTemplateId(templateId: number): Promise<void> {
    await db.delete(assessmentAssignments).where(eq(assessmentAssignments.templateId, templateId));
  }

  // Assessment Responses Management
  async getAssessmentResponses(assignmentId: number): Promise<(AssessmentResponse & { question: AssessmentQuestion; responder: User })[]> {
    const results = await db
      .select()
      .from(assessmentResponses)
      .leftJoin(assessmentQuestions, eq(assessmentResponses.questionId, assessmentQuestions.id))
      .leftJoin(users, eq(assessmentResponses.responderId, users.id))
      .where(eq(assessmentResponses.assignmentId, assignmentId))
      .orderBy(asc(assessmentResponses.createdAt));

    return results.map(result => ({
      ...result.assessment_responses,
      question: result.assessment_questions!,
      responder: result.users!
    }));
  }

  async createAssessmentResponse(responseData: InsertAssessmentResponse): Promise<AssessmentResponse> {
    const [response] = await db
      .insert(assessmentResponses)
      .values(responseData)
      .returning();
    return response;
  }

  async updateAssessmentResponse(id: number, responseData: Partial<InsertAssessmentResponse>): Promise<AssessmentResponse> {
    const [response] = await db
      .update(assessmentResponses)
      .set(responseData)
      .where(eq(assessmentResponses.id, id))
      .returning();
    return response;
  }

  async deleteAssessmentResponse(id: number): Promise<void> {
    await db.delete(assessmentResponses).where(eq(assessmentResponses.id, id));
  }

  // Assessment Reports Management
  async getAssessmentReport(assignmentId: number): Promise<(AssessmentReport & { assignment: AssessmentAssignment; createdBy: User }) | undefined> {
    const [result] = await db
      .select()
      .from(assessmentReports)
      .leftJoin(assessmentAssignments, eq(assessmentReports.assignmentId, assessmentAssignments.id))
      .leftJoin(users, eq(assessmentReports.createdById, users.id))
      .where(eq(assessmentReports.assignmentId, assignmentId));

    if (!result) return undefined;

    return {
      ...result.assessment_reports,
      assignment: result.assessment_assignments!,
      createdBy: result.users!
    };
  }

  async createAssessmentReport(reportData: InsertAssessmentReport): Promise<AssessmentReport> {
    const [report] = await db
      .insert(assessmentReports)
      .values(reportData)
      .returning();
    return report;
  }

  async updateAssessmentReport(id: number, reportData: Partial<InsertAssessmentReport>): Promise<AssessmentReport> {
    const [report] = await db
      .update(assessmentReports)
      .set(reportData)
      .where(eq(assessmentReports.id, id))
      .returning();
    return report;
  }

  async deleteAssessmentReport(id: number): Promise<void> {
    await db.delete(assessmentReports).where(eq(assessmentReports.id, id));
  }

  // Assessment Section Methods
  async getAssessmentSections(templateId: number): Promise<any[]> {
    try {
      const sections = await db.select().from(assessmentSections)
        .where(eq(assessmentSections.templateId, templateId));

      if (!sections || sections.length === 0) {
        return [];
      }

      // Get questions for each section
      const sectionsWithQuestions = [];
      for (const section of sections) {
        const questions = await db.select().from(assessmentQuestions)
          .where(eq(assessmentQuestions.sectionId, section.id));

        sectionsWithQuestions.push({
          ...section,
          questions: questions || []
        });
      }

      return sectionsWithQuestions;
    } catch (error) {
      console.error("Error in getAssessmentSections:", error);
      return [];
    }
  }

  async createAssessmentSection(data: InsertAssessmentSection): Promise<AssessmentSection> {
    const [section] = await db.insert(assessmentSections).values(data).returning();
    return section;
  }

  async updateAssessmentSection(id: number, data: Partial<InsertAssessmentSection>): Promise<AssessmentSection> {
    const [section] = await db.update(assessmentSections)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(assessmentSections.id, id))
      .returning();
    return section;
  }

  // Assessment Question Methods
  async createAssessmentQuestion(data: InsertAssessmentQuestion): Promise<AssessmentQuestion> {
    const [question] = await db.insert(assessmentQuestions).values(data).returning();
    return question;
  }

  async updateAssessmentQuestion(id: number, data: Partial<InsertAssessmentQuestion>): Promise<AssessmentQuestion> {
    const [question] = await db.update(assessmentQuestions)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(assessmentQuestions.id, id))
      .returning();
    return question;
  }
}

export const storage = new DatabaseStorage();
