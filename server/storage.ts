// Database Connection and Operators
import { db } from "./db";
import { eq, and, or, ilike, desc, asc, count, sql, gte, lte, inArray } from "drizzle-orm";

// Database Schema - Tables
import { 
  clients, 
  users,
  userProfiles,
  supervisorAssignments,
  userActivityLog,
  sessions, 
  tasks, 
  taskComments,
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
  services,
  rooms,
  roomBookings,
  sessionBilling,
  roles,
  permissions,
  rolePermissions,
  optionCategories,
  systemOptions,
  checklistTemplates,
  checklistItems,
  clientChecklists,
  clientChecklistItems
} from "@shared/schema";

// Database Schema - Types
import type { 
  Client, 
  InsertClient,
  User, 
  InsertUser,
  Session,
  InsertSession,
  Task,
  InsertTask,
  TaskComment,
  InsertTaskComment,
  Note,
  InsertNote,
  Document,
  InsertDocument,
  SessionNote,
  InsertSessionNote,
  LibraryCategory,
  InsertLibraryCategory,
  LibraryEntry,
  InsertLibraryEntry,
  LibraryEntryConnection,
  InsertLibraryEntryConnection,
  AssessmentTemplate,
  InsertAssessmentTemplate,
  AssessmentSection,
  InsertAssessmentSection,
  AssessmentQuestion,
  InsertAssessmentQuestion,
  AssessmentQuestionOption,
  InsertAssessmentQuestionOption,
  AssessmentAssignment,
  InsertAssessmentAssignment,
  AssessmentResponse,
  InsertAssessmentResponse,
  AssessmentReport,
  InsertAssessmentReport,
  ChecklistTemplate,
  InsertChecklistTemplate,
  ChecklistItem,
  InsertChecklistItem,
  ClientChecklist,
  InsertClientChecklist,
  ClientChecklistItem,
  InsertClientChecklistItem,
  SelectService,
  InsertService,
  SelectRoom,
  InsertRoom,
  Role,
  InsertRole,
  Permission,
  InsertPermission,
  RolePermission,
  InsertRolePermission,
  SelectRoomBooking,
  InsertRoomBooking,
  SelectSessionBilling,
  InsertSessionBilling,
  UserProfile,
  InsertUserProfile,
  SupervisorAssignment,
  InsertSupervisorAssignment,
  UserActivityLog,
  InsertUserActivityLog,
  SelectOptionCategory,
  InsertOptionCategory,
  SelectSystemOption,
  InsertSystemOption,
  ChecklistTemplate,
  ChecklistItem,
  ClientChecklist,
  ClientChecklistItem,
  InsertChecklistTemplate,
  InsertChecklistItem,
  InsertClientChecklist,
  InsertClientChecklistItem
} from "@shared/schema";

export interface ClientsQueryParams {
  page?: number;
  pageSize?: number;
  search?: string;
  status?: string;
  therapistId?: number;
  supervisedTherapistIds?: number[];
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

// ===== STORAGE INTERFACE DEFINITION =====
// Defines all data operations for the application
export interface IStorage {
  
  // ===== USER MANAGEMENT =====
  getUser(id: number): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  updateUser(id: number, user: Partial<InsertUser>): Promise<User>;
  getTherapists(): Promise<User[]>;
  getUsers(): Promise<User[]>;
  
  // ===== USER PROFILES =====
  getUserProfile(userId: number): Promise<UserProfile | undefined>;
  createUserProfile(profile: InsertUserProfile): Promise<UserProfile>;
  updateUserProfile(userId: number, profile: Partial<InsertUserProfile>): Promise<UserProfile>;
  deleteUserProfile(userId: number): Promise<void>;
  
  // ===== SUPERVISOR ASSIGNMENTS =====
  getSupervisorAssignments(supervisorId: number): Promise<SupervisorAssignment[]>;
  getTherapistSupervisor(therapistId: number): Promise<SupervisorAssignment | undefined>;
  createSupervisorAssignment(assignment: InsertSupervisorAssignment): Promise<SupervisorAssignment>;
  updateSupervisorAssignment(id: number, assignment: Partial<InsertSupervisorAssignment>): Promise<SupervisorAssignment>;
  deleteSupervisorAssignment(id: number): Promise<void>;
  
  // ===== USER ACTIVITY LOGGING =====
  logUserActivity(activity: InsertUserActivityLog): Promise<UserActivityLog>;
  getUserActivityHistory(userId: number, limit?: number): Promise<UserActivityLog[]>;

  // ===== ROLE AND PERMISSION MANAGEMENT =====
  getRoles(): Promise<Role[]>;
  getRole(id: number): Promise<Role | undefined>;
  createRole(role: InsertRole): Promise<Role>;
  updateRole(id: number, role: Partial<InsertRole>): Promise<Role>;
  deleteRole(id: number): Promise<void>;
  
  getPermissions(): Promise<Permission[]>;
  getPermission(id: number): Promise<Permission | undefined>;
  createPermission(permission: InsertPermission): Promise<Permission>;
  updatePermission(id: number, permission: Partial<InsertPermission>): Promise<Permission>;
  deletePermission(id: number): Promise<void>;
  
  getRolePermissions(roleId: number): Promise<Permission[]>;
  assignPermissionToRole(roleId: number, permissionId: number): Promise<RolePermission>;
  removePermissionFromRole(roleId: number, permissionId: number): Promise<void>;
  updateRolePermissions(roleId: number, permissionIds: number[]): Promise<void>;

  // ===== CLIENT MANAGEMENT =====
  getClients(params: ClientsQueryParams): Promise<ClientsQueryResult>;
  getClient(id: number): Promise<(Client & { assignedTherapist?: User }) | undefined>;
  getClientByClientId(clientId: string): Promise<Client | undefined>;
  createClient(client: InsertClient): Promise<Client>;
  updateClient(id: number, client: Partial<InsertClient>): Promise<Client>;
  deleteClient(id: number): Promise<void>;
  getClientCountByMonth(year: number, month: number): Promise<number>;
  getClientStats(): Promise<{
    totalClients: number;
    activeClients: number;
    inactiveClients: number;
    newIntakes: number;
    assessmentPhase: number;
    psychotherapy: number;
  }>;

  // ===== SESSION MANAGEMENT =====
  getAllSessions(): Promise<(Session & { therapist: User; client: Client })[]>;
  getSessionsByClient(clientId: number): Promise<(Session & { therapist: User })[]>;
  getSessionsByMonth(year: number, month: number): Promise<(Session & { therapist: User; client: Client })[]>;
  createSession(session: InsertSession): Promise<Session>;
  updateSession(id: number, session: Partial<InsertSession>): Promise<Session>;
  deleteSession(id: number): Promise<void>;

  // ===== TASK MANAGEMENT =====
  getAllTasks(params?: {
    page?: number;
    pageSize?: number;
    search?: string;
    status?: string;
    priority?: string;
    assignedToId?: number;
    clientId?: number;
    sortBy?: string;
    sortOrder?: 'asc' | 'desc';
    includeCompleted?: boolean;
  }): Promise<{
    tasks: (Task & { assignedTo?: User; client: Client })[];
    total: number;
    totalPages: number;
  }>;
  getTasksByClient(clientId: number): Promise<(Task & { assignedTo?: User })[]>;
  getTasksByAssignee(assigneeId: number): Promise<(Task & { client: Client })[]>;
  getTask(id: number): Promise<(Task & { assignedTo?: User; client: Client }) | undefined>;
  createTask(task: InsertTask): Promise<Task>;
  updateTask(id: number, task: Partial<InsertTask>): Promise<Task>;
  deleteTask(id: number): Promise<void>;
  getTaskStats(): Promise<{
    totalTasks: number;
    pendingTasks: number;
    inProgressTasks: number;
    completedTasks: number;
    overdueTasks: number;
    highPriorityTasks: number;
    urgentTasks: number;
  }>;
  getPendingTasksCount(): Promise<number>;
  getRecentTasks(limit?: number): Promise<(Task & { assignedTo?: User; client: Client })[]>;
  getUpcomingTasks(limit?: number): Promise<(Task & { assignedTo?: User; client: Client })[]>;

