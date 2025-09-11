// Database Connection and Operators
import { db } from "./db";
import { eq, and, or, ilike, desc, asc, count, sql, gte, lte, inArray, isNull, isNotNull } from "drizzle-orm";

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
  clientChecklistItems,
  notifications,
  notificationTriggers,
  notificationPreferences,
  notificationTemplates
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
  Notification,
  InsertNotification,
  NotificationTrigger,
  InsertNotificationTrigger,
  NotificationPreference,
  InsertNotificationPreference,
  NotificationTemplate,
  InsertNotificationTemplate
} from "@shared/schema";

export interface ClientsQueryParams {
  page?: number;
  pageSize?: number;
  search?: string;
  status?: string;
  stage?: string;
  therapistId?: number;
  supervisedTherapistIds?: number[];
  clientType?: string;
  hasPortalAccess?: boolean;
  hasPendingTasks?: boolean;
  hasNoSessions?: boolean;
  needsFollowUp?: boolean;
  unassigned?: boolean;
  checklistTemplateId?: number;
  checklistItemId?: number;
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
// Task query parameters type for consistent filtering
export type TaskQueryParams = {
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
  therapistId?: number;
  supervisedTherapistIds?: number[];
};

export interface IStorage {
  
  // ===== USER MANAGEMENT =====
  getUser(id: number): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  getUserByName(fullName: string): Promise<User | undefined>;
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
  getClientStats(therapistId?: number, supervisedTherapistIds?: number[]): Promise<{
    totalClients: number;
    activeClients: number;
    inactiveClients: number;
    newIntakes: number;
    assessmentPhase: number;
    psychotherapy: number;
  }>;
  getAllClientsForExport(): Promise<(Client & { assignedTherapist?: string })[]>;

  // ===== SESSION MANAGEMENT =====
  getAllSessions(): Promise<(Session & { therapist: User; client: Client })[]>;
  getSessionsByClient(clientId: number): Promise<(Session & { therapist: User })[]>;
  getSessionsByMonth(year: number, month: number): Promise<(Session & { therapist: User; client: Client })[]>;
  getOverdueSessions(limit?: number, therapistId?: number, supervisedTherapistIds?: number[]): Promise<(Session & { therapist: User; client: Client; daysOverdue: number })[]>;
  createSession(session: InsertSession): Promise<Session>;
  createSessionsBulk(sessions: InsertSession[]): Promise<Session[]>;
  updateSession(id: number, session: Partial<InsertSession>): Promise<Session>;
  deleteSession(id: number): Promise<void>;
  
  // ===== SESSION CONFLICT DETECTION =====
  getClientSessionConflicts(clientId: number): Promise<{
    conflictDates: string[];
    conflicts: Array<{
      date: string;
      sessions: (Session & { therapist: User; service: any })[];
      type: 'same_service' | 'different_service';
    }>;
  }>;
  
  // ===== SERVICE AND ROOM LOOKUPS =====
  getServices(): Promise<any[]>;
  updateService(id: number, updateData: any): Promise<any>;
  deleteService(id: number): Promise<void>;
  getServiceByCode(serviceCode: string): Promise<any>;
  getServiceCodeByKey(serviceCode: string): Promise<any>;
  getRoomByNumber(roomNumber: string): Promise<any>;