  // ===== Task Comments Management =====
  // Create a new task comment for progress tracking
  createTaskComment(commentData: InsertTaskComment): Promise<TaskComment>;
  // Get all comments for a specific task with author info
  getTaskComments(taskId: number): Promise<(TaskComment & { author: User })[]>;
  // Update task comment by ID
  updateTaskComment(id: number, commentData: Partial<InsertTaskComment>): Promise<TaskComment>;
  // Delete task comment by ID
  deleteTaskComment(id: number): Promise<void>;

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
  createAssessmentQuestionOptionsBulk(options: InsertAssessmentQuestionOption[]): Promise<AssessmentQuestionOption[]>;
  getAssessmentQuestionOptions(questionId: number): Promise<AssessmentQuestionOption[]>;
  updateAssessmentQuestionOption(id: number, option: Partial<InsertAssessmentQuestionOption>): Promise<AssessmentQuestionOption>;
  deleteAssessmentQuestionOption(id: number): Promise<void>;
  deleteAllAssessmentQuestionOptions(questionId: number): Promise<void>;

  // Assessment Assignments Management
  getAssessmentAssignments(clientId?: number): Promise<(AssessmentAssignment & { template: AssessmentTemplate; client: Client; assignedBy: User })[]>;
  getAssessmentAssignment(id: number): Promise<(AssessmentAssignment & { template: AssessmentTemplate; client: Client; assignedBy: User; responses: AssessmentResponse[] }) | undefined>;
  createAssessmentAssignment(assignment: InsertAssessmentAssignment): Promise<AssessmentAssignment>;
  updateAssessmentAssignment(id: number, assignment: Partial<InsertAssessmentAssignment>): Promise<AssessmentAssignment>;
  deleteAssessmentAssignment(id: number): Promise<void>;

  // Client Assessment Helper Methods
  getClientAssessments(clientId: number): Promise<(AssessmentAssignment & { template: AssessmentTemplate; assignedBy: User })[]>;
  assignAssessmentToClient(assignmentData: any): Promise<AssessmentAssignment>;

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

  // ===== SYSTEM OPTIONS MANAGEMENT =====
  // (Following same pattern as Services/Rooms)
  getOptionCategories(): Promise<SelectOptionCategory[]>;
  getOptionCategory(id: number): Promise<(SelectOptionCategory & { options: SelectSystemOption[] }) | undefined>;
  createOptionCategory(category: InsertOptionCategory): Promise<SelectOptionCategory>;
  updateOptionCategory(id: number, category: Partial<InsertOptionCategory>): Promise<SelectOptionCategory>;
  deleteOptionCategory(id: number): Promise<void>;

  getSystemOptions(categoryId?: number): Promise<(SelectSystemOption & { category: SelectOptionCategory })[]>;
  getSystemOptionsByCategory(categoryKey: string): Promise<SelectSystemOption[]>;
  getSystemOption(id: number): Promise<(SelectSystemOption & { category: SelectOptionCategory }) | undefined>;
  createSystemOption(option: InsertSystemOption): Promise<SelectSystemOption>;
  updateSystemOption(id: number, option: Partial<InsertSystemOption>): Promise<SelectSystemOption>;
  deleteSystemOption(id: number): Promise<void>;
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

  async updateUser(id: number, userData: Partial<InsertUser>): Promise<User> {
    const [user] = await db
      .update(users)
      .set({ ...userData, updatedAt: new Date() })
      .where(eq(users.id, id))
      .returning();
    return user;
  }

  async getTherapists(): Promise<User[]> {
    return await db
      .select()
      .from(users)
      .where(and(eq(users.role, 'therapist'), eq(users.isActive, true)))
      .orderBy(asc(users.fullName));
  }

  async getUsers(): Promise<User[]> {
    return await db
      .select()
      .from(users)
      .where(eq(users.isActive, true))
      .orderBy(asc(users.fullName));
  }

  // User Profile Methods
  async getUserProfile(userId: number): Promise<UserProfile | undefined> {
    const [profile] = await db
      .select()
      .from(userProfiles)
      .where(eq(userProfiles.userId, userId));
    return profile || undefined;
  }

  async createUserProfile(profile: InsertUserProfile): Promise<UserProfile> {
    const [createdProfile] = await db
      .insert(userProfiles)
      .values(profile)
      .returning();
    return createdProfile;
  }

  async updateUserProfile(userId: number, profileData: Partial<InsertUserProfile>): Promise<UserProfile> {
    const [profile] = await db
      .update(userProfiles)
      .set({ ...profileData, updatedAt: new Date() })
      .where(eq(userProfiles.userId, userId))
      .returning();
    return profile;
  }

  async deleteUserProfile(userId: number): Promise<void> {
    await db
      .delete(userProfiles)
      .where(eq(userProfiles.userId, userId));
  }

  // Supervisor Assignment Methods
  async getSupervisorAssignments(supervisorId: number): Promise<SupervisorAssignment[]> {
    return await db
      .select()
      .from(supervisorAssignments)
      .where(and(
        eq(supervisorAssignments.supervisorId, supervisorId),
        eq(supervisorAssignments.isActive, true)
      ))
      .orderBy(asc(supervisorAssignments.assignedDate));
  }

  async getTherapistSupervisor(therapistId: number): Promise<SupervisorAssignment | undefined> {
    const [assignment] = await db
      .select()
      .from(supervisorAssignments)
      .where(and(
        eq(supervisorAssignments.therapistId, therapistId),
        eq(supervisorAssignments.isActive, true)
      ));
    return assignment || undefined;
  }

  async createSupervisorAssignment(assignment: InsertSupervisorAssignment): Promise<SupervisorAssignment> {
    const [createdAssignment] = await db
      .insert(supervisorAssignments)
      .values(assignment)
      .returning();
    return createdAssignment;
  }

  async updateSupervisorAssignment(id: number, assignmentData: Partial<InsertSupervisorAssignment>): Promise<SupervisorAssignment> {
    const [assignment] = await db
      .update(supervisorAssignments)
      .set({ ...assignmentData, updatedAt: new Date() })
      .where(eq(supervisorAssignments.id, id))
      .returning();
    return assignment;
  }

  async getAllSupervisorAssignments(): Promise<any[]> {
    const result = await db
      .select({
        id: supervisorAssignments.id,
        supervisorId: supervisorAssignments.supervisorId,
        therapistId: supervisorAssignments.therapistId,
        assignedDate: supervisorAssignments.assignedDate,
        isActive: supervisorAssignments.isActive,
        notes: supervisorAssignments.notes,
        requiredMeetingFrequency: supervisorAssignments.requiredMeetingFrequency,
        nextMeetingDate: supervisorAssignments.nextMeetingDate,
        lastMeetingDate: supervisorAssignments.lastMeetingDate,
        createdAt: supervisorAssignments.createdAt,
        updatedAt: supervisorAssignments.updatedAt,
        supervisorName: sql<string>`supervisor.full_name`,
        therapistName: sql<string>`therapist.full_name`,
      })
      .from(supervisorAssignments)
      .leftJoin(
        sql`${users} as supervisor`,
        sql`${supervisorAssignments.supervisorId} = supervisor.id`
      )
      .leftJoin(
        sql`${users} as therapist`,
        sql`${supervisorAssignments.therapistId} = therapist.id`
      )
      .where(eq(supervisorAssignments.isActive, true))
      .orderBy(asc(supervisorAssignments.assignedDate));
    
    return result;
  }

  async deleteSupervisorAssignment(id: number): Promise<void> {
    await db
      .delete(supervisorAssignments)
      .where(eq(supervisorAssignments.id, id));
  }

  // User Activity Logging Methods
  async logUserActivity(activity: InsertUserActivityLog): Promise<UserActivityLog> {
    const [log] = await db
      .insert(userActivityLog)
      .values(activity)
      .returning();
    return log;
  }

  async getUserActivityHistory(userId: number, limit: number = 50): Promise<UserActivityLog[]> {
    return await db
      .select()
      .from(userActivityLog)
      .where(eq(userActivityLog.userId, userId))
      .orderBy(desc(userActivityLog.timestamp))
      .limit(limit);
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
    
    if (params.supervisedTherapistIds && params.supervisedTherapistIds.length > 0) {
      whereConditions.push(inArray(clients.assignedTherapistId, params.supervisedTherapistIds));
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

  async getClient(id: number): Promise<(Client & { assignedTherapist?: User; sessionCount?: number }) | undefined> {
    const [result] = await db
      .select({
        client: clients,
        assignedTherapist: users,
        sessionCount: sql<number>`(
          SELECT COUNT(*) FROM ${sessions} 
          WHERE ${sessions.clientId} = ${clients.id}
        )`.as('sessionCount')
      })
      .from(clients)
      .leftJoin(users, eq(clients.assignedTherapistId, users.id))
      .where(eq(clients.id, id));

    if (!result) return undefined;

    return {
      ...result.client,
      assignedTherapist: result.assignedTherapist || undefined,
      sessionCount: result.sessionCount
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

  async getClientCountByMonth(year: number, month: number): Promise<number> {
    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 0);
    
    const [result] = await db
      .select({ count: count() })
      .from(clients)
      .where(and(
        gte(clients.createdAt, startDate),
        lte(clients.createdAt, endDate)
      ));
    
    return result.count;
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

  async getSessionsByMonth(year: number, month: number): Promise<(Session & { therapist: User; client: Client })[]> {
    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 0);

    const results = await db
      .select({
        session: sessions,
        therapist: users,
        client: clients
      })
      .from(sessions)
      .innerJoin(users, eq(sessions.therapistId, users.id))
      .innerJoin(clients, eq(sessions.clientId, clients.id))
      .where(
        and(
          sql`DATE(${sessions.sessionDate}) >= ${startDate.toISOString().split('T')[0]}`,
          sql`DATE(${sessions.sessionDate}) <= ${endDate.toISOString().split('T')[0]}`
        )
      )
      .orderBy(desc(sessions.sessionDate));

    return results.map(r => ({ 
      ...r.session, 
      therapist: r.therapist, 
      client: r.client 
    }));
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
    
    // Billing trigger: Create billing record when session is completed
    if (sessionData.status === 'completed') {
      await this.createBillingRecord(session);
    }
    
    return session;
  }

  async deleteSession(id: number): Promise<void> {
    await db.delete(sessions).where(eq(sessions.id, id));
  }

  // Billing trigger method - Creates billing record when session is completed
  private async createBillingRecord(session: Session): Promise<void> {
    try {
      // Get service details for billing
      const [service] = await db
        .select()
        .from(services)
        .where(eq(services.id, session.serviceId));

      if (!service) {
        return;
      }

      // Get client insurance information
      const [client] = await db
        .select()
        .from(clients)
        .where(eq(clients.id, session.clientId));

      if (!client) {
        return;
      }

      // Check if billing record already exists
      const existingBilling = await db
        .select()
        .from(sessionBilling)
        .where(eq(sessionBilling.sessionId, session.id));

      if (existingBilling.length > 0) {
        return;
      }

      // Create billing record
      const billingData = {
        sessionId: session.id,
        serviceCode: service.serviceCode,
        units: 1,
        ratePerUnit: service.baseRate,
        totalAmount: service.baseRate,
        insuranceCovered: !!client.insuranceProvider,
        copayAmount: client.copayAmount || null,
        billingDate: new Date().toISOString().split('T')[0], // Current date
        paymentStatus: 'pending' as const,
      };

      await db.insert(sessionBilling).values(billingData);
    } catch (error) {
    }
  }

  // Billing methods
  async getBillingRecordsBySession(sessionId: number): Promise<SelectSessionBilling[]> {
    return await db
      .select()
      .from(sessionBilling)
      .where(eq(sessionBilling.sessionId, sessionId));
  }

  async getBillingRecordsByClient(clientId: number): Promise<(SelectSessionBilling & { session: Session; service?: any })[]> {
    const results = await db
      .select({
        billing: sessionBilling,
        session: sessions,
        service: services
      })
      .from(sessionBilling)
      .innerJoin(sessions, eq(sessionBilling.sessionId, sessions.id))
      .leftJoin(services, eq(sessions.serviceId, services.id))
      .where(eq(sessions.clientId, clientId))
      .orderBy(desc(sessionBilling.billingDate));

    return results.map(r => ({ 
      ...r.billing, 
      session: r.session,
      service: r.service,
      // Override billing fields with actual service data if available
      serviceName: r.service?.serviceName || r.billing.serviceCode,
      serviceCode: r.service?.serviceCode || r.billing.serviceCode,
      amount: r.billing.totalAmount || r.service?.baseRate || r.billing.totalAmount,
      serviceDate: r.session.sessionDate
    }));
  }

  async updateBillingStatus(billingId: number, status: 'pending' | 'billed' | 'paid' | 'denied' | 'refunded'): Promise<void> {
    await db
      .update(sessionBilling)
      .set({ paymentStatus: status, updatedAt: new Date() })
      .where(eq(sessionBilling.id, billingId));
  }

  async updatePaymentDetails(billingId: number, paymentData: {
    status: 'pending' | 'billed' | 'paid' | 'denied' | 'refunded';
    amount?: number;
    date?: string;
    reference?: string;
    method?: string;
    notes?: string;
  }): Promise<void> {
    const updateData: any = {
      paymentStatus: paymentData.status,
      updatedAt: new Date()
    };

    if (paymentData.amount !== undefined) {
      updateData.paymentAmount = paymentData.amount.toString();
    }
    if (paymentData.date) {
      updateData.paymentDate = paymentData.date;
    }
    if (paymentData.reference) {
      updateData.paymentReference = paymentData.reference;
    }
    if (paymentData.method) {
      updateData.paymentMethod = paymentData.method;
    }
    if (paymentData.notes) {
      updateData.paymentNotes = paymentData.notes;
    }

    await db
      .update(sessionBilling)
      .set(updateData)
      .where(eq(sessionBilling.id, billingId));
  }

  // Enhanced Task Management Methods
  async getAllTasks(params?: {
    page?: number;
    pageSize?: number;
    search?: string;
    status?: string;
    priority?: string;
    assignedToId?: number;
    clientId?: number;
    sortBy?: string;
    sortOrder?: 'asc' | 'desc';
    includeCompleted?: boolean;
  }): Promise<{
    tasks: (Task & { assignedTo?: User; client: Client })[];
    total: number;
    totalPages: number;
  }> {
    const page = params?.page || 1;
    const pageSize = params?.pageSize || 25;
    const offset = (page - 1) * pageSize;

    // Build where conditions
    const conditions = [];
    
    if (params?.search) {
      conditions.push(
        or(
          ilike(tasks.title, `%${params.search}%`),
          ilike(tasks.description, `%${params.search}%`),
          ilike(clients.fullName, `%${params.search}%`)
        )
      );
    }
    
    if (params?.status) {
      conditions.push(eq(tasks.status, params.status));
    }
    
    if (params?.priority) {
      conditions.push(eq(tasks.priority, params.priority));
    }
    
    if (params?.assignedToId) {
      conditions.push(eq(tasks.assignedToId, params.assignedToId));
    }
    
    if (params?.clientId) {
      conditions.push(eq(tasks.clientId, params.clientId));
    }
    
    if (!params?.includeCompleted) {
      conditions.push(or(
        eq(tasks.status, 'pending'),
        eq(tasks.status, 'in_progress'),
        eq(tasks.status, 'overdue')
      ));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    // Get total count
    const [{ count: totalCount }] = await db
      .select({ count: count() })
      .from(tasks)
      .innerJoin(clients, eq(tasks.clientId, clients.id))
      .where(whereClause);

    // Get tasks with pagination
    const results = await db
      .select({
        task: tasks,
        assignedTo: users,
        client: clients
      })
      .from(tasks)
      .innerJoin(clients, eq(tasks.clientId, clients.id))
      .leftJoin(users, eq(tasks.assignedToId, users.id))
      .where(whereClause)
      .orderBy(
        params?.sortOrder === 'asc' 
          ? asc(params?.sortBy === 'dueDate' ? tasks.dueDate : params?.sortBy === 'priority' ? tasks.priority : tasks.createdAt)
          : desc(params?.sortBy === 'dueDate' ? tasks.dueDate : params?.sortBy === 'priority' ? tasks.priority : tasks.createdAt)
      )
      .limit(pageSize)
      .offset(offset);

    return {
      tasks: results.map(r => ({ 
        ...r.task, 
        assignedTo: r.assignedTo || undefined,
        client: r.client
      })),
      total: totalCount,
      totalPages: Math.ceil(totalCount / pageSize)
    };
  }

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

  async getTasksByAssignee(assigneeId: number): Promise<(Task & { client: Client })[]> {
    const results = await db
      .select({
        task: tasks,
        client: clients
      })
      .from(tasks)
      .innerJoin(clients, eq(tasks.clientId, clients.id))
      .where(eq(tasks.assignedToId, assigneeId))
      .orderBy(desc(tasks.createdAt));

    return results.map(r => ({ ...r.task, client: r.client }));
  }

  async getTask(id: number): Promise<(Task & { assignedTo?: User; client: Client }) | undefined> {
    const results = await db
      .select({
        task: tasks,
        assignedTo: users,
        client: clients
      })
      .from(tasks)
      .innerJoin(clients, eq(tasks.clientId, clients.id))
      .leftJoin(users, eq(tasks.assignedToId, users.id))
      .where(eq(tasks.id, id));

    if (results.length === 0) return undefined;
    
    const r = results[0];
    return { 
      ...r.task, 
      assignedTo: r.assignedTo || undefined,
      client: r.client
    };
  }

  async createTask(task: InsertTask): Promise<Task> {
    const [newTask] = await db
      .insert(tasks)
      .values(task)
      .returning();
    return newTask;
  }

  async updateTask(id: number, taskData: Partial<InsertTask>): Promise<Task> {
    // Auto-set completion timestamp when status changes to completed
    if (taskData.status === 'completed' && !taskData.completedAt) {
      taskData.completedAt = new Date();
    }
    
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

  async getTaskStats(): Promise<{
    totalTasks: number;
    pendingTasks: number;
    inProgressTasks: number;
    completedTasks: number;
    overdueTasks: number;
    highPriorityTasks: number;
    urgentTasks: number;
  }> {
    const [stats] = await db
      .select({
        totalTasks: count(),
        pendingTasks: sql<number>`COUNT(*) FILTER (WHERE status = 'pending')`,
        inProgressTasks: sql<number>`COUNT(*) FILTER (WHERE status = 'in_progress')`,
        completedTasks: sql<number>`COUNT(*) FILTER (WHERE status = 'completed')`,
        overdueTasks: sql<number>`COUNT(*) FILTER (WHERE status = 'overdue')`,
        highPriorityTasks: sql<number>`COUNT(*) FILTER (WHERE priority = 'high')`,
        urgentTasks: sql<number>`COUNT(*) FILTER (WHERE priority = 'urgent')`
      })
      .from(tasks);

    return stats;
  }

  async getPendingTasksCount(): Promise<number> {
    const [{ count: pendingCount }] = await db
      .select({ count: count() })
      .from(tasks)
      .where(or(eq(tasks.status, 'pending'), eq(tasks.status, 'overdue')));
    
    return pendingCount;
  }

  async getRecentTasks(limit: number = 10): Promise<(Task & { assignedTo?: User; client: Client })[]> {
    const results = await db
      .select({
        task: tasks,
        assignedTo: users,
        client: clients
      })
      .from(tasks)
      .innerJoin(clients, eq(tasks.clientId, clients.id))
      .leftJoin(users, eq(tasks.assignedToId, users.id))
      .orderBy(desc(tasks.createdAt))
      .limit(limit);

    return results.map(r => ({ 
      ...r.task, 
      assignedTo: r.assignedTo || undefined,
      client: r.client
    }));
  }

  async getUpcomingTasks(limit: number = 10): Promise<(Task & { assignedTo?: User; client: Client })[]> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const results = await db
      .select({
        task: tasks,
        assignedTo: users,
        client: clients
      })
      .from(tasks)
      .innerJoin(clients, eq(tasks.clientId, clients.id))
      .leftJoin(users, eq(tasks.assignedToId, users.id))
      .where(
        and(
          or(eq(tasks.status, 'pending'), eq(tasks.status, 'in_progress')),
          sql`${tasks.dueDate} >= ${today.toISOString()}`
        )
      )
      .orderBy(asc(tasks.dueDate))
      .limit(limit);

    return results.map(r => ({ 
      ...r.task, 
      assignedTo: r.assignedTo || undefined,
      client: r.client
    }));
  }

  // ===== TASK COMMENTS METHODS =====
  // Create a new task comment for progress tracking and communication
  async createTaskComment(commentData: InsertTaskComment): Promise<TaskComment> {
    const [newComment] = await db
      .insert(taskComments)
      .values(commentData)
      .returning();
    return newComment;
  }

  // Get all comments for a specific task with author information
  async getTaskComments(taskId: number): Promise<(TaskComment & { author: User })[]> {
    const results = await db
      .select({
        comment: taskComments,
        author: users
      })
      .from(taskComments)
      .innerJoin(users, eq(taskComments.authorId, users.id))
      .where(eq(taskComments.taskId, taskId))
      .orderBy(asc(taskComments.createdAt));

    return results.map(r => ({ ...r.comment, author: r.author }));
  }

  // Update task comment by ID
  async updateTaskComment(id: number, commentData: Partial<InsertTaskComment>): Promise<TaskComment> {
    const [updatedComment] = await db
      .update(taskComments)
      .set({ ...commentData, updatedAt: new Date() })
      .where(eq(taskComments.id, id))
      .returning();
    return updatedComment;
  }

  // Delete task comment by ID
  async deleteTaskComment(id: number): Promise<void> {
    await db
      .delete(taskComments)
      .where(eq(taskComments.id, id));
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

  async createAssessmentQuestionOptionsBulk(options: InsertAssessmentQuestionOption[]): Promise<AssessmentQuestionOption[]> {
    if (options.length === 0) return [];
    
    const createdOptions = await db
      .insert(assessmentQuestionOptions)
      .values(options)
      .returning();
    return createdOptions;
  }

  async getAssessmentQuestionOptions(questionId: number): Promise<AssessmentQuestionOption[]> {
    return await db
      .select()
      .from(assessmentQuestionOptions)
      .where(eq(assessmentQuestionOptions.questionId, questionId))
      .orderBy(asc(assessmentQuestionOptions.sortOrder));
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

  async deleteAllAssessmentQuestionOptions(questionId: number): Promise<void> {
    await db.delete(assessmentQuestionOptions).where(eq(assessmentQuestionOptions.questionId, questionId));
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

  // Client Assessment Helper Methods
  async getClientAssessments(clientId: number): Promise<(AssessmentAssignment & { template: AssessmentTemplate; assignedBy: User })[]> {
    const results = await db
      .select()
      .from(assessmentAssignments)
      .leftJoin(assessmentTemplates, eq(assessmentAssignments.templateId, assessmentTemplates.id))
      .leftJoin(users, eq(assessmentAssignments.assignedById, users.id))
      .where(eq(assessmentAssignments.clientId, clientId))
      .orderBy(desc(assessmentAssignments.createdAt));

    return results.map(result => ({
      ...result.assessment_assignments,
      template: result.assessment_templates!,
      assignedBy: result.users!
    }));
  }

  async assignAssessmentToClient(assignmentData: any): Promise<AssessmentAssignment> {
    const [assignment] = await db
      .insert(assessmentAssignments)
      .values({
        clientId: assignmentData.clientId,
        templateId: assignmentData.templateId,
        assignedById: assignmentData.assignedBy,
        status: assignmentData.status || 'pending',
        dueDate: null,
        completedAt: null,
        finalizedAt: null,
        clientSubmittedAt: null,
        therapistCompletedAt: null,
        totalScore: null,
        notes: null,
        createdAt: assignmentData.assignedDate || new Date(),
        updatedAt: new Date()
      })
      .returning();
    return assignment;
  }

  // Get single assignment with full relationships for completion workflow
  async getAssessmentAssignmentById(assignmentId: number): Promise<(AssessmentAssignment & { template: AssessmentTemplate; client: Client; assignedBy: User }) | undefined> {
    const [result] = await db
      .select()
      .from(assessmentAssignments)
      .leftJoin(assessmentTemplates, eq(assessmentAssignments.templateId, assessmentTemplates.id))
      .leftJoin(clients, eq(assessmentAssignments.clientId, clients.id))
      .leftJoin(users, eq(assessmentAssignments.assignedById, users.id))
      .where(eq(assessmentAssignments.id, assignmentId));

    if (!result || !result.assessment_assignments) return undefined;

    return {
      ...result.assessment_assignments,
      template: result.assessment_templates!,
      client: result.clients!,
      assignedBy: result.users!
    };
  }

  // Get template sections with questions for assessment completion
  async getAssessmentTemplateSections(templateId: number): Promise<(AssessmentSection & { questions: AssessmentQuestion[] })[]> {
    const sections = await db
      .select()
      .from(assessmentSections)
      .where(eq(assessmentSections.templateId, templateId))
      .orderBy(asc(assessmentSections.sortOrder));

    const sectionsWithQuestions = await Promise.all(
      sections.map(async (section) => {
        const questions = await db
          .select()
          .from(assessmentQuestions)
          .where(eq(assessmentQuestions.sectionId, section.id))
          .orderBy(asc(assessmentQuestions.sortOrder));

        return {
          ...section,
          questions
        };
      })
    );

    return sectionsWithQuestions;
  }

  // Save or update assessment response
  async saveAssessmentResponse(responseData: any): Promise<AssessmentResponse> {
    // Check if response already exists
    const [existingResponse] = await db
      .select()
      .from(assessmentResponses)
      .where(
        and(
          eq(assessmentResponses.assignmentId, responseData.assignmentId),
          eq(assessmentResponses.questionId, responseData.questionId),
          eq(assessmentResponses.responderId, responseData.responderId)
        )
      );

    if (existingResponse) {
      // Update existing response
      const [updatedResponse] = await db
        .update(assessmentResponses)
        .set({
          responseText: responseData.responseText,
          selectedOptions: responseData.selectedOptions,
          ratingValue: responseData.ratingValue,
          updatedAt: new Date()
        })
        .where(eq(assessmentResponses.id, existingResponse.id))
        .returning();
      return updatedResponse;
    } else {
      // Create new response
      const [newResponse] = await db
        .insert(assessmentResponses)
        .values({
          assignmentId: responseData.assignmentId,
          questionId: responseData.questionId,
          responderId: responseData.responderId,
          responseText: responseData.responseText,
          selectedOptions: responseData.selectedOptions,
          ratingValue: responseData.ratingValue,
          createdAt: new Date(),
          updatedAt: new Date()
        })
        .returning();
      return newResponse;
    }
  }

  // Update assessment assignment status and completion details
  async updateAssessmentAssignment(assignmentId: number, updateData: any): Promise<AssessmentAssignment> {
    // Convert date strings to Date objects
    const processedData = { ...updateData };
    if (processedData.completedAt && typeof processedData.completedAt === 'string') {
      processedData.completedAt = new Date(processedData.completedAt);
    }
    if (processedData.therapistCompletedAt && typeof processedData.therapistCompletedAt === 'string') {
      processedData.therapistCompletedAt = new Date(processedData.therapistCompletedAt);
    }
    if (processedData.clientSubmittedAt && typeof processedData.clientSubmittedAt === 'string') {
      processedData.clientSubmittedAt = new Date(processedData.clientSubmittedAt);
    }
    if (processedData.finalizedAt && typeof processedData.finalizedAt === 'string') {
      processedData.finalizedAt = new Date(processedData.finalizedAt);
    }

    const [assignment] = await db
      .update(assessmentAssignments)
      .set({
        ...processedData,
        updatedAt: new Date()
      })
      .where(eq(assessmentAssignments.id, assignmentId))
      .returning();
    return assignment;
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

  // Delete assessment assignment and its responses
  async deleteAssessmentAssignment(assignmentId: number): Promise<void> {
    // First delete all responses for this assignment
    await db.delete(assessmentResponses).where(eq(assessmentResponses.assignmentId, assignmentId));
    
    // Then delete the assignment itself
    await db.delete(assessmentAssignments).where(eq(assessmentAssignments.id, assignmentId));
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

        // Get options for each question
        const questionsWithOptions = [];
        for (const question of questions) {
          const options = await this.getAssessmentQuestionOptions(question.id);
          questionsWithOptions.push({
            ...question,
            options: options.map(opt => opt.optionText),
            scoreValues: options.map(opt => Number(opt.optionValue) || 0)
          });
        }

        sectionsWithQuestions.push({
          ...section,
          questions: questionsWithOptions || []
        });
      }

      return sectionsWithQuestions;
    } catch (error) {
      throw error;
    }
  }



  // Assessment Question Options Methods
  async getAssessmentQuestionOptions(questionId: number): Promise<AssessmentQuestionOption[]> {
    const options = await db.select().from(assessmentQuestionOptions)
      .where(eq(assessmentQuestionOptions.questionId, questionId))
      .orderBy(asc(assessmentQuestionOptions.sortOrder));
    return options;
  }

  // Service Management Methods
  async getServices(): Promise<SelectService[]> {
    const serviceList = await db.select().from(services)
      .where(eq(services.isActive, true))
      .orderBy(asc(services.serviceName));
    return serviceList;
  }

  async createService(serviceData: InsertService): Promise<SelectService> {
    const [service] = await db.insert(services).values(serviceData).returning();
    return service;
  }

  async getServiceById(id: number): Promise<SelectService | null> {
    const [service] = await db.select().from(services).where(eq(services.id, id));
    return service || null;
  }

  // Room Management Methods
  async getRooms(): Promise<SelectRoom[]> {
    const roomList = await db.select().from(rooms)
      .where(eq(rooms.isActive, true))
      .orderBy(asc(rooms.roomNumber));
    return roomList;
  }

  async createRoom(roomData: InsertRoom): Promise<SelectRoom> {
    const [room] = await db.insert(rooms).values(roomData).returning();
    return room;
  }

  async getRoomById(id: number): Promise<SelectRoom | null> {
    const [room] = await db.select().from(rooms).where(eq(rooms.id, id));
    return room || null;
  }

  // Room Availability Methods
  async checkRoomAvailability(date: string, startTime: string, endTime: string, excludeSessionId?: number): Promise<SelectRoom[]> {
    const startDateTime = new Date(`${date}T${startTime}`);
    const endDateTime = new Date(`${date}T${endTime}`);
    
    // Find rooms that are NOT booked during the requested time
    const availableRooms = await db.select().from(rooms)
      .where(
        and(
          eq(rooms.isActive, true),
          sql`${rooms.id} NOT IN (
            SELECT DISTINCT ${roomBookings.roomId}
            FROM ${roomBookings}
            WHERE (
              ${roomBookings.startTime} < ${endDateTime.toISOString()}
              AND ${roomBookings.endTime} > ${startDateTime.toISOString()}
              ${excludeSessionId ? sql`AND ${roomBookings.sessionId} != ${excludeSessionId}` : sql``}
            )
          )`
        )
      )
      .orderBy(asc(rooms.roomNumber));
    
    return availableRooms;
  }

  // ===== ROLE AND PERMISSION MANAGEMENT IMPLEMENTATION =====
  
  // Role Methods
  async getRoles(): Promise<Role[]> {
    const rolesList = await db.select().from(roles)
      .where(eq(roles.isActive, true))
      .orderBy(asc(roles.name));
    
    // Get permissions for each role
    const rolesWithPermissions = [];
    for (const role of rolesList) {
      const permissions = await this.getRolePermissions(role.id);
      rolesWithPermissions.push({
        ...role,
        permissions
      });
    }
    
    return rolesWithPermissions;
  }

  async getRole(id: number): Promise<Role | undefined> {
    const [role] = await db.select().from(roles).where(eq(roles.id, id));
    if (!role) return undefined;
    
    const permissions = await this.getRolePermissions(id);
    return {
      ...role,
      permissions
    };
  }

  async createRole(roleData: InsertRole): Promise<Role> {
    const [role] = await db.insert(roles).values(roleData).returning();
    return role;
  }

  async updateRole(id: number, roleData: Partial<InsertRole>): Promise<Role> {
    const [role] = await db.update(roles)
      .set({ ...roleData, updatedAt: new Date() })
      .where(eq(roles.id, id))
      .returning();
    return role;
  }

  async deleteRole(id: number): Promise<void> {
    // First delete all role permissions
    await db.delete(rolePermissions).where(eq(rolePermissions.roleId, id));
    // Then delete the role
    await db.delete(roles).where(eq(roles.id, id));
  }

  // Permission Methods
  async getPermissions(): Promise<Permission[]> {
    const permissionsList = await db.select().from(permissions)
      .where(eq(permissions.isActive, true))
      .orderBy(asc(permissions.category), asc(permissions.name));
    return permissionsList;
  }

  async getPermission(id: number): Promise<Permission | undefined> {
    const [permission] = await db.select().from(permissions).where(eq(permissions.id, id));
    return permission;
  }

  async createPermission(permissionData: InsertPermission): Promise<Permission> {
    const [permission] = await db.insert(permissions).values(permissionData).returning();
    return permission;
  }

  async updatePermission(id: number, permissionData: Partial<InsertPermission>): Promise<Permission> {
    const [permission] = await db.update(permissions)
      .set(permissionData)
      .where(eq(permissions.id, id))
      .returning();
    return permission;
  }

  async deletePermission(id: number): Promise<void> {
    // First delete all role permissions
    await db.delete(rolePermissions).where(eq(rolePermissions.permissionId, id));
    // Then delete the permission
    await db.delete(permissions).where(eq(permissions.id, id));
  }

  // Role Permission Methods
  async getRolePermissions(roleId: number): Promise<Permission[]> {
    const results = await db.select({
      id: permissions.id,
      name: permissions.name,
      displayName: permissions.displayName,
      description: permissions.description,
      category: permissions.category,
      isActive: permissions.isActive,
      createdAt: permissions.createdAt,
    })
      .from(rolePermissions)
      .innerJoin(permissions, eq(rolePermissions.permissionId, permissions.id))
      .where(eq(rolePermissions.roleId, roleId));
    
    return results;
  }

  async assignPermissionToRole(roleId: number, permissionId: number): Promise<RolePermission> {
    const [rolePermission] = await db.insert(rolePermissions)
      .values({ roleId, permissionId })
      .returning();
    return rolePermission;
  }

  async removePermissionFromRole(roleId: number, permissionId: number): Promise<void> {
    await db.delete(rolePermissions)
      .where(and(
        eq(rolePermissions.roleId, roleId),
        eq(rolePermissions.permissionId, permissionId)
      ));
  }

  async updateRolePermissions(roleId: number, permissionIds: number[]): Promise<void> {
    // Remove all existing permissions for this role
    await db.delete(rolePermissions).where(eq(rolePermissions.roleId, roleId));
    
    // Add new permissions
    if (permissionIds.length > 0) {
      const rolePermissionData = permissionIds.map(permissionId => ({
        roleId,
        permissionId
      }));
      await db.insert(rolePermissions).values(rolePermissionData);
    }
  }

  // Enhanced Session Management with Billing
  async updateSessionStatus(sessionId: number, status: string): Promise<Session> {
    const [updatedSession] = await db.update(sessions)
      .set({ status: status as any, updatedAt: new Date() })
      .where(eq(sessions.id, sessionId))
      .returning();
    
    return updatedSession;
  }

  async createSessionBilling(sessionId: number): Promise<SelectSessionBilling | null> {
    // Get session and service information
    const [sessionData] = await db.select({
      session: sessions,
      service: services
    })
    .from(sessions)
    .leftJoin(services, eq(sessions.serviceId, services.id))
    .where(eq(sessions.id, sessionId));
    
    if (!sessionData || !sessionData.session) {
      throw new Error('Session not found');
    }
    
    if (!sessionData.service) {
      // Skip billing for sessions without service information
      return null;
    }
    
    // Create billing record
    const billingData: InsertSessionBilling = {
      sessionId: sessionId,
      serviceCode: sessionData.service.serviceCode,
      units: 1,
      ratePerUnit: sessionData.service.baseRate,
      totalAmount: sessionData.service.baseRate,
      insuranceCovered: false,
      paymentStatus: 'pending',
      billingDate: new Date().toISOString().split('T')[0]
    };
    
    const [billing] = await db.insert(sessionBilling).values(billingData).returning();
    
    // Update session with calculated rate
    await db.update(sessions)
      .set({ calculatedRate: sessionData.service.baseRate })
      .where(eq(sessions.id, sessionId));
    
    return billing;
  }

  async getSessionBilling(sessionId: number): Promise<SelectSessionBilling | null> {
    const [billing] = await db.select().from(sessionBilling)
      .where(eq(sessionBilling.sessionId, sessionId));
    return billing || null;
  }

  async getBillingReports(params: {
    startDate?: string;
    endDate?: string;
    therapistId?: number;
    status?: string;
  }): Promise<any[]> {
    let query = db.select({
      billing: sessionBilling,
      session: sessions,
      client: clients,
      therapist: users,
      service: services
    })
    .from(sessionBilling)
    .innerJoin(sessions, eq(sessionBilling.sessionId, sessions.id))
    .innerJoin(clients, eq(sessions.clientId, clients.id))
    .innerJoin(users, eq(sessions.therapistId, users.id))
    .innerJoin(services, eq(sessions.serviceId, services.id));
    
    const conditions = [];
    
    if (params.startDate) {
      conditions.push(sql`${sessionBilling.billingDate} >= ${params.startDate}`);
    }
    
    if (params.endDate) {
      conditions.push(sql`${sessionBilling.billingDate} <= ${params.endDate}`);
    }
    
    if (params.therapistId) {
      conditions.push(eq(sessions.therapistId, params.therapistId));
    }
    
    if (params.status) {
      conditions.push(eq(sessionBilling.paymentStatus, params.status as any));
    }
    
    if (conditions.length > 0) {
      query = query.where(and(...conditions));
    }
    
    const results = await query.orderBy(desc(sessionBilling.billingDate));
    return results;
  }

  // ===== SYSTEM OPTIONS MANAGEMENT =====
  // (Following same pattern as Services/Rooms)

  // Option Categories Management
  async getOptionCategories(): Promise<SelectOptionCategory[]> {
    return await db.select().from(optionCategories).where(eq(optionCategories.isActive, true)).orderBy(optionCategories.categoryName);
  }

  async getOptionCategory(id: number): Promise<(SelectOptionCategory & { options: SelectSystemOption[] }) | undefined> {
    const [category] = await db.select().from(optionCategories).where(eq(optionCategories.id, id));
    if (!category) return undefined;

    const options = await db.select().from(systemOptions)
      .where(and(eq(systemOptions.categoryId, id), eq(systemOptions.isActive, true)))
      .orderBy(systemOptions.sortOrder, systemOptions.optionLabel);

    return { ...category, options };
  }

  async createOptionCategory(categoryData: InsertOptionCategory): Promise<SelectOptionCategory> {
    const [category] = await db.insert(optionCategories).values(categoryData).returning();
    return category;
  }

  async updateOptionCategory(id: number, categoryData: Partial<InsertOptionCategory>): Promise<SelectOptionCategory> {
    const [category] = await db.update(optionCategories)
      .set({ ...categoryData, updatedAt: new Date() })
      .where(eq(optionCategories.id, id))
      .returning();
    return category;
  }

  async deleteOptionCategory(id: number): Promise<void> {
    await db.delete(optionCategories).where(eq(optionCategories.id, id));
  }

  // ===== CHECKLIST TEMPLATE MANAGEMENT =====
  // Database-backed storage for checklist templates and items

  // Checklist Template Management
  async getChecklistTemplates(): Promise<(ChecklistTemplate & { items: ChecklistItem[] })[]> {
    const templates = await db.select().from(checklistTemplates)
      .where(eq(checklistTemplates.isActive, true))
      .orderBy(checklistTemplates.sortOrder, checklistTemplates.name);

    // Get items for each template
    const templatesWithItems = await Promise.all(templates.map(async (template) => {
      const items = await db.select().from(checklistItems)
        .where(eq(checklistItems.templateId, template.id))
        .orderBy(checklistItems.sortOrder, checklistItems.title);
      
      return { ...template, items };
    }));

    return templatesWithItems;
  }

  async getChecklistTemplate(id: number): Promise<(ChecklistTemplate & { items: ChecklistItem[] }) | undefined> {
    const [template] = await db.select().from(checklistTemplates)
      .where(and(eq(checklistTemplates.id, id), eq(checklistTemplates.isActive, true)));
    
    if (!template) return undefined;

    const items = await db.select().from(checklistItems)
      .where(eq(checklistItems.templateId, id))
      .orderBy(checklistItems.sortOrder, checklistItems.title);

    return { ...template, items };
  }

  async createChecklistTemplate(templateData: InsertChecklistTemplate): Promise<ChecklistTemplate> {
    const [template] = await db.insert(checklistTemplates).values(templateData).returning();
    return template;
  }

  async updateChecklistTemplate(id: number, templateData: Partial<InsertChecklistTemplate>): Promise<ChecklistTemplate> {
    const [template] = await db.update(checklistTemplates)
      .set({ ...templateData, updatedAt: new Date() })
      .where(eq(checklistTemplates.id, id))
      .returning();
    return template;
  }

  async deleteChecklistTemplate(id: number): Promise<void> {
    await db.delete(checklistTemplates).where(eq(checklistTemplates.id, id));
  }

  // Checklist Item Management
  async getChecklistItems(templateId?: number): Promise<ChecklistItem[]> {
    let query = db.select().from(checklistItems);
    
    if (templateId) {
      query = query.where(eq(checklistItems.templateId, templateId));
    }
    
    return await query.orderBy(checklistItems.templateId, checklistItems.sortOrder, checklistItems.title);
  }

  async createChecklistItem(itemData: InsertChecklistItem): Promise<ChecklistItem> {
    const [item] = await db.insert(checklistItems).values(itemData).returning();
    return item;
  }

  async updateChecklistItem(id: number, itemData: Partial<InsertChecklistItem>): Promise<ChecklistItem> {
    const [item] = await db.update(checklistItems)
      .set(itemData)
      .where(eq(checklistItems.id, id))
      .returning();
    return item;
  }

  async deleteChecklistItem(id: number): Promise<void> {
    await db.delete(checklistItems).where(eq(checklistItems.id, id));
  }

  // Client Checklist Management
  async getClientChecklists(clientId: number): Promise<any[]> {
    try {
      const checklists = await db.select().from(clientChecklists)
        .where(eq(clientChecklists.clientId, clientId));
      return checklists;
    } catch (error) {
      return [];
    }
  }

  async createClientChecklist(checklistData: InsertClientChecklist): Promise<ClientChecklist> {
    const [checklist] = await db.insert(clientChecklists).values(checklistData).returning();
    return checklist;
  }

  async updateClientChecklistItem(id: number, itemData: Partial<InsertClientChecklistItem>): Promise<ClientChecklistItem> {
    const [item] = await db.update(clientChecklistItems)
      .set({ ...itemData, completedAt: itemData.isCompleted ? new Date() : null })
      .where(eq(clientChecklistItems.id, id))
      .returning();
    return item;
  }

  async getClientChecklistItems(clientChecklistId: number): Promise<any[]> {
    try {
      const items = await db.select({
        clientItem: clientChecklistItems,
        templateItem: checklistItems
      })
      .from(clientChecklistItems)
      .innerJoin(checklistItems, eq(clientChecklistItems.checklistItemId, checklistItems.id))
      .where(eq(clientChecklistItems.clientChecklistId, clientChecklistId))
      .orderBy(checklistItems.sortOrder);

      return items.map(row => ({
        ...row.clientItem,
        templateItem: row.templateItem
      }));
    } catch (error) {
      return [];
    }
  }

  // System Options Management
  async getSystemOptions(categoryId?: number): Promise<(SelectSystemOption & { category: SelectOptionCategory })[]> {
    let query = db.select({
      option: systemOptions,
      category: optionCategories
    })
    .from(systemOptions)
    .innerJoin(optionCategories, eq(systemOptions.categoryId, optionCategories.id))
    .where(eq(systemOptions.isActive, true));

    if (categoryId) {
      query = query.where(eq(systemOptions.categoryId, categoryId));
    }

    const results = await query.orderBy(optionCategories.categoryName, systemOptions.sortOrder, systemOptions.optionLabel);
    return results.map(row => ({ ...row.option, category: row.category }));
  }

  async getSystemOptionsByCategory(categoryKey: string): Promise<SelectSystemOption[]> {
    const results = await db.select({
      option: systemOptions
    })
    .from(systemOptions)
    .innerJoin(optionCategories, eq(systemOptions.categoryId, optionCategories.id))
    .where(and(
      eq(optionCategories.categoryKey, categoryKey),
      eq(systemOptions.isActive, true),
      eq(optionCategories.isActive, true)
    ))
    .orderBy(systemOptions.sortOrder, systemOptions.optionLabel);

    return results.map(row => row.option);
  }

  async getSystemOption(id: number): Promise<(SelectSystemOption & { category: SelectOptionCategory }) | undefined> {
    const [result] = await db.select({
      option: systemOptions,
      category: optionCategories
    })
    .from(systemOptions)
    .innerJoin(optionCategories, eq(systemOptions.categoryId, optionCategories.id))
    .where(eq(systemOptions.id, id));

    if (!result) return undefined;
    return { ...result.option, category: result.category };
  }

  async createSystemOption(optionData: InsertSystemOption): Promise<SelectSystemOption> {
    const [option] = await db.insert(systemOptions).values(optionData).returning();
    return option;
  }

  async updateSystemOption(id: number, optionData: Partial<InsertSystemOption>): Promise<SelectSystemOption> {
    const [option] = await db.update(systemOptions)
      .set({ ...optionData, updatedAt: new Date() })
      .where(eq(systemOptions.id, id))
      .returning();
    return option;
  }

  async deleteSystemOption(id: number): Promise<void> {
    await db.delete(systemOptions).where(eq(systemOptions.id, id));
  }

  // ===== CLIENT PROCESS CHECKLIST METHODS =====
  
  // Checklist Template Management
  async getChecklistTemplates(): Promise<ChecklistTemplate[]> {
    return await db.select().from(checklistTemplates)
      .where(eq(checklistTemplates.isActive, true))
      .orderBy(checklistTemplates.category, checklistTemplates.sortOrder);
  }

  async getChecklistTemplate(id: number): Promise<ChecklistTemplate | undefined> {
    const [template] = await db.select().from(checklistTemplates).where(eq(checklistTemplates.id, id));
    return template;
  }

  async createChecklistTemplate(templateData: InsertChecklistTemplate): Promise<ChecklistTemplate> {
    const [template] = await db.insert(checklistTemplates).values(templateData).returning();
    return template;
  }

  async updateChecklistTemplate(id: number, templateData: Partial<InsertChecklistTemplate>): Promise<ChecklistTemplate> {
    const [template] = await db.update(checklistTemplates)
      .set({ ...templateData, updatedAt: new Date() })
      .where(eq(checklistTemplates.id, id))
      .returning();
    return template;
  }

  async deleteChecklistTemplate(id: number): Promise<void> {
    await db.delete(checklistTemplates).where(eq(checklistTemplates.id, id));
  }

  // Checklist Items Management
  async getChecklistItems(templateId: number): Promise<ChecklistItem[]> {
    return await db.select().from(checklistItems)
      .where(eq(checklistItems.templateId, templateId))
      .orderBy(checklistItems.sortOrder);
  }

  async createChecklistItem(itemData: InsertChecklistItem): Promise<ChecklistItem> {
    const [item] = await db.insert(checklistItems).values(itemData).returning();
    return item;
  }

  async updateChecklistItem(id: number, itemData: Partial<InsertChecklistItem>): Promise<ChecklistItem> {
    const [item] = await db.update(checklistItems)
      .set(itemData)
      .where(eq(checklistItems.id, id))
      .returning();
    return item;
  }

  async deleteChecklistItem(id: number): Promise<void> {
    await db.delete(checklistItems).where(eq(checklistItems.id, id));
  }

  // Client Checklist Management
  async getClientChecklists(clientId: number): Promise<any[]> {
    const checklists = await db.select({
      checklist: clientChecklists,
      template: checklistTemplates
    })
    .from(clientChecklists)
    .innerJoin(checklistTemplates, eq(clientChecklists.templateId, checklistTemplates.id))
    .where(eq(clientChecklists.clientId, clientId))
    .orderBy(checklistTemplates.category, checklistTemplates.sortOrder);

    return checklists.map(row => ({
      ...row.checklist,
      template: row.template
    }));
  }

  async assignChecklistToClient(clientId: number, templateId: number, dueDate?: string): Promise<any> {
    const [assignment] = await db.insert(clientChecklists).values({
      clientId,
      templateId,
      dueDate: dueDate ? new Date(dueDate) : undefined,
      isCompleted: false
    }).returning();

    // Create checklist items for the client
    const templateItems = await db.select().from(checklistItems)
      .where(eq(checklistItems.templateId, templateId))
      .orderBy(checklistItems.sortOrder);

    if (templateItems.length > 0) {
      await db.insert(clientChecklistItems).values(
        templateItems.map(item => ({
          clientChecklistId: assignment.id,
          checklistItemId: item.id,
          isCompleted: false
        }))
      );
    }

    return assignment;
  }

  async createClientChecklist(checklistData: InsertClientChecklist): Promise<ClientChecklist> {
    const [checklist] = await db.insert(clientChecklists).values(checklistData).returning();
    return checklist;
  }

  async updateClientChecklistItem(id: number, itemData: Partial<InsertClientChecklistItem>): Promise<ClientChecklistItem> {
    const [item] = await db.update(clientChecklistItems)
      .set({ ...itemData, completedAt: itemData.isCompleted ? new Date() : null })
      .where(eq(clientChecklistItems.id, id))
      .returning();
    return item;
  }

  // Auto-assign checklists when client is created
  async assignChecklistsToClient(clientId: number, clientType: string): Promise<void> {
    const templates = await db.select().from(checklistTemplates)
      .where(and(
        eq(checklistTemplates.isActive, true),
        or(
          eq(checklistTemplates.clientType, clientType),
          sql`${checklistTemplates.clientType} IS NULL`
        )
      ));

    for (const template of templates) {
      // Create client checklist
      const [clientChecklist] = await db.insert(clientChecklists).values({
        clientId,
        templateId: template.id,
        dueDate: template.category === 'intake' ? sql`CURRENT_DATE + INTERVAL '30 days'` : 
                 template.category === 'assessment' ? sql`CURRENT_DATE + INTERVAL '14 days'` : null
      }).returning();

      // Create client checklist items
      const items = await this.getChecklistItems(template.id);
      const clientItems = items.map(item => ({
        clientChecklistId: clientChecklist.id,
        checklistItemId: item.id
      }));

      if (clientItems.length > 0) {
        await db.insert(clientChecklistItems).values(clientItems);
      }
    }
  }
}

export const storage = new DatabaseStorage();