  // ===== TASK MANAGEMENT =====
  getAllTasks(params?: TaskQueryParams): Promise<{
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
  getTaskStats(therapistId?: number, supervisedTherapistIds?: number[]): Promise<{
    totalTasks: number;
    pendingTasks: number;
    inProgressTasks: number;
    completedTasks: number;
    overdueTasks: number;
    highPriorityTasks: number;
    urgentTasks: number;
  }>;
  getPendingTasksCount(): Promise<number>;
  getRecentTasks(limit?: number, therapistId?: number, supervisedTherapistIds?: number[]): Promise<(Task & { assignedTo?: User; client: Client })[]>;
  getUpcomingTasks(limit?: number, therapistId?: number, supervisedTherapistIds?: number[]): Promise<(Task & { assignedTo?: User; client: Client })[]>;

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

  // ===== ROOM MANAGEMENT =====
  getRooms(): Promise<SelectRoom[]>;
  getRoomById(id: number): Promise<SelectRoom | null>;
  createRoom(roomData: InsertRoom): Promise<SelectRoom>;
  updateRoom(id: number, updateData: any): Promise<SelectRoom>;
  deleteRoom(id: number): Promise<void>;
  checkRoomAvailability(date: string, startTime: string, endTime: string, excludeSessionId?: number): Promise<SelectRoom[]>;

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

  // ===== NOTIFICATION SYSTEM MANAGEMENT =====
  getUserNotifications(userId: number, limit?: number): Promise<Notification[]>;
  getUnreadNotificationCount(userId: number): Promise<number>;
  createNotification(notification: InsertNotification): Promise<Notification>;
  createNotificationsBatch(notifications: InsertNotification[]): Promise<void>;
  markNotificationAsRead(notificationId: number, userId: number): Promise<void>;
  markAllNotificationsAsRead(userId: number): Promise<void>;
  deleteNotification(notificationId: number, userId: number): Promise<void>;
  
  // Notification Triggers Management
  getNotificationTriggers(eventType?: string): Promise<NotificationTrigger[]>;
  getNotificationTrigger(id: number): Promise<NotificationTrigger | undefined>;
  createNotificationTrigger(trigger: InsertNotificationTrigger): Promise<NotificationTrigger>;
  updateNotificationTrigger(id: number, trigger: Partial<InsertNotificationTrigger>): Promise<NotificationTrigger>;
  deleteNotificationTrigger(id: number): Promise<void>;
  
  // Notification Preferences Management
  getUserNotificationPreferences(userId: number): Promise<NotificationPreference[]>;
  getUserNotificationPreference(userId: number, triggerType: string): Promise<NotificationPreference | undefined>;
  setUserNotificationPreference(userId: number, triggerType: string, preferences: Partial<InsertNotificationPreference>): Promise<NotificationPreference>;
  
  // Notification Templates Management
  getNotificationTemplates(type?: string): Promise<NotificationTemplate[]>;
  getNotificationTemplate(id: number): Promise<NotificationTemplate | undefined>;
  createNotificationTemplate(template: InsertNotificationTemplate): Promise<NotificationTemplate>;
  updateNotificationTemplate(id: number, template: Partial<InsertNotificationTemplate>): Promise<NotificationTemplate>;
  deleteNotificationTemplate(id: number): Promise<void>;
  
  // Notification Processing
  processNotificationEvent(eventType: string, entityData: any): Promise<void>;
  cleanupExpiredNotifications(): Promise<void>;
  getNotificationStats(): Promise<{ total: number; unread: number }>;
  
  // ===== PRACTICE CONFIGURATION MANAGEMENT =====
  // Note: Practice configuration methods removed - not implemented in current schema
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

  async getUserByName(fullName: string): Promise<User | undefined> {
    // Try exact match first
    let [user] = await db.select().from(users).where(eq(users.fullName, fullName));
    
    if (!user) {
      // Try case-insensitive match
      [user] = await db.select().from(users).where(ilike(users.fullName, fullName));
    }
    
    if (!user) {
      // Try partial match - search for the name within the full name field
      [user] = await db.select().from(users).where(ilike(users.fullName, `%${fullName}%`));
    }
    
    if (!user) {
      // Try reverse - clean both names and search
      const cleanSearchName = fullName.replace(/,?\s*(RP\s*\(Qualifying\)|MSW|RP)\s*/gi, '').trim();
      [user] = await db.select().from(users).where(ilike(users.fullName, `%${cleanSearchName}%`));
    }
    
    return user || undefined;
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const result = await db
      .insert(users)
      .values(insertUser)
      .returning();
    return (result as User[])[0];
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
      stage,
      therapistId,
      clientType,
      hasPortalAccess,
      hasPendingTasks,
      hasNoSessions,
      needsFollowUp,
      unassigned,
      checklistTemplateId,
      checklistItemId,
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
    
    if (stage) {
      whereConditions.push(eq(clients.stage, stage as any));
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

    // Filter clients with no sessions
    if (hasNoSessions === true) {
      whereConditions.push(
        sql`NOT EXISTS (SELECT 1 FROM ${sessions} WHERE ${sessions.clientId} = ${clients.id})`
      );
    }

    if (needsFollowUp !== undefined) {
      whereConditions.push(eq(clients.needsFollowUp, needsFollowUp));
    }

    // Filter clients not assigned to a therapist
    if (unassigned === true) {
      whereConditions.push(isNull(clients.assignedTherapistId));
    }

    // Filter clients by checklist template
    if (checklistTemplateId) {
      whereConditions.push(
        sql`EXISTS (
          SELECT 1 FROM ${clientChecklists} cc 
          WHERE cc.client_id = ${clients.id} 
          AND cc.template_id = ${checklistTemplateId}
        )`
      );
    }

    // Filter clients by specific checklist item completion
    if (checklistItemId) {
      whereConditions.push(
        sql`EXISTS (
          SELECT 1 FROM ${clientChecklists} cc 
          JOIN ${clientChecklistItems} cci ON cci.client_checklist_id = cc.id
          JOIN ${checklistItems} ci ON ci.id = cci.checklist_item_id
          WHERE cc.client_id = ${clients.id} 
          AND ci.id = ${checklistItemId}
        )`
      );
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
        assignedTherapist: {
          id: users.id,
          fullName: users.fullName,
          role: users.role
        },
        sessionCount: sql<number>`(
          SELECT COUNT(*) FROM ${sessions} 
          WHERE ${sessions.clientId} = ${clients.id}
        )`.as('sessionCount'),
        lastSessionDate: sql<Date | null>`(
          SELECT MAX(session_date) FROM sessions 
          WHERE client_id = ${clients.id}
        )`.as('lastSessionDate'),
        firstSessionDate: sql<Date | null>`(
          SELECT MIN(session_date) FROM sessions 
          WHERE client_id = ${clients.id}
        )`.as('firstSessionDate'),
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
                      sortBy === 'lastSession' ? sql`(SELECT MAX(session_date) FROM sessions WHERE client_id = ${clients.id})` :
                      sortBy === 'firstSession' ? sql`(SELECT MIN(session_date) FROM sessions WHERE client_id = ${clients.id})` :
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
      lastSessionDate: r.lastSessionDate,
      firstSessionDate: r.firstSessionDate,
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
      assignedTherapist: result.assignedTherapist ? {
        id: result.assignedTherapist.id,
        fullName: result.assignedTherapist.fullName,
        role: result.assignedTherapist.role,
      } : undefined,
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
    // Cascade delete in proper dependency order
    
    // First get all sessions for this client
    const clientSessions = await db.select({ id: sessions.id }).from(sessions).where(eq(sessions.clientId, id));
    
    // Delete session billing records first (they reference sessions)
    for (const session of clientSessions) {
      await db.delete(sessionBilling).where(eq(sessionBilling.sessionId, session.id));
    }
    
    // Delete session notes (they reference sessions)
    for (const session of clientSessions) {
      await db.delete(sessionNotes).where(eq(sessionNotes.sessionId, session.id));
    }
    
    // Now delete sessions
    for (const session of clientSessions) {
      await db.delete(sessions).where(eq(sessions.id, session.id));
    }
    
    // Get all tasks for this client
    const clientTasks = await db.select({ id: tasks.id }).from(tasks).where(eq(tasks.clientId, id));
    
    // Delete task comments first (they reference tasks)
    for (const task of clientTasks) {
      await db.delete(taskComments).where(eq(taskComments.taskId, task.id));
    }
    
    // Delete tasks
    for (const task of clientTasks) {
      await db.delete(tasks).where(eq(tasks.id, task.id));
    }
    
    // Get all assessment assignments for this client
    const clientAssignments = await db.select({ id: assessmentAssignments.id }).from(assessmentAssignments).where(eq(assessmentAssignments.clientId, id));
    
    // Delete assessment responses first (they reference assignments)
    for (const assignment of clientAssignments) {
      await db.delete(assessmentResponses).where(eq(assessmentResponses.assignmentId, assignment.id));
    }
    
    // Delete assessment assignments
    for (const assignment of clientAssignments) {
      await db.delete(assessmentAssignments).where(eq(assessmentAssignments.id, assignment.id));
    }
    
    // Get all checklists for this client
    const clientChecklistsList = await db.select({ id: clientChecklists.id }).from(clientChecklists).where(eq(clientChecklists.clientId, id));
    
    // Delete checklist items first (they reference checklists)
    for (const checklist of clientChecklistsList) {
      await db.delete(clientChecklistItems).where(eq(clientChecklistItems.clientChecklistId, checklist.id));
    }
    
    // Delete client checklists
    await db.delete(clientChecklists).where(eq(clientChecklists.clientId, id));
    
    // NOTE: Documents are preserved when clients are deleted for record keeping
    // Documents will remain accessible even after client deletion
    
    // Delete notes
    await db.delete(notes).where(eq(notes.clientId, id));
    
    // Finally delete the client
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

  async getClientStats(therapistId?: number, supervisedTherapistIds?: number[]): Promise<{
    totalClients: number;
    activeClients: number;
    inactiveClients: number;
    pendingClients: number;
    newIntakes: number;
    assessmentPhase: number;
    psychotherapy: number;
    noSessions: number;
    needsFollowUp: number;
    unassignedClients: number;
    checklistCompleted: number;
    checklistInProgress: number;
    checklistNotStarted: number;
    checklistOverdue: number;
  }> {
    // Build where conditions for role-based filtering
    const whereConditions = [];
    
    if (therapistId) {
      whereConditions.push(eq(clients.assignedTherapistId, therapistId));
    } else if (supervisedTherapistIds && supervisedTherapistIds.length > 0) {
      whereConditions.push(inArray(clients.assignedTherapistId, supervisedTherapistIds));
    }
    
    const whereClause = whereConditions.length > 0 ? and(...whereConditions) : undefined;

    const [stats] = await db
      .select({
        totalClients: count(),
        activeClients: sql<number>`CAST(COUNT(*) FILTER (WHERE status = 'active') AS INTEGER)`,
        inactiveClients: sql<number>`CAST(COUNT(*) FILTER (WHERE status = 'inactive') AS INTEGER)`,
        pendingClients: sql<number>`CAST(COUNT(*) FILTER (WHERE status = 'pending') AS INTEGER)`,
        newIntakes: sql<number>`CAST(COUNT(*) FILTER (WHERE stage = 'intake') AS INTEGER)`,
        assessmentPhase: sql<number>`CAST(COUNT(*) FILTER (WHERE stage = 'assessment') AS INTEGER)`,
        psychotherapy: sql<number>`CAST(COUNT(*) FILTER (WHERE stage = 'psychotherapy') AS INTEGER)`,
        noSessions: sql<number>`CAST(COUNT(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM sessions WHERE sessions.client_id = clients.id)) AS INTEGER)`,
        needsFollowUp: sql<number>`CAST(COUNT(*) FILTER (WHERE needs_follow_up = true) AS INTEGER)`,
        unassignedClients: sql<number>`CAST(COUNT(*) FILTER (WHERE assigned_therapist_id IS NULL) AS INTEGER)`,
        checklistCompleted: sql<number>`CAST(COUNT(*) FILTER (WHERE EXISTS (
          SELECT 1 FROM client_checklists cc 
          WHERE cc.client_id = clients.id 
          AND NOT EXISTS (
            SELECT 1 FROM client_checklist_items cci 
            WHERE cci.client_checklist_id = cc.id 
            AND cci.is_completed = false
          )
        )) AS INTEGER)`,
        checklistInProgress: sql<number>`CAST(COUNT(*) FILTER (WHERE EXISTS (
          SELECT 1 FROM client_checklists cc 
          JOIN client_checklist_items cci ON cci.client_checklist_id = cc.id
          WHERE cc.client_id = clients.id 
          AND EXISTS (SELECT 1 FROM client_checklist_items cci2 WHERE cci2.client_checklist_id = cc.id AND cci2.is_completed = true)
          AND EXISTS (SELECT 1 FROM client_checklist_items cci3 WHERE cci3.client_checklist_id = cc.id AND cci3.is_completed = false)
        )) AS INTEGER)`,
        checklistNotStarted: sql<number>`CAST(COUNT(*) FILTER (WHERE EXISTS (
          SELECT 1 FROM client_checklists cc 
          WHERE cc.client_id = clients.id 
          AND NOT EXISTS (
            SELECT 1 FROM client_checklist_items cci 
            WHERE cci.client_checklist_id = cc.id 
            AND cci.is_completed = true
          )
        )) AS INTEGER)`,
        checklistOverdue: sql<number>`CAST(COUNT(*) FILTER (WHERE EXISTS (
          SELECT 1 FROM client_checklists cc 
          WHERE cc.client_id = clients.id 
          AND cc.due_date < CURRENT_DATE 
          AND NOT EXISTS (
            SELECT 1 FROM client_checklist_items cci 
            WHERE cci.client_checklist_id = cc.id 
            AND cci.is_completed = false
          )
        )) AS INTEGER)`
      })
      .from(clients)
      .where(whereClause);

    return {
      totalClients: Number(stats.totalClients),
      activeClients: Number(stats.activeClients),
      inactiveClients: Number(stats.inactiveClients),
      pendingClients: Number(stats.pendingClients),
      newIntakes: Number(stats.newIntakes),
      assessmentPhase: Number(stats.assessmentPhase),
      psychotherapy: Number(stats.psychotherapy),
      noSessions: Number(stats.noSessions),
      needsFollowUp: Number(stats.needsFollowUp),
      unassignedClients: Number(stats.unassignedClients),
      checklistCompleted: Number(stats.checklistCompleted),
      checklistInProgress: Number(stats.checklistInProgress),
      checklistNotStarted: Number(stats.checklistNotStarted),
      checklistOverdue: Number(stats.checklistOverdue)
    };
  }

  async getAllClientsForExport(): Promise<(Client & { assignedTherapist?: string })[]> {
    const results = await db
      .select({
        client: clients,
        therapist: users
      })
      .from(clients)
      .leftJoin(users, eq(clients.assignedTherapistId, users.id))
      .orderBy(asc(clients.clientId));

    return results.map(r => ({ 
      ...r.client, 
      assignedTherapist: r.therapist?.username || '' 
    }));
  }

  // Session methods
  async getAllSessions(therapistId?: number, supervisedTherapistIds?: number[]): Promise<(Session & { therapist: User; client: Client })[]> {
    let query = db
      .select({
        session: sessions,
        therapist: users,
        client: clients
      })
      .from(sessions)
      .innerJoin(users, eq(sessions.therapistId, users.id))
      .innerJoin(clients, eq(sessions.clientId, clients.id))
      .$dynamic();

    // Apply role-based filtering at database level
    if (therapistId) {
      // Therapist sees only their own sessions
      query = query.where(eq(sessions.therapistId, therapistId));
    } else if (supervisedTherapistIds && supervisedTherapistIds.length > 0) {
      // Supervisor sees sessions for supervised therapists
      query = query.where(inArray(sessions.therapistId, supervisedTherapistIds));
    }

    const results = await query.orderBy(desc(sessions.sessionDate));

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

  async getClientSessionConflicts(clientId: number): Promise<{
    conflictDates: string[];
    conflicts: Array<{
      date: string;
      sessions: (Session & { therapist: User; service: any })[];
      type: 'same_service' | 'different_service';
    }>;
  }> {
    // Get all sessions for this client
    const results = await db
      .select({
        session: sessions,
        therapist: users,
        service: services
      })
      .from(sessions)
      .innerJoin(users, eq(sessions.therapistId, users.id))
      .innerJoin(services, eq(sessions.serviceId, services.id))
      .where(eq(sessions.clientId, clientId))
      .orderBy(desc(sessions.sessionDate));

    // Group sessions by date
    const sessionsByDate = new Map<string, (Session & { therapist: User; service: any })[]>();
    
    results.forEach(r => {
      const sessionData = { ...r.session, therapist: r.therapist, service: r.service };
      const dateKey = sessionData.sessionDate.toISOString().split('T')[0];
      
      if (!sessionsByDate.has(dateKey)) {
        sessionsByDate.set(dateKey, []);
      }
      sessionsByDate.get(dateKey)!.push(sessionData);
    });

    // Find conflicts (dates with multiple sessions)
    const conflicts: Array<{
      date: string;
      sessions: (Session & { therapist: User; service: any })[];
      type: 'same_service' | 'different_service';
    }> = [];

    const conflictDates: string[] = [];

    sessionsByDate.forEach((sessionsOnDate, date) => {
      if (sessionsOnDate.length > 1) {
        conflictDates.push(date);
        
        // Check if same service codes or different
        const serviceIds = new Set(sessionsOnDate.map(s => s.service.id));
        const type = serviceIds.size === 1 ? 'same_service' : 'different_service';
        
        conflicts.push({
          date,
          sessions: sessionsOnDate,
          type
        });
      }
    });

    return {
      conflictDates: conflictDates.sort(),
      conflicts: conflicts.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    };
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

  async getOverdueSessions(limit: number = 10, therapistId?: number, supervisedTherapistIds?: number[]): Promise<(Session & { therapist: User; client: Client; daysOverdue: number })[]> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    let query = db
      .select({
        session: sessions,
        therapist: users,
        client: clients
      })
      .from(sessions)
      .innerJoin(users, eq(sessions.therapistId, users.id))
      .innerJoin(clients, eq(sessions.clientId, clients.id))
      .$dynamic();

    // Apply role-based filtering at database level
    const conditions = [
      sql`DATE(${sessions.sessionDate}) < ${today.toISOString().split('T')[0]}`,
      eq(sessions.status, 'scheduled')
    ];

    if (therapistId) {
      // Therapist sees only their own overdue sessions
      conditions.push(eq(sessions.therapistId, therapistId));
    } else if (supervisedTherapistIds && supervisedTherapistIds.length > 0) {
      // Supervisor sees overdue sessions for supervised therapists
      conditions.push(inArray(sessions.therapistId, supervisedTherapistIds));
    }

    const results = await query
      .where(and(...conditions))
      .orderBy(asc(sessions.sessionDate))
      .limit(limit);

    return results.map(r => {
      const sessionDate = new Date(r.session.sessionDate);
      const timeDiff = today.getTime() - sessionDate.getTime();
      const daysOverdue = Math.floor(timeDiff / (1000 * 3600 * 24));
      
      return { 
        ...r.session, 
        therapist: r.therapist, 
        client: r.client,
        daysOverdue
      };
    });
  }

  async createSession(session: InsertSession): Promise<Session> {
    const [newSession] = await db
      .insert(sessions)
      .values(session)
      .returning();
    return newSession;
  }

  async createSessionsBulk(sessionsData: InsertSession[]): Promise<Session[]> {
    if (sessionsData.length === 0) {
      return [];
    }
    
    const newSessions = await db
      .insert(sessions)
      .values(sessionsData)
      .returning();
    
    return newSessions;
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

  async getOverdueTasks(): Promise<(Task & { assignedTo: User; client: Client })[]> {
    const results = await db
      .select({
        task: tasks,
        assignedTo: users,
        client: clients
      })
      .from(tasks)
      .innerJoin(users, eq(tasks.assignedToId, users.id))
      .innerJoin(clients, eq(tasks.clientId, clients.id))
      .where(
        and(
          sql`${tasks.dueDate} < NOW()`,
          sql`${tasks.status} NOT IN ('completed')`,
          isNotNull(tasks.dueDate)
        )
      )
      .orderBy(asc(tasks.dueDate));

    return results.map(r => ({ 
      ...r.task, 
      assignedTo: r.assignedTo, 
      client: r.client 
    }));
  }

  // ===== SESSION CONFLICT DETECTION IMPLEMENTATION =====
  async checkSessionConflicts(clientId: number, sessionDate: string, serviceCode?: string, excludeSessionId?: number): Promise<{
    exactDuplicates: (Session & { therapist: User; service: any })[];
    potentialConflicts: (Session & { therapist: User; service: any })[];
  }> {
    const today = new Date();
    const checkDate = new Date(sessionDate);
    
    // Only check future sessions (ignore historical data)
    if (checkDate < today) {
      return { exactDuplicates: [], potentialConflicts: [] };
    }

    // Convert sessionDate string to date format for comparison
    const dateOnly = sessionDate.split('T')[0]; // Get YYYY-MM-DD format

    const conflictingSessions = await db
      .select({
        id: sessions.id,
        clientId: sessions.clientId,
        therapistId: sessions.therapistId,
        serviceId: sessions.serviceId,
        sessionDate: sessions.sessionDate,
        sessionType: sessions.sessionType,
        status: sessions.status,
        notes: sessions.notes,
        createdAt: sessions.createdAt,
        updatedAt: sessions.updatedAt,
        therapist: {
          id: users.id,
          fullName: users.fullName,
          username: users.username
        },
        service: {
          id: services.id,
          serviceCode: services.serviceCode,
          serviceName: services.serviceName
        }
      })
      .from(sessions)
      .leftJoin(users, eq(sessions.therapistId, users.id))
      .leftJoin(services, eq(sessions.serviceId, services.id))
      .where(
        and(
          eq(sessions.clientId, clientId),
          sql`DATE(${sessions.sessionDate}) = ${dateOnly}`,
          sql`DATE(${sessions.sessionDate}) >= CURRENT_DATE`, // Future sessions only
          ...(excludeSessionId ? [sql`${sessions.id} != ${excludeSessionId}`] : [])
        )
      );
    
    const exactDuplicates: any[] = [];
    const potentialConflicts: any[] = [];
    
    for (const session of conflictingSessions) {
      if (serviceCode && session.service?.serviceCode === serviceCode) {
        // Exact duplicate: same client, same date, same service code
        exactDuplicates.push(session);
      } else {
        // Potential conflict: same client, same date, different service code
        potentialConflicts.push(session);
      }
    }
    
    return { exactDuplicates, potentialConflicts };
  }

  async getFutureSessionConflicts(): Promise<{
    today: (Session & { therapist: User; client: Client; service: any })[];
    upcoming: (Session & { therapist: User; client: Client; service: any })[];
  }> {
    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];
    const oneWeekFromNow = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000);
    const oneWeekStr = oneWeekFromNow.toISOString().split('T')[0];

    // Find potential conflicts for today
    const todayConflicts = await db
      .select({
        id: sessions.id,
        clientId: sessions.clientId,
        therapistId: sessions.therapistId,
        serviceId: sessions.serviceId,
        sessionDate: sessions.sessionDate,
        sessionType: sessions.sessionType,
        status: sessions.status,
        notes: sessions.notes,
        createdAt: sessions.createdAt,
        updatedAt: sessions.updatedAt,
        therapist: {
          id: users.id,
          fullName: users.fullName,
          username: users.username
        },
        client: {
          id: clients.id,
          fullName: clients.fullName,
          clientId: clients.clientId
        },
        service: {
          id: services.id,
          serviceCode: services.serviceCode,
          serviceName: services.serviceName
        }
      })
      .from(sessions)
      .leftJoin(users, eq(sessions.therapistId, users.id))
      .leftJoin(clients, eq(sessions.clientId, clients.id))
      .leftJoin(services, eq(sessions.serviceId, services.id))
      .where(
        and(
          sql`DATE(${sessions.sessionDate}) = ${todayStr}`,
          sql`EXISTS (
            SELECT 1 FROM ${sessions} s2 
            WHERE s2.client_id = ${sessions.clientId} 
            AND DATE(s2.session_date) = DATE(${sessions.sessionDate})
            AND s2.id != ${sessions.id}
          )`
        )
      );

    // Find potential conflicts for upcoming week
    const upcomingConflicts = await db
      .select({
        id: sessions.id,
        clientId: sessions.clientId,
        therapistId: sessions.therapistId,
        serviceId: sessions.serviceId,
        sessionDate: sessions.sessionDate,
        sessionType: sessions.sessionType,
        status: sessions.status,
        notes: sessions.notes,
        createdAt: sessions.createdAt,
        updatedAt: sessions.updatedAt,
        therapist: {
          id: users.id,
          fullName: users.fullName,
          username: users.username
        },
        client: {
          id: clients.id,
          fullName: clients.fullName,
          clientId: clients.clientId
        },
        service: {
          id: services.id,
          serviceCode: services.serviceCode,
          serviceName: services.serviceName
        }
      })
      .from(sessions)
      .leftJoin(users, eq(sessions.therapistId, users.id))
      .leftJoin(clients, eq(sessions.clientId, clients.id))
      .leftJoin(services, eq(sessions.serviceId, services.id))
      .where(
        and(
          sql`DATE(${sessions.sessionDate}) >= ${todayStr}`,
          sql`DATE(${sessions.sessionDate}) <= ${oneWeekStr}`,
          sql`EXISTS (
            SELECT 1 FROM ${sessions} s2 
            WHERE s2.client_id = ${sessions.clientId} 
            AND DATE(s2.session_date) = DATE(${sessions.sessionDate})
            AND s2.id != ${sessions.id}
          )`
        )
      );

    return {
      today: todayConflicts as any[],
      upcoming: upcomingConflicts as any[]
    };
  }

  // Service and Room lookup methods
  async getServiceByCode(serviceCode: string): Promise<any> {
    const [service] = await db
      .select()
      .from(services)
      .where(eq(services.serviceCode, serviceCode));
    return service || null;
  }

  async getServiceCodeByKey(serviceCode: string): Promise<any> {
    // Handle IFH mapping to specific service types
    const ihfMapping: { [key: string]: string } = {
      'IFH': 'IFH', // Keep original for backward compatibility
      'IFH-ASSESS': 'IFH-ASSESS',
      'IFH-1H': 'IFH-1H', 
      'IFH-2H': 'IFH-2H'
    };
    
    const mappedCode = ihfMapping[serviceCode] || serviceCode;
    
    // Only use services table - no more fallback to system_options
    const [service] = await db
      .select({
        id: services.id,
        serviceCode: services.serviceCode,
        serviceName: services.serviceName,
        baseRate: services.baseRate
      })
      .from(services)
      .where(eq(services.serviceCode, mappedCode));
      
    if (service) {
      return {
        id: service.id,
        optionKey: service.serviceCode,
        optionLabel: service.serviceName,
        price: service.baseRate
      };
    }
    
    return null; // Service code not found
  }

  async getServices(): Promise<any[]> {
    return await db.select().from(services).where(eq(services.isActive, true));
  }

  async updateService(id: number, updateData: any): Promise<any> {
    const [service] = await db
      .update(services)
      .set({
        ...updateData,
        updatedAt: new Date()
      })
      .where(eq(services.id, id))
      .returning();
    return service;
  }

  async deleteService(id: number): Promise<void> {
    try {
      // Check if service is referenced in other tables
      const [sessionsUsing] = await db
        .select({ count: count() })
        .from(sessions)
        .where(eq(sessions.serviceId, id));
      
      if (sessionsUsing.count > 0) {
        throw new Error(`Cannot delete service: ${sessionsUsing.count} sessions are using this service`);
      }

      // Check session billing references by service code
      const [service] = await db
        .select({ serviceCode: services.serviceCode })
        .from(services)
        .where(eq(services.id, id));

      if (service) {
        const [billingUsing] = await db
          .select({ count: count() })
          .from(sessionBilling)
          .where(eq(sessionBilling.serviceCode, service.serviceCode));
        
        if (billingUsing.count > 0) {
          throw new Error(`Cannot delete service: ${billingUsing.count} billing records are using this service code`);
        }
      }

      // Safe to delete
      await db
        .delete(services)
        .where(eq(services.id, id));
    } catch (error) {

      throw error;
    }
  }

  async getRoomByNumber(roomNumber: string): Promise<any> {
    // First try to find by room number
    let [room] = await db
      .select()
      .from(rooms)
      .where(eq(rooms.roomNumber, roomNumber));
    
    // If not found, try to find by room name
    if (!room) {
      [room] = await db
        .select()
        .from(rooms)
        .where(eq(rooms.roomName, roomNumber));
    }
    
    return room || null;
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
    therapistId?: number;
    supervisedTherapistIds?: number[];
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
      conditions.push(eq(tasks.status, params.status as any));
    }
    
    if (params?.priority) {
      conditions.push(eq(tasks.priority, params.priority as any));
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

    // Apply consistent role-based filtering using centralized helper
    const visibilityFilter = this.getTherapistTaskVisibility(params?.therapistId, params?.supervisedTherapistIds);
    if (visibilityFilter) {
      conditions.push(visibilityFilter);
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
    const result = await db
      .insert(tasks)
      .values(task as any)
      .returning();
    return (result as Task[])[0];
  }

  async updateTask(id: number, taskData: Partial<InsertTask>): Promise<Task> {
    // Auto-set completion timestamp when status changes to completed
    const updateData: any = { ...taskData };
    if (taskData.status === 'completed' && !updateData.completedAt) {
      updateData.completedAt = new Date();
    }
    
    const [task] = await db
      .update(tasks)
      .set({ ...updateData, updatedAt: new Date() })
      .where(eq(tasks.id, id))
      .returning();
    return task;
  }

  async deleteTask(id: number): Promise<void> {
    await db.delete(tasks).where(eq(tasks.id, id));
  }

  // Helper function for consistent therapist task visibility across all methods
  private getTherapistTaskVisibility(therapistId?: number, supervisedTherapistIds?: number[]) {
    if (therapistId) {
      // Therapist sees tasks assigned TO them OR for their assigned clients
      return or(
        eq(tasks.assignedToId, therapistId),
        eq(clients.assignedTherapistId, therapistId)
      );
    } else if (supervisedTherapistIds && supervisedTherapistIds.length > 0) {
      // Supervisor sees tasks for clients of their supervised therapists
      return inArray(clients.assignedTherapistId, supervisedTherapistIds);
    }
    return undefined; // Admin sees all
  }

  async getTaskStats(therapistId?: number, supervisedTherapistIds?: number[]): Promise<{
    totalTasks: number;
    pendingTasks: number;
    inProgressTasks: number;
    completedTasks: number;
    overdueTasks: number;
    highPriorityTasks: number;
    urgentTasks: number;
  }> {
    let query = db
      .select({
        totalTasks: count(),
        pendingTasks: sql<number>`COUNT(*) FILTER (WHERE ${tasks.status} = 'pending')`,
        inProgressTasks: sql<number>`COUNT(*) FILTER (WHERE ${tasks.status} = 'in_progress')`,
        completedTasks: sql<number>`COUNT(*) FILTER (WHERE ${tasks.status} = 'completed')`,
        overdueTasks: sql<number>`COUNT(*) FILTER (WHERE ${tasks.status} = 'overdue')`,
        highPriorityTasks: sql<number>`COUNT(*) FILTER (WHERE ${tasks.priority} = 'high')`,
        urgentTasks: sql<number>`COUNT(*) FILTER (WHERE ${tasks.priority} = 'urgent')`
      })
      .from(tasks)
      .$dynamic();

    // Apply consistent role-based filtering using centralized helper
    const visibilityFilter = this.getTherapistTaskVisibility(therapistId, supervisedTherapistIds);
    if (visibilityFilter) {
      query = query
        .leftJoin(clients, eq(tasks.clientId, clients.id))
        .where(visibilityFilter);
    }

    const [stats] = await query;
    return stats;
  }

  async getPendingTasksCount(): Promise<number> {
    const [{ count: pendingCount }] = await db
      .select({ count: count() })
      .from(tasks)
      .where(or(eq(tasks.status, 'pending'), eq(tasks.status, 'overdue')));
    
    return pendingCount;
  }

  async getRecentTasks(limit: number = 10, therapistId?: number, supervisedTherapistIds?: number[]): Promise<(Task & { assignedTo?: User; client: Client })[]> {
    let query = db
      .select({
        task: tasks,
        assignedTo: users,
        client: clients
      })
      .from(tasks)
      .leftJoin(clients, eq(tasks.clientId, clients.id))
      .leftJoin(users, eq(tasks.assignedToId, users.id))
      .$dynamic();

    // Apply consistent role-based filtering using centralized helper
    const visibilityFilter = this.getTherapistTaskVisibility(therapistId, supervisedTherapistIds);
    if (visibilityFilter) {
      query = query.where(visibilityFilter);
    }

    const results = await query
      .orderBy(desc(tasks.createdAt))
      .limit(limit);

    return results.map(r => ({ 
      ...r.task, 
      assignedTo: r.assignedTo || undefined,
      client: r.client!
    }));
  }

  async getUpcomingTasks(limit: number = 10, therapistId?: number, supervisedTherapistIds?: number[]): Promise<(Task & { assignedTo?: User; client: Client })[]> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    let query = db
      .select({
        task: tasks,
        assignedTo: users,
        client: clients
      })
      .from(tasks)
      .leftJoin(clients, eq(tasks.clientId, clients.id))
      .leftJoin(users, eq(tasks.assignedToId, users.id))
      .$dynamic();

    // Apply consistent role-based filtering using centralized helper
    const visibilityFilter = this.getTherapistTaskVisibility(therapistId, supervisedTherapistIds);
    const dateFilter = and(
      or(eq(tasks.status, 'pending'), eq(tasks.status, 'in_progress')),
      sql`${tasks.dueDate} >= ${today.toISOString()}`
    );
    
    const whereCondition = visibilityFilter ? and(visibilityFilter, dateFilter) : dateFilter;
    
    const results = await query
      .where(whereCondition)
      .orderBy(asc(tasks.dueDate))
      .limit(limit);

    return results.map(r => ({ 
      ...r.task, 
      assignedTo: r.assignedTo || undefined,
      client: r.client!
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

    return results.map(r => ({ 
      ...r.document, 
      uploadedBy: r.uploadedBy 
    }));
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
    const result = await db.insert(libraryCategories).values(categoryData).returning();
    return (result as LibraryCategory[])[0];
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
    const baseConditions = [eq(libraryEntryConnections.isActive, true)];
    
    if (entryId) {
      const condition = or(
        eq(libraryEntryConnections.fromEntryId, entryId), 
        eq(libraryEntryConnections.toEntryId, entryId)
      );
      if (condition) {
        baseConditions.push(condition);
      }
    }

    const query = db
      .select()
      .from(libraryEntryConnections)
      .where(and(...baseConditions));

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
  async getAssessmentTemplateSections(templateId: number): Promise<any[]> {
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

        // Fetch options for each question
        const questionsWithOptions = await Promise.all(
          questions.map(async (q) => {
            const options = await db
              .select()
              .from(assessmentQuestionOptions)
              .where(eq(assessmentQuestionOptions.questionId, q.id))
              .orderBy(asc(assessmentQuestionOptions.sortOrder));

            return {
              id: q.id,
              sectionId: q.sectionId,
              questionText: q.questionText,
              questionType: q.questionType,
              isRequired: q.isRequired,
              sortOrder: q.sortOrder,
              ratingMin: q.ratingMin,
              ratingMax: q.ratingMax,
              ratingLabels: q.ratingLabels,
              contributesToScore: q.contributesToScore,
              createdAt: q.createdAt,
              updatedAt: q.updatedAt,
              options: options.map(opt => opt.optionText),
              scoreValues: options.map(opt => Number(opt.optionValue) || 0)
            };
          })
        );

        return {
          id: section.id,
          templateId: section.templateId,
          title: section.title,
          description: section.description,
          accessLevel: section.accessLevel,
          isScoring: section.isScoring,
          reportMapping: section.reportMapping,
          aiReportPrompt: section.aiReportPrompt,
          sortOrder: section.sortOrder,
          createdAt: section.createdAt,
          updatedAt: section.updatedAt,
          questions: questionsWithOptions
        };
      })
    );

    return sectionsWithQuestions;
  }

  // Save or update assessment response
  async saveAssessmentResponse(responseData: any): Promise<AssessmentResponse> {
    // Calculate score value for this response
    const scoreValue = await this.calculateResponseScore(responseData);

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

    let savedResponse: AssessmentResponse;

    if (existingResponse) {
      // Update existing response
      const [updatedResponse] = await db
        .update(assessmentResponses)
        .set({
          responseText: responseData.responseText,
          selectedOptions: responseData.selectedOptions,
          ratingValue: responseData.ratingValue,
          scoreValue: scoreValue !== null ? scoreValue.toString() : null,
          updatedAt: new Date()
        })
        .where(eq(assessmentResponses.id, existingResponse.id))
        .returning();
      savedResponse = updatedResponse;
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
          scoreValue: scoreValue !== null ? scoreValue.toString() : null,
          createdAt: new Date(),
          updatedAt: new Date()
        })
        .returning();
      savedResponse = newResponse;
    }

    // Update the overall assessment total score
    await this.updateAssessmentTotalScore(responseData.assignmentId);

    return savedResponse;
  }

  // Calculate score value for an individual response
  async calculateResponseScore(responseData: any): Promise<number | null> {
    // Get the question to check if it contributes to scoring
    const [question] = await db
      .select()
      .from(assessmentQuestions)
      .where(eq(assessmentQuestions.id, responseData.questionId));

    if (!question || !question.contributesToScore) {
      return null; // This question doesn't contribute to scoring
    }

    // For multiple choice/checkbox questions - use option values
    if (responseData.selectedOptions && responseData.selectedOptions.length > 0) {
      // Get the option values for selected options
      const options = await db
        .select()
        .from(assessmentQuestionOptions)
        .where(
          and(
            eq(assessmentQuestionOptions.questionId, responseData.questionId),
            inArray(assessmentQuestionOptions.id, responseData.selectedOptions)
          )
        );

      // Sum up the option values
      return options.reduce((total, option) => {
        return total + (Number(option.optionValue) || 0);
      }, 0);
    }

    // For rating scale questions - use the rating value directly
    if (responseData.ratingValue !== null && responseData.ratingValue !== undefined) {
      return Number(responseData.ratingValue);
    }

    // For other question types that don't have numeric scoring
    return null;
  }

  // Update the total score for an assessment assignment
  async updateAssessmentTotalScore(assignmentId: number): Promise<void> {
    // Get all responses for this assignment that have score values
    const scoredResponses = await db
      .select({
        scoreValue: assessmentResponses.scoreValue,
        questionId: assessmentResponses.questionId,
        sectionId: assessmentQuestions.sectionId,
        isScoring: assessmentSections.isScoring
      })
      .from(assessmentResponses)
      .leftJoin(assessmentQuestions, eq(assessmentResponses.questionId, assessmentQuestions.id))
      .leftJoin(assessmentSections, eq(assessmentQuestions.sectionId, assessmentSections.id))
      .where(
        and(
          eq(assessmentResponses.assignmentId, assignmentId),
          isNotNull(assessmentResponses.scoreValue),
          eq(assessmentSections.isScoring, true) // Only include responses from scoring sections
        )
      );

    // Calculate total score
    const totalScore = scoredResponses.reduce((total, response) => {
      return total + (Number(response.scoreValue) || 0);
    }, 0);

    // Update the assessment assignment with the new total score
    await db
      .update(assessmentAssignments)
      .set({
        totalScore: totalScore.toString(),
        updatedAt: new Date()
      })
      .where(eq(assessmentAssignments.id, assignmentId));
  }

  // Recalculate scores for all responses in an assessment (useful for fixing existing data)
  async recalculateAssessmentScores(assignmentId: number): Promise<void> {
    // Get all responses for this assignment
    const responses = await db
      .select()
      .from(assessmentResponses)
      .where(eq(assessmentResponses.assignmentId, assignmentId));

    // Recalculate score for each response
    for (const response of responses) {
      const scoreValue = await this.calculateResponseScore({
        assignmentId: response.assignmentId,
        questionId: response.questionId,
        responseText: response.responseText,
        selectedOptions: response.selectedOptions,
        ratingValue: response.ratingValue
      });

      // Update the response with new score
      await db
        .update(assessmentResponses)
        .set({
          scoreValue: scoreValue !== null ? scoreValue.toString() : null,
          updatedAt: new Date()
        })
        .where(eq(assessmentResponses.id, response.id));
    }

    // Recalculate the total assessment score
    await this.updateAssessmentTotalScore(assignmentId);
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
        .where(eq(assessmentSections.templateId, templateId))
        .orderBy(asc(assessmentSections.sortOrder));

      if (!sections || sections.length === 0) {
        return [];
      }

      // Get questions for each section
      const sectionsWithQuestions = [];
      for (const section of sections) {
        const questions = await db.select().from(assessmentQuestions)
          .where(eq(assessmentQuestions.sectionId, section.id))
          .orderBy(asc(assessmentQuestions.sortOrder));

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

  // Service Management Methods
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

  async updateRoom(id: number, updateData: any): Promise<SelectRoom> {
    const [room] = await db
      .update(rooms)
      .set({
        ...updateData,
        updatedAt: new Date()
      })
      .where(eq(rooms.id, id))
      .returning();
    return room;
  }

  async deleteRoom(id: number): Promise<void> {
    await db.delete(rooms).where(eq(rooms.id, id));
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
    return role;
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
    serviceCode?: string;
    clientSearch?: string;
    clientType?: string;
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
      conditions.push(sql`DATE(${sessions.sessionDate}) >= ${params.startDate}`);
    }
    
    if (params.endDate) {
      conditions.push(sql`DATE(${sessions.sessionDate}) <= ${params.endDate}`);
    }
    
    if (params.therapistId) {
      conditions.push(eq(sessions.therapistId, params.therapistId));
    }
    
    if (params.status) {
      conditions.push(eq(sessionBilling.paymentStatus, params.status as any));
    }
    
    if (params.serviceCode) {
      conditions.push(eq(sessionBilling.serviceCode, params.serviceCode));
    }
    
    if (params.clientSearch) {
      conditions.push(sql`LOWER(${clients.fullName}) LIKE LOWER(${'%' + params.clientSearch + '%'})`);
    }
    
    if (params.clientType) {
      conditions.push(eq(clients.clientType, params.clientType));
    }
    
    if (conditions.length > 0) {
      const results = await query.where(and(...conditions)).orderBy(desc(sessionBilling.billingDate));
      return results;
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

    // For category management, show ALL options (active and inactive) so admins can manage them
    const options = await db.select().from(systemOptions)
      .where(eq(systemOptions.categoryId, id))
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
        .orderBy(checklistItems.itemOrder, checklistItems.title);
      
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
      .orderBy(checklistItems.itemOrder, checklistItems.title);

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
    const conditions = [];
    
    if (templateId) {
      conditions.push(eq(checklistItems.templateId, templateId));
    }
    
    if (conditions.length > 0) {
      return await db.select().from(checklistItems)
        .where(and(...conditions))
        .orderBy(checklistItems.templateId, checklistItems.itemOrder, checklistItems.title);
    }
    
    return await db.select().from(checklistItems)
      .orderBy(checklistItems.templateId, checklistItems.itemOrder, checklistItems.title);
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
      // Get checklists with template info
      const checklists = await db.select({
        checklist: clientChecklists,
        template: checklistTemplates
      })
      .from(clientChecklists)
      .innerJoin(checklistTemplates, eq(clientChecklists.templateId, checklistTemplates.id))
      .where(eq(clientChecklists.clientId, clientId))
      .orderBy(checklistTemplates.sortOrder, checklistTemplates.name);

      // For each checklist, get its items with proper ordering
      const checklistsWithItems = await Promise.all(
        checklists.map(async (row) => {
          const items = await db.select({
            clientItem: clientChecklistItems,
            checklistItem: checklistItems
          })
          .from(clientChecklistItems)
          .innerJoin(checklistItems, eq(clientChecklistItems.checklistItemId, checklistItems.id))
          .where(eq(clientChecklistItems.clientChecklistId, row.checklist.id))
          .orderBy(checklistItems.itemOrder); // Sort by your intended order

          return {
            ...row.checklist,
            template: row.template,
            items: items.map(item => ({
              ...item.clientItem,
              checklistItem: item.checklistItem
            }))
          };
        })
      );

      return checklistsWithItems;
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
      .orderBy(checklistItems.itemOrder);

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
    const conditions = [eq(systemOptions.isActive, true)];
    
    if (categoryId) {
      conditions.push(eq(systemOptions.categoryId, categoryId));
    }

    const query = db.select({
      option: systemOptions,
      category: optionCategories
    })
    .from(systemOptions)
    .innerJoin(optionCategories, eq(systemOptions.categoryId, optionCategories.id))
    .where(and(...conditions));

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

  async updateSystemOptionWithMigration(id: number, optionData: Partial<InsertSystemOption>, oldOptionKey?: string): Promise<SelectSystemOption> {
    // Get the current option to determine its category
    const [currentOption] = await db.select().from(systemOptions).where(eq(systemOptions.id, id));
    if (!currentOption) {
      throw new Error('Option not found');
    }

    // Check if option key is changing
    const isKeyChanging = optionData.optionKey && optionData.optionKey !== oldOptionKey;
    
    if (isKeyChanging && oldOptionKey) {
      
      // Determine which table/column to update based on category
      const categoryKey = await this.getCategoryKey(currentOption.categoryId);
      
      if (categoryKey && optionData.optionKey) {
        await this.migrateOptionData(categoryKey, oldOptionKey, optionData.optionKey);
      }
    }

    // Update the option
    const [option] = await db.update(systemOptions)
      .set({ ...optionData, updatedAt: new Date() })
      .where(eq(systemOptions.id, id))
      .returning();
    
    return option;
  }

  private async getCategoryKey(categoryId: number): Promise<string | null> {
    const [category] = await db.select({ categoryKey: optionCategories.categoryKey })
      .from(optionCategories)
      .where(eq(optionCategories.id, categoryId));
    return category?.categoryKey || null;
  }

  private async migrateOptionData(categoryKey: string, oldKey: string, newKey: string): Promise<void> {
    try {
      // Map category keys to their corresponding tables and columns
      const migrationMap: Record<string, { table: string; column: string }> = {
        'client_type': { table: 'clients', column: 'client_type' },
        'client_status': { table: 'clients', column: 'status' },
        'client_stage': { table: 'clients', column: 'stage' },
        'session_type': { table: 'sessions', column: 'session_type' },
        'session_status': { table: 'sessions', column: 'status' },
        // Add more mappings as needed
      };

      const migration = migrationMap[categoryKey];
      if (migration) {
        
        // Use raw SQL for the update since we need dynamic table/column names
        await db.execute(sql.raw(`
          UPDATE ${migration.table} 
          SET ${migration.column} = '${newKey}' 
          WHERE ${migration.column} = '${oldKey}'
        `));
        
      } else {
      }
    } catch (error) {

      throw error;
    }
  }

  async deleteSystemOption(id: number): Promise<void> {
    await db.delete(systemOptions).where(eq(systemOptions.id, id));
  }

  async assignChecklistToClient(clientId: number, templateId: number, dueDate?: string): Promise<any> {
    const [assignment] = await db.insert(clientChecklists).values({
      clientId,
      templateId,
      dueDate,
      isCompleted: false
    }).returning();

    // Create checklist items for the client
    const templateItems = await db.select().from(checklistItems)
      .where(eq(checklistItems.templateId, templateId))
      .orderBy(checklistItems.itemOrder);

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
        dueDate: null
      }).returning();

      // Create client checklist items
      const items = await db.select().from(checklistItems)
        .where(eq(checklistItems.templateId, template.id))
        .orderBy(checklistItems.itemOrder);
      const clientItems = items.map(item => ({
        clientChecklistId: clientChecklist.id,
        checklistItemId: item.id
      }));

      if (clientItems.length > 0) {
        await db.insert(clientChecklistItems).values(clientItems);
      }
    }
  }

  // ===== NOTIFICATION SYSTEM IMPLEMENTATION =====

  async getUserNotifications(userId: number, limit: number = 50): Promise<Notification[]> {
    return await db
      .select()
      .from(notifications)
      .where(eq(notifications.userId, userId))
      .orderBy(desc(notifications.createdAt))
      .limit(limit);
  }

  async getUnreadNotificationCount(userId: number): Promise<number> {
    const result = await db
      .select({ count: count() })
      .from(notifications)
      .where(and(
        eq(notifications.userId, userId),
        eq(notifications.isRead, false)
      ));
    return result[0]?.count || 0;
  }

  async createNotification(notification: InsertNotification): Promise<Notification> {
    const [created] = await db
      .insert(notifications)
      .values(notification)
      .returning();
    return created;
  }

  async createNotificationsBatch(notificationsData: InsertNotification[]): Promise<void> {
    if (notificationsData.length > 0) {
      await db.insert(notifications).values(notificationsData);
    }
  }

  async markNotificationAsRead(notificationId: number, userId: number): Promise<void> {
    await db
      .update(notifications)
      .set({ isRead: true, readAt: new Date() })
      .where(and(
        eq(notifications.id, notificationId),
        eq(notifications.userId, userId)
      ));
  }

  async markAllNotificationsAsRead(userId: number): Promise<void> {
    await db
      .update(notifications)
      .set({ isRead: true, readAt: new Date() })
      .where(and(
        eq(notifications.userId, userId),
        eq(notifications.isRead, false)
      ));
  }

  async deleteNotification(notificationId: number, userId: number): Promise<void> {
    await db
      .delete(notifications)
      .where(and(
        eq(notifications.id, notificationId),
        eq(notifications.userId, userId)
      ));
  }

  // Notification Triggers Management
  async getNotificationTriggers(eventType?: string): Promise<NotificationTrigger[]> {
    if (eventType) {
      return await db
        .select()
        .from(notificationTriggers)
        .where(and(
          eq(notificationTriggers.eventType, eventType as any),
          eq(notificationTriggers.isActive, true)
        ));
    }
    return await db
      .select()
      .from(notificationTriggers)
      .where(eq(notificationTriggers.isActive, true));
  }

  async getNotificationTrigger(id: number): Promise<NotificationTrigger | undefined> {
    const [trigger] = await db
      .select()
      .from(notificationTriggers)
      .where(eq(notificationTriggers.id, id));
    return trigger;
  }

  async createNotificationTrigger(trigger: InsertNotificationTrigger): Promise<NotificationTrigger> {
    const [created] = await db
      .insert(notificationTriggers)
      .values(trigger)
      .returning();
    return created;
  }

  async updateNotificationTrigger(id: number, trigger: Partial<InsertNotificationTrigger>): Promise<NotificationTrigger> {
    const [updated] = await db
      .update(notificationTriggers)
      .set({ ...trigger, updatedAt: new Date() })
      .where(eq(notificationTriggers.id, id))
      .returning();
    return updated;
  }

  async deleteNotificationTrigger(id: number): Promise<void> {
    await db
      .delete(notificationTriggers)
      .where(eq(notificationTriggers.id, id));
  }

  // Notification Preferences Management
  async getUserNotificationPreferences(userId: number): Promise<NotificationPreference[]> {
    return await db
      .select()
      .from(notificationPreferences)
      .where(eq(notificationPreferences.userId, userId));
  }

  async getUserNotificationPreference(userId: number, triggerType: string): Promise<NotificationPreference | undefined> {
    const [preference] = await db
      .select()
      .from(notificationPreferences)
      .where(and(
        eq(notificationPreferences.userId, userId),
        eq(notificationPreferences.triggerType, triggerType as any)
      ));
    return preference;
  }

  async setUserNotificationPreference(userId: number, triggerType: string, preferences: Partial<InsertNotificationPreference>): Promise<NotificationPreference> {
    const existing = await this.getUserNotificationPreference(userId, triggerType);
    
    if (existing) {
      const [updated] = await db
        .update(notificationPreferences)
        .set({ ...preferences, updatedAt: new Date() })
        .where(and(
          eq(notificationPreferences.userId, userId),
          eq(notificationPreferences.triggerType, triggerType as any)
        ))
        .returning();
      return updated;
    } else {
      const [created] = await db
        .insert(notificationPreferences)
        .values({
          userId,
          triggerType: triggerType as any,
          ...preferences
        })
        .returning();
      return created;
    }
  }

  // Notification Templates Management
  async getNotificationTemplates(type?: string): Promise<NotificationTemplate[]> {
    if (type) {
      return await db
        .select()
        .from(notificationTemplates)
        .where(and(
          eq(notificationTemplates.type, type as any),
          eq(notificationTemplates.isActive, true)
        ));
    }
    return await db
      .select()
      .from(notificationTemplates)
      .where(eq(notificationTemplates.isActive, true));
  }

  async getNotificationTemplate(id: number): Promise<NotificationTemplate | undefined> {
    const [template] = await db
      .select()
      .from(notificationTemplates)
      .where(eq(notificationTemplates.id, id));
    return template;
  }

  async createNotificationTemplate(template: InsertNotificationTemplate): Promise<NotificationTemplate> {
    const [created] = await db
      .insert(notificationTemplates)
      .values(template)
      .returning();
    return created;
  }

  async updateNotificationTemplate(id: number, template: Partial<InsertNotificationTemplate>): Promise<NotificationTemplate> {
    const [updated] = await db
      .update(notificationTemplates)
      .set({ ...template, updatedAt: new Date() })
      .where(eq(notificationTemplates.id, id))
      .returning();
    return updated;
  }

  async deleteNotificationTemplate(id: number): Promise<void> {
    await db
      .delete(notificationTemplates)
      .where(eq(notificationTemplates.id, id));
  }

  // Notification Processing
  async processNotificationEvent(eventType: string, entityData: any): Promise<void> {
    // This will be delegated to the notification service
    // Import here to avoid circular dependency
    const { notificationService } = await import('./notification-service');
    return await notificationService.processEvent(eventType, entityData);
  }

  async cleanupExpiredNotifications(): Promise<void> {
    await db
      .delete(notifications)
      .where(and(
        sql`${notifications.expiresAt} IS NOT NULL`,
        sql`${notifications.expiresAt} < NOW()`
      ));
  }

  async getNotificationStats(): Promise<{ total: number; unread: number }> {
    const totalResult = await db
      .select({ count: count() })
      .from(notifications);
    
    const unreadResult = await db
      .select({ count: count() })
      .from(notifications)
      .where(eq(notifications.isRead, false));

    return {
      total: totalResult[0]?.count || 0,
      unread: unreadResult[0]?.count || 0
    };
  }
}

export const storage = new DatabaseStorage();
