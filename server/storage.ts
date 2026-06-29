// Database Connection and Operators
import { db } from "./db";
import { eq, ne, and, or, ilike, desc, asc, count, sql, gte, lte, lt, inArray, isNull, isNotNull } from "drizzle-orm";
import { normalizePhoneE164 } from "@shared/phone";
import { isDuplicateInsuranceAmount } from "@shared/insurance";

// Database Schema - Tables
import { 
  clients, 
  users,
  userProfiles,
  supervisorAssignments,
  therapistBlockedTimes,
  clientPortalSessions,
  userActivityLog,
  sessions, 
  sessions as sessionsTable,
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
  reportTemplates,
  reportSupportingFiles,
  clientReports,
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
  notificationTemplates,
  patientConsents,
  sessionTranscripts,
  commTranscribeUploads,
  paymentTransactions,
  therapistPayRules,
  therapistPayouts,
  therapistPayoutItems,
  therapistPaymentAllocations,
  therapistEarnings,
  therapistAdjustments,
  auditLogs,
  dailyScheduleEmails,
  deferredNotificationEmails,
  insuranceStatements,
  insuranceStatementLines
} from "@shared/schema";

// Database Schema - Types
import type { 
  Client, 
  InsertClient,
  User, 
  InsertUser,
  BasicUserInfo,
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
  ReportTemplate,
  InsertReportTemplate,
  ReportSupportingFile,
  InsertReportSupportingFile,
  ClientReport,
  InsertClientReport,
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
  TherapistPayRule,
  InsertTherapistPayRule,
  TherapistPayout,
  InsertTherapistPayout,
  TherapistPayoutItem,
  InsuranceStatement,
  InsertInsuranceStatement,
  InsuranceStatementLine,
  InsertInsuranceStatementLine,
  ClientInvoice,
  UserProfile,
  InsertUserProfile,
  SupervisorAssignment,
  InsertSupervisorAssignment,
  TherapistBlockedTime,
  InsertTherapistBlockedTime,
  ClientPortalSession,
  InsertClientPortalSession,
  UserActivityLog,
  InsertUserActivityLog,
  SelectOptionCategory,
  InsertOptionCategory,
  SelectSystemOption,
  InsertSystemOption,
  Notification,
  PatientConsent,
  InsertPatientConsent,
  SessionTranscript,
  InsertSessionTranscript,
  CommTranscribeUpload,
  InsertCommTranscribeUpload,
  InsertNotification,
  NotificationTrigger,
  InsertNotificationTrigger,
  NotificationPreference,
  InsertNotificationPreference,
  NotificationTemplate,
  InsertNotificationTemplate,
  PaymentTransaction,
  DailyScheduleEmail,
  InsertDailyScheduleEmail,
  DeferredNotificationEmail,
  InsertDeferredNotificationEmail
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
  checklistItemIds?: number[];
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

export interface ClientsQueryResult {
  clients: (Client & { assignedTherapist?: BasicUserInfo; sessionCount: number; taskCount: number; documentCount: number })[];
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
  // Date filtering parameters
  dueDateFrom?: Date;
  dueDateTo?: Date;
  createdDateFrom?: Date;
  createdDateTo?: Date;
};

// Note query parameters for filtering
export type NoteQueryParams = {
  clientId: number;
  noteType?: string;
  startDate?: Date;
  endDate?: Date;
};

// Session filtering parameters for secure, database-level filtering
export type SessionFilterParams = {
  therapistId?: number;
  supervisedTherapistIds?: number[];
  startDate?: Date;
  endDate?: Date;
  status?: string;
  serviceCode?: string;
  clientId?: number;
  clientType?: string;
  page?: number;
  limit?: number;
  includeHiddenServices?: boolean; // Admin-only flag to see all services
};

// Type for sessions with joined relations (without legacy room string field)
export type SessionWithRelations = Omit<Session, 'room'> & { 
  therapist: User; 
  client?: Client; 
  service: any; 
  room: any;
};

export type SessionQueryResult = {
  sessions: SessionWithRelations[];
  total: number;
  totalPages: number;
};

// A single owed (collected, not-yet-paid) session for a therapist, with the
// resolved pay rule and computed earnings. `payType` is null when no rule
// (specific or default) applies — such items are surfaced but excluded from
// the payable total so nothing is paid by accident.
export interface TherapistOwedItem {
  sessionBillingId: number;
  sessionId: number;
  sessionDate: Date;
  serviceId: number | null;
  serviceCode: string | null;
  serviceName: string | null;
  category: string | null;
  clientName: string;
  totalAmount: number;
  collectedAmount: number;
  payType: 'percentage' | 'fixed' | null;
  payValue: number | null;
  ruleSource: 'service' | 'default' | 'none';
  amountEarned: number;
  // Portion of amountEarned already covered by non-voided lump/partial payments.
  amountAllocated: number;
  // What is still owed for this session: amountEarned - amountAllocated.
  amountRemaining: number;
}

export interface TherapistPayoutItemDetail {
  id: number;
  sessionBillingId: number;
  sessionId: number;
  sessionDate: Date | null;
  serviceCode: string | null;
  serviceName: string | null;
  clientName: string;
  basisAmount: number;
  payType: string;
  payValue: number;
  amountEarned: number;
  // For lump/partial payments this is the portion of amountEarned this payout
  // covered (may be less than amountEarned). For legacy itemized payouts it
  // equals amountEarned.
  amountAllocated: number;
}

// A single dated line in a therapist's running statement: either money EARNED
// from a collected session (positive) or a PAYMENT made to the therapist
// (negative). runningBalance is what the practice owed the therapist right
// after this line (positive = owed to therapist, negative = therapist credit).
export interface TherapistStatementEntry {
  date: string; // YYYY-MM-DD
  // 'adjustment' lines reverse a previously-recorded payment that was later
  // voided, or carry a manual bonus/deduction, so the ledger stays continuous.
  type: 'earning' | 'payment' | 'adjustment';
  description: string;
  reference: string | null;
  earned: number;   // > 0 for earning lines and bonuses, 0 otherwise
  // > 0 for payment lines and deductions; < 0 for a void-reversal adjustment line.
  paid: number;
  runningBalance: number;
  payoutId?: number;
  sessionId?: number;
  // Set on manual bonus/deduction lines so the UI can offer a "void" action.
  adjustmentId?: number;
}

// A manual, non-session ledger item (bonus or deduction) shown in the
// adjustments list. Signed `amount`: bonus is positive, deduction negative.
export interface TherapistAdjustmentRow {
  id: number;
  therapistId: number;
  adjustmentType: 'bonus' | 'deduction';
  amount: number;        // always positive (the magnitude)
  signedAmount: number;  // + for bonus, - for deduction (effect on owed)
  description: string;
  effectiveDate: string; // YYYY-MM-DD
  status: 'active' | 'voided';
  createdAt: Date;
}

// The "needs attention" summary across therapists for the payments dashboard.
export interface TherapistPayAttention {
  // Therapists with collected sessions that have NO pay rule set (can't be paid).
  unresolved: { therapistId: number; therapistName: string; count: number }[];
  // Therapists carrying an over-payment credit (paid ahead of earnings).
  credits: { therapistId: number; therapistName: string; creditBalance: number }[];
  // Therapists with owed sessions older than the staleDays threshold.
  staleUnpaid: {
    therapistId: number;
    therapistName: string;
    count: number;
    oldestDate: string | null;
    total: number;
  }[];
  staleDays: number;
}

// A single session-level allocation produced when a payout is recorded, surfaced
// so each allocation can be written to the audit trail with stable identifiers.
export interface TherapistPayoutAllocationDetail {
  sessionBillingId: number;
  sessionId: number;
  amountAllocated: number;
}

export interface TherapistStatement {
  therapistId: number;
  therapistName: string;
  entries: TherapistStatementEntry[];
  totalEarned: number;
  totalPaid: number;
  // Net = totalEarned - totalPaid. currentOwed = max(net, 0);
  // creditBalance = max(-net, 0) (therapist was paid ahead of earnings).
  currentOwed: number;
  creditBalance: number;
  unresolvedCount: number;
}

export interface TherapistMonthlySessionRow {
  sessionId: number;
  sessionBillingId: number | null; // null when the session has no billing record yet
  sessionDate: Date | null;
  clientName: string;
  clientType: string | null;
  serviceCode: string | null;
  serviceName: string | null;
  status: string | null; // session status (scheduled / completed / cancelled / no_show ...)
  billed: boolean;       // true if a billing record exists; false = not billed yet
  expected: number;    // full fee after discount (what should be collected)
  collected: number;   // client + insurance paid
  uncollected: number; // expected - collected (clamped at >= 0)
  earned: number;      // therapist earning on collected (0 if no rule)
  hasRule: boolean;
}

export interface TherapistMonthlyStatement {
  therapistId: number;
  therapistName: string;
  month: string; // YYYY-MM
  openingBalance: number;
  earnedInMonth: number;
  paidInMonth: number;
  closingBalance: number;
  sessions: TherapistMonthlySessionRow[];
  totalExpected: number;
  totalCollected: number;
  totalUncollected: number;
  unbilledCount: number;          // sessions in the month with NO billing record
  unbilledCompletedCount: number; // of those, ones already marked completed (the real gap)
}

// Row shape for the insurance statements list (counts rolled up per statement).
export interface InsuranceStatementSummary extends InsuranceStatement {
  uploadedByName: string | null;
  therapistName: string | null; // the one therapist this statement belongs to
  lineCount: number;
  matchedCount: number; // suggested or confirmed
  postedCount: number;
  postedTotal: number; // sum of insurance-paid amounts on posted lines
}

// One flat transaction row for the cross-statement "Transactions" list: a single
// statement line enriched with its statement + therapist + matched-client info.
export interface InsuranceTransactionRow {
  lineId: number;
  statementId: number;
  statementFileName: string;
  statementStatus: string;
  payerName: string | null;
  therapistName: string | null;
  serviceDate: string | null;
  clientName: string | null;     // matched session client, else the statement's raw name
  serviceCode: string | null;
  insurancePaidAmount: string;
  matchStatus: string;
  remarkCode: string | null;
}

// A statement line enriched with the matched billing's display fields so the
// review screen can show what each line was matched to.
export interface InsuranceStatementLineDetail extends InsuranceStatementLine {
  matchedClientName: string | null;
  matchedSessionDate: Date | null;
  matchedServiceCode: string | null;
  matchedServiceName: string | null;
  matchedBilledTotal: number | null;
  matchedInsurancePaid: number | null;
  matchedClientPaid: number | null;
}

export interface InsuranceStatementDetail {
  statement: InsuranceStatement;
  therapistName: string | null; // resolved name for statement.therapistId
  lines: InsuranceStatementLineDetail[];
}

export interface IStorage {
  
  // ===== USER MANAGEMENT =====
  getUser(id: number): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  getUserByCalendarFeedToken(token: string): Promise<User | undefined>;
  getUserByName(fullName: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  updateUser(id: number, user: Partial<InsertUser>): Promise<User>;
  deleteUser(id: number): Promise<void>;
  getTherapists(): Promise<User[]>;
  getUsers(): Promise<User[]>;

  // ===== THERAPIST PAYMENTS (compensation rules, owed earnings, payouts) =====
  getTherapistPayRules(therapistId: number): Promise<TherapistPayRule[]>;
  upsertTherapistPayRule(rule: InsertTherapistPayRule): Promise<TherapistPayRule>;
  deleteTherapistPayRule(id: number, therapistId: number): Promise<void>;
  // Sessions whose billing has been (at least partly) collected for this
  // therapist and that have not yet been included in a payout, with the
  // applicable pay rule resolved and the earned amount computed.
  getTherapistOwed(therapistId: number): Promise<{
    therapistId: number;
    items: TherapistOwedItem[];
    total: number;
    unresolvedCount: number;
  }>;
  createTherapistPayout(input: {
    therapistId: number;
    paymentDate: string;
    paymentMethod?: string | null;
    referenceNumber?: string | null;
    notes?: string | null;
    sessionBillingIds: number[];
    createdBy: number;
  }): Promise<TherapistPayout & { allocations: TherapistPayoutAllocationDetail[] }>;
  createTherapistLumpPayment(input: {
    therapistId: number;
    amount: number;
    paymentDate: string;
    paymentMethod?: string | null;
    referenceNumber?: string | null;
    notes?: string | null;
    createdBy: number;
  }): Promise<TherapistPayout & { appliedAmount: number; unappliedAmount: number; allocationCount: number; allocations: TherapistPayoutAllocationDetail[] }>;
  getTherapistPayouts(therapistId?: number): Promise<(TherapistPayout & { therapistName: string; itemCount: number })[]>;
  getTherapistPayoutById(id: number): Promise<(TherapistPayout & { therapistName: string; items: TherapistPayoutItemDetail[] }) | undefined>;
  voidTherapistPayout(id: number, voidedBy: number, reason: string): Promise<TherapistPayout>;
  getTherapistStatement(therapistId: number): Promise<TherapistStatement>;
  getTherapistMonthlyStatement(therapistId: number, month: string): Promise<TherapistMonthlyStatement>;
  getTherapistPeriodStatement(therapistId: number, startDate: string, endDate: string): Promise<TherapistMonthlyStatement>;

  // ===== INSURANCE STATEMENT RECONCILIATION =====
  // Persist an uploaded statement and its extracted lines, then auto-match each
  // line to a session_billing record.
  createInsuranceStatement(
    statement: InsertInsuranceStatement,
    lines: Omit<InsertInsuranceStatementLine, 'statementId'>[],
  ): Promise<InsuranceStatement>;
  // Look for an already-uploaded (non-voided) statement that looks like the same
  // one, so a re-upload can be flagged before it gets posted twice.
  findDuplicateStatement(input: {
    payerName: string | null;
    statementDate: string | null;
    totalPaid: string | null;
    checkNumber: string | null;
    lineCount: number;
  }): Promise<{
    id: number;
    status: string;
    fileName: string;
    payerName: string | null;
    statementDate: string | null;
    totalPaid: string | null;
    createdAt: Date;
    lineCount: number;
  } | null>;
  // Re-run auto-matching for every still-unconfirmed line on a statement.
  autoMatchStatementLines(statementId: number): Promise<void>;
  getInsuranceStatements(): Promise<InsuranceStatementSummary[]>;
  getInsuranceStatementById(id: number): Promise<InsuranceStatementDetail | undefined>;
  // All statement lines across every statement, flattened for the Transactions
  // list (with statement, therapist and matched-client info for search/filter).
  getAllInsuranceLines(): Promise<InsuranceTransactionRow[]>;
  // Assign (or clear, with null) the single therapist a statement belongs to.
  updateInsuranceStatementTherapist(
    id: number,
    therapistId: number | null,
  ): Promise<InsuranceStatementDetail>;
  // Manually set a line's match (confirm a suggestion, point it at a different
  // billing, or skip it). Pass matchedSessionBillingId=null to clear the match.
  updateStatementLineMatch(
    lineId: number,
    update: {
      matchStatus: 'unmatched' | 'suggested' | 'confirmed' | 'skipped';
      matchedSessionBillingId?: number | null;
    },
  ): Promise<InsuranceStatementLine>;
  // Record an insurance payment for every confirmed line. Idempotent: lines
  // already posted are skipped, so a retry after a partial failure is safe.
  postInsuranceStatement(
    id: number,
    userId: number,
  ): Promise<{ statement: InsuranceStatement; postedCount: number; postedTotal: number }>;
  // Reverse every posted line's insurance payment and mark the statement voided.
  voidInsuranceStatement(id: number, userId: number, reason: string): Promise<InsuranceStatement>;
  // Re-open a voided statement: move its lines back to 'confirmed', clear the
  // void fields, and set a re-postable 'draft' status so it can go back through
  // the normal adoption-aware post flow.
  reopenInsuranceStatement(id: number, userId: number): Promise<InsuranceStatement>;
  // Permanently delete a statement and its lines. Only allowed for a statement
  // that is NOT posted (draft or voided) so we never silently leave billing
  // balances inflated; a posted statement must be voided first to reverse its
  // payments. Throws 'A posted statement must be voided' / 'Statement not found'.
  deleteInsuranceStatement(id: number): Promise<void>;

  // ===== DAILY SCHEDULE EMAILS (8 AM ET therapist digest) =====
  // All daily-email tracking rows for a given Eastern calendar day (yyyy-MM-dd).
  getDailyScheduleEmailsByDate(sendDate: string): Promise<DailyScheduleEmail[]>;
  // Insert-or-update the per-(therapist, day) record. A 'sent' row is the
  // idempotency guard that prevents a second send for the same Eastern day.
  upsertDailyScheduleEmail(data: InsertDailyScheduleEmail): Promise<void>;
  claimDailyScheduleEmail(
    therapistId: number,
    sendDate: string,
    maxAttempts: number,
  ): Promise<DailyScheduleEmail | undefined>;

  // ===== Deferred (quiet-hours) notification emails =====
  // Queue an email "ping" that was suppressed by quiet hours/weekend muting so a
  // catch-up summary can deliver it later instead of dropping it.
  enqueueDeferredNotificationEmail(data: InsertDeferredNotificationEmail): Promise<void>;
  // Distinct user ids that currently have at least one 'pending' queued email.
  getPendingDeferredEmailUserIds(): Promise<number[]>;
  // Atomically claim all of a user's 'pending' rows (-> 'processing'), bumping
  // attempts, and return them. Only the caller that wins the claim gets rows.
  claimPendingDeferredEmails(userId: number): Promise<DeferredNotificationEmail[]>;
  // Mark a set of claimed rows as 'sent'.
  markDeferredEmailsSent(ids: number[]): Promise<void>;
  // Release claimed rows after a send failure: back to 'pending' for retry, or
  // 'failed' once they have reached maxAttempts (so they stop being retried).
  releaseDeferredEmails(ids: number[], maxAttempts: number, error: string): Promise<void>;

  // ===== USER PROFILES =====
  getUserProfile(userId: number): Promise<UserProfile | undefined>;
  createUserProfile(profile: InsertUserProfile): Promise<UserProfile>;
  updateUserProfile(userId: number, profile: Partial<InsertUserProfile>): Promise<UserProfile>;
  deleteUserProfile(userId: number): Promise<void>;
  
  // ===== THERAPIST AVAILABILITY =====
  getTherapistBlockedTimes(therapistId: number, startDate?: Date, endDate?: Date): Promise<TherapistBlockedTime[]>;
  createTherapistBlockedTime(blockedTime: InsertTherapistBlockedTime): Promise<TherapistBlockedTime>;
  updateTherapistBlockedTime(id: number, blockedTime: Partial<InsertTherapistBlockedTime>): Promise<TherapistBlockedTime>;
  deleteTherapistBlockedTime(id: number): Promise<void>;
  getAvailableTimeSlots(therapistId: number, date: Date, serviceId: number): Promise<{ time: string; available: boolean }[]>;
  
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
  getClient(id: number): Promise<(Client & { assignedTherapist?: BasicUserInfo }) | undefined>;
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
  getClientInvoices(clientId: number): Promise<ClientInvoice[]>;

  // ===== CLIENT PORTAL AUTHENTICATION =====
  getClientByPortalEmail(portalEmail: string): Promise<Client | undefined>;
  createPortalSession(session: InsertClientPortalSession): Promise<ClientPortalSession>;
  getPortalSessionByToken(token: string): Promise<ClientPortalSession | undefined>;
  updatePortalSessionActivity(id: number): Promise<void>;
  deletePortalSession(id: number): Promise<void>;
  deleteClientPortalSessions(clientId: number): Promise<void>;
  cleanupExpiredPortalSessions(): Promise<void>;

  // ===== PATIENT CONSENT MANAGEMENT (GDPR) =====
  getClientsByPhone(e164: string): Promise<Client[]>;
  getClientConsents(clientId: number): Promise<PatientConsent[]>;
  getClientConsent(clientId: number, consentType: string): Promise<PatientConsent | undefined>;
  createClientConsent(consent: InsertPatientConsent): Promise<PatientConsent>;
  updateClientConsent(id: number, consent: Partial<InsertPatientConsent>): Promise<PatientConsent>;
  withdrawClientConsent(clientId: number, consentType: string): Promise<PatientConsent>;
  hasClientConsent(clientId: number, consentType: string): Promise<boolean>;

  // ===== SESSION TRANSCRIPTS (Voice Recording) =====
  getSessionTranscript(sessionId: number): Promise<SessionTranscript | undefined>;
  getSessionTranscriptByUploadId(uploadId: string): Promise<SessionTranscript | undefined>;
  // Bulk: returns the set of sessionIds that have a transcript with status='ready'.
  getReadyTranscriptSessionIds(sessionIds: number[]): Promise<number[]>;
  createSessionTranscript(data: InsertSessionTranscript): Promise<SessionTranscript>;
  updateSessionTranscript(id: number, data: Partial<InsertSessionTranscript>): Promise<SessionTranscript>;
  deleteSessionTranscript(sessionId: number): Promise<void>;
  // Append a single chunk's transcribed text to the recording row's `chunks` JSONB.
  appendTranscriptChunk(
    transcriptId: number,
    chunkIndex: number,
    text: string,
    durationSeconds: number,
  ): Promise<SessionTranscript>;
  // Atomically: update this transcript row to its final state AND delete any
  // other (older) transcript rows for the same session. Used at finalize time
  // so the user is never left with no transcript at all.
  finalizeTranscriptAtomic(
    transcriptId: number,
    sessionId: number,
    data: Partial<InsertSessionTranscript>,
  ): Promise<SessionTranscript>;

  // ===== COMMUNICATION VOICE DICTATION UPLOADS (chunked, restart-durable) =====
  createCommTranscribeUpload(data: InsertCommTranscribeUpload): Promise<CommTranscribeUpload>;
  getCommTranscribeUpload(uploadId: string): Promise<CommTranscribeUpload | undefined>;
  // Atomically merge a single chunk's transcribed text into the row's `chunks`
  // JSONB and bump lastActivityAt. Returns the updated row.
  appendCommTranscribeChunk(
    uploadId: string,
    chunkIndex: number,
    text: string,
  ): Promise<CommTranscribeUpload | undefined>;
  deleteCommTranscribeUpload(uploadId: string): Promise<void>;
  // Delete abandoned (never-finalized) rows whose lastActivityAt predates cutoff.
  sweepCommTranscribeUploads(cutoff: Date): Promise<void>;

  // ===== SESSION MANAGEMENT =====
  getAllSessions(): Promise<SessionWithRelations[]>;
  // SECURE: Database-level filtered session query with service visibility controls
  getSessionsWithFiltering(params: SessionFilterParams): Promise<SessionQueryResult>;
  getSessionsByClient(clientId: number, includeHiddenServices?: boolean): Promise<SessionWithRelations[]>;
  getSessionsByMonth(year: number, month: number, therapistId?: number, supervisedTherapistIds?: number[], includeHiddenServices?: boolean): Promise<SessionWithRelations[]>;
  getOverdueSessions(limit?: number, therapistId?: number, supervisedTherapistIds?: number[], includeHiddenServices?: boolean): Promise<(SessionWithRelations & { daysOverdue: number })[]>;
  getSession(id: number): Promise<Session | undefined>;
  createSession(session: InsertSession): Promise<Session>;
  createSessionsBulk(sessions: InsertSession[]): Promise<Session[]>;
  updateSession(id: number, session: Partial<InsertSession>): Promise<Session>;
  deleteSession(id: number): Promise<void>;
  
  // ===== SESSION CONFLICT DETECTION =====
  getClientSessionConflicts(clientId: number, includeHiddenServices?: boolean): Promise<{
    conflictDates: string[];
    conflicts: Array<{
      date: string;
      sessions: (Session & { therapist: User; service: any })[];
      type: 'same_service' | 'different_service';
    }>;
  }>;
  
  // ===== SERVICE AND ROOM LOOKUPS =====
  getServices(): Promise<any[]>;
  getServicesFiltered(userRole: string): Promise<any[]>; // Returns role-based filtered services
  updateService(id: number, updateData: any): Promise<any>;
  updateServiceVisibility(id: number, therapistVisible: boolean): Promise<any>;
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
  getNotesByClient(params: NoteQueryParams): Promise<(Note & { author: User })[]>;
  getNote(id: number): Promise<(Note & { author: User }) | undefined>;
  createNote(note: InsertNote & { authorId: number }): Promise<Note>;
  updateNote(id: number, note: Partial<InsertNote>): Promise<Note>;
  deleteNote(id: number): Promise<void>;

  // Document methods
  getDocumentsByClient(clientId: number): Promise<(Document & { uploadedBy: User | null })[]>;
  createDocument(document: InsertDocument): Promise<Document>;
  updateDocument(id: number, document: Partial<InsertDocument>): Promise<Document>;
  deleteDocument(id: number): Promise<void>;

  // Session Notes Management
  getSessionNotesBySession(sessionId: number): Promise<(SessionNote & { therapist: User; client: Client; session: Session })[]>;
  getSessionNotesByClient(clientId: number): Promise<(SessionNote & { therapist: User; session: Omit<Session, 'room'> & { room?: SelectRoom | null } })[]>;
  createSessionNote(sessionNote: InsertSessionNote): Promise<SessionNote>;
  updateSessionNote(id: number, sessionNote: Partial<InsertSessionNote>): Promise<SessionNote>;
  deleteSessionNote(id: number): Promise<void>;
  getSessionNote(id: number): Promise<(SessionNote & { therapist: User & { profile?: UserProfile | null }; client: Client; session: Omit<Session, 'room'> & { room?: SelectRoom | null } }) | undefined>;

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
  deleteAllLibraryEntryConnections(entryId: number): Promise<void>;
  getConnectedEntries(entryId: number): Promise<(LibraryEntry & { connectionType: string; connectionStrength: number; connectionId: number; category: LibraryCategory })[]>;

  // Assessment Templates Management
  getAssessmentTemplates(): Promise<(AssessmentTemplate & { createdBy: User | null; sectionsCount: number })[]>;
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
  checkOptionHasResponses(optionId: number): Promise<boolean>;
  checkQuestionHasResponses(questionId: number): Promise<boolean>;

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
  updateAssessmentReportDraft(assignmentId: number, draftContent: string): Promise<AssessmentReport>;
  getAssessmentReportById(id: number): Promise<AssessmentReport | undefined>;

  // Report Templates (admin-managed AI report templates)
  getReportTemplates(includeInactive?: boolean): Promise<(ReportTemplate & { createdBy?: User })[]>;
  getReportTemplate(id: number): Promise<ReportTemplate | undefined>;
  createReportTemplate(template: InsertReportTemplate): Promise<ReportTemplate>;
  updateReportTemplate(id: number, template: Partial<InsertReportTemplate>): Promise<ReportTemplate>;
  deleteReportTemplate(id: number): Promise<void>;

  // Report Supporting Files (per-client reference material for AI reports)
  getReportSupportingFilesByClient(clientId: number): Promise<ReportSupportingFile[]>;
  getReportSupportingFile(id: number): Promise<ReportSupportingFile | undefined>;
  createReportSupportingFile(file: InsertReportSupportingFile): Promise<ReportSupportingFile>;
  updateReportSupportingFile(id: number, file: Partial<InsertReportSupportingFile>): Promise<ReportSupportingFile>;
  deleteReportSupportingFile(id: number): Promise<void>;

  // Client Reports (AI-generated from templates)
  getClientReports(clientId: number): Promise<(ClientReport & { createdBy?: User; template?: ReportTemplate })[]>;
  getClientReport(id: number): Promise<(ClientReport & { client?: Client; createdBy?: (User & { profile?: UserProfile | null }); template?: ReportTemplate }) | undefined>;
  createClientReport(report: InsertClientReport): Promise<ClientReport>;
  updateClientReport(id: number, report: Partial<InsertClientReport>): Promise<ClientReport>;
  deleteClientReport(id: number): Promise<void>;

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

// Normalize a person's name into comparable word-tokens for insurance/EOB
// matching. Strips diacritics (José -> jose), lowercases, and splits on any
// non-letter/digit so punctuation and ordering are irrelevant (O'Brien ->
// ["obrien"], "Garcia Lopez, Maria" -> ["garcia","lopez","maria"]). Keeps
// tokens of length >= 2 so stray single-letter initials don't create noise.
function normalizedNameTokens(raw: string | null | undefined): string[] {
  if (!raw) return [];
  return (
    raw
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .match(/[a-z0-9]{2,}/g) || []
  );
}

// Edit (Levenshtein) distance between two strings — number of single-character
// insertions, deletions or substitutions to turn one into the other.
function editDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = new Array(n + 1);
  let curr = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

// Whether two *name word-pieces* should be treated as the same piece, tolerant
// of the differences seen between IFHP statements and stored client names:
//   - identical                       ("qazan" === "qazan")
//   - truncation / abbreviation       ("mohs" → "mohsen", "subh" → "subhi",
//                                       "lutf" → "lutfi", "german" → "germanica")
//   - transliteration / minor spelling diffs, same first letter
//                                     ("ghonem" ~ "ghoneim", "mohamed" ~ "mohamad")
// Kept deliberately conservative (same first letter, length-scaled threshold) so
// it loosens *spelling*, not identity — the single-candidate + service-date gates
// downstream still stop a loose piece from pulling in the wrong client.
function nameTokensSimilar(a: string, b: string): boolean {
  if (a === b) return true;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  // Truncation / abbreviation: the shorter piece is a prefix of the longer one.
  if (short.length >= 3 && long.startsWith(short)) return true;
  // Transliteration / minor spelling variation: same first letter, small edit
  // distance scaled to length (2 for longer pieces, 1 for shorter).
  if (short.length >= 4 && a[0] === b[0]) {
    const threshold = long.length >= 6 ? 2 : 1;
    if (editDistance(a, b) <= threshold) return true;
  }
  return false;
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

  async getUserByCalendarFeedToken(token: string): Promise<User | undefined> {
    if (!token) return undefined;
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.calendarFeedToken, token));
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
      // Derive the standardized SMS copy from the typed `phone` (never modifies
      // the typed value); null when it can't be standardized.
      .values({ ...insertUser, phoneE164: normalizePhoneE164(insertUser.phone) })
      .returning();
    return (result as User[])[0];
  }

  async updateUser(id: number, userData: Partial<InsertUser>): Promise<User> {
    // Only recompute the standardized copy when the typed phone is actually
    // part of this update. We require a concrete value (not `undefined`) because
    // Drizzle ignores `undefined` for the typed `phone` column, so treating a
    // `phone: undefined` payload as a change would clear phoneE164 and drift the
    // two columns. An explicit null/empty (a real clear) still recomputes.
    const phoneE164Patch =
      userData.phone !== undefined ? { phoneE164: normalizePhoneE164(userData.phone) } : {};
    const [user] = await db
      .update(users)
      .set({ ...userData, ...phoneE164Patch, updatedAt: new Date() })
      .where(eq(users.id, id))
      .returning();
    return user;
  }

  async deleteUser(id: number): Promise<void> {
    await db
      .delete(users)
      .where(eq(users.id, id));
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

  // ===== Daily Schedule Emails =====
  async getDailyScheduleEmailsByDate(sendDate: string): Promise<DailyScheduleEmail[]> {
    return await db
      .select()
      .from(dailyScheduleEmails)
      .where(eq(dailyScheduleEmails.sendDate, sendDate));
  }

  async upsertDailyScheduleEmail(data: InsertDailyScheduleEmail): Promise<void> {
    await db
      .insert(dailyScheduleEmails)
      .values(data)
      .onConflictDoUpdate({
        target: [dailyScheduleEmails.therapistId, dailyScheduleEmails.sendDate],
        set: {
          status: data.status ?? "sent",
          appointmentCount: data.appointmentCount ?? 0,
          attempts: data.attempts ?? 0,
          error: data.error ?? null,
          updatedAt: new Date(),
        },
      });
  }

  // Atomically claims the (therapist, day) slot BEFORE any email is sent, so the
  // claim — not the send — is the idempotency guard. Returns the claimed row
  // (status 'processing') only when this caller won the claim; returns undefined
  // otherwise. The claim succeeds when no row exists yet, or when the existing
  // row is 'failed' and still under the retry cap. A row that is 'sent' or
  // 'processing' is NEVER re-claimed: this guarantees at-most-once delivery (no
  // double-send). If the server crashes after the SparkPost send but before the
  // row is marked 'sent', that row stays 'processing' and is left alone rather
  // than re-sent — a stuck 'processing' row is visible/auditable for manual
  // recovery, which we accept over ever emailing a therapist twice.
  async claimDailyScheduleEmail(
    therapistId: number,
    sendDate: string,
    maxAttempts: number,
  ): Promise<DailyScheduleEmail | undefined> {
    const rows = await db
      .insert(dailyScheduleEmails)
      .values({
        therapistId,
        sendDate,
        status: "processing",
        appointmentCount: 0,
        attempts: 1,
        error: null,
      })
      .onConflictDoUpdate({
        target: [dailyScheduleEmails.therapistId, dailyScheduleEmails.sendDate],
        set: {
          status: "processing",
          attempts: sql`${dailyScheduleEmails.attempts} + 1`,
          error: null,
          updatedAt: new Date(),
        },
        // Only 'failed' rows under the retry cap may be re-claimed. 'sent' and
        // 'processing' rows never match, so they are never re-sent.
        setWhere: and(
          eq(dailyScheduleEmails.status, "failed"),
          lt(dailyScheduleEmails.attempts, maxAttempts),
        ),
      })
      .returning();
    return rows[0];
  }

  // ===== Deferred (quiet-hours) notification emails =====
  async enqueueDeferredNotificationEmail(
    data: InsertDeferredNotificationEmail,
  ): Promise<void> {
    await db.insert(deferredNotificationEmails).values(data);
  }

  async getPendingDeferredEmailUserIds(): Promise<number[]> {
    const rows = await db
      .selectDistinct({ userId: deferredNotificationEmails.userId })
      .from(deferredNotificationEmails)
      .where(eq(deferredNotificationEmails.status, "pending"));
    return rows.map((r) => r.userId);
  }

  // Atomically claim a user's pending rows. The single UPDATE ... RETURNING is
  // the idempotency guard: only ONE caller flips 'pending' -> 'processing', so
  // two overlapping ticks (or instances) can't both send the same summary.
  async claimPendingDeferredEmails(
    userId: number,
  ): Promise<DeferredNotificationEmail[]> {
    return await db
      .update(deferredNotificationEmails)
      .set({
        status: "processing",
        attempts: sql`${deferredNotificationEmails.attempts} + 1`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(deferredNotificationEmails.userId, userId),
          eq(deferredNotificationEmails.status, "pending"),
        ),
      )
      .returning();
  }

  async markDeferredEmailsSent(ids: number[]): Promise<void> {
    if (ids.length === 0) return;
    await db
      .update(deferredNotificationEmails)
      .set({ status: "sent", error: null, updatedAt: new Date() })
      .where(inArray(deferredNotificationEmails.id, ids));
  }

  // After a send failure: rows still under the cap go back to 'pending' for a
  // later retry; rows that have hit the cap are marked 'failed' so they stop
  // being retried (no storm). Crash-after-send rows are NOT handled here — they
  // stay 'processing' and are intentionally never re-sent (at-most-once).
  async releaseDeferredEmails(
    ids: number[],
    maxAttempts: number,
    error: string,
  ): Promise<void> {
    if (ids.length === 0) return;
    await db
      .update(deferredNotificationEmails)
      .set({ status: "pending", error, updatedAt: new Date() })
      .where(
        and(
          inArray(deferredNotificationEmails.id, ids),
          lt(deferredNotificationEmails.attempts, maxAttempts),
        ),
      );
    await db
      .update(deferredNotificationEmails)
      .set({ status: "failed", error, updatedAt: new Date() })
      .where(
        and(
          inArray(deferredNotificationEmails.id, ids),
          gte(deferredNotificationEmails.attempts, maxAttempts),
        ),
      );
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

  // Therapist Availability Methods
  async getTherapistBlockedTimes(therapistId: number, startDate?: Date, endDate?: Date): Promise<TherapistBlockedTime[]> {
    const conditions = [
      eq(therapistBlockedTimes.therapistId, therapistId),
      eq(therapistBlockedTimes.isActive, true)
    ];
    
    if (startDate) {
      conditions.push(gte(therapistBlockedTimes.endTime, startDate));
    }
    
    if (endDate) {
      conditions.push(lte(therapistBlockedTimes.startTime, endDate));
    }
    
    return await db
      .select()
      .from(therapistBlockedTimes)
      .where(and(...conditions))
      .orderBy(asc(therapistBlockedTimes.startTime));
  }

  async createTherapistBlockedTime(blockedTime: InsertTherapistBlockedTime): Promise<TherapistBlockedTime> {
    const [created] = await db
      .insert(therapistBlockedTimes)
      .values(blockedTime)
      .returning();
    return created;
  }

  async updateTherapistBlockedTime(id: number, blockedTimeData: Partial<InsertTherapistBlockedTime>): Promise<TherapistBlockedTime> {
    const [updated] = await db
      .update(therapistBlockedTimes)
      .set({ ...blockedTimeData, updatedAt: new Date() })
      .where(eq(therapistBlockedTimes.id, id))
      .returning();
    return updated;
  }

  async deleteTherapistBlockedTime(id: number): Promise<void> {
    await db
      .delete(therapistBlockedTimes)
      .where(eq(therapistBlockedTimes.id, id));
  }

  async getAvailableTimeSlots(therapistId: number, date: Date, serviceId: number, sessionType?: 'online' | 'in-person'): Promise<{ time: string; available: boolean }[]> {
    // Get therapist profile for working hours and room configuration
    const profile = await this.getUserProfile(therapistId);
    if (!profile) {
      return [];
    }

    // Get service duration
    const [service] = await db
      .select()
      .from(services)
      .where(eq(services.id, serviceId));
    
    if (!service) {
      return [];
    }

    const sessionDuration = service.duration || profile.sessionDuration || 50;
    
    // Determine session type from service name if not provided
    const isOnlineSession = sessionType === 'online' || 
      (service.serviceName && service.serviceName.toLowerCase().includes('online'));

    // Parse working hours from profile (stored as JSON array of day objects)
    const workingHoursData = profile.workingHours ? JSON.parse(profile.workingHours) : null;
    const dayOfWeek = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'][date.getDay()];
    
    // Check if working hours is an array (new format) or object (legacy format)
    let dayHours;
    if (Array.isArray(workingHoursData)) {
      // New format: array of day objects
      dayHours = workingHoursData.find(d => d.day && d.day.toLowerCase() === dayOfWeek.toLowerCase());
    } else if (workingHoursData && typeof workingHoursData === 'object') {
      // Legacy format: object with day keys
      dayHours = workingHoursData[dayOfWeek];
    }
    
    if (!dayHours || dayHours.enabled === false || !dayHours.start || !dayHours.end) {
      return []; // Not a working day or day is disabled
    }

    // Get blocked times for this day
    const dayStart = new Date(date);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(date);
    dayEnd.setHours(23, 59, 59, 999);

    const blockedTimes = await this.getTherapistBlockedTimes(therapistId, dayStart, dayEnd);

    // Get existing sessions for this therapist on this day
    const existingSessions = await db
      .select()
      .from(sessions)
      .where(and(
        eq(sessions.therapistId, therapistId),
        gte(sessions.sessionDate, dayStart),
        lte(sessions.sessionDate, dayEnd),
        inArray(sessions.status, ['scheduled', 'confirmed', 'in-progress'])
      ));

    // Get ALL sessions for this day (to check room availability)
    const allSessionsToday = await db
      .select()
      .from(sessions)
      .where(and(
        gte(sessions.sessionDate, dayStart),
        lte(sessions.sessionDate, dayEnd),
        inArray(sessions.status, ['scheduled', 'confirmed', 'in-progress'])
      ));

    // Generate time slots
    const slots: { time: string; available: boolean }[] = [];
    const startHour = parseInt(dayHours.start.split(':')[0]);
    const startMinute = parseInt(dayHours.start.split(':')[1]);
    const endHour = parseInt(dayHours.end.split(':')[0]);
    const endMinute = parseInt(dayHours.end.split(':')[1]);

    let currentTime = new Date(date);
    currentTime.setHours(startHour, startMinute, 0, 0);
    
    const endTime = new Date(date);
    endTime.setHours(endHour, endMinute, 0, 0);

    while (currentTime < endTime) {
      const slotEnd = new Date(currentTime.getTime() + sessionDuration * 60000);
      
      // Skip this slot if it extends beyond working hours
      if (slotEnd > endTime) {
        break; // Stop generating slots - would exceed working hours
      }
      
      // Check if slot is blocked
      const isBlocked = blockedTimes.some(blocked => {
        const blockStart = new Date(blocked.startTime);
        const blockEnd = new Date(blocked.endTime);
        return currentTime < blockEnd && slotEnd > blockStart;
      });

      // Check if therapist already has a session at this time (RULE 1: One therapist = one session at a time)
      const hasSession = existingSessions.some(session => {
        const sessionStart = new Date(session.sessionDate);
        // Use the actual session's duration, not the requested duration
        const actualSessionDuration = session.duration || sessionDuration;
        const sessionEnd = new Date(sessionStart.getTime() + actualSessionDuration * 60000);
        return currentTime < sessionEnd && slotEnd > sessionStart;
      });

      // Check room availability (RULE 2: Check appropriate room type)
      let roomAvailable = true;
      
      if (!hasSession) { // Only check rooms if therapist is free
        if (isOnlineSession) {
          // ONLINE SESSION: Check if therapist's virtual room is free
          if (profile.virtualRoomId) {
            const virtualRoomBusy = allSessionsToday.some(session => {
              if (!session.roomId) return false;
              const sessionStart = new Date(session.sessionDate);
              // Use each session's actual duration
              const actualSessionDuration = session.duration || sessionDuration;
              const sessionEnd = new Date(sessionStart.getTime() + actualSessionDuration * 60000);
              const timeOverlap = currentTime < sessionEnd && slotEnd > sessionStart;
              return timeOverlap && session.roomId === profile.virtualRoomId;
            });
            roomAvailable = !virtualRoomBusy;
          } else {
            // Therapist has no virtual room configured
            roomAvailable = false;
          }
        } else {
          // PHYSICAL SESSION: Check if ANY of therapist's physical rooms are free
          const availableRooms = profile.availablePhysicalRooms || [];
          if (availableRooms.length === 0) {
            // Therapist has no physical rooms configured
            roomAvailable = false;
          } else {
            // Check if at least ONE room is free
            const hasAtLeastOneFreeRoom = availableRooms.some(roomId => {
              const roomBusy = allSessionsToday.some(session => {
                if (!session.roomId) return false;
                const sessionStart = new Date(session.sessionDate);
                // Use each session's actual duration
                const actualSessionDuration = session.duration || sessionDuration;
                const sessionEnd = new Date(sessionStart.getTime() + actualSessionDuration * 60000);
                const timeOverlap = currentTime < sessionEnd && slotEnd > sessionStart;
                return timeOverlap && session.roomId === roomId;
              });
              return !roomBusy; // Return true if this room is free
            });
            roomAvailable = hasAtLeastOneFreeRoom;
          }
        }
      }

      // Format time as HH:MM (24-hour format) for consistency
      const hours = currentTime.getHours().toString().padStart(2, '0');
      const minutes = currentTime.getMinutes().toString().padStart(2, '0');
      const timeString = `${hours}:${minutes}`;

      slots.push({
        time: timeString,
        available: !isBlocked && !hasSession && roomAvailable
      });

      // Move to next slot (every 30 minutes for consistent scheduling)
      currentTime = new Date(currentTime.getTime() + 30 * 60000);
    }

    return slots;
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
      checklistItemIds,
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

    // Filter clients by specific checklist item completion - current status only (most recent completed item)
    // REQUIRES checklistTemplateId to be set - cannot filter by items without a template
    if (checklistItemIds && checklistItemIds.length > 0) {
      if (!checklistTemplateId) {
        throw new Error("Checklist template must be selected when filtering by checklist items");
      }
      
      // Find the most recent completed item for each client, then check if it's in the selected list
      whereConditions.push(
        sql`EXISTS (
          SELECT 1 FROM ${clientChecklists} cc
          JOIN ${clientChecklistItems} cci ON cci.client_checklist_id = cc.id
          WHERE cc.client_id = ${clients.id}
          AND cc.template_id = ${checklistTemplateId}
          AND cci.is_completed = true
          AND cci.checklist_item_id IN (${sql.join(checklistItemIds.map(id => sql`${id}`), sql`, `)})
          AND NOT EXISTS (
            SELECT 1 FROM ${clientChecklistItems} cci2
            WHERE cci2.client_checklist_id = cc.id
            AND cci2.is_completed = true
            AND cci2.completed_at > cci.completed_at
          )
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
        )`.as('taskCount'),
        documentCount: sql<number>`(
          SELECT COUNT(*) FROM ${documents} 
          WHERE ${documents.clientId} = ${clients.id}
        )`.as('documentCount'),
        checklistTotal: sql<number>`(
          SELECT COUNT(*) FROM ${clientChecklistItems} cci
          JOIN ${clientChecklists} cc ON cc.id = cci.client_checklist_id
          WHERE cc.client_id = ${clients.id}
        )`.as('checklistTotal'),
        checklistCompleted: sql<number>`(
          SELECT COUNT(*) FROM ${clientChecklistItems} cci
          JOIN ${clientChecklists} cc ON cc.id = cci.client_checklist_id
          WHERE cc.client_id = ${clients.id} AND cci.is_completed = true
        )`.as('checklistCompleted')
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
      taskCount: r.taskCount,
      documentCount: r.documentCount,
      checklistProgress: r.checklistTotal > 0 ? {
        total: r.checklistTotal,
        completed: r.checklistCompleted,
        items: [] // Will be populated separately if needed
      } : null
    }));

    return {
      clients: clientsWithCounts,
      total,
      totalPages: Math.ceil(total / pageSize)
    };
  }

  async getClient(id: number): Promise<(Client & { assignedTherapist?: BasicUserInfo; sessionCount?: number; documentCount?: number }) | undefined> {
    const [result] = await db
      .select({
        client: clients,
        assignedTherapist: users,
        sessionCount: sql<number>`(
          SELECT COUNT(*) FROM ${sessions} 
          WHERE ${sessions.clientId} = ${clients.id}
        )`.as('sessionCount'),
        documentCount: sql<number>`(
          SELECT COUNT(*) FROM ${documents} 
          WHERE ${documents.clientId} = ${clients.id}
        )`.as('documentCount')
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
      sessionCount: result.sessionCount,
      documentCount: result.documentCount
    };
  }

  async getClientByClientId(clientId: string): Promise<Client | undefined> {
    const [client] = await db.select().from(clients).where(eq(clients.clientId, clientId));
    return client || undefined;
  }

  // Find every client whose stored phone matches a given E.164 number. Stored
  // numbers are free-form ("(519) 555-7777", "519-555-7777", etc.), so we
  // compare on the trailing 10 digits (the NANP subscriber+area portion) after
  // stripping non-digits from both sides. Returns all matches because a single
  // phone can belong to more than one client (e.g. a family) — an inbound STOP
  // must opt every one of them out.
  async getClientsByPhone(e164: string): Promise<Client[]> {
    const digits = (e164 || "").replace(/\D/g, "");
    const last10 = digits.slice(-10);
    if (last10.length < 10) return [];
    return db
      .select()
      .from(clients)
      .where(
        sql`right(regexp_replace(coalesce(${clients.phone}, ''), '\\D', '', 'g'), 10) = ${last10}`,
      );
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
      // Derive the standardized SMS copy from the typed `phone` (never modifies
      // the typed value); null when it can't be standardized.
      .values({ ...insertClient, clientId, phoneE164: normalizePhoneE164(insertClient.phone) })
      .returning();
    return client;
  }

  async updateClient(id: number, clientData: Partial<InsertClient>): Promise<Client> {
    // Only recompute the standardized copy when the typed phone is actually
    // part of this update. We require a concrete value (not `undefined`) because
    // Drizzle ignores `undefined` for the typed `phone` column, so treating a
    // `phone: undefined` payload as a change would clear phoneE164 and drift the
    // two columns. An explicit null/empty (a real clear) still recomputes.
    const phoneE164Patch =
      clientData.phone !== undefined ? { phoneE164: normalizePhoneE164(clientData.phone) } : {};
    const [client] = await db
      .update(clients)
      .set({ ...clientData, ...phoneE164Patch, updatedAt: new Date() })
      .where(eq(clients.id, id))
      .returning();
    return client;
  }

  async getClientInvoices(clientId: number): Promise<ClientInvoice[]> {
    const result = await db
      .select({
        id: sessionBilling.id,
        sessionId: sessionBilling.sessionId,
        serviceCode: sessionBilling.serviceCode,
        serviceId: sessions.serviceId,
        units: sessionBilling.units,
        ratePerUnit: sessionBilling.ratePerUnit,
        totalAmount: sessionBilling.totalAmount,
        insuranceCovered: sessionBilling.insuranceCovered,
        copayAmount: sessionBilling.copayAmount,
        billingDate: sessionBilling.billingDate,
        paymentStatus: sessionBilling.paymentStatus,
        paymentAmount: sessionBilling.paymentAmount,
        paymentDate: sessionBilling.paymentDate,
        paymentReference: sessionBilling.paymentReference,
        paymentMethod: sessionBilling.paymentMethod,
        sessionDate: sessions.sessionDate,
        sessionType: sessions.sessionType,
        clientId: sessions.clientId,
      })
      .from(sessionBilling)
      .innerJoin(sessions, eq(sessionBilling.sessionId, sessions.id))
      .where(eq(sessions.clientId, clientId))
      .orderBy(desc(sessionBilling.billingDate));

    return result;
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

  // Client Portal Authentication Methods
  async getClientByPortalEmail(portalEmail: string): Promise<Client | undefined> {
    const [client] = await db
      .select()
      .from(clients)
      .where(eq(clients.portalEmail, portalEmail));
    return client || undefined;
  }

  async createPortalSession(session: InsertClientPortalSession): Promise<ClientPortalSession> {
    const [newSession] = await db
      .insert(clientPortalSessions)
      .values(session)
      .returning();
    return newSession;
  }

  async getPortalSessionByToken(token: string): Promise<ClientPortalSession | undefined> {
    const [session] = await db
      .select()
      .from(clientPortalSessions)
      .where(and(
        eq(clientPortalSessions.sessionToken, token),
        eq(clientPortalSessions.isActive, true),
        gte(clientPortalSessions.expiresAt, new Date())
      ));
    return session || undefined;
  }

  async updatePortalSessionActivity(id: number): Promise<void> {
    await db
      .update(clientPortalSessions)
      .set({ lastActivityAt: new Date() })
      .where(eq(clientPortalSessions.id, id));
  }

  async deletePortalSession(id: number): Promise<void> {
    await db
      .delete(clientPortalSessions)
      .where(eq(clientPortalSessions.id, id));
  }

  async deleteClientPortalSessions(clientId: number): Promise<void> {
    await db
      .delete(clientPortalSessions)
      .where(eq(clientPortalSessions.clientId, clientId));
  }

  async cleanupExpiredPortalSessions(): Promise<void> {
    await db
      .delete(clientPortalSessions)
      .where(or(
        eq(clientPortalSessions.isActive, false),
        lte(clientPortalSessions.expiresAt, new Date())
      ));
  }

  // Patient Consent Management (GDPR)
  async getClientConsents(clientId: number): Promise<PatientConsent[]> {
    const consents = await db
      .select()
      .from(patientConsents)
      .where(eq(patientConsents.clientId, clientId))
      .orderBy(desc(patientConsents.createdAt));
    return consents;
  }

  async getClientConsent(clientId: number, consentType: string): Promise<PatientConsent | undefined> {
    const [consent] = await db
      .select()
      .from(patientConsents)
      .where(and(
        eq(patientConsents.clientId, clientId),
        eq(patientConsents.consentType, consentType),
        eq(patientConsents.granted, true),
        isNull(patientConsents.withdrawnAt)
      ))
      .orderBy(desc(patientConsents.createdAt))
      .limit(1);
    return consent || undefined;
  }

  async createClientConsent(consent: InsertPatientConsent): Promise<PatientConsent> {
    const [newConsent] = await db
      .insert(patientConsents)
      .values({
        ...consent,
        grantedAt: new Date()
      })
      .returning();
    return newConsent;
  }

  async updateClientConsent(id: number, consent: Partial<InsertPatientConsent>): Promise<PatientConsent> {
    const [updated] = await db
      .update(patientConsents)
      .set({
        ...consent,
        updatedAt: new Date()
      })
      .where(eq(patientConsents.id, id))
      .returning();
    return updated;
  }

  async withdrawClientConsent(clientId: number, consentType: string): Promise<PatientConsent> {
    const [withdrawn] = await db
      .update(patientConsents)
      .set({
        granted: false,
        withdrawnAt: new Date(),
        updatedAt: new Date()
      })
      .where(and(
        eq(patientConsents.clientId, clientId),
        eq(patientConsents.consentType, consentType),
        eq(patientConsents.granted, true)
      ))
      .returning();
    return withdrawn;
  }

  async hasClientConsent(clientId: number, consentType: string): Promise<boolean> {
    const consent = await this.getClientConsent(clientId, consentType);
    return consent !== undefined && consent.granted;
  }

  // Session Transcripts (chunked voice recording)
  // Only returns transcripts that have transitioned past the "recording" stage,
  // so an in-progress recording row is invisible to the saved-transcript display.
  async getSessionTranscript(sessionId: number): Promise<SessionTranscript | undefined> {
    const [transcript] = await db
      .select()
      .from(sessionTranscripts)
      .where(
        and(
          eq(sessionTranscripts.sessionId, sessionId),
          inArray(sessionTranscripts.status, ['processing', 'ready', 'failed']),
        ),
      )
      .orderBy(desc(sessionTranscripts.createdAt))
      .limit(1);
    return transcript || undefined;
  }

  async getReadyTranscriptSessionIds(sessionIds: number[]): Promise<number[]> {
    if (!sessionIds.length) return [];
    const rows = await db
      .selectDistinct({ sessionId: sessionTranscripts.sessionId })
      .from(sessionTranscripts)
      .where(
        and(
          inArray(sessionTranscripts.sessionId, sessionIds),
          eq(sessionTranscripts.status, 'ready'),
        ),
      );
    return rows.map((r) => r.sessionId);
  }

  async getSessionTranscriptByUploadId(uploadId: string): Promise<SessionTranscript | undefined> {
    const [transcript] = await db
      .select()
      .from(sessionTranscripts)
      .where(eq(sessionTranscripts.uploadId, uploadId))
      .limit(1);
    return transcript || undefined;
  }

  async createSessionTranscript(data: InsertSessionTranscript): Promise<SessionTranscript> {
    const [created] = await db.insert(sessionTranscripts).values(data).returning();
    return created;
  }

  async updateSessionTranscript(id: number, data: Partial<InsertSessionTranscript>): Promise<SessionTranscript> {
    const [updated] = await db
      .update(sessionTranscripts)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(sessionTranscripts.id, id))
      .returning();
    return updated;
  }

  async deleteSessionTranscript(sessionId: number): Promise<void> {
    await db.delete(sessionTranscripts).where(eq(sessionTranscripts.sessionId, sessionId));
  }

  // Atomic JSONB merge: chunks = COALESCE(chunks, '{}') || jsonb_build_object(idx, {...})
  async appendTranscriptChunk(
    transcriptId: number,
    chunkIndex: number,
    text: string,
    durationSeconds: number,
  ): Promise<SessionTranscript> {
    const key = String(chunkIndex);
    const payload = JSON.stringify({ text, durationSeconds });
    const [updated] = await db
      .update(sessionTranscripts)
      .set({
        chunks: sql`COALESCE(${sessionTranscripts.chunks}, '{}'::jsonb) || jsonb_build_object(${key}::text, ${payload}::jsonb)`,
        updatedAt: new Date(),
      })
      .where(eq(sessionTranscripts.id, transcriptId))
      .returning();
    return updated;
  }

  async finalizeTranscriptAtomic(
    transcriptId: number,
    sessionId: number,
    data: Partial<InsertSessionTranscript>,
  ): Promise<SessionTranscript> {
    return await db.transaction(async (tx) => {
      // First update the new row to its final state.
      const [updated] = await tx
        .update(sessionTranscripts)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(sessionTranscripts.id, transcriptId))
        .returning();
      if (!updated) {
        throw new Error('Transcript row not found during atomic finalize');
      }
      // Then remove any *previous saved* transcript rows for the same session
      // — so we never wipe the old transcript before the new one is fully
      // saved. We deliberately only delete rows in the 'ready' or 'failed'
      // state: any concurrent 'recording'/'processing' row belongs to a
      // different upload attempt and must not be destroyed.
      await tx
        .delete(sessionTranscripts)
        .where(
          and(
            eq(sessionTranscripts.sessionId, sessionId),
            sql`${sessionTranscripts.id} <> ${transcriptId}`,
            inArray(sessionTranscripts.status, ['ready', 'failed']),
          ),
        );
      return updated;
    });
  }

  // Communication voice dictation uploads (chunked, restart-durable)
  async createCommTranscribeUpload(data: InsertCommTranscribeUpload): Promise<CommTranscribeUpload> {
    const [created] = await db.insert(commTranscribeUploads).values(data).returning();
    return created;
  }

  async getCommTranscribeUpload(uploadId: string): Promise<CommTranscribeUpload | undefined> {
    const [row] = await db
      .select()
      .from(commTranscribeUploads)
      .where(eq(commTranscribeUploads.uploadId, uploadId))
      .limit(1);
    return row || undefined;
  }

  // Atomic JSONB merge: chunks = COALESCE(chunks, '{}') || { [idx]: text }
  async appendCommTranscribeChunk(
    uploadId: string,
    chunkIndex: number,
    text: string,
  ): Promise<CommTranscribeUpload | undefined> {
    const key = String(chunkIndex);
    const value = JSON.stringify(text); // JSON string literal, cast to jsonb below
    const [updated] = await db
      .update(commTranscribeUploads)
      .set({
        chunks: sql`COALESCE(${commTranscribeUploads.chunks}, '{}'::jsonb) || jsonb_build_object(${key}::text, ${value}::jsonb)`,
        lastActivityAt: new Date(),
      })
      .where(eq(commTranscribeUploads.uploadId, uploadId))
      .returning();
    return updated || undefined;
  }

  async deleteCommTranscribeUpload(uploadId: string): Promise<void> {
    await db.delete(commTranscribeUploads).where(eq(commTranscribeUploads.uploadId, uploadId));
  }

  async sweepCommTranscribeUploads(cutoff: Date): Promise<void> {
    await db.delete(commTranscribeUploads).where(lt(commTranscribeUploads.lastActivityAt, cutoff));
  }

  // Session methods
  async getAllSessions(therapistId?: number, supervisedTherapistIds?: number[]): Promise<any[]> {
    let query = db
      .select({
        session: sessions,
        therapist: users,
        client: clients,
        service: services,
        room: rooms
      })
      .from(sessions)
      .innerJoin(users, eq(sessions.therapistId, users.id))
      .innerJoin(clients, eq(sessions.clientId, clients.id))
      .leftJoin(services, eq(sessions.serviceId, services.id))
      .leftJoin(rooms, eq(sessions.roomId, rooms.id))
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

    return results.map(r => {
      const { room: _legacyRoom, ...sessionData } = r.session;
      return {
        ...sessionData,
        therapist: r.therapist,
        client: r.client,
        service: r.service,
        room: r.room
      };
    });
  }

  // SECURE: Database-level session filtering with comprehensive security and performance optimizations
  async getSessionsWithFiltering(params: SessionFilterParams): Promise<SessionQueryResult> {
    const {
      therapistId,
      supervisedTherapistIds,
      startDate,
      endDate,
      status,
      serviceCode,
      clientId,
      clientType,
      page = 1,
      limit = 50,
      includeHiddenServices = false
    } = params;

    // Build base query with all necessary joins
    let query = db
      .select({
        session: sessions,
        therapist: users,
        client: clients,
        service: services,
        room: rooms
      })
      .from(sessions)
      .innerJoin(users, eq(sessions.therapistId, users.id))
      .innerJoin(clients, eq(sessions.clientId, clients.id))
      .leftJoin(services, eq(sessions.serviceId, services.id))
      .leftJoin(rooms, eq(sessions.roomId, rooms.id))
      .$dynamic();

    // Build WHERE conditions array
    const whereConditions = [];

    // SECURITY: Role-based access control at database level
    if (therapistId) {
      // Therapist sees only their own sessions
      whereConditions.push(eq(sessions.therapistId, therapistId));
    } else if (supervisedTherapistIds && supervisedTherapistIds.length > 0) {
      // Supervisor sees sessions for supervised therapists only
      whereConditions.push(inArray(sessions.therapistId, supervisedTherapistIds));
    }
    
    // SECURITY: Service visibility filtering for non-admin users
    if (!includeHiddenServices) {
      // Only show sessions with visible services OR sessions without service assigned
      whereConditions.push(
        or(
          and(
            isNotNull(sessions.serviceId),
            eq(services.therapistVisible, true),
            eq(services.isActive, true)
          ),
          isNull(sessions.serviceId)
        )
      );
    } else {
      // Admin sees all active services but still filter out inactive ones
      whereConditions.push(
        or(
          and(
            isNotNull(sessions.serviceId),
            eq(services.isActive, true)
          ),
          isNull(sessions.serviceId)
        )
      );
    }

    // Date range filtering
    if (startDate) {
      whereConditions.push(gte(sessions.sessionDate, startDate));
    }
    if (endDate) {
      whereConditions.push(lte(sessions.sessionDate, endDate));
    }

    // Status filtering
    if (status && status !== 'all') {
      whereConditions.push(eq(sessions.status, status));
    }

    // Client filtering
    if (clientId) {
      whereConditions.push(eq(sessions.clientId, clientId));
    }

    // Service code filtering
    if (serviceCode && serviceCode !== 'all') {
      whereConditions.push(eq(services.serviceCode, serviceCode));
    }

    // Client type filtering
    if (clientType && clientType !== 'all') {
      whereConditions.push(eq(clients.clientType, clientType));
    }

    // Apply all conditions
    if (whereConditions.length > 0) {
      query = query.where(and(...whereConditions));
    }

    // Get total count for pagination (using same conditions)
    const countQuery = db
      .select({ count: sql<number>`count(*)` })
      .from(sessions)
      .innerJoin(users, eq(sessions.therapistId, users.id))
      .innerJoin(clients, eq(sessions.clientId, clients.id))
      .leftJoin(services, eq(sessions.serviceId, services.id));
    
    if (whereConditions.length > 0) {
      countQuery.where(and(...whereConditions));
    }
    
    const [{ count: total }] = await countQuery;

    // Apply ordering and pagination
    const results = await query
      .orderBy(desc(sessions.sessionDate))
      .limit(limit)
      .offset((page - 1) * limit);

    const sessionResults = results.map(r => ({ 
      ...r.session, 
      therapist: r.therapist, 
      client: r.client,
      service: r.service,
      room: r.room
    }));

    return {
      sessions: sessionResults,
      total: Number(total),
      totalPages: Math.ceil(Number(total) / limit)
    };
  }

  async getSessionsByClient(clientId: number, includeHiddenServices = false): Promise<SessionWithRelations[]> {
    let query = db
      .select({
        session: sessions,
        therapist: users,
        service: services,
        room: rooms
      })
      .from(sessions)
      .innerJoin(users, eq(sessions.therapistId, users.id))
      .leftJoin(services, eq(sessions.serviceId, services.id))
      .leftJoin(rooms, eq(sessions.roomId, rooms.id))
      .$dynamic();

    const conditions = [eq(sessions.clientId, clientId)];
    
    // Apply service visibility filtering for non-admins
    if (!includeHiddenServices) {
      const visibilityCondition = or(
        isNull(services.id), // Sessions without services (shouldn't happen but safety check)
        eq(services.therapistVisible, true),
        isNull(services.therapistVisible) // Legacy services without visibility setting (show by default)
      );
      if (visibilityCondition) {
        conditions.push(visibilityCondition);
      }
    }

    const results = await query
      .where(and(...conditions))
      .orderBy(desc(sessions.sessionDate));

    return results.map(r => {
      const { room: _legacyRoom, ...sessionData } = r.session;
      return { ...sessionData, therapist: r.therapist, service: r.service, room: r.room };
    });
  }

  async getClientSessionConflicts(clientId: number, includeHiddenServices = false): Promise<{
    conflictDates: string[];
    conflicts: Array<{
      date: string;
      sessions: (Session & { therapist: User; service: any })[];
      type: 'same_service' | 'different_service';
    }>;
  }> {
    // Get all sessions for this client with service visibility filtering
    let query = db
      .select({
        session: sessions,
        therapist: users,
        service: services
      })
      .from(sessions)
      .innerJoin(users, eq(sessions.therapistId, users.id))
      .innerJoin(services, eq(sessions.serviceId, services.id))
      .$dynamic();

    const conditions = [eq(sessions.clientId, clientId)];
    
    // Apply service visibility filtering for non-admins
    if (!includeHiddenServices) {
      const visibilityCondition = or(
        eq(services.therapistVisible, true),
        isNull(services.therapistVisible) // Legacy services without visibility setting
      );
      if (visibilityCondition) {
        conditions.push(visibilityCondition);
      }
    }

    const results = await query
      .where(and(...conditions))
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

  async getSessionsByMonth(year: number, month: number, therapistId?: number, supervisedTherapistIds?: number[], includeHiddenServices = false): Promise<SessionWithRelations[]> {
    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 0);

    let query = db
      .select({
        session: sessions,
        therapist: users,
        client: clients,
        service: services,
        room: rooms
      })
      .from(sessions)
      .innerJoin(users, eq(sessions.therapistId, users.id))
      .innerJoin(clients, eq(sessions.clientId, clients.id))
      .leftJoin(services, eq(sessions.serviceId, services.id))
      .leftJoin(rooms, eq(sessions.roomId, rooms.id))
      .$dynamic();

    // Apply role-based filtering at database level with optimized date filtering
    const nextDay = new Date(endDate);
    nextDay.setDate(nextDay.getDate() + 1);
    
    const conditions = [
      gte(sessions.sessionDate, startDate),
      lte(sessions.sessionDate, nextDay)
    ];

    if (therapistId) {
      // Therapist sees only their own sessions
      conditions.push(eq(sessions.therapistId, therapistId));
    } else if (supervisedTherapistIds && supervisedTherapistIds.length > 0) {
      // Supervisor sees sessions for supervised therapists
      conditions.push(inArray(sessions.therapistId, supervisedTherapistIds));
    }

    // Apply service visibility filtering for non-admins
    if (!includeHiddenServices) {
      const visibilityCondition = or(
        isNull(services.id), // Sessions without services
        eq(services.therapistVisible, true),
        isNull(services.therapistVisible) // Legacy services without visibility setting
      );
      if (visibilityCondition) {
        conditions.push(visibilityCondition);
      }
    }

    const results = await query
      .where(and(...conditions))
      .orderBy(desc(sessions.sessionDate));

    return results.map(r => {
      const { room: _legacyRoom, ...sessionData } = r.session;
      return {
        ...sessionData,
        therapist: r.therapist,
        client: r.client,
        service: r.service,
        room: r.room
      };
    });
  }

  async getRecentSessions(limit: number = 10, therapistId?: number, supervisedTherapistIds?: number[], includeHiddenServices = false): Promise<SessionWithRelations[]> {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    let query = db
      .select({
        session: sessions,
        therapist: users,
        client: clients,
        service: services,
        room: rooms
      })
      .from(sessions)
      .innerJoin(users, eq(sessions.therapistId, users.id))
      .innerJoin(clients, eq(sessions.clientId, clients.id))
      .leftJoin(services, eq(sessions.serviceId, services.id))
      .leftJoin(rooms, eq(sessions.roomId, rooms.id))
      .$dynamic();

    // Apply role-based filtering for recent completed sessions
    const conditions = [
      sql`DATE(${sessions.sessionDate}) >= ${thirtyDaysAgo.toISOString().split('T')[0]}`,
      eq(sessions.status, 'completed')
    ];

    if (therapistId) {
      // Therapist sees only their own recent sessions
      conditions.push(eq(sessions.therapistId, therapistId));
    } else if (supervisedTherapistIds && supervisedTherapistIds.length > 0) {
      // Supervisor sees recent sessions for supervised therapists
      conditions.push(inArray(sessions.therapistId, supervisedTherapistIds));
    }

    // Apply service visibility filtering for non-admins
    if (!includeHiddenServices) {
      const visibilityCondition = or(
        isNull(services.id), // Sessions without services
        eq(services.therapistVisible, true),
        isNull(services.therapistVisible) // Legacy services without visibility setting
      );
      if (visibilityCondition) {
        conditions.push(visibilityCondition);
      }
    }

    const results = await query
      .where(and(...conditions))
      .orderBy(desc(sessions.sessionDate))
      .limit(limit);

    return results.map(r => {
      const { room: _legacyRoom, ...sessionData } = r.session;
      return {
        ...sessionData,
        therapist: r.therapist,
        client: r.client,
        service: r.service,
        room: r.room
      };
    });
  }

  async getUpcomingSessions(limit: number = 10, therapistId?: number, supervisedTherapistIds?: number[], includeHiddenServices = false): Promise<SessionWithRelations[]> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const oneWeekFromNow = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000);

    let query = db
      .select({
        session: sessions,
        therapist: users,
        client: clients,
        service: services,
        room: rooms
      })
      .from(sessions)
      .innerJoin(users, eq(sessions.therapistId, users.id))
      .innerJoin(clients, eq(sessions.clientId, clients.id))
      .leftJoin(services, eq(sessions.serviceId, services.id))
      .leftJoin(rooms, eq(sessions.roomId, rooms.id))
      .$dynamic();

    // Apply role-based filtering for upcoming sessions
    const conditions = [
      sql`DATE(${sessions.sessionDate}) >= ${today.toISOString().split('T')[0]}`,
      sql`DATE(${sessions.sessionDate}) <= ${oneWeekFromNow.toISOString().split('T')[0]}`,
      eq(sessions.status, 'scheduled')
    ];

    if (therapistId) {
      // Therapist sees only their own upcoming sessions
      conditions.push(eq(sessions.therapistId, therapistId));
    } else if (supervisedTherapistIds && supervisedTherapistIds.length > 0) {
      // Supervisor sees upcoming sessions for supervised therapists
      conditions.push(inArray(sessions.therapistId, supervisedTherapistIds));
    }

    // Apply service visibility filtering for non-admins
    if (!includeHiddenServices) {
      const visibilityCondition = or(
        isNull(services.id), // Sessions without services
        eq(services.therapistVisible, true),
        isNull(services.therapistVisible) // Legacy services without visibility setting
      );
      if (visibilityCondition) {
        conditions.push(visibilityCondition);
      }
    }

    const results = await query
      .where(and(...conditions))
      .orderBy(asc(sessions.sessionDate))
      .limit(limit);

    return results.map(r => {
      const { room: _legacyRoom, ...sessionData } = r.session;
      return {
        ...sessionData,
        therapist: r.therapist,
        client: r.client,
        service: r.service,
        room: r.room
      };
    });
  }

  async getOverdueSessions(limit: number = 10, therapistId?: number, supervisedTherapistIds?: number[], includeHiddenServices = false): Promise<(SessionWithRelations & { daysOverdue: number })[]> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    let query = db
      .select({
        session: sessions,
        therapist: users,
        client: clients,
        service: services,
        room: rooms
      })
      .from(sessions)
      .innerJoin(users, eq(sessions.therapistId, users.id))
      .innerJoin(clients, eq(sessions.clientId, clients.id))
      .leftJoin(services, eq(sessions.serviceId, services.id))
      .leftJoin(rooms, eq(sessions.roomId, rooms.id))
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

    // Apply service visibility filtering for non-admins
    if (!includeHiddenServices) {
      const visibilityCondition = or(
        isNull(services.id), // Sessions without services
        eq(services.therapistVisible, true),
        isNull(services.therapistVisible) // Legacy services without visibility setting
      );
      if (visibilityCondition) {
        conditions.push(visibilityCondition);
      }
    }

    const results = await query
      .where(and(...conditions))
      .orderBy(asc(sessions.sessionDate))
      .limit(limit);

    return results.map(r => {
      const { room: _legacyRoom, ...sessionData } = r.session;
      const sessionDate = new Date(r.session.sessionDate);
      const timeDiff = today.getTime() - sessionDate.getTime();
      const daysOverdue = Math.floor(timeDiff / (1000 * 3600 * 24));
      
      return { 
        ...sessionData,
        therapist: r.therapist, 
        client: r.client,
        service: r.service,
        room: r.room,
        daysOverdue
      };
    });
  }

  async getSession(id: number): Promise<Session | undefined> {
    const [row] = await db
      .select()
      .from(sessions)
      .where(eq(sessions.id, id))
      .limit(1);
    return row;
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

  async getServicesFiltered(userRole: string): Promise<any[]> {
    // Administrators see all active services
    if (userRole === 'administrator' || userRole === 'admin') {
      return await db.select().from(services).where(eq(services.isActive, true));
    }
    
    // Therapists and other roles see only services marked as therapist visible
    return await db
      .select()
      .from(services)
      .where(and(
        eq(services.isActive, true),
        eq(services.therapistVisible, true)
      ));
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

  async updateServiceVisibility(id: number, therapistVisible: boolean): Promise<any> {
    const [service] = await db
      .update(services)
      .set({
        therapistVisible: therapistVisible,
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
      const units = 1;
      const ratePerUnit = service.baseRate;
      const billingData = {
        sessionId: session.id,
        serviceCode: service.serviceCode,
        units: units,
        ratePerUnit: ratePerUnit,
        totalAmount: (parseFloat(ratePerUnit) * units).toFixed(2),
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
    status: 'pending' | 'billed' | 'paid' | 'denied' | 'refunded' | 'follow_up';
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

  // Centralized billing method for invoice generation
  async getBillingForInvoice(clientId: number, billingId: number): Promise<{
    billing: SelectSessionBilling;
    client: Client;
    session: Session;
    service?: any;
    therapist?: User;
  } | null> {
    const result = await db
      .select({
        billing: sessionBilling,
        session: sessions,
        client: clients,
        service: services,
        therapist: users
      })
      .from(sessionBilling)
      .innerJoin(sessions, eq(sessionBilling.sessionId, sessions.id))
      .innerJoin(clients, eq(sessions.clientId, clients.id))
      .leftJoin(services, eq(sessions.serviceId, services.id))
      .leftJoin(users, eq(sessions.therapistId, users.id))
      .where(and(
        eq(sessionBilling.id, billingId),
        eq(clients.id, clientId)
      ))
      .limit(1);

    if (!result.length) {
      return null;
    }

    const r = result[0];
    return {
      billing: r.billing,
      client: r.client,
      session: r.session,
      service: r.service || undefined,
      therapist: r.therapist || undefined
    };
  }

  // Centralized payment recording method
  async recordPayment(billingId: number, paymentData: {
    status: 'pending' | 'billed' | 'paid' | 'denied' | 'refunded' | 'follow_up';
    amount: number;
    date: string;
    reference?: string;
    method: string;
    notes?: string;
    source?: 'client' | 'insurance';
    recordedBy?: number;
    sourceStatementId?: number;
    sourceStatementLineId?: number;
    acknowledgeDuplicate?: boolean;
  }, executor?: any): Promise<SelectSessionBilling> {
    // When an `executor` (an already-open transaction) is supplied, run on it
    // instead of opening a new transaction — this lets callers that already hold
    // a transaction/connection (e.g. postInsuranceStatement under an advisory
    // lock) keep all work on ONE pooled connection, avoiding pool starvation.
    const run = async (tx: any) => {
      // Lock the row so concurrent payments can't race each other
      const lockedRows = await tx.execute(
        sql`SELECT id, total_amount, discount_amount, client_paid_amount, insurance_paid_amount
            FROM session_billing WHERE id = ${billingId} FOR UPDATE`
      );
      const current: any = (lockedRows as any).rows?.[0] || (lockedRows as any)[0];
      if (!current) throw new Error(`Billing record ${billingId} not found`);

      const source: 'client' | 'insurance' =
        paymentData.source ??
        (paymentData.method === 'insurance' ? 'insurance' : 'client');

      // Validate numeric input
      const cumulativeForSource = Number(paymentData.amount);
      if (!Number.isFinite(cumulativeForSource) || cumulativeForSource < 0) {
        throw new Error(`Invalid cumulative amount: ${paymentData.amount}`);
      }

      const previousForSource = Number(
        source === 'client' ? current.client_paid_amount : current.insurance_paid_amount
      ) || 0;
      const delta = +(cumulativeForSource - previousForSource).toFixed(2);

      // Server-side duplicate-insurance guard (defense-in-depth for the
      // client-side advisory in PaymentDialog). A MANUAL insurance payment
      // (one NOT carrying a sourceStatement(Line)Id — i.e. not posted by the
      // statement reconciler) whose newly-added amount closely matches an
      // insurance payment already posted from a statement for this billing is
      // almost always the same EOB being re-keyed by hand, which would double-
      // count collected insurance. Reject it unless the caller explicitly
      // acknowledges it is a separate, additional payment. The tolerance comes
      // from the shared isDuplicateInsuranceAmount (@shared/insurance) so it can
      // never drift from the dialog: the greater of $1 or 5% of the posted amount.
      const isManualInsurance =
        source === 'insurance' &&
        paymentData.sourceStatementId == null &&
        paymentData.sourceStatementLineId == null;
      if (isManualInsurance && !paymentData.acknowledgeDuplicate && delta > 0) {
        const postedRows = await tx.execute(sql`
          SELECT amount FROM payment_transactions
          WHERE session_billing_id = ${billingId}
            AND voided_at IS NULL
            AND source = 'insurance'
            AND source_statement_id IS NOT NULL
        `);
        const rows: any[] = (postedRows as any).rows || (postedRows as any) || [];
        for (const r of rows) {
          const amt = Math.abs(Number(r.amount) || 0);
          if (amt <= 0) continue;
          if (isDuplicateInsuranceAmount(delta, amt)) {
            const err: any = new Error(
              `This insurance amount ($${delta.toFixed(2)}) matches a payment of $${amt.toFixed(2)} already posted from a statement for this billing. If this is a separate, additional insurance payment, confirm the duplicate to proceed.`
            );
            err.code = 'DUPLICATE_INSURANCE_PAYMENT';
            throw err;
          }
        }
      }

      const otherSourceAmount = Number(
        source === 'client' ? current.insurance_paid_amount : current.client_paid_amount
      ) || 0;
      const combinedTotal = +(cumulativeForSource + otherSourceAmount).toFixed(2);

      // Compute authoritative status from totals (don't trust client when it disagrees)
      // Round to cents before comparing — float subtraction (e.g. 149.61 - 44.88
      // = 104.7299999…) would otherwise leave a fully-paid session one float-epsilon
      // short and mislabel it 'billed' instead of 'paid'.
      const billAmount = +(Number(current.total_amount) - Number(current.discount_amount || 0)).toFixed(2);
      const authoritativeStatus =
        combinedTotal >= billAmount ? 'paid'
        : combinedTotal > 0 ? 'billed'
        : paymentData.status;

      const updateData: any = {
        paymentStatus: authoritativeStatus,
        paymentAmount: combinedTotal.toString(),
        paymentDate: paymentData.date,
        paymentMethod: paymentData.method,
        updatedAt: new Date()
      };

      if (source === 'client') {
        updateData.clientPaidAmount = cumulativeForSource.toString();
      } else {
        updateData.insurancePaidAmount = cumulativeForSource.toString();
      }

      if (paymentData.reference) updateData.paymentReference = paymentData.reference;
      if (paymentData.notes) updateData.paymentNotes = paymentData.notes;

      const [updated] = await tx
        .update(sessionBilling)
        .set(updateData)
        .where(eq(sessionBilling.id, billingId))
        .returning();

      // Insert audit row only when money actually changed
      if (delta !== 0) {
        await tx.insert(paymentTransactions).values({
          sessionBillingId: billingId,
          source,
          amount: delta.toString(),
          paymentMethod: paymentData.method,
          referenceNumber: paymentData.reference || null,
          notes: paymentData.notes || null,
          isHistoricalLump: false,
          paymentDate: paymentData.date || null,
          recordedBy: paymentData.recordedBy || null,
          sourceStatementId: paymentData.sourceStatementId ?? null,
          sourceStatementLineId: paymentData.sourceStatementLineId ?? null,
        });
      }

      return updated;
    };
    if (executor) return await run(executor);
    return await db.transaction(run);
  }

  // Lightweight billing lookup for authorization (returns the owning client's assignedTherapistId)
  async getBillingRecordWithClient(billingId: number): Promise<{ id: number; clientId: number; assignedTherapistId: number | null } | null> {
    const rows = await db
      .select({
        id: sessionBilling.id,
        clientId: sessions.clientId,
        assignedTherapistId: clients.assignedTherapistId,
      })
      .from(sessionBilling)
      .innerJoin(sessions, eq(sessionBilling.sessionId, sessions.id))
      .innerJoin(clients, eq(sessions.clientId, clients.id))
      .where(eq(sessionBilling.id, billingId))
      .limit(1);
    return rows[0] || null;
  }

  // Void a payment transaction and recompute totals atomically
  async voidPaymentTransaction(
    transactionId: number,
    reason: string,
    voidedBy: number
  ): Promise<{ billingId: number }> {
    if (!reason || reason.trim().length < 3) {
      throw new Error("Void reason is required (min 3 characters)");
    }
    return await db.transaction(async (tx) => {
      // Lock the transaction row
      const txRows = await tx.execute(
        sql`SELECT id, session_billing_id, voided_at FROM payment_transactions WHERE id = ${transactionId} FOR UPDATE`
      );
      const txRow: any = (txRows as any).rows?.[0] || (txRows as any)[0];
      if (!txRow) throw new Error("Transaction not found");
      if (txRow.voided_at) throw new Error("Transaction already voided");

      const billingId: number = txRow.session_billing_id;

      // Mark voided
      await tx
        .update(paymentTransactions)
        .set({
          voidedAt: new Date(),
          voidedBy: voidedBy,
          voidReason: reason.trim(),
        })
        .where(eq(paymentTransactions.id, transactionId));

      // Lock the billing row + recompute totals from remaining (non-voided) transactions
      await tx.execute(sql`SELECT id FROM session_billing WHERE id = ${billingId} FOR UPDATE`);
      const sumRows = await tx.execute(sql`
        SELECT
          COALESCE(SUM(CASE WHEN source = 'client'    THEN amount::numeric ELSE 0 END), 0) AS client_total,
          COALESCE(SUM(CASE WHEN source = 'insurance' THEN amount::numeric ELSE 0 END), 0) AS insurance_total
        FROM payment_transactions
        WHERE session_billing_id = ${billingId} AND voided_at IS NULL
      `);
      const sums: any = (sumRows as any).rows?.[0] || (sumRows as any)[0];
      const clientTotal = Number(sums.client_total) || 0;
      const insuranceTotal = Number(sums.insurance_total) || 0;
      const combined = +(clientTotal + insuranceTotal).toFixed(2);

      // Get bill amount to compute correct status
      const billRows = await tx.execute(
        sql`SELECT total_amount, discount_amount FROM session_billing WHERE id = ${billingId}`
      );
      const bill: any = (billRows as any).rows?.[0] || (billRows as any)[0];
      // Round to cents before comparing (float subtraction can leave a fully-paid
      // session a float-epsilon short and mislabel it 'billed').
      const billAmount = +(Number(bill.total_amount) - Number(bill.discount_amount || 0)).toFixed(2);
      const newStatus = combined >= billAmount ? 'paid' : combined > 0 ? 'billed' : 'pending';

      await tx
        .update(sessionBilling)
        .set({
          clientPaidAmount: clientTotal.toString(),
          insurancePaidAmount: insuranceTotal.toString(),
          paymentAmount: combined.toString(),
          paymentStatus: newStatus,
          updatedAt: new Date(),
        })
        .where(eq(sessionBilling.id, billingId));

      return { billingId };
    });
  }

  // Fetch the transaction history for a billing record
  async getPaymentTransactions(
    billingId: number,
  ): Promise<(PaymentTransaction & { statementPayerName: string | null; statementCheckNumber: string | null })[]> {
    const rows = await db
      .select({
        tx: paymentTransactions,
        statementPayerName: insuranceStatements.payerName,
        statementCheckNumber: insuranceStatements.checkNumber,
      })
      .from(paymentTransactions)
      .leftJoin(insuranceStatements, eq(paymentTransactions.sourceStatementId, insuranceStatements.id))
      .where(eq(paymentTransactions.sessionBillingId, billingId))
      .orderBy(desc(paymentTransactions.recordedAt));
    return rows.map((r) => ({
      ...r.tx,
      statementPayerName: r.statementPayerName ?? null,
      statementCheckNumber: r.statementCheckNumber ?? null,
    }));
  }

  // Update billing record discount
  async updateBillingDiscount(billingId: number, discountData: {
    discountType: string | null;
    discountValue: number | null;
    discountAmount: number | null;
  }): Promise<SelectSessionBilling> {
    const [updated] = await db
      .update(sessionBilling)
      .set({
        discountType: discountData.discountType,
        discountValue: discountData.discountValue !== null ? discountData.discountValue.toString() : null,
        discountAmount: discountData.discountAmount !== null ? discountData.discountAmount.toString() : null,
        updatedAt: new Date()
      })
      .where(eq(sessionBilling.id, billingId))
      .returning();

    return updated;
  }

  // ===== THERAPIST PAYMENTS =====

  async getTherapistPayRules(therapistId: number): Promise<TherapistPayRule[]> {
    return db
      .select()
      .from(therapistPayRules)
      .where(eq(therapistPayRules.therapistId, therapistId))
      .orderBy(asc(therapistPayRules.serviceId));
  }

  async upsertTherapistPayRule(rule: InsertTherapistPayRule): Promise<TherapistPayRule> {
    const therapistId = rule.therapistId;
    const serviceId = rule.serviceId ?? null;
    const whereRule =
      serviceId == null
        ? and(eq(therapistPayRules.therapistId, therapistId), isNull(therapistPayRules.serviceId))
        : and(eq(therapistPayRules.therapistId, therapistId), eq(therapistPayRules.serviceId, serviceId));

    const existing = await db.select().from(therapistPayRules).where(whereRule).limit(1);
    if (existing.length) {
      const [updated] = await db
        .update(therapistPayRules)
        .set({ payType: rule.payType, payValue: String(rule.payValue), updatedAt: new Date() })
        .where(eq(therapistPayRules.id, existing[0].id))
        .returning();
      return updated;
    }
    const [inserted] = await db
      .insert(therapistPayRules)
      .values({ therapistId, serviceId, payType: rule.payType, payValue: String(rule.payValue) })
      .returning();
    return inserted;
  }

  async deleteTherapistPayRule(id: number, therapistId: number): Promise<void> {
    await db
      .delete(therapistPayRules)
      .where(and(eq(therapistPayRules.id, id), eq(therapistPayRules.therapistId, therapistId)));
  }

  // Compute every collected session for a therapist with the pay rule applied,
  // newest first. This is the single source of truth for "what the therapist
  // earned" and is shared by the owed list, the running statement and the
  // monthly report so they can never disagree. One row per session billing.
  private async computeTherapistEarnings(therapistId: number): Promise<{
    billingId: number;
    sessionId: number;
    status: string | null;
    sessionDate: Date;
    serviceId: number | null;
    serviceCode: string | null;
    serviceName: string | null;
    category: string | null;
    clientId: number | null;
    clientName: string;
    clientType: string | null;
    totalAmount: number;
    expected: number;
    collectedAmount: number;
    payType: 'percentage' | 'fixed' | null;
    payValue: number | null;
    ruleSource: 'service' | 'default' | 'none';
    amountEarned: number;
    hasRule: boolean;
  }[]> {
    const rules = await this.getTherapistPayRules(therapistId);
    const defaultRule = rules.find((r) => r.serviceId == null) || null;
    const serviceRuleMap = new Map<number, TherapistPayRule>();
    for (const r of rules) if (r.serviceId != null) serviceRuleMap.set(Number(r.serviceId), r);

    const rows = await db
      .select({
        billingId: sessionBilling.id,
        sessionId: sessions.id,
        status: sessions.status,
        sessionDate: sessions.sessionDate,
        serviceId: sessions.serviceId,
        serviceCode: services.serviceCode,
        serviceName: services.serviceName,
        category: services.category,
        clientId: clients.id,
        clientName: clients.fullName,
        clientType: clients.clientType,
        totalAmount: sessionBilling.totalAmount,
        discountAmount: sessionBilling.discountAmount,
        clientPaid: sessionBilling.clientPaidAmount,
        insurancePaid: sessionBilling.insurancePaidAmount,
      })
      .from(sessionBilling)
      .innerJoin(sessions, eq(sessionBilling.sessionId, sessions.id))
      .innerJoin(clients, eq(sessions.clientId, clients.id))
      .leftJoin(services, eq(sessions.serviceId, services.id))
      .where(eq(sessions.therapistId, therapistId))
      .orderBy(desc(sessions.sessionDate));

    return rows.map((row) => {
      const collected = Number(row.clientPaid || 0) + Number(row.insurancePaid || 0);
      // A cancelled session keeps its billing row (cancelling never removes it),
      // but it is no longer owed money and earns nothing. Treat its expected and
      // earned as 0 at the source so EVERY consumer (owed list, running statement,
      // monthly report, payouts, earning-ledger sync) agrees it costs/earns
      // nothing — rather than each report having to special-case it. Money that
      // was actually collected before the cancellation still appears as collected.
      const cancelled = row.status === 'cancelled';
      const expected = cancelled
        ? 0
        : Math.max(0, Number(row.totalAmount || 0) - Number(row.discountAmount || 0));
      const svcId = row.serviceId != null ? Number(row.serviceId) : null;
      let rule: TherapistPayRule | null = null;
      let ruleSource: 'service' | 'default' | 'none' = 'none';
      if (svcId != null && serviceRuleMap.has(svcId)) {
        rule = serviceRuleMap.get(svcId)!;
        ruleSource = 'service';
      } else if (defaultRule) {
        rule = defaultRule;
        ruleSource = 'default';
      }

      let amountEarned = 0;
      let payType: 'percentage' | 'fixed' | null = null;
      let payValue: number | null = null;
      if (rule) {
        payType = rule.payType as 'percentage' | 'fixed';
        payValue = Number(rule.payValue);
        amountEarned = payType === 'percentage' ? (collected * payValue) / 100 : payValue;
        amountEarned = Math.round(amountEarned * 100) / 100;
      }
      // Cancelled sessions earn nothing regardless of rule/collected money.
      if (cancelled) amountEarned = 0;

      return {
        billingId: Number(row.billingId),
        sessionId: Number(row.sessionId),
        status: row.status ?? null,
        sessionDate: row.sessionDate,
        serviceId: svcId,
        serviceCode: row.serviceCode ?? null,
        serviceName: row.serviceName ?? null,
        category: row.category ?? null,
        clientId: row.clientId != null ? Number(row.clientId) : null,
        clientName: row.clientName ?? '',
        clientType: row.clientType ?? null,
        totalAmount: Number(row.totalAmount || 0),
        expected,
        collectedAmount: collected,
        payType,
        payValue,
        ruleSource,
        amountEarned,
        hasRule: !!rule,
      };
    });
  }

  // How much of each session billing's earning has already been paid to the
  // therapist, keyed by session billing id. Combines two sources:
  //  - Legacy itemized payouts: a payout_item exists => the full amountEarned
  //    snapshot was paid (voided payouts delete their items, so anything present
  //    is live). 
  //  - Lump / partial payments: the sum of allocation amounts whose payout is
  //    still 'paid' (voiding a payout keeps its allocations but flips status, so
  //    they stop counting here).
  private async getTherapistPaidByBilling(therapistId: number): Promise<Map<number, number>> {
    const paid = new Map<number, number>();

    const itemRows = await db
      .select({ sbId: therapistPayoutItems.sessionBillingId, amt: therapistPayoutItems.amountEarned })
      .from(therapistPayoutItems)
      .innerJoin(sessions, eq(therapistPayoutItems.sessionId, sessions.id))
      .where(eq(sessions.therapistId, therapistId));
    for (const r of itemRows) {
      const id = Number(r.sbId);
      paid.set(id, (paid.get(id) || 0) + Number(r.amt || 0));
    }

    const allocRows = await db
      .select({ sbId: therapistPaymentAllocations.sessionBillingId, amt: therapistPaymentAllocations.amountAllocated })
      .from(therapistPaymentAllocations)
      .innerJoin(therapistPayouts, eq(therapistPaymentAllocations.payoutId, therapistPayouts.id))
      .where(and(eq(therapistPayouts.therapistId, therapistId), eq(therapistPayouts.status, 'paid')));
    for (const r of allocRows) {
      const id = Number(r.sbId);
      paid.set(id, (paid.get(id) || 0) + Number(r.amt || 0));
    }

    return paid;
  }

  // Total over-payment credit currently sitting on a therapist's account: the
  // sum of unappliedAmount across their non-voided payouts (money paid beyond
  // what was owed at the time). Voiding a payout flips its status, so its credit
  // stops counting here.
  private async getTherapistUnappliedCredit(therapistId: number): Promise<number> {
    const rows = await db
      .select({ amt: therapistPayouts.unappliedAmount })
      .from(therapistPayouts)
      .where(and(eq(therapistPayouts.therapistId, therapistId), eq(therapistPayouts.status, 'paid')));
    let sum = 0;
    for (const r of rows) sum = Math.round((sum + Number(r.amt || 0)) * 100) / 100;
    return sum;
  }

  // Net manual adjustment for a therapist: sum of active bonuses (+) minus active
  // deductions (-). A positive result increases what the practice owes; negative
  // decreases it. The single place every consumer reads adjustments from, so the
  // statement, owed total, lump-payment math and monthly report can never disagree.
  private async getTherapistAdjustmentsNet(therapistId: number): Promise<number> {
    const rows = await db
      .select({ type: therapistAdjustments.adjustmentType, amt: therapistAdjustments.amount })
      .from(therapistAdjustments)
      .where(and(eq(therapistAdjustments.therapistId, therapistId), eq(therapistAdjustments.status, 'active')));
    let net = 0;
    for (const r of rows) {
      const signed = r.type === 'deduction' ? -Number(r.amt || 0) : Number(r.amt || 0);
      net = Math.round((net + signed) * 100) / 100;
    }
    return net;
  }

  // List a therapist's manual adjustments (active and voided), newest first.
  async listTherapistAdjustments(therapistId: number): Promise<TherapistAdjustmentRow[]> {
    const rows = await db
      .select()
      .from(therapistAdjustments)
      .where(eq(therapistAdjustments.therapistId, therapistId))
      .orderBy(desc(therapistAdjustments.effectiveDate), desc(therapistAdjustments.id));
    return rows.map((r) => {
      const amount = Number(r.amount || 0);
      const type = (r.adjustmentType === 'deduction' ? 'deduction' : 'bonus') as 'bonus' | 'deduction';
      const dateStr =
        typeof r.effectiveDate === 'string'
          ? r.effectiveDate
          : r.effectiveDate
            ? new Date(r.effectiveDate as any).toISOString().slice(0, 10)
            : '';
      return {
        id: Number(r.id),
        therapistId: Number(r.therapistId),
        adjustmentType: type,
        amount,
        signedAmount: type === 'deduction' ? -amount : amount,
        description: r.description ?? '',
        effectiveDate: dateStr,
        status: (r.status === 'voided' ? 'voided' : 'active') as 'active' | 'voided',
        createdAt: r.createdAt as Date,
      };
    });
  }

  async createTherapistAdjustment(input: {
    therapistId: number;
    adjustmentType: 'bonus' | 'deduction';
    amount: number;
    description: string;
    effectiveDate: string;
    createdBy: number;
  }): Promise<TherapistAdjustmentRow> {
    const amount = Math.round(Number(input.amount) * 100) / 100;
    if (!(amount > 0)) throw new Error('Amount must be greater than zero');
    const [row] = await db
      .insert(therapistAdjustments)
      .values({
        therapistId: input.therapistId,
        adjustmentType: input.adjustmentType,
        amount: amount.toString(),
        description: input.description,
        effectiveDate: input.effectiveDate,
        status: 'active',
        createdBy: input.createdBy,
      })
      .returning();
    const list = await this.listTherapistAdjustments(input.therapistId);
    return list.find((a) => a.id === Number(row.id))!;
  }

  async voidTherapistAdjustment(
    id: number,
    voidedBy: number,
    reason: string,
  ): Promise<TherapistAdjustmentRow> {
    const [existing] = await db
      .select()
      .from(therapistAdjustments)
      .where(eq(therapistAdjustments.id, id))
      .limit(1);
    if (!existing) throw new Error('Adjustment not found');
    if (existing.status === 'voided') throw new Error('Adjustment is already voided');
    await db
      .update(therapistAdjustments)
      .set({ status: 'voided', voidedAt: new Date(), voidedBy, voidReason: reason })
      .where(eq(therapistAdjustments.id, id));
    const list = await this.listTherapistAdjustments(Number(existing.therapistId));
    return list.find((a) => a.id === id)!;
  }

  async getTherapistOwed(therapistId: number): Promise<{
    therapistId: number;
    items: TherapistOwedItem[];
    total: number;          // session-only payable total (sum of items' remaining)
    adjustmentsNet: number; // net manual bonus(+)/deduction(-) not tied to a session
    unresolvedCount: number;
  }> {
    const earnings = await this.computeTherapistEarnings(therapistId);
    const paidByBilling = await this.getTherapistPaidByBilling(therapistId);

    const items: TherapistOwedItem[] = [];
    let unresolvedCount = 0;
    // Money already paid to a session BEYOND its (possibly later-corrected) earned
    // amount is an overpayment. This happens when a session was paid in full and
    // its collected amount was reduced afterwards (e.g. fixing a double-counted
    // insurance payment), which lowers the earned amount on a session that was
    // already settled. We pool that excess and apply it as credit against other
    // outstanding sessions below — exactly like unapplied lump credit — so the
    // owed list reconciles with the statement's net balance instead of clamping
    // each overpaid session to zero and silently dropping the excess.
    let retroOverpayCredit = 0;
    for (const e of earnings) {
      if (e.collectedAmount <= 0) continue;
      const paid = paidByBilling.get(e.billingId) || 0;
      const remaining = Math.round((e.amountEarned - paid) * 100) / 100;

      if (remaining < 0) {
        retroOverpayCredit = Math.round((retroOverpayCredit + -remaining) * 100) / 100;
      }

      // Fully-settled (via allocations/items), rule-resolved sessions drop off.
      if (e.hasRule && remaining <= 0) continue;

      if (!e.hasRule) unresolvedCount++;

      items.push({
        sessionBillingId: e.billingId,
        sessionId: e.sessionId,
        sessionDate: e.sessionDate,
        serviceId: e.serviceId,
        serviceCode: e.serviceCode,
        serviceName: e.serviceName,
        category: e.category,
        clientName: e.clientName,
        totalAmount: e.totalAmount,
        collectedAmount: e.collectedAmount,
        payType: e.payType,
        payValue: e.payValue,
        ruleSource: e.ruleSource,
        amountEarned: e.amountEarned,
        amountAllocated: Math.round(paid * 100) / 100,
        amountRemaining: Math.max(0, remaining),
      });
    }

    // Apply any over-payment credit to outstanding rule-resolved earnings, oldest
    // first, so the owed list reconciles with the statement's net balance. The
    // credit comes from two sources: (1) unapplied lump money (paid but not yet
    // allocated to any session) and (2) retroactive overpayments on sessions whose
    // earned amount was reduced after they were already paid in full. Without this,
    // those credits would never offset new earnings and the sessions could be paid
    // a second time.
    const creditPool = Math.round(
      ((await this.getTherapistUnappliedCredit(therapistId)) + retroOverpayCredit) * 100,
    ) / 100;
    if (creditPool > 0) {
      const payableOldestFirst = items
        .filter((i) => i.payType != null && i.amountRemaining > 0)
        .sort((a, b) => {
          const ta = a.sessionDate ? new Date(a.sessionDate).getTime() : 0;
          const tb = b.sessionDate ? new Date(b.sessionDate).getTime() : 0;
          if (ta !== tb) return ta - tb; // oldest first
          return a.sessionBillingId - b.sessionBillingId;
        });
      let creditRemaining = creditPool;
      for (const i of payableOldestFirst) {
        if (creditRemaining <= 0) break;
        const cover = Math.round(Math.min(i.amountRemaining, creditRemaining) * 100) / 100;
        if (cover <= 0) continue;
        i.amountRemaining = Math.round((i.amountRemaining - cover) * 100) / 100;
        creditRemaining = Math.round((creditRemaining - cover) * 100) / 100;
      }
    }

    // Rule-resolved sessions fully covered (by payment or credit) are no longer
    // cash-payable and drop off the owed list. Unresolved (no-rule) sessions stay
    // so they remain visible for follow-up.
    const visible = items.filter((i) => !(i.payType != null && i.amountRemaining <= 0));
    const total = Math.round(
      visible.reduce((s, i) => s + (i.payType != null ? i.amountRemaining : 0), 0) * 100,
    ) / 100;

    // Manual bonuses/deductions are not tied to a session, so they don't appear as
    // owed-list items. They are returned separately and folded into the net owed by
    // callers (the headline owed number and the lump-payment math) so the owed total
    // reconciles with the running statement's net balance.
    const adjustmentsNet = await this.getTherapistAdjustmentsNet(therapistId);

    return { therapistId, items: visible, total, adjustmentsNet, unresolvedCount };
  }

  async createTherapistPayout(input: {
    therapistId: number;
    paymentDate: string;
    paymentMethod?: string | null;
    referenceNumber?: string | null;
    notes?: string | null;
    sessionBillingIds: number[];
    createdBy: number;
  }): Promise<TherapistPayout & { allocations: TherapistPayoutAllocationDetail[] }> {
    // Ensure the persistent (audited) earning ledger is up to date before paying
    // against it. Uses a distinct advisory lock from the payout lock below, so
    // it must run BEFORE opening the payout transaction (no nested/competing lock).
    await this.syncTherapistEarnings(input.therapistId);
    return await db.transaction(async (tx) => {
      // Serialize payout creation per therapist (shared with the lump path) so a
      // concurrent itemized/lump payout can't allocate against the same stale
      // "remaining" snapshot and over-pay a session. Released on commit/rollback.
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtext('therapist_payout'), ${input.therapistId})`,
      );

      // Recompute owed server-side (inside the lock) so amounts and eligibility
      // can't be tampered with by the client and reflect any just-committed
      // concurrent payout. Only sessions that are owed AND have a resolved rule
      // are payable.
      const owed = await this.getTherapistOwed(input.therapistId);
      const wanted = new Set(input.sessionBillingIds.map(Number));
      // Only sessions that still have an outstanding remaining amount are payable.
      const selected = owed.items.filter(
        (i) => wanted.has(i.sessionBillingId) && i.payType != null && i.amountRemaining > 0,
      );
      if (selected.length === 0) {
        throw new Error('No payable sessions selected');
      }
      // Pay each selected session's *remaining* (earned minus anything already
      // paid via an earlier partial/lump payment). Fresh sessions have
      // remaining === earned, so this behaves exactly like before.
      const total = Math.round(selected.reduce((s, i) => s + i.amountRemaining, 0) * 100) / 100;

      const [payout] = await tx
        .insert(therapistPayouts)
        .values({
          therapistId: input.therapistId,
          totalAmount: total.toString(),
          paymentDate: input.paymentDate,
          paymentMethod: input.paymentMethod ?? null,
          referenceNumber: input.referenceNumber ?? null,
          notes: input.notes ?? null,
          status: 'paid',
          paymentType: 'itemized',
          createdBy: input.createdBy,
        })
        .returning();

      for (const i of selected) {
        await tx.insert(therapistPayoutItems).values({
          payoutId: payout.id,
          sessionBillingId: i.sessionBillingId,
          sessionId: i.sessionId,
          serviceId: i.serviceId,
          basisAmount: i.collectedAmount.toString(),
          payType: i.payType!,
          payValue: (i.payValue ?? 0).toString(),
          amountEarned: i.amountRemaining.toString(),
        });
      }

      return {
        ...(payout as any),
        allocations: selected.map((i) => ({
          sessionBillingId: i.sessionBillingId,
          sessionId: i.sessionId,
          amountAllocated: i.amountRemaining,
        })),
      };
    });
  }

  async getTherapistPayouts(
    therapistId?: number,
  ): Promise<(TherapistPayout & { therapistName: string; itemCount: number })[]> {
    const rows = await db
      .select({
        id: therapistPayouts.id,
        therapistId: therapistPayouts.therapistId,
        totalAmount: therapistPayouts.totalAmount,
        paymentDate: therapistPayouts.paymentDate,
        paymentMethod: therapistPayouts.paymentMethod,
        referenceNumber: therapistPayouts.referenceNumber,
        notes: therapistPayouts.notes,
        status: therapistPayouts.status,
        voidedAt: therapistPayouts.voidedAt,
        voidedBy: therapistPayouts.voidedBy,
        voidReason: therapistPayouts.voidReason,
        createdBy: therapistPayouts.createdBy,
        createdAt: therapistPayouts.createdAt,
        therapistName: users.fullName,
        itemCount: count(therapistPayoutItems.id),
      })
      .from(therapistPayouts)
      .innerJoin(users, eq(therapistPayouts.therapistId, users.id))
      .leftJoin(therapistPayoutItems, eq(therapistPayoutItems.payoutId, therapistPayouts.id))
      .where(therapistId != null ? eq(therapistPayouts.therapistId, therapistId) : undefined)
      .groupBy(therapistPayouts.id, users.fullName)
      .orderBy(desc(therapistPayouts.paymentDate), desc(therapistPayouts.id));

    // Lump payouts have no payout_items; their session count lives in the
    // allocations table. Count those separately and fold them in.
    const allocCounts = await db
      .select({
        payoutId: therapistPaymentAllocations.payoutId,
        c: count(therapistPaymentAllocations.id),
      })
      .from(therapistPaymentAllocations)
      .groupBy(therapistPaymentAllocations.payoutId);
    const allocCountMap = new Map<number, number>();
    for (const a of allocCounts) allocCountMap.set(Number(a.payoutId), Number(a.c));

    return rows.map((r) => ({
      ...(r as any),
      itemCount: Number(r.itemCount) + (allocCountMap.get(Number(r.id)) || 0),
    }));
  }

  async getTherapistPayoutById(
    id: number,
  ): Promise<(TherapistPayout & { therapistName: string; items: TherapistPayoutItemDetail[] }) | undefined> {
    const [payout] = await db
      .select({
        id: therapistPayouts.id,
        therapistId: therapistPayouts.therapistId,
        totalAmount: therapistPayouts.totalAmount,
        paymentDate: therapistPayouts.paymentDate,
        paymentMethod: therapistPayouts.paymentMethod,
        referenceNumber: therapistPayouts.referenceNumber,
        notes: therapistPayouts.notes,
        status: therapistPayouts.status,
        voidedAt: therapistPayouts.voidedAt,
        voidedBy: therapistPayouts.voidedBy,
        voidReason: therapistPayouts.voidReason,
        createdBy: therapistPayouts.createdBy,
        createdAt: therapistPayouts.createdAt,
        therapistName: users.fullName,
      })
      .from(therapistPayouts)
      .innerJoin(users, eq(therapistPayouts.therapistId, users.id))
      .where(eq(therapistPayouts.id, id))
      .limit(1);

    if (!payout) return undefined;

    // Reflect post-payout COLLECTION corrections in the detail view. The stored
    // rows keep a frozen snapshot of each session's basis/earned at payout time,
    // so a collection that was later corrected (e.g. a double-counted insurance
    // payment that was fixed) never showed up here. Re-derive each session's
    // basis from the current collected amount, keyed by session billing id.
    // IMPORTANT: only the collected basis is refreshed — the pay RULE
    // (payType/payValue) stays the historical snapshot, and earned is recomputed
    // from that snapshot rule, so editing a therapist's rule later never mutates
    // this receipt. The amount actually PAID (amountAllocated) is real money and
    // is never changed, so any over/under payment caused by a later collection
    // correction stays visible.
    const liveEarnings = await this.computeTherapistEarnings(payout.therapistId);
    const liveCollectedByBilling = new Map<number, number>();
    const cancelledByBilling = new Set<number>();
    for (const e of liveEarnings) {
      liveCollectedByBilling.set(e.billingId, e.collectedAmount);
      if (e.status === 'cancelled') cancelledByBilling.add(e.billingId);
    }

    const itemRows = await db
      .select({
        id: therapistPayoutItems.id,
        sessionBillingId: therapistPayoutItems.sessionBillingId,
        sessionId: therapistPayoutItems.sessionId,
        sessionDate: sessions.sessionDate,
        serviceCode: services.serviceCode,
        serviceName: services.serviceName,
        clientName: clients.fullName,
        basisAmount: therapistPayoutItems.basisAmount,
        payType: therapistPayoutItems.payType,
        payValue: therapistPayoutItems.payValue,
        amountEarned: therapistPayoutItems.amountEarned,
      })
      .from(therapistPayoutItems)
      .leftJoin(sessions, eq(therapistPayoutItems.sessionId, sessions.id))
      .leftJoin(clients, eq(sessions.clientId, clients.id))
      .leftJoin(services, eq(therapistPayoutItems.serviceId, services.id))
      .where(eq(therapistPayoutItems.payoutId, id))
      .orderBy(desc(sessions.sessionDate));

    const items: TherapistPayoutItemDetail[] = itemRows.map((r) => ({
      id: Number(r.id),
      sessionBillingId: Number(r.sessionBillingId),
      sessionId: Number(r.sessionId),
      sessionDate: r.sessionDate ?? null,
      serviceCode: r.serviceCode ?? null,
      serviceName: r.serviceName ?? null,
      clientName: r.clientName ?? '',
      basisAmount: Number(r.basisAmount || 0),
      payType: r.payType,
      payValue: Number(r.payValue || 0),
      amountEarned: Number(r.amountEarned || 0),
      // Legacy itemized payouts pay the full (remaining) earned amount.
      amountAllocated: Number(r.amountEarned || 0),
    }));

    // Lump / partial payments record their coverage in the allocations table
    // instead of payout_items. Include those rows so the detail view is complete.
    const allocRows = await db
      .select({
        id: therapistPaymentAllocations.id,
        sessionBillingId: therapistPaymentAllocations.sessionBillingId,
        sessionId: therapistPaymentAllocations.sessionId,
        sessionDate: sessions.sessionDate,
        serviceCode: services.serviceCode,
        serviceName: services.serviceName,
        clientName: clients.fullName,
        basisAmount: therapistPaymentAllocations.basisAmount,
        payType: therapistPaymentAllocations.payType,
        payValue: therapistPaymentAllocations.payValue,
        amountEarned: therapistPaymentAllocations.amountEarned,
        amountAllocated: therapistPaymentAllocations.amountAllocated,
      })
      .from(therapistPaymentAllocations)
      .leftJoin(sessions, eq(therapistPaymentAllocations.sessionId, sessions.id))
      .leftJoin(clients, eq(sessions.clientId, clients.id))
      .leftJoin(services, eq(therapistPaymentAllocations.serviceId, services.id))
      .where(eq(therapistPaymentAllocations.payoutId, id))
      .orderBy(desc(sessions.sessionDate));

    for (const r of allocRows) {
      items.push({
        id: Number(r.id),
        sessionBillingId: Number(r.sessionBillingId),
        sessionId: Number(r.sessionId),
        sessionDate: r.sessionDate ?? null,
        serviceCode: r.serviceCode ?? null,
        serviceName: r.serviceName ?? null,
        clientName: r.clientName ?? '',
        basisAmount: Number(r.basisAmount || 0),
        payType: r.payType,
        payValue: Number(r.payValue || 0),
        amountEarned: Number(r.amountEarned || 0),
        amountAllocated: Number(r.amountAllocated || 0),
      });
    }

    for (const it of items) {
      const collected = liveCollectedByBilling.get(it.sessionBillingId);
      if (collected === undefined) continue;
      it.basisAmount = collected;
      // A session cancelled after it was paid earns nothing on the live basis,
      // so payout detail shows it as over-paid — consistent with the owed list,
      // running statement and monthly report that all treat cancelled as $0.
      if (cancelledByBilling.has(it.sessionBillingId)) {
        it.amountEarned = 0;
        continue;
      }
      // Recompute earned from the stored historical rule, not the current rule.
      it.amountEarned =
        it.payType === 'percentage'
          ? Math.round(collected * it.payValue) / 100
          : it.payValue;
    }

    return { ...(payout as any), items };
  }

  async voidTherapistPayout(id: number, voidedBy: number, reason: string): Promise<TherapistPayout> {
    return await db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(therapistPayouts)
        .where(eq(therapistPayouts.id, id))
        .limit(1);
      if (!existing) throw new Error('Payout not found');
      if (existing.status === 'voided') throw new Error('Payout already voided');

      // Release legacy itemized coverage so those sessions become owed again
      // (their existence == fully paid). Lump/partial *allocations* are kept on
      // purpose for the audit trail; flipping status to 'voided' makes the owed
      // and statement queries stop counting them.
      await tx.delete(therapistPayoutItems).where(eq(therapistPayoutItems.payoutId, id));

      const [updated] = await tx
        .update(therapistPayouts)
        .set({ status: 'voided', voidedAt: new Date(), voidedBy, voidReason: reason })
        .where(eq(therapistPayouts.id, id))
        .returning();
      return updated;
    });
  }

  // Record a single lump payment to a therapist and auto-apply it oldest-first
  // across their outstanding earnings. Each session is settled up to its
  // remaining amount (partial allocations allowed); any money beyond everything
  // owed is recorded as the payout's unappliedAmount (an over-payment credit).
  async createTherapistLumpPayment(input: {
    therapistId: number;
    amount: number;
    paymentDate: string;
    paymentMethod?: string | null;
    referenceNumber?: string | null;
    notes?: string | null;
    createdBy: number;
  }): Promise<TherapistPayout & { appliedAmount: number; unappliedAmount: number; allocationCount: number; allocations: TherapistPayoutAllocationDetail[] }> {
    const amount = Math.round(Number(input.amount) * 100) / 100;
    if (!(amount > 0)) throw new Error('Payment amount must be greater than zero');

    // Ensure the persistent (audited) earning ledger is up to date before paying
    // against it. Uses a distinct advisory lock from the payout lock below, so
    // it must run BEFORE opening the payout transaction (no nested/competing lock).
    await this.syncTherapistEarnings(input.therapistId);
    return await db.transaction(async (tx) => {
      // Serialize payout creation per therapist: hold a per-therapist advisory
      // lock for the life of this transaction so a concurrent payout can't
      // allocate against the same stale "remaining" snapshot and over-pay a
      // session. Released automatically on commit/rollback.
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtext('therapist_payout'), ${input.therapistId})`,
      );

      // Outstanding, rule-resolved sessions, oldest first. getTherapistOwed
      // already nets out prior allocations AND over-payment credit, so we only
      // allocate against genuinely-owed remaining balances. Read inside the lock
      // so the snapshot reflects any just-committed concurrent payout.
      const owed = await this.getTherapistOwed(input.therapistId);
      const payable = owed.items
        .filter((i) => i.payType != null && i.amountRemaining > 0)
        .sort((a, b) => {
          const ta = a.sessionDate ? new Date(a.sessionDate).getTime() : 0;
          const tb = b.sessionDate ? new Date(b.sessionDate).getTime() : 0;
          if (ta !== tb) return ta - tb; // oldest first
          return a.sessionBillingId - b.sessionBillingId;
        });

      let remainingToApply = amount;
      const allocations: {
        item: TherapistOwedItem;
        apply: number;
      }[] = [];
      for (const item of payable) {
        if (remainingToApply <= 0) break;
        const apply = Math.min(item.amountRemaining, remainingToApply);
        const applyRounded = Math.round(apply * 100) / 100;
        if (applyRounded <= 0) continue;
        allocations.push({ item, apply: applyRounded });
        remainingToApply = Math.round((remainingToApply - applyRounded) * 100) / 100;
      }

      // Money beyond everything currently owed becomes an over-payment credit.
      // "Everything owed" is the session payable total PLUS the net manual
      // adjustment (a bonus raises owed, a deduction lowers it). Computing the
      // unapplied part against this net — rather than against session remaining
      // alone — keeps the credit correct when adjustments exist: paying off a
      // bonus creates no false credit, and a deduction makes a same-size payment
      // correctly show as credit. Session allocations above are unchanged; the
      // adjustment portion is settled implicitly via the net balance.
      const netOwed = Math.max(0, Math.round((owed.total + owed.adjustmentsNet) * 100) / 100);
      const unappliedAmount = Math.max(0, Math.round((amount - netOwed) * 100) / 100);
      const appliedAmount = Math.round((amount - unappliedAmount) * 100) / 100;

      const [payout] = await tx
        .insert(therapistPayouts)
        .values({
          therapistId: input.therapistId,
          totalAmount: amount.toString(),
          paymentDate: input.paymentDate,
          paymentMethod: input.paymentMethod ?? null,
          referenceNumber: input.referenceNumber ?? null,
          notes: input.notes ?? null,
          status: 'paid',
          paymentType: 'lump',
          unappliedAmount: unappliedAmount.toString(),
          createdBy: input.createdBy,
        })
        .returning();

      for (const { item, apply } of allocations) {
        await tx.insert(therapistPaymentAllocations).values({
          payoutId: payout.id,
          sessionBillingId: item.sessionBillingId,
          sessionId: item.sessionId,
          serviceId: item.serviceId,
          basisAmount: item.collectedAmount.toString(),
          payType: item.payType!,
          payValue: (item.payValue ?? 0).toString(),
          amountEarned: item.amountEarned.toString(),
          amountAllocated: apply.toString(),
        });
      }

      return {
        ...(payout as any),
        appliedAmount,
        unappliedAmount,
        allocationCount: allocations.length,
        allocations: allocations.map(({ item, apply }) => ({
          sessionBillingId: item.sessionBillingId,
          sessionId: item.sessionId,
          amountAllocated: apply,
        })),
      };
    });
  }

  // Materialize the PERSISTENT earning ledger for a therapist (idempotent).
  // For each rule-resolved, collected session it ensures a stored earning row
  // exists whose summed amountEarned equals the live computed earning. The first
  // earning for a billing is written as an 'earning' row; if more is later
  // collected (e.g. insurance pays after a client copay) an 'adjustment' row is
  // appended for the delta rather than mutating history, so the ledger is
  // append-only and never shifts retroactively. Every newly-written row is
  // recorded in the audit log (action 'therapist_earning_recorded'). Returns the
  // count of collected sessions that have NO resolvable pay rule (surfaced in the
  // statement so the owner knows they need a rule before they can be paid).
  // Serialized per therapist via an advisory lock so concurrent reads can't
  // double-insert the same earning.
  private async syncTherapistEarnings(therapistId: number): Promise<{ unresolvedCount: number }> {
    const SYSTEM_USER_ID = 6; // system actor for derived (non-user) audit events
    const earnings = await this.computeTherapistEarnings(therapistId);
    let unresolvedCount = 0;
    return await db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtext('therapist_earning'), ${therapistId})`,
      );
      const existing = await tx
        .select({
          sessionBillingId: therapistEarnings.sessionBillingId,
          amountEarned: therapistEarnings.amountEarned,
        })
        .from(therapistEarnings)
        .where(eq(therapistEarnings.therapistId, therapistId));
      const persistedByBilling = new Map<number, number>();
      for (const r of existing) {
        const bid = Number(r.sessionBillingId);
        persistedByBilling.set(
          bid,
          Math.round(((persistedByBilling.get(bid) || 0) + Number(r.amountEarned)) * 100) / 100,
        );
      }

      const toInsert: (typeof therapistEarnings.$inferInsert)[] = [];
      for (const e of earnings) {
        if (!e.hasRule) {
          if (e.collectedAmount > 0) unresolvedCount++;
          continue;
        }
        const had = persistedByBilling.has(e.billingId);
        const persisted = persistedByBilling.get(e.billingId) || 0;
        // Earnings follow the money actually collected, so with nothing collected
        // the earned amount is 0. A session that previously collected money (and
        // recorded an earning) but whose collected amount later fell to 0 — e.g. a
        // refund/payment removal after a status change — must be reversed back to
        // net 0 rather than left at its old recorded value, otherwise the running
        // statement and monthly report keep overstating the therapist's earnings.
        const earnedNow = e.collectedAmount > 0 ? e.amountEarned : 0;
        if (earnedNow <= 0 && !had) continue; // nothing recorded and nothing to record
        const delta = Math.round((earnedNow - persisted) * 100) / 100;
        if (Math.abs(delta) < 0.005) continue; // already fully recorded
        const earnedDateStr = e.sessionDate
          ? new Date(e.sessionDate).toISOString().slice(0, 10)
          : null;
        toInsert.push({
          therapistId,
          sessionBillingId: e.billingId,
          sessionId: e.sessionId,
          clientId: e.clientId ?? null,
          clientName: e.clientName ?? '',
          serviceCode: e.serviceCode ?? null,
          serviceName: e.serviceName ?? null,
          entryType: had ? 'adjustment' : 'earning',
          amountEarned: delta.toString(),
          collectedSnapshot: e.collectedAmount.toString(),
          earnedDate: earnedDateStr,
        });
      }

      if (toInsert.length > 0) {
        await tx.insert(therapistEarnings).values(toInsert);
        await tx.insert(auditLogs).values(
          toInsert.map((t) => ({
            userId: SYSTEM_USER_ID,
            username: 'system',
            action: 'therapist_earning_recorded' as const,
            result: 'success' as const,
            resourceType: 'therapist_earning',
            resourceId: String(t.sessionBillingId),
            clientId: t.clientId ?? null,
            details: JSON.stringify({
              therapistId,
              sessionBillingId: t.sessionBillingId,
              sessionId: t.sessionId,
              entryType: t.entryType,
              amountEarned: t.amountEarned,
              collectedSnapshot: t.collectedSnapshot,
            }),
            hipaaRelevant: true,
          })),
        );
      }

      return { unresolvedCount };
    });
  }

  // Build a therapist's running statement (ledger): a chronological list of
  // earning lines (collected sessions) and payment lines (payouts), with a
  // running balance of what the practice owed the therapist after each line.
  async getTherapistStatement(therapistId: number): Promise<TherapistStatement> {
    const [therapist] = await db
      .select({ fullName: users.fullName })
      .from(users)
      .where(eq(users.id, therapistId))
      .limit(1);

    // Persist any newly-collected earnings (audited) before reading, then build
    // the statement's earning lines FROM the stored ledger rows so historical
    // lines are durable and never recomputed/shifted retroactively.
    const { unresolvedCount } = await this.syncTherapistEarnings(therapistId);

    type RawEntry = Omit<TherapistStatementEntry, 'runningBalance'> & { sortKey: number };
    const raw: RawEntry[] = [];

    const earningRows = await db
      .select()
      .from(therapistEarnings)
      .where(eq(therapistEarnings.therapistId, therapistId));
    // The ledger is append-only: a session can have an original 'earning' row plus
    // later 'adjustment' rows (e.g. when its collected amount changed). For the
    // statement we collapse all rows for the same session/billing into ONE earning
    // line showing the NET earned, so each session shows a single row instead of a
    // confusing stack of partial lines. The underlying rows are untouched (audit).
    type EarnGroup = {
      billingId: number;
      dateStr: string;
      description: string;
      reference: string | null;
      earned: number;
      sessionId?: number;
    };
    const earnGroups = new Map<number, EarnGroup>();
    for (const er of earningRows) {
      const dateStr =
        typeof er.earnedDate === 'string'
          ? er.earnedDate
          : er.earnedDate
            ? new Date(er.earnedDate as any).toISOString().slice(0, 10)
            : '1970-01-01';
      const bid = Number(er.sessionBillingId);
      const existing = earnGroups.get(bid);
      if (existing) {
        existing.earned = Math.round((existing.earned + Number(er.amountEarned)) * 100) / 100;
        // Keep the earliest (session) date for the consolidated line.
        if (dateStr < existing.dateStr) existing.dateStr = dateStr;
      } else {
        earnGroups.set(bid, {
          billingId: bid,
          dateStr,
          description: `${er.clientName || 'Client'} — ${er.serviceName || er.serviceCode || 'Session'}`,
          reference: er.serviceCode ?? null,
          earned: Number(er.amountEarned),
          sessionId: er.sessionId ?? undefined,
        });
      }
    }
    for (const g of Array.from(earnGroups.values())) {
      // Drop fully-reversed sessions (net 0) so they don't clutter the ledger.
      if (Math.abs(g.earned) < 0.005) continue;
      raw.push({
        date: g.dateStr,
        type: 'earning',
        description: g.description,
        reference: g.reference,
        earned: g.earned,
        paid: 0,
        sessionId: g.sessionId,
        sortKey: new Date(g.dateStr).getTime(),
      });
    }

    // Payment lines: ALL payouts (itemized or lump), including voided ones.
    // A voided payout is NOT erased — its original payment line is kept and a
    // reversing 'adjustment' line is added on the void date, so the ledger is a
    // continuous, append-only history (the two lines net to zero in the balance).
    const payouts = await db
      .select()
      .from(therapistPayouts)
      .where(eq(therapistPayouts.therapistId, therapistId));
    for (const p of payouts) {
      const d = p.paymentDate ? new Date(p.paymentDate as any) : new Date(0);
      const label = p.paymentType === 'lump' ? 'Lump payment' : 'Payment';
      raw.push({
        date: typeof p.paymentDate === 'string' ? p.paymentDate : d.toISOString().slice(0, 10),
        type: 'payment',
        description: p.referenceNumber ? `${label} (${p.referenceNumber})` : label,
        reference: p.referenceNumber ?? null,
        earned: 0,
        paid: Number(p.totalAmount || 0),
        payoutId: p.id,
        sortKey: d.getTime(),
      });
      if (p.status === 'voided') {
        const vd = p.voidedAt ? new Date(p.voidedAt as any) : d;
        const reason = p.voidReason ? `: ${p.voidReason}` : '';
        raw.push({
          date: vd.toISOString().slice(0, 10),
          type: 'adjustment',
          description: `${label} voided${reason}`,
          reference: p.referenceNumber ?? null,
          earned: 0,
          // Negative paid = money returned to the ledger; running balance += amount.
          paid: -Number(p.totalAmount || 0),
          payoutId: p.id,
          sortKey: vd.getTime(),
        });
      }
    }

    // Manual adjustment lines (active only): a bonus adds to earned, a deduction
    // adds to paid, so they move the running balance the same way a session earning
    // or a payment would. They are not session/payout lines, so they carry neither
    // sessionId nor payoutId; the adjustmentId lets the UI offer a "void" action.
    const adjustments = await this.listTherapistAdjustments(therapistId);
    for (const a of adjustments) {
      if (a.status !== 'active') continue;
      const isBonus = a.adjustmentType === 'bonus';
      const label = isBonus ? 'Bonus' : 'Deduction';
      const d = a.effectiveDate || '1970-01-01';
      raw.push({
        date: d,
        type: 'adjustment',
        description: a.description ? `${label} — ${a.description}` : label,
        reference: null,
        earned: isBonus ? a.amount : 0,
        paid: isBonus ? 0 : a.amount,
        adjustmentId: a.id,
        sortKey: new Date(d).getTime(),
      });
    }

    // Chronological order. On the same day: earnings first, then payments, then
    // void adjustments, so a payment can settle that day's earnings and a void
    // reversal applies after the payment it reverses.
    const rank = (t: RawEntry['type']) => (t === 'earning' ? 0 : t === 'payment' ? 1 : 2);
    raw.sort((a, b) => {
      if (a.sortKey !== b.sortKey) return a.sortKey - b.sortKey;
      return rank(a.type) - rank(b.type);
    });

    let running = 0;
    let totalEarned = 0;
    let totalPaid = 0;
    const entries: TherapistStatementEntry[] = raw.map((r) => {
      running = Math.round((running + r.earned - r.paid) * 100) / 100;
      totalEarned = Math.round((totalEarned + r.earned) * 100) / 100;
      totalPaid = Math.round((totalPaid + r.paid) * 100) / 100;
      const { sortKey, ...rest } = r;
      return { ...rest, runningBalance: running };
    });

    const net = Math.round((totalEarned - totalPaid) * 100) / 100;
    return {
      therapistId,
      therapistName: therapist?.fullName || '',
      entries,
      totalEarned,
      totalPaid,
      currentOwed: Math.max(0, net),
      creditBalance: Math.max(0, -net),
      unresolvedCount,
    };
  }

  // Per-therapist monthly audit report: opening/closing balance bracketing the
  // month, money earned & paid within it, and a session-by-session breakdown
  // with expected-vs-collected so uncollected balances are easy to flag.
  async getTherapistMonthlyStatement(
    therapistId: number,
    month: string, // YYYY-MM
  ): Promise<TherapistMonthlyStatement> {
    const m = /^(\d{4})-(\d{2})$/.exec(month);
    if (!m) throw new Error('month must be in YYYY-MM format');
    const mon = Number(m[2]);
    if (mon < 1 || mon > 12) throw new Error('month must be in YYYY-MM format');
    // A single calendar month is just a date range from the 1st to the last day.
    const lastDay = new Date(Date.UTC(Number(m[1]), mon, 0)).getUTCDate();
    const startDate = `${m[1]}-${m[2]}-01`;
    const endDate = `${m[1]}-${m[2]}-${String(lastDay).padStart(2, '0')}`;
    const res = await this.getTherapistPeriodStatement(therapistId, startDate, endDate);
    return { ...res, month };
  }

  // Generalized statement over an arbitrary inclusive [startDate, endDate] day
  // range (YYYY-MM-DD). The monthly statement above is just the special case of
  // a single calendar month. Opening balance = ledger balance strictly BEFORE
  // startDate; "earned/paid in period" are bucketed within the range; closing =
  // opening + earned − paid. Session rows are every session in the range (billed
  // or not), so unbilled gaps still surface.
  async getTherapistPeriodStatement(
    therapistId: number,
    startDate: string, // YYYY-MM-DD inclusive
    endDate: string,   // YYYY-MM-DD inclusive
  ): Promise<TherapistMonthlyStatement> {
    const sm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(startDate);
    const em = /^(\d{4})-(\d{2})-(\d{2})$/.exec(endDate);
    if (!sm || !em) throw new Error('startDate and endDate must be in YYYY-MM-DD format');
    // Parse to a UTC date AND verify it round-trips to the same Y/M/D. Date.UTC
    // silently normalizes impossible dates (2026-02-30 -> Mar 2, month 13 -> next
    // year), so a regex-only check would accept them and bucket the wrong period.
    const parseYmd = (m: RegExpExecArray): Date => {
      const y = Number(m[1]);
      const mo = Number(m[2]);
      const d = Number(m[3]);
      const dt = new Date(Date.UTC(y, mo - 1, d));
      if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) {
        throw new Error('startDate and endDate must be valid dates in YYYY-MM-DD format');
      }
      return dt;
    };
    const monthStart = parseYmd(sm);
    const endInclusive = parseYmd(em);
    // exclusive end = the day AFTER endDate, so the whole end day is included.
    const monthEnd = new Date(endInclusive.getTime() + 24 * 60 * 60 * 1000);
    if (monthEnd <= monthStart) throw new Error('endDate must be on or after startDate');

    const [therapist] = await db
      .select({ fullName: users.fullName })
      .from(users)
      .where(eq(users.id, therapistId))
      .limit(1);

    // Persist any newly-collected earnings (audited) before computing the report.
    await this.syncTherapistEarnings(therapistId);
    const earnings = await this.computeTherapistEarnings(therapistId);

    // Opening/earned amounts come FROM the persisted earning ledger (durable,
    // audited) bucketed by earnedDate, so the monthly numbers reconcile with the
    // running statement and don't shift if billing later changes.
    const earningRows = await db
      .select()
      .from(therapistEarnings)
      .where(eq(therapistEarnings.therapistId, therapistId));
    let openingEarned = 0;
    let earnedInMonth = 0;
    for (const er of earningRows) {
      const ds =
        typeof er.earnedDate === 'string'
          ? er.earnedDate
          : er.earnedDate
            ? new Date(er.earnedDate as any).toISOString().slice(0, 10)
            : null;
      const d = ds ? new Date(ds) : null;
      const amt = Number(er.amountEarned);
      if (d != null && d < monthStart) {
        openingEarned = Math.round((openingEarned + amt) * 100) / 100;
      } else if (d != null && d >= monthStart && d < monthEnd) {
        earnedInMonth = Math.round((earnedInMonth + amt) * 100) / 100;
      }
    }

    // Pull EVERY session for this therapist in the month (regardless of whether
    // it was billed) so the audit can flag sessions that fell through the cracks
    // and were never billed. This is what closes the "scheduled vs billed" gap:
    // billing rows are only created when a session is marked completed, so a
    // completed-but-unbilled session would otherwise silently never appear.
    const monthSessionRows = await db
      .select({
        sessionId: sessionsTable.id,
        status: sessionsTable.status,
        sessionDate: sessionsTable.sessionDate,
        clientName: clients.fullName,
        clientType: clients.clientType,
        serviceCode: services.serviceCode,
        serviceName: services.serviceName,
      })
      .from(sessionsTable)
      .innerJoin(clients, eq(sessionsTable.clientId, clients.id))
      .leftJoin(services, eq(sessionsTable.serviceId, services.id))
      .where(
        and(
          eq(sessionsTable.therapistId, therapistId),
          gte(sessionsTable.sessionDate, monthStart),
          lt(sessionsTable.sessionDate, monthEnd),
        ),
      );
    // status lookup so billed rows can also show the session's status, and the
    // set of all sessions that DO have a billing record (across all time).
    const statusBySession = new Map<number, string | null>();
    for (const r of monthSessionRows) statusBySession.set(Number(r.sessionId), r.status ?? null);
    const billedSessionIds = new Set(earnings.map((e) => Number(e.sessionId)));

    const sessions: TherapistMonthlySessionRow[] = [];
    let totalExpected = 0;
    let totalCollected = 0;
    let totalUncollected = 0;

    for (const e of earnings) {
      const d = e.sessionDate ? new Date(e.sessionDate) : null;
      const inMonth = d != null && d >= monthStart && d < monthEnd;
      if (inMonth) {
        // expected/earned are already 0 for cancelled sessions (computeTherapistEarnings
        // zeroes them at the source), so uncollected naturally falls to 0 and a
        // cancelled session no longer inflates the "money owed" totals here.
        const uncollected = Math.max(0, Math.round((e.expected - e.collectedAmount) * 100) / 100);
        sessions.push({
          sessionId: e.sessionId,
          sessionBillingId: e.billingId,
          sessionDate: e.sessionDate,
          clientName: e.clientName,
          clientType: e.clientType ?? null,
          serviceCode: e.serviceCode,
          serviceName: e.serviceName,
          status: statusBySession.get(e.sessionId) ?? 'completed',
          billed: true,
          expected: e.expected,
          collected: e.collectedAmount,
          uncollected,
          // Earnings follow collected money: a fixed-rate rule still earns $0
          // until something is collected, so an uncollected session must show 0
          // (its row would otherwise overstate earnings vs. the month total/ledger).
          earned: e.hasRule && e.collectedAmount > 0 ? e.amountEarned : 0,
          hasRule: e.hasRule,
        });
        totalExpected = Math.round((totalExpected + e.expected) * 100) / 100;
        totalCollected = Math.round((totalCollected + e.collectedAmount) * 100) / 100;
        totalUncollected = Math.round((totalUncollected + uncollected) * 100) / 100;
      }
    }

    // Append the NOT-billed sessions for the month. Money columns are 0 (no fee
    // is established until a session is billed) and they're excluded from the
    // collected/expected totals above, which represent billed money only.
    let unbilledCount = 0;
    let unbilledCompletedCount = 0;
    for (const r of monthSessionRows) {
      const sid = Number(r.sessionId);
      if (billedSessionIds.has(sid)) continue; // already shown as a billed row
      const status = r.status ?? null;
      unbilledCount++;
      if (status === 'completed') unbilledCompletedCount++;
      sessions.push({
        sessionId: sid,
        sessionBillingId: null,
        sessionDate: r.sessionDate ? new Date(r.sessionDate) : null,
        clientName: r.clientName ?? '',
        clientType: r.clientType ?? null,
        serviceCode: r.serviceCode ?? null,
        serviceName: r.serviceName ?? null,
        status,
        billed: false,
        expected: 0,
        collected: 0,
        uncollected: 0,
        earned: 0,
        hasRule: false,
      });
    }

    // Payment math uses ledger semantics (mirrors getTherapistStatement) so the
    // monthly opening/closing chain stays consistent with the running statement:
    // every payout contributes a positive payment event on its paymentDate, and
    // a voided payout ALSO contributes a negative reversal event on its voidedAt.
    // Each event is bucketed by its OWN date — so a payment made in one month and
    // voided in a later month adds the money back in the month it was voided,
    // never silently disappearing from earlier totals.
    const payouts = await db
      .select({
        paymentDate: therapistPayouts.paymentDate,
        totalAmount: therapistPayouts.totalAmount,
        status: therapistPayouts.status,
        voidedAt: therapistPayouts.voidedAt,
      })
      .from(therapistPayouts)
      .where(eq(therapistPayouts.therapistId, therapistId));
    let openingPaid = 0;
    let paidInMonth = 0;
    const bucketPayment = (eventDate: Date | null, amt: number) => {
      if (eventDate == null) return;
      if (eventDate < monthStart) openingPaid = Math.round((openingPaid + amt) * 100) / 100;
      else if (eventDate < monthEnd) paidInMonth = Math.round((paidInMonth + amt) * 100) / 100;
    };
    for (const p of payouts) {
      const amt = Number(p.totalAmount || 0);
      bucketPayment(p.paymentDate ? new Date(p.paymentDate as any) : null, amt);
      if (p.status === 'voided') {
        const vd = p.voidedAt
          ? new Date(p.voidedAt as any)
          : (p.paymentDate ? new Date(p.paymentDate as any) : null);
        bucketPayment(vd, -amt);
      }
    }

    // Bucket manual adjustments (active only) the same way as earnings/payments so
    // the monthly chain stays consistent with the running statement: a bonus is an
    // "earned" event and a deduction is a "paid" event, each on its effectiveDate.
    // Before the month -> opening; inside the month -> this period's earned/paid.
    const adjustments = await this.listTherapistAdjustments(therapistId);
    for (const a of adjustments) {
      if (a.status !== 'active') continue;
      const d = a.effectiveDate ? new Date(a.effectiveDate) : null;
      if (d == null) continue;
      const before = d < monthStart;
      const inMonth = d >= monthStart && d < monthEnd;
      if (!before && !inMonth) continue;
      if (a.adjustmentType === 'bonus') {
        if (before) openingEarned = Math.round((openingEarned + a.amount) * 100) / 100;
        else earnedInMonth = Math.round((earnedInMonth + a.amount) * 100) / 100;
      } else {
        if (before) openingPaid = Math.round((openingPaid + a.amount) * 100) / 100;
        else paidInMonth = Math.round((paidInMonth + a.amount) * 100) / 100;
      }
    }

    const openingBalance = Math.round((openingEarned - openingPaid) * 100) / 100;
    const closingBalance = Math.round((openingBalance + earnedInMonth - paidInMonth) * 100) / 100;

    // Sessions oldest first within the month.
    sessions.sort((a, b) => {
      const ta = a.sessionDate ? new Date(a.sessionDate).getTime() : 0;
      const tb = b.sessionDate ? new Date(b.sessionDate).getTime() : 0;
      if (ta !== tb) return ta - tb;
      return a.sessionId - b.sessionId;
    });

    return {
      therapistId,
      therapistName: therapist?.fullName || '',
      month: `${startDate}..${endDate}`,
      openingBalance,
      earnedInMonth,
      paidInMonth,
      closingBalance,
      sessions,
      totalExpected,
      totalCollected,
      totalUncollected,
      unbilledCount,
      unbilledCompletedCount,
    };
  }

  // Read-only "needs attention" summary for the payments dashboard. Scans only the
  // therapists that have any pay activity (an earning, a payout, or an adjustment)
  // and flags three actionable problems:
  //   - unresolved: collected sessions with NO pay rule (can't be paid out)
  //   - credits:    therapists carrying an unapplied over-payment credit
  //   - staleUnpaid: owed sessions older than `staleDays` still unpaid
  async getTherapistPayAttention(staleDays = 30): Promise<TherapistPayAttention> {
    const ids = new Set<number>();
    // Seed with every current therapist so that someone who has collected
    // sessions but NO pay rule (and therefore no persisted earnings/payouts yet)
    // still gets flagged as "unresolved" — that is exactly the case this panel
    // exists to catch. We then union in any historical ledger ids below so a
    // therapist who has since left but still has owed money isn't dropped.
    const allTherapists = await this.getTherapists();
    for (const t of allTherapists) ids.add(Number(t.id));
    const earnIds = await db
      .selectDistinct({ id: therapistEarnings.therapistId })
      .from(therapistEarnings);
    for (const r of earnIds) ids.add(Number(r.id));
    const payIds = await db
      .selectDistinct({ id: therapistPayouts.therapistId })
      .from(therapistPayouts);
    for (const r of payIds) ids.add(Number(r.id));
    const adjIds = await db
      .selectDistinct({ id: therapistAdjustments.therapistId })
      .from(therapistAdjustments);
    for (const r of adjIds) ids.add(Number(r.id));

    const idList = Array.from(ids);
    const nameMap = new Map<number, string>();
    if (idList.length) {
      const us = await db
        .select({ id: users.id, fullName: users.fullName })
        .from(users)
        .where(inArray(users.id, idList));
      for (const u of us) nameMap.set(Number(u.id), u.fullName || '');
    }

    const unresolved: TherapistPayAttention['unresolved'] = [];
    const credits: TherapistPayAttention['credits'] = [];
    const staleUnpaid: TherapistPayAttention['staleUnpaid'] = [];
    const cutoff = new Date(Date.now() - staleDays * 24 * 60 * 60 * 1000);

    for (const tid of idList) {
      const name = nameMap.get(tid) || '';
      const owed = await this.getTherapistOwed(tid);
      if (owed.unresolvedCount > 0) {
        unresolved.push({ therapistId: tid, therapistName: name, count: owed.unresolvedCount });
      }
      const credit = await this.getTherapistUnappliedCredit(tid);
      if (credit > 0.005) {
        credits.push({ therapistId: tid, therapistName: name, creditBalance: credit });
      }
      let count = 0;
      let total = 0;
      let oldest: string | null = null;
      for (const it of owed.items) {
        if (it.payType == null || it.amountRemaining <= 0 || !it.sessionDate) continue;
        const sd = new Date(it.sessionDate);
        if (sd >= cutoff) continue;
        count++;
        total = Math.round((total + it.amountRemaining) * 100) / 100;
        const ds = new Date(it.sessionDate).toISOString().slice(0, 10);
        if (oldest == null || ds < oldest) oldest = ds;
      }
      if (count > 0) {
        staleUnpaid.push({ therapistId: tid, therapistName: name, count, oldestDate: oldest, total });
      }
    }

    unresolved.sort((a, b) => b.count - a.count);
    credits.sort((a, b) => b.creditBalance - a.creditBalance);
    staleUnpaid.sort((a, b) => (a.oldestDate || '') < (b.oldestDate || '') ? -1 : 1);

    return { unresolved, credits, staleUnpaid, staleDays };
  }

  // ===== INSURANCE STATEMENT RECONCILIATION =====

  async findDuplicateStatement(input: {
    payerName: string | null;
    statementDate: string | null;
    totalPaid: string | null;
    checkNumber: string | null;
    lineCount: number;
  }): Promise<{
    id: number;
    status: string;
    fileName: string;
    payerName: string | null;
    statementDate: string | null;
    totalPaid: string | null;
    createdAt: Date;
    lineCount: number;
  } | null> {
    // Only consider statements that still "count" (draft or posted). A voided
    // statement is intentionally undone, so re-uploading it is not a duplicate.
    const candidates = await db
      .select({
        id: insuranceStatements.id,
        status: insuranceStatements.status,
        fileName: insuranceStatements.fileName,
        payerName: insuranceStatements.payerName,
        statementDate: insuranceStatements.statementDate,
        totalPaid: insuranceStatements.totalPaid,
        checkNumber: insuranceStatements.checkNumber,
        createdAt: insuranceStatements.createdAt,
      })
      .from(insuranceStatements)
      .where(inArray(insuranceStatements.status, ['draft', 'posted']))
      .orderBy(desc(insuranceStatements.createdAt));
    if (!candidates.length) return null;

    // How many lines each candidate has (one grouped query, not a correlated
    // subquery — the latter does not correlate reliably through Drizzle's sql``).
    const counts = await db
      .select({ sid: insuranceStatementLines.statementId, n: count() })
      .from(insuranceStatementLines)
      .where(inArray(insuranceStatementLines.statementId, candidates.map((c) => c.id)))
      .groupBy(insuranceStatementLines.statementId);
    const countMap = new Map(counts.map((c) => [c.sid, Number(c.n)]));
    const rows = candidates.map((c) => ({ ...c, lineCount: countMap.get(c.id) ?? 0 }));

    const txt = (s: string | null | undefined) => (s == null ? '' : s.trim().toLowerCase());
    const numEq = (a: string | null, b: string | null) => {
      if (a == null && b == null) return true;
      if (a == null || b == null) return false;
      return Number(a) === Number(b);
    };

    for (const r of rows) {
      const lineCount = Number(r.lineCount);
      // If both statements carry a check/EFT reference, that alone decides it:
      // same reference + payer = duplicate; different reference = not the same.
      if (input.checkNumber && r.checkNumber) {
        if (txt(input.checkNumber) === txt(r.checkNumber) && txt(input.payerName) === txt(r.payerName)) {
          return { ...r, lineCount } as any;
        }
        continue;
      }
      // Otherwise fall back to a content fingerprint: same payer, statement date,
      // total paid, and number of lines.
      const samePayer = txt(input.payerName) === txt(r.payerName);
      const sameDate = (input.statementDate || null) === (r.statementDate || null);
      const sameTotal = numEq(input.totalPaid, r.totalPaid);
      const sameLines = lineCount === input.lineCount;
      if (samePayer && sameDate && sameTotal && sameLines) {
        return { ...r, lineCount } as any;
      }
    }
    return null;
  }

  async createInsuranceStatement(
    statement: InsertInsuranceStatement,
    lines: Omit<InsertInsuranceStatementLine, 'statementId'>[],
  ): Promise<InsuranceStatement> {
    const created = await db.transaction(async (tx) => {
      const [stmt] = await tx.insert(insuranceStatements).values(statement).returning();
      if (lines.length) {
        await tx.insert(insuranceStatementLines).values(
          lines.map((l) => ({ ...l, statementId: stmt.id })),
        );
      }
      return stmt;
    });
    // Auto-match outside the insert transaction (it issues its own queries).
    await this.autoMatchStatementLines(created.id);
    return created;
  }

  // Find the single best session_billing match for one statement line. Returns
  // null when there is no candidate or the candidates are ambiguous (we never
  // guess between multiple billings — the user resolves those manually).
  private async findBillingMatchForLine(line: InsuranceStatementLine): Promise<
    { billingId: number; sessionId: number; clientId: number; confidence: 'high' | 'medium' | 'low' | 'partial' } | null
  > {
    const conds: any[] = [];
    const hasDate = !!line.serviceDate;
    if (hasDate) {
      conds.push(sql`${sessions.sessionDate}::date = ${line.serviceDate}::date`);
    }
    // Name tokens are normalized (accents stripped, lowercased, order-independent)
    // so "José", "Garcia Lopez, Maria Jose" and "Maria Garcia" all compare on
    // their bare word-pieces. See normalizedNameTokens.
    const nameTokens = normalizedNameTokens(line.clientNameRaw);
    const hasName = nameTokens.length > 0;
    if (!hasDate && !hasName) return null;

    // When we have a service date we pre-filter on the date alone and do ALL
    // name logic in JS. This is more accurate than an ILIKE name pre-filter,
    // which silently drops accented stored names (e.g. statement token "jose"
    // can't ILIKE-match a stored "José"). A single day has few billings, so the
    // candidate set stays small. Without a date we fall back to a broad name
    // ILIKE pre-filter.
    if (!hasDate && hasName) {
      const tokenConds = nameTokens.map((t) => ilike(clients.fullName, `%${t}%`));
      conds.push(or(...tokenConds));
    }

    // Fetch one more than the cap so we can detect saturation. If the prefilter
    // returns MORE than the cap, additional valid candidates may be hidden and we
    // cannot guarantee the eventual single survivor is globally unique — bail to
    // manual rather than risk a misleading "unique" suggestion.
    const CANDIDATE_CAP = 50;
    const rows = await db
      .select({
        billingId: sessionBilling.id,
        sessionId: sessions.id,
        clientId: clients.id,
        clientName: clients.fullName,
        serviceCode: services.serviceCode,
      })
      .from(sessionBilling)
      .innerJoin(sessions, eq(sessionBilling.sessionId, sessions.id))
      .innerJoin(clients, eq(sessions.clientId, clients.id))
      .leftJoin(services, eq(sessions.serviceId, services.id))
      .where(and(...conds))
      .limit(CANDIDATE_CAP + 1);

    if (!rows.length) return null;
    if (rows.length > CANDIDATE_CAP) return null;

    let candidates = rows;
    // 'partial' means the names only PARTLY overlap (shared word-piece, but
    // neither name fully contains the other) — surfaced as a low-confidence
    // "possible match" a human must confirm, never auto-posted.
    let partial = false;

    if (hasName) {
      // Tier 1 — strong name match: every word-piece of the shorter name has a
      // similar piece in the other (order-independent), tolerant of truncation
      // and transliteration spelling differences (see nameTokensSimilar).
      // "Qazan Ammar Subh" ⊆ "Ammar Subhi Suleiman Qazan"; a genuinely different
      // name ("John Smith" vs "John Doe") still does not.
      const nameCompatible = candidates.filter((r) => {
        const clientTokens = normalizedNameTokens(r.clientName);
        if (!clientTokens.length) return false;
        const clientInStmt = clientTokens.every((ct) =>
          nameTokens.some((st) => nameTokensSimilar(ct, st)),
        );
        const stmtInClient = nameTokens.every((st) =>
          clientTokens.some((ct) => nameTokensSimilar(st, ct)),
        );
        return clientInStmt || stmtInClient;
      });

      if (nameCompatible.length) {
        candidates = nameCompatible;
      } else if (hasDate) {
        // Tier 2 — partial name overlap. Only attempted when we have a service
        // date (a strong constraint), and even then it is just a suggestion the
        // user confirms. Requires at least one similar word-piece so a stray
        // substring can't pull in an unrelated client.
        const sharesToken = candidates.filter((r) =>
          normalizedNameTokens(r.clientName).some((ct) =>
            nameTokens.some((st) => nameTokensSimilar(ct, st)),
          ),
        );
        if (!sharesToken.length) return null;
        candidates = sharesToken;
        partial = true;
      } else {
        return null;
      }
    }

    // Matching is name-driven only (service code is intentionally NOT used to
    // pick or rank a match). The service date above just narrows which sessions
    // are in play; the name decides the client.

    // Only auto-suggest when exactly one candidate survives; ambiguity → manual.
    if (candidates.length !== 1) return null;

    const c = candidates[0];
    // Distinguish an EXACT name match (every piece identical) from a FUZZY one
    // (some pieces matched only via truncation/transliteration) so we don't label
    // a spelling-guess as confidently as a verbatim match.
    let exactName = false;
    if (hasName && !partial) {
      const clientTokens = normalizedNameTokens(c.clientName);
      const stmtSet = new Set(nameTokens);
      const clientSet = new Set(clientTokens);
      exactName =
        clientTokens.length > 0 &&
        (clientTokens.every((t) => stmtSet.has(t)) ||
          nameTokens.every((t) => clientSet.has(t)));
    }
    let confidence: 'high' | 'medium' | 'low' | 'partial' = 'low';
    if (partial) confidence = 'partial';
    else if (exactName) confidence = hasDate ? 'high' : 'medium';
    else if (hasName) confidence = hasDate ? 'medium' : 'low';
    return { billingId: c.billingId, sessionId: c.sessionId, clientId: c.clientId, confidence };
  }

  async autoMatchStatementLines(statementId: number): Promise<void> {
    // A voided statement is terminal: its lines were reversed and must never be
    // re-matched, which would resurrect the misleading "re-postable" appearance
    // the terminal state was meant to remove.
    const [statement] = await db
      .select({ status: insuranceStatements.status })
      .from(insuranceStatements)
      .where(eq(insuranceStatements.id, statementId))
      .limit(1);
    if (!statement) throw new Error('Statement not found');
    if (statement.status === 'voided') {
      throw new Error('Cannot rematch a voided statement.');
    }

    const lines = await db
      .select()
      .from(insuranceStatementLines)
      .where(eq(insuranceStatementLines.statementId, statementId));

    for (const line of lines) {
      // Never disturb a line the user already confirmed/posted/skipped, or a
      // line that was reversed by a void (terminal state — re-matching it would
      // resurrect the misleading "re-postable" appearance this guards against).
      if (
        line.matchStatus === 'confirmed' ||
        line.matchStatus === 'posted' ||
        line.matchStatus === 'skipped' ||
        line.matchStatus === 'reversed'
      ) {
        continue;
      }
      const match = await this.findBillingMatchForLine(line);
      if (match) {
        await db
          .update(insuranceStatementLines)
          .set({
            matchedSessionBillingId: match.billingId,
            matchedSessionId: match.sessionId,
            matchedClientId: match.clientId,
            matchStatus: 'suggested',
            matchConfidence: match.confidence,
          })
          .where(eq(insuranceStatementLines.id, line.id));
      } else {
        await db
          .update(insuranceStatementLines)
          .set({
            matchedSessionBillingId: null,
            matchedSessionId: null,
            matchedClientId: null,
            matchStatus: 'unmatched',
            matchConfidence: null,
          })
          .where(eq(insuranceStatementLines.id, line.id));
      }
    }
  }

  async getInsuranceStatements(): Promise<InsuranceStatementSummary[]> {
    const stmts = await db
      .select()
      .from(insuranceStatements)
      .orderBy(desc(insuranceStatements.createdAt));
    if (!stmts.length) return [];

    const ids = stmts.map((s) => s.id);
    // Per-statement line counts in one grouped query.
    const counts = await db
      .select({
        statementId: insuranceStatementLines.statementId,
        lineCount: sql<number>`count(*)::int`,
        matchedCount: sql<number>`count(*) FILTER (WHERE ${insuranceStatementLines.matchStatus} IN ('suggested','confirmed','posted'))::int`,
        postedCount: sql<number>`count(*) FILTER (WHERE ${insuranceStatementLines.matchStatus} = 'posted')::int`,
        postedTotal: sql<number>`coalesce(sum(${insuranceStatementLines.insurancePaidAmount}) FILTER (WHERE ${insuranceStatementLines.matchStatus} = 'posted'), 0)::float8`,
      })
      .from(insuranceStatementLines)
      .where(inArray(insuranceStatementLines.statementId, ids))
      .groupBy(insuranceStatementLines.statementId);
    const countMap = new Map(counts.map((c) => [c.statementId, c]));

    const userIds = Array.from(
      new Set(
        stmts
          .flatMap((s) => [s.uploadedBy, s.therapistId])
          .filter((x): x is number => x != null),
      ),
    );
    const people = userIds.length
      ? await db.select({ id: users.id, fullName: users.fullName }).from(users).where(inArray(users.id, userIds))
      : [];
    const userMap = new Map(people.map((u) => [u.id, u.fullName]));

    return stmts.map((s) => {
      const c = countMap.get(s.id);
      return {
        ...s,
        uploadedByName: s.uploadedBy != null ? userMap.get(s.uploadedBy) ?? null : null,
        therapistName: s.therapistId != null ? userMap.get(s.therapistId) ?? null : null,
        lineCount: c?.lineCount ?? 0,
        matchedCount: c?.matchedCount ?? 0,
        postedCount: c?.postedCount ?? 0,
        postedTotal: c?.postedTotal ?? 0,
      };
    });
  }

  async getInsuranceStatementById(id: number): Promise<InsuranceStatementDetail | undefined> {
    const [statement] = await db
      .select()
      .from(insuranceStatements)
      .where(eq(insuranceStatements.id, id))
      .limit(1);
    if (!statement) return undefined;

    const rows = await db
      .select({
        line: insuranceStatementLines,
        clientName: clients.fullName,
        sessionDate: sessions.sessionDate,
        serviceCode: services.serviceCode,
        serviceName: services.serviceName,
        billedTotal: sessionBilling.totalAmount,
        insurancePaid: sessionBilling.insurancePaidAmount,
        clientPaid: sessionBilling.clientPaidAmount,
      })
      .from(insuranceStatementLines)
      .leftJoin(sessionBilling, eq(insuranceStatementLines.matchedSessionBillingId, sessionBilling.id))
      .leftJoin(sessions, eq(sessionBilling.sessionId, sessions.id))
      .leftJoin(clients, eq(sessions.clientId, clients.id))
      .leftJoin(services, eq(sessions.serviceId, services.id))
      .where(eq(insuranceStatementLines.statementId, id))
      .orderBy(asc(insuranceStatementLines.id));

    const lines: InsuranceStatementLineDetail[] = rows.map((r) => ({
      ...r.line,
      matchedClientName: r.clientName ?? null,
      matchedSessionDate: r.sessionDate ?? null,
      matchedServiceCode: r.serviceCode ?? null,
      matchedServiceName: r.serviceName ?? null,
      matchedBilledTotal: r.billedTotal != null ? Number(r.billedTotal) : null,
      matchedInsurancePaid: r.insurancePaid != null ? Number(r.insurancePaid) : null,
      matchedClientPaid: r.clientPaid != null ? Number(r.clientPaid) : null,
    }));

    let therapistName: string | null = null;
    if (statement.therapistId != null) {
      const [t] = await db
        .select({ fullName: users.fullName })
        .from(users)
        .where(eq(users.id, statement.therapistId))
        .limit(1);
      therapistName = t?.fullName ?? null;
    }

    return { statement, therapistName, lines };
  }

  async getAllInsuranceLines(): Promise<InsuranceTransactionRow[]> {
    const rows = await db
      .select({
        lineId: insuranceStatementLines.id,
        statementId: insuranceStatementLines.statementId,
        serviceDate: insuranceStatementLines.serviceDate,
        clientNameRaw: insuranceStatementLines.clientNameRaw,
        lineServiceCode: insuranceStatementLines.serviceCode,
        insurancePaidAmount: insuranceStatementLines.insurancePaidAmount,
        matchStatus: insuranceStatementLines.matchStatus,
        remarkCode: insuranceStatementLines.remarkCode,
        statementFileName: insuranceStatements.fileName,
        statementStatus: insuranceStatements.status,
        payerName: insuranceStatements.payerName,
        statementCreatedAt: insuranceStatements.createdAt,
        therapistName: users.fullName,
        matchedClientName: clients.fullName,
      })
      .from(insuranceStatementLines)
      .innerJoin(insuranceStatements, eq(insuranceStatementLines.statementId, insuranceStatements.id))
      .leftJoin(users, eq(insuranceStatements.therapistId, users.id))
      .leftJoin(sessionBilling, eq(insuranceStatementLines.matchedSessionBillingId, sessionBilling.id))
      .leftJoin(sessions, eq(sessionBilling.sessionId, sessions.id))
      .leftJoin(clients, eq(sessions.clientId, clients.id))
      .orderBy(desc(insuranceStatements.createdAt), asc(insuranceStatementLines.id));

    return rows.map((r) => ({
      lineId: r.lineId,
      statementId: r.statementId,
      statementFileName: r.statementFileName,
      statementStatus: r.statementStatus,
      payerName: r.payerName ?? null,
      therapistName: r.therapistName ?? null,
      serviceDate: r.serviceDate ?? null,
      clientName: r.matchedClientName ?? r.clientNameRaw ?? null,
      serviceCode: r.lineServiceCode ?? null,
      insurancePaidAmount: r.insurancePaidAmount,
      matchStatus: r.matchStatus,
      remarkCode: r.remarkCode ?? null,
    }));
  }

  async updateInsuranceStatementTherapist(
    id: number,
    therapistId: number | null,
  ): Promise<InsuranceStatementDetail> {
    const [updated] = await db
      .update(insuranceStatements)
      .set({ therapistId })
      .where(eq(insuranceStatements.id, id))
      .returning();
    if (!updated) throw new Error('Statement not found');
    const detail = await this.getInsuranceStatementById(id);
    if (!detail) throw new Error('Statement not found');
    return detail;
  }

  async updateStatementLineMatch(
    lineId: number,
    update: {
      matchStatus: 'unmatched' | 'suggested' | 'confirmed' | 'skipped';
      matchedSessionBillingId?: number | null;
    },
  ): Promise<InsuranceStatementLine> {
    const [existing] = await db
      .select()
      .from(insuranceStatementLines)
      .where(eq(insuranceStatementLines.id, lineId))
      .limit(1);
    if (!existing) throw new Error('Statement line not found');
    if (existing.matchStatus === 'posted') {
      throw new Error('Cannot change a line that has already been posted. Void the statement first.');
    }

    // A voided statement is terminal: none of its lines may be edited, otherwise
    // a direct API call could flip a 'reversed' line back to a re-postable
    // status, resurrecting the misleading "re-postable" appearance.
    const [parent] = await db
      .select({ status: insuranceStatements.status })
      .from(insuranceStatements)
      .where(eq(insuranceStatements.id, existing.statementId))
      .limit(1);
    if (parent?.status === 'voided') {
      throw new Error('Cannot change a line on a voided statement.');
    }

    const setData: any = { matchStatus: update.matchStatus };

    // When the caller points the line at a (different) billing, resolve its
    // session/client so the display joins and posting stay consistent.
    if (update.matchedSessionBillingId !== undefined) {
      if (update.matchedSessionBillingId === null) {
        setData.matchedSessionBillingId = null;
        setData.matchedSessionId = null;
        setData.matchedClientId = null;
      } else {
        const [b] = await db
          .select({ billingId: sessionBilling.id, sessionId: sessions.id, clientId: clients.id })
          .from(sessionBilling)
          .innerJoin(sessions, eq(sessionBilling.sessionId, sessions.id))
          .innerJoin(clients, eq(sessions.clientId, clients.id))
          .where(eq(sessionBilling.id, update.matchedSessionBillingId))
          .limit(1);
        if (!b) throw new Error('Selected billing record not found');
        setData.matchedSessionBillingId = b.billingId;
        setData.matchedSessionId = b.sessionId;
        setData.matchedClientId = b.clientId;
      }
    }

    // Confirming requires a billing target.
    if (update.matchStatus === 'confirmed') {
      const targetBilling =
        update.matchedSessionBillingId !== undefined
          ? update.matchedSessionBillingId
          : existing.matchedSessionBillingId;
      if (!targetBilling) {
        throw new Error('Cannot confirm a line with no matched billing record.');
      }
    }

    const [updated] = await db
      .update(insuranceStatementLines)
      .set(setData)
      .where(eq(insuranceStatementLines.id, lineId))
      .returning();
    return updated;
  }

  async postInsuranceStatement(
    id: number,
    userId: number,
  ): Promise<{ statement: InsuranceStatement; postedCount: number; postedTotal: number; skippedDuplicates: number }> {
    // Serialize posting against a concurrent delete on the SAME statement. Post
    // records payments BEFORE flipping status to 'posted', so a delete that read
    // 'draft' mid-post could remove the statement and leave billing balances
    // inflated. Hold a transaction-scoped advisory lock (the same key delete
    // takes) for the whole post: delete's matching lock blocks until we commit,
    // and it auto-releases on commit/rollback — no leak across the pooled
    // postgres-js connections (a session-level lock could unlock on the wrong
    // connection and leak forever). The WHOLE body runs on this one transaction
    // (lockTx) — including recordPayment via its executor arg — so post never
    // needs a second pooled connection (pool max is small: 2 dev / 5 prod), which
    // would otherwise deadlock two concurrent posts. Bonus: post is now atomic.
    return await db.transaction(async (lockTx) => {
    await lockTx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('insurance_statement'), ${id})`);
    const [statement] = await lockTx
      .select()
      .from(insuranceStatements)
      .where(eq(insuranceStatements.id, id))
      .limit(1);
    if (!statement) throw new Error('Statement not found');
    if (statement.status === 'voided') throw new Error('Cannot post a voided statement.');

    const lines = await lockTx
      .select()
      .from(insuranceStatementLines)
      .where(eq(insuranceStatementLines.statementId, id));

    // Block finalizing a draft that has nothing confirmed — otherwise the
    // statement would be marked "posted" without recording any payment, which
    // prematurely closes it. (Re-running an already-posted statement stays
    // allowed so a partial failure can be retried idempotently.)
    if (statement.status === 'draft') {
      const confirmedCount = lines.filter(
        (l) => l.matchStatus === 'confirmed' && l.matchedSessionBillingId,
      ).length;
      if (confirmedCount === 0) {
        throw new Error('Cannot post: confirm at least one matched line first.');
      }
    }

    const paymentDate = statement.statementDate || new Date().toISOString().slice(0, 10);
    let postedCount = 0;
    let postedTotal = 0;
    let skippedDuplicates = 0;

    for (const line of lines) {
      // Only confirmed, billing-linked lines get posted. Already-posted lines
      // are skipped so re-running after a partial failure is safe (idempotent).
      if (line.matchStatus !== 'confirmed') continue;
      if (!line.matchedSessionBillingId) continue;
      const lineAmount = Number(line.insurancePaidAmount) || 0;
      if (lineAmount <= 0) {
        // Nothing to pay (e.g. fully denied) — mark posted with zero so it's
        // reflected as handled without touching the billing record.
        await lockTx
          .update(insuranceStatementLines)
          .set({ matchStatus: 'posted', postedAmount: '0' })
          .where(eq(insuranceStatementLines.id, line.id));
        postedCount += 1;
        continue;
      }

      // Double-count guardrail. A statement line records the SAME real-world
      // insurer payment that may ALREADY be reflected on the billing — either
      // because staff keyed it MANUALLY first, or because an EARLIER statement
      // already posted/adopted coverage for this same billing. Either way it is
      // the same money, not an extra payment, so we must never inflate collections
      // (which would inflate therapist pay).
      //
      // Read the billing's current cumulative insurance first; that number already
      // includes every live manual row AND every shortfall a prior statement
      // posted for this billing. We then:
      //   1. "Adopt" any matching MANUAL insurance rows (source='insurance', not
      //      statement-sourced, not yet adopted) — stamping them with this line's
      //      id so no later statement can claim them again and so a void can
      //      release them for a clean re-post.
      //   2. Post ONLY the SHORTFALL by which this line exceeds the insurance
      //      already counted on the billing. When the billing already covers the
      //      line, `additional` is 0 and nothing new is recorded — so a second
      //      statement for the same payment can never double the total.
      const [billing] = await lockTx
        .select({
          insurancePaid: sessionBilling.insurancePaidAmount,
          clientPaid: sessionBilling.clientPaidAmount,
          totalAmount: sessionBilling.totalAmount,
          discountAmount: sessionBilling.discountAmount,
        })
        .from(sessionBilling)
        .where(eq(sessionBilling.id, line.matchedSessionBillingId))
        .limit(1);
      if (!billing) continue;
      const currentInsurance = Number(billing.insurancePaid) || 0;
      const currentClient = Number(billing.clientPaid) || 0;
      const expected = Math.max(
        0,
        Number(billing.totalAmount || 0) - Number(billing.discountAmount || 0),
      );

      // ── Duplicate-payment guard ──────────────────────────────────────────
      // The earlier guard (below) only stops the SAME insurance payment from
      // being counted twice. It does NOT see a payment that was already recorded
      // on the CLIENT side. So when staff already keyed a client payment that
      // fully covers the session, posting this insurance line on top would
      // silently DOUBLE collections (client paid + insurance paid), which then
      // inflates therapist pay. That is the same money paid once, recorded twice.
      //
      // Detect it: there is an existing client payment AND adding this insurer
      // amount would push total collected ABOVE what the session is expected to
      // collect. In that case skip the line (record nothing) and mark it
      // 'skipped' so a human can review/reconcile it instead of it silently
      // double-counting. Sessions with NO client payment are untouched, so a
      // genuine insurer over-payment (no client side) still posts as before.
      const wouldAdd = Math.max(0, +(lineAmount - currentInsurance).toFixed(2));
      const wouldCollect = +(currentClient + currentInsurance + wouldAdd).toFixed(2);
      if (wouldAdd > 0 && currentClient > 0 && wouldCollect > expected + 0.01) {
        await lockTx
          .update(insuranceStatementLines)
          .set({ matchStatus: 'skipped', postedAmount: '0.00' })
          .where(eq(insuranceStatementLines.id, line.id));
        skippedDuplicates += 1;
        continue;
      }

      const manualRows = await lockTx
        .select({ id: paymentTransactions.id, amt: paymentTransactions.amount })
        .from(paymentTransactions)
        .where(
          and(
            eq(paymentTransactions.sessionBillingId, line.matchedSessionBillingId),
            eq(paymentTransactions.source, 'insurance'),
            isNull(paymentTransactions.sourceStatementLineId),
            isNull(paymentTransactions.adoptedByLineId),
            isNull(paymentTransactions.voidedAt),
          ),
        )
        .orderBy(asc(paymentTransactions.recordedAt));

      let remaining = lineAmount;
      const adoptIds: number[] = [];
      for (const r of manualRows) {
        if (remaining <= 0) break;
        adoptIds.push(r.id);
        remaining = +(remaining - (Number(r.amt) || 0)).toFixed(2);
      }
      if (adoptIds.length > 0) {
        await lockTx
          .update(paymentTransactions)
          .set({ adoptedByLineId: line.id })
          .where(inArray(paymentTransactions.id, adoptIds));
      }

      // Shortfall = the amount this line adds ON TOP of insurance already counted
      // on the billing (manual rows just adopted are already in `currentInsurance`,
      // as is anything an earlier statement posted). Never negative: dedup only
      // ever prevents inflation, it never reduces a previously recorded amount.
      const additional = +Math.max(0, +(lineAmount - currentInsurance).toFixed(2)).toFixed(2);

      // Only add the shortfall to the billing's cumulative insurance. When the
      // billing already covers the line (manual entry or an earlier statement),
      // `additional` is 0 and nothing new is recorded — the duplicate is prevented.
      if (additional > 0) {
        const newCumulative = +(currentInsurance + additional).toFixed(2);

        await this.recordPayment(line.matchedSessionBillingId, {
          status: 'paid',
          amount: newCumulative,
          date: paymentDate,
          method: 'insurance',
          source: 'insurance',
          reference: statement.checkNumber || undefined,
          notes: `Insurance statement #${statement.id}${statement.payerName ? ` (${statement.payerName})` : ''}`,
          recordedBy: userId,
          sourceStatementId: statement.id,
          sourceStatementLineId: line.id,
        }, lockTx);
      }

      // postedAmount = the net-new amount actually added to the billing's
      // cumulative (the shortfall), so a later void subtracts exactly that and
      // leaves the adopted manual payment in place. postedTotal still reports the
      // statement's full insurer-paid amount for the user-facing summary.
      await lockTx
        .update(insuranceStatementLines)
        .set({ matchStatus: 'posted', postedAmount: additional.toFixed(2) })
        .where(eq(insuranceStatementLines.id, line.id));
      postedCount += 1;
      postedTotal = +(postedTotal + lineAmount).toFixed(2);
    }

    const [updated] = await lockTx
      .update(insuranceStatements)
      .set({ status: 'posted', postedAt: new Date(), postedBy: userId })
      .where(eq(insuranceStatements.id, id))
      .returning();

    return { statement: updated, postedCount, postedTotal, skippedDuplicates };
    });
  }

  async voidInsuranceStatement(id: number, userId: number, reason: string): Promise<InsuranceStatement> {
    // Run the whole void on ONE transaction under the SAME advisory lock that
    // post/delete/reverse take, so it serializes against a concurrent
    // post/reverse/delete on this statement (timing could otherwise corrupt the
    // billing balances). Passing lockTx to every read/write and every
    // recordPayment keeps it all on one pooled connection (pool max 2 dev / 5
    // prod) — opening a second connection mid-lock would risk a deadlock. Bonus:
    // void is now atomic.
    return await db.transaction(async (lockTx) => {
    await lockTx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('insurance_statement'), ${id})`);
    const [statement] = await lockTx
      .select()
      .from(insuranceStatements)
      .where(eq(insuranceStatements.id, id))
      .limit(1);
    if (!statement) throw new Error('Statement not found');
    if (statement.status === 'voided') throw new Error('Statement already voided.');

    const lines = await lockTx
      .select()
      .from(insuranceStatementLines)
      .where(eq(insuranceStatementLines.statementId, id));

    const paymentDate = new Date().toISOString().slice(0, 10);

    // Billings whose insurance coverage this void touches. After reversing this
    // statement's posted lines, we re-derive each affected billing's coverage
    // from the manual rows plus whatever OTHER statements remain posted, so a
    // surviving statement keeps the real payment reflected (see re-balance pass
    // below). Collect from every posted line, even $0 ones, so a billing whose
    // only contribution was a sibling statement is still re-evaluated.
    const affectedBillingIds = new Set<number>();

    for (const line of lines) {
      if (line.matchStatus !== 'posted') continue;
      if (line.matchedSessionBillingId) affectedBillingIds.add(line.matchedSessionBillingId);
      const posted = Number(line.postedAmount) || 0;
      if (line.matchedSessionBillingId && posted > 0) {
        // Reverse: subtract this line's payment from the billing's cumulative
        // insurance amount (never below zero).
        const [billing] = await lockTx
          .select({ insurancePaid: sessionBilling.insurancePaidAmount })
          .from(sessionBilling)
          .where(eq(sessionBilling.id, line.matchedSessionBillingId))
          .limit(1);
        if (billing) {
          const currentInsurance = Number(billing.insurancePaid) || 0;
          const newCumulative = Math.max(0, +(currentInsurance - posted).toFixed(2));
          await this.recordPayment(line.matchedSessionBillingId, {
            status: 'billed',
            amount: newCumulative,
            date: paymentDate,
            method: 'insurance',
            source: 'insurance',
            reference: statement.checkNumber || undefined,
            notes: `Void of insurance statement #${statement.id}: ${reason}`,
            recordedBy: userId,
            sourceStatementId: statement.id,
            sourceStatementLineId: line.id,
          }, lockTx);
        }
      }
      // Release any MANUAL payments this line had adopted, so they go back to
      // being unattributed manual payments and can be re-adopted if the statement
      // is re-posted. (Statement-created shortfall rows carry sourceStatementLineId,
      // not adoptedByLineId, so they are untouched here and reversed via postedAmount
      // above.)
      await lockTx
        .update(paymentTransactions)
        .set({ adoptedByLineId: null })
        .where(eq(paymentTransactions.adoptedByLineId, line.id));

      // Move the line to the terminal 'reversed' state. A voided statement can
      // never be re-posted (postInsuranceStatement hard-blocks it); the only
      // re-post path is uploading a NEW statement. Leaving the line as
      // 'confirmed' made it look re-postable and was dead, misleading state, so
      // we mark it 'reversed' to reflect that its posting was undone. postedAmount
      // is cleared since nothing is posted anymore.
      await lockTx
        .update(insuranceStatementLines)
        .set({ matchStatus: 'reversed', postedAmount: null })
        .where(eq(insuranceStatementLines.id, line.id));
    }

    // ── Re-balance surviving statements ─────────────────────────────────────
    // Two statements can document the SAME real-world insurer payment for one
    // billing (a re-uploaded EOB, or one statement keyed manually then posted):
    // the FIRST to post records the money (postedAmount > 0); a later duplicate
    // posts a $0 shortfall because the billing already covers it. If the one
    // that actually posted the money is now voided, naively subtracting its
    // postedAmount wrongly drops the billing's collected insurance to $0 and
    // orphans the still-posted sibling, which is left documenting a payment the
    // billing no longer reflects.
    //
    // To fix that, after reversing this statement's lines, re-derive each
    // affected billing's insurance from the live manual rows plus whatever
    // statement lines REMAIN posted (excluding this just-voided statement),
    // re-distributing the shortfall across the survivors in post order exactly
    // like the original post did. The surviving statement re-absorbs the
    // coverage it documents (its postedAmount is restored), so collected stays
    // correct and a future void of that survivor reverses the right amount.
    for (const billingId of Array.from(affectedBillingIds)) {
      // Live manual insurance already counted on the billing. Statement-sourced
      // shortfall rows are represented by the posted lines' postedAmount below,
      // so they are excluded here to avoid double counting.
      const manualRows = await lockTx
        .select({ amt: paymentTransactions.amount })
        .from(paymentTransactions)
        .where(
          and(
            eq(paymentTransactions.sessionBillingId, billingId),
            eq(paymentTransactions.source, 'insurance'),
            isNull(paymentTransactions.sourceStatementLineId),
            isNull(paymentTransactions.voidedAt),
          ),
        );
      const manualSum = +manualRows
        .reduce((s, r) => s + (Number(r.amt) || 0), 0)
        .toFixed(2);

      // Posted lines that survive this void (their parent statement is NOT
      // voided), in post order so the shortfall re-distribution is deterministic
      // and matches how the original post built up the cumulative.
      const remaining = await lockTx
        .select({
          lineId: insuranceStatementLines.id,
          statementId: insuranceStatementLines.statementId,
          lineAmount: insuranceStatementLines.insurancePaidAmount,
        })
        .from(insuranceStatementLines)
        .innerJoin(
          insuranceStatements,
          eq(insuranceStatementLines.statementId, insuranceStatements.id),
        )
        .where(
          and(
            eq(insuranceStatementLines.matchedSessionBillingId, billingId),
            eq(insuranceStatementLines.matchStatus, 'posted'),
            ne(insuranceStatements.status, 'voided'),
          ),
        )
        .orderBy(asc(insuranceStatementLines.id));

      let running = manualSum;
      let ownerLineId: number | null = null;
      let ownerStatementId: number | null = null;
      let ownerShare = 0;
      for (const r of remaining) {
        const amt = Number(r.lineAmount) || 0;
        const newPosted = +Math.max(0, +(amt - running).toFixed(2)).toFixed(2);
        running = +(running + newPosted).toFixed(2);
        await lockTx
          .update(insuranceStatementLines)
          .set({ postedAmount: newPosted.toFixed(2) })
          .where(eq(insuranceStatementLines.id, r.lineId));
        // Track the survivor that re-absorbed the most coverage so the ledger
        // adjustment below can be attributed to a real surviving line (keeping
        // it out of the "manual insurance" duplicate guard and traceable).
        if (newPosted > ownerShare) {
          ownerShare = newPosted;
          ownerLineId = r.lineId;
          ownerStatementId = r.statementId;
        }
      }

      // Adjust the billing's cumulative insurance to the re-derived total. When
      // the voided statement was NOT the one holding the money (its sibling was),
      // `running` already equals the current value and nothing changes.
      const [bill] = await lockTx
        .select({ insurancePaid: sessionBilling.insurancePaidAmount })
        .from(sessionBilling)
        .where(eq(sessionBilling.id, billingId))
        .limit(1);
      if (bill) {
        const current = Number(bill.insurancePaid) || 0;
        if (Math.abs(current - running) > 0.005 && ownerLineId != null) {
          await this.recordPayment(billingId, {
            status: running > 0 ? 'paid' : 'billed',
            amount: running,
            date: paymentDate,
            method: 'insurance',
            source: 'insurance',
            reference: statement.checkNumber || undefined,
            notes: `Rebalance after voiding insurance statement #${statement.id}: surviving statement #${ownerStatementId} retains the payment`,
            recordedBy: userId,
            sourceStatementId: ownerStatementId ?? undefined,
            sourceStatementLineId: ownerLineId ?? undefined,
          }, lockTx);
        }
      }
    }

    const [updated] = await lockTx
      .update(insuranceStatements)
      .set({ status: 'voided', voidedAt: new Date(), voidedBy: userId, voidReason: reason })
      .where(eq(insuranceStatements.id, id))
      .returning();
    return updated;
    });
  }

  // Reverse a SINGLE posted line without voiding its whole statement. Undoes
  // just that one line's insurance payment (its postedAmount), releases any
  // manual payments it had adopted, marks the line terminal 'reversed', and
  // re-balances any sibling posted lines on the same billing — exactly like a
  // whole-statement void does per line, but scoped to one line. The parent
  // statement STAYS 'posted' so its other lines are untouched. The whole thing
  // runs on one transaction under the same advisory lock post/delete take, so it
  // serializes against a concurrent post/delete on that statement and never
  // needs a second pooled connection.
  async reverseStatementLine(
    lineId: number,
    userId: number,
    reason?: string,
  ): Promise<InsuranceStatementLine> {
    return await db.transaction(async (lockTx) => {
      // The lock key is the statement id, so read it first (without the lock),
      // take the lock, then re-read the line so a concurrent post/void/delete
      // that changed it is observed before we act.
      const [pre] = await lockTx
        .select({ statementId: insuranceStatementLines.statementId })
        .from(insuranceStatementLines)
        .where(eq(insuranceStatementLines.id, lineId))
        .limit(1);
      if (!pre) throw new Error('Statement line not found');
      await lockTx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtext('insurance_statement'), ${pre.statementId})`,
      );

      const [line] = await lockTx
        .select()
        .from(insuranceStatementLines)
        .where(eq(insuranceStatementLines.id, lineId))
        .limit(1);
      if (!line) throw new Error('Statement line not found');
      if (line.matchStatus !== 'posted') {
        throw new Error('Only a posted line can be reversed.');
      }

      const [statement] = await lockTx
        .select()
        .from(insuranceStatements)
        .where(eq(insuranceStatements.id, line.statementId))
        .limit(1);
      if (!statement) throw new Error('Statement not found');
      // Defensive: a posted line should only ever live on a posted statement,
      // but guard explicitly so a voided statement's line can never be reversed
      // (its money was already undone by the void).
      if (statement.status !== 'posted') {
        throw new Error('Only a line on a posted statement can be reversed.');
      }

      const paymentDate = new Date().toISOString().slice(0, 10);
      const billingId = line.matchedSessionBillingId;
      const posted = Number(line.postedAmount) || 0;
      const reasonText = (reason && reason.trim()) || 'Single-line reversal';

      // 1) Reverse this line's posted shortfall from the billing's cumulative
      //    insurance (never below zero) — same as void's per-line reversal.
      if (billingId && posted > 0) {
        const [billing] = await lockTx
          .select({ insurancePaid: sessionBilling.insurancePaidAmount })
          .from(sessionBilling)
          .where(eq(sessionBilling.id, billingId))
          .limit(1);
        if (billing) {
          const currentInsurance = Number(billing.insurancePaid) || 0;
          const newCumulative = Math.max(0, +(currentInsurance - posted).toFixed(2));
          await this.recordPayment(billingId, {
            status: 'billed',
            amount: newCumulative,
            date: paymentDate,
            method: 'insurance',
            source: 'insurance',
            reference: statement.checkNumber || undefined,
            notes: `Reverse line of insurance statement #${statement.id}: ${reasonText}`,
            recordedBy: userId,
            sourceStatementId: statement.id,
            sourceStatementLineId: line.id,
          }, lockTx);
        }
      }

      // 2) Release any MANUAL payments this line had adopted so they go back to
      //    unattributed manual payments (re-adoptable by a future post).
      await lockTx
        .update(paymentTransactions)
        .set({ adoptedByLineId: null })
        .where(eq(paymentTransactions.adoptedByLineId, line.id));

      // 3) Move the line to the terminal 'reversed' state, clearing postedAmount.
      const [updatedLine] = await lockTx
        .update(insuranceStatementLines)
        .set({ matchStatus: 'reversed', postedAmount: null })
        .where(eq(insuranceStatementLines.id, line.id))
        .returning();

      // 4) Re-balance surviving posted lines on the SAME billing. Releasing this
      //    line's coverage may let a sibling statement (that documented the same
      //    real-world payment with a $0 shortfall) re-absorb it, so collected
      //    insurance stays correct. Identical to void's re-balance pass, scoped
      //    to this one billing. The just-reversed line is excluded automatically
      //    because it's no longer 'posted'.
      if (billingId) {
        const manualRows = await lockTx
          .select({ amt: paymentTransactions.amount })
          .from(paymentTransactions)
          .where(
            and(
              eq(paymentTransactions.sessionBillingId, billingId),
              eq(paymentTransactions.source, 'insurance'),
              isNull(paymentTransactions.sourceStatementLineId),
              isNull(paymentTransactions.voidedAt),
            ),
          );
        const manualSum = +manualRows
          .reduce((s, r) => s + (Number(r.amt) || 0), 0)
          .toFixed(2);

        const remaining = await lockTx
          .select({
            lineId: insuranceStatementLines.id,
            statementId: insuranceStatementLines.statementId,
            lineAmount: insuranceStatementLines.insurancePaidAmount,
          })
          .from(insuranceStatementLines)
          .innerJoin(
            insuranceStatements,
            eq(insuranceStatementLines.statementId, insuranceStatements.id),
          )
          .where(
            and(
              eq(insuranceStatementLines.matchedSessionBillingId, billingId),
              eq(insuranceStatementLines.matchStatus, 'posted'),
              ne(insuranceStatements.status, 'voided'),
            ),
          )
          .orderBy(asc(insuranceStatementLines.id));

        let running = manualSum;
        let ownerLineId: number | null = null;
        let ownerStatementId: number | null = null;
        let ownerShare = 0;
        for (const r of remaining) {
          const amt = Number(r.lineAmount) || 0;
          const newPosted = +Math.max(0, +(amt - running).toFixed(2)).toFixed(2);
          running = +(running + newPosted).toFixed(2);
          await lockTx
            .update(insuranceStatementLines)
            .set({ postedAmount: newPosted.toFixed(2) })
            .where(eq(insuranceStatementLines.id, r.lineId));
          if (newPosted > ownerShare) {
            ownerShare = newPosted;
            ownerLineId = r.lineId;
            ownerStatementId = r.statementId;
          }
        }

        const [bill] = await lockTx
          .select({ insurancePaid: sessionBilling.insurancePaidAmount })
          .from(sessionBilling)
          .where(eq(sessionBilling.id, billingId))
          .limit(1);
        if (bill) {
          const current = Number(bill.insurancePaid) || 0;
          if (Math.abs(current - running) > 0.005 && ownerLineId != null) {
            await this.recordPayment(billingId, {
              status: running > 0 ? 'paid' : 'billed',
              amount: running,
              date: paymentDate,
              method: 'insurance',
              source: 'insurance',
              reference: statement.checkNumber || undefined,
              notes: `Rebalance after reversing a line of insurance statement #${statement.id}: surviving statement #${ownerStatementId} retains the payment`,
              recordedBy: userId,
              sourceStatementId: ownerStatementId ?? undefined,
              sourceStatementLineId: ownerLineId ?? undefined,
            }, lockTx);
          }
        }
      }

      return updatedLine;
    });
  }

  async deleteInsuranceStatement(id: number): Promise<void> {
    await db.transaction(async (tx) => {
      // Serialize against a concurrent post on the SAME statement. post() holds
      // the matching transaction-scoped advisory lock on this key for its whole
      // run; taking it here makes delete wait until any in-flight post has fully
      // committed (status now 'posted') before we read state, so we can never
      // delete a statement that's mid-post.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('insurance_statement'), ${id})`);
      // Belt-and-suspenders: also lock the row FOR UPDATE so the status read
      // below reflects any just-committed change.
      const [statement] = await tx
        .select()
        .from(insuranceStatements)
        .where(eq(insuranceStatements.id, id))
        .limit(1)
        .for('update');
      if (!statement) throw new Error('Statement not found');
      // A posted statement has recorded insurance payments against billings.
      // Deleting it directly would leave those balances inflated, so require a
      // void first (which reverses the payments) before deletion is allowed.
      if (statement.status === 'posted') {
        throw new Error('A posted statement must be voided before it can be deleted.');
      }

      // Detach payment-ledger references so the statement (and its
      // cascade-deleted lines) can be removed without tripping FK constraints.
      // Balances are unaffected: a draft never posted any payment, and a voided
      // statement's payments were already reversed — we only drop the now-stale
      // links from the surviving ledger rows.
      const lineRows = await tx
        .select({ id: insuranceStatementLines.id })
        .from(insuranceStatementLines)
        .where(eq(insuranceStatementLines.statementId, id));
      const lineIds = lineRows.map((r) => r.id);
      if (lineIds.length) {
        await tx
          .update(paymentTransactions)
          .set({ sourceStatementLineId: null })
          .where(inArray(paymentTransactions.sourceStatementLineId, lineIds));
        await tx
          .update(paymentTransactions)
          .set({ adoptedByLineId: null })
          .where(inArray(paymentTransactions.adoptedByLineId, lineIds));
      }
      await tx
        .update(paymentTransactions)
        .set({ sourceStatementId: null })
        .where(eq(paymentTransactions.sourceStatementId, id));

      // Lines are removed automatically via the statementId FK cascade.
      await tx.delete(insuranceStatements).where(eq(insuranceStatements.id, id));
    });
  }

  async reopenInsuranceStatement(id: number, userId: number): Promise<InsuranceStatement> {
    const [statement] = await db
      .select()
      .from(insuranceStatements)
      .where(eq(insuranceStatements.id, id))
      .limit(1);
    if (!statement) throw new Error('Statement not found');
    if (statement.status !== 'voided') {
      throw new Error('Only a voided statement can be re-opened.');
    }

    const lines = await db
      .select()
      .from(insuranceStatementLines)
      .where(eq(insuranceStatementLines.statementId, id));

    // Move the lines that voiding sent to the terminal 'reversed' state back to a
    // re-postable state, clearing the frozen postedAmount so the next post
    // recomputes the shortfall from scratch through the adoption guard. A
    // 'reversed' line that still points at a billing returns to 'confirmed' (ready
    // to re-post); one with no billing target falls back to 'unmatched' so it can
    // be re-matched first. Lines that were never posted are left untouched.
    for (const line of lines) {
      if (line.matchStatus !== 'reversed') continue;
      const nextStatus = line.matchedSessionBillingId ? 'confirmed' : 'unmatched';
      await db
        .update(insuranceStatementLines)
        .set({ matchStatus: nextStatus, postedAmount: null })
        .where(eq(insuranceStatementLines.id, line.id));
    }

    // Clear the void bookkeeping and return the statement to a re-postable
    // 'draft'. Re-posting then runs the normal adoption-aware flow, so the
    // double-count guard still prevents collected from re-stacking.
    const [updated] = await db
      .update(insuranceStatements)
      .set({ status: 'draft', voidedAt: null, voidedBy: null, voidReason: null })
      .where(eq(insuranceStatements.id, id))
      .returning();
    return updated;
  }

  // Enhanced Task Management Methods
  async getAllTasks(params?: TaskQueryParams): Promise<{
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

    // Date filtering conditions
    if (params?.dueDateFrom) {
      conditions.push(gte(tasks.dueDate, params.dueDateFrom));
    }
    
    if (params?.dueDateTo) {
      const endOfDay = new Date(params.dueDateTo);
      endOfDay.setHours(23, 59, 59, 999);
      conditions.push(lte(tasks.dueDate, endOfDay));
    }
    
    if (params?.createdDateFrom) {
      conditions.push(gte(tasks.createdAt, params.createdDateFrom));
    }
    
    if (params?.createdDateTo) {
      const endOfDay = new Date(params.createdDateTo);
      endOfDay.setHours(23, 59, 59, 999);
      conditions.push(lte(tasks.createdAt, endOfDay));
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

    // Apply same simple filtering logic as sessions - therapist sees only their assigned tasks
    const conditions = [];
    
    if (therapistId) {
      // Therapist sees only tasks assigned to them (same logic as sessions)
      conditions.push(eq(tasks.assignedToId, therapistId));
    } else if (supervisedTherapistIds && supervisedTherapistIds.length > 0) {
      // Supervisor sees tasks assigned to supervised therapists
      conditions.push(inArray(tasks.assignedToId, supervisedTherapistIds));
    }

    if (conditions.length > 0) {
      query = query.where(and(...conditions));
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
  async getNotesByClient(params: NoteQueryParams): Promise<(Note & { author: User })[]> {
    const conditions = [eq(notes.clientId, params.clientId)];
    
    if (params.noteType) {
      conditions.push(eq(notes.noteType, params.noteType));
    }
    
    if (params.startDate) {
      conditions.push(gte(notes.eventDate, params.startDate));
    }
    
    if (params.endDate) {
      conditions.push(lte(notes.eventDate, params.endDate));
    }
    
    const results = await db
      .select({
        note: notes,
        author: users
      })
      .from(notes)
      .innerJoin(users, eq(notes.authorId, users.id))
      .where(and(...conditions))
      .orderBy(desc(notes.eventDate), desc(notes.createdAt));

    return results.map(r => ({ ...r.note, author: r.author }));
  }

  async getNote(id: number): Promise<(Note & { author: User }) | undefined> {
    const results = await db
      .select({
        note: notes,
        author: users
      })
      .from(notes)
      .innerJoin(users, eq(notes.authorId, users.id))
      .where(eq(notes.id, id));

    if (results.length === 0) return undefined;
    
    const r = results[0];
    return { ...r.note, author: r.author };
  }

  async createNote(note: InsertNote & { authorId: number }): Promise<Note> {
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
  async getDocumentsByClient(clientId: number): Promise<(Document & { uploadedBy: User | null })[]> {
    const results = await db
      .select({
        document: documents,
        uploadedBy: users
      })
      .from(documents)
      .leftJoin(users, eq(documents.uploadedById, users.id))
      .where(eq(documents.clientId, clientId))
      .orderBy(desc(documents.createdAt));

    return results.map(r => ({ 
      ...r.document, 
      uploadedBy: r.uploadedBy || null
    }));
  }

  async createDocument(document: InsertDocument): Promise<Document> {
    const [newDocument] = await db
      .insert(documents)
      .values(document)
      .returning();
    return newDocument;
  }

  async updateDocument(id: number, document: Partial<InsertDocument>): Promise<Document> {
    const [updatedDocument] = await db
      .update(documents)
      .set(document)
      .where(eq(documents.id, id))
      .returning();
    return updatedDocument;
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

  async getSessionNotesByClient(clientId: number): Promise<(SessionNote & { therapist: User; session: Omit<Session, 'room'> & { room?: SelectRoom | null } })[]> {
    const results = await db
      .select({
        sessionNote: sessionNotes,
        therapist: users,
        session: sessions,
        room: rooms
      })
      .from(sessionNotes)
      .innerJoin(users, eq(sessionNotes.therapistId, users.id))
      .innerJoin(sessions, eq(sessionNotes.sessionId, sessions.id))
      .leftJoin(rooms, eq(sessions.roomId, rooms.id))
      .where(eq(sessionNotes.clientId, clientId))
      .orderBy(desc(sessionNotes.createdAt));

    return results.map(r => {
      const { room: _legacyRoom, ...sessionData } = r.session;
      return {
        ...r.sessionNote,
        therapist: r.therapist,
        session: {
          ...sessionData,
          room: r.room || null
        }
      };
    });
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

  async getSessionNote(id: number): Promise<(SessionNote & { therapist: User & { profile?: UserProfile | null }; client: Client; session: Omit<Session, 'room'> & { room?: SelectRoom | null } }) | undefined> {
    const results = await db
      .select({
        sessionNote: sessionNotes,
        therapist: users,
        userProfile: userProfiles,
        client: clients,
        session: sessions,
        room: rooms
      })
      .from(sessionNotes)
      .innerJoin(users, eq(sessionNotes.therapistId, users.id))
      .leftJoin(userProfiles, eq(users.id, userProfiles.userId))
      .innerJoin(clients, eq(sessionNotes.clientId, clients.id))
      .innerJoin(sessions, eq(sessionNotes.sessionId, sessions.id))
      .leftJoin(rooms, eq(sessions.roomId, rooms.id))
      .where(eq(sessionNotes.id, id));

    if (results.length === 0) return undefined;
    
    const r = results[0];
    return { 
      ...r.sessionNote, 
      therapist: {
        ...r.therapist,
        profile: r.userProfile || null
      }, 
      client: r.client, 
      session: {
        ...r.session,
        room: r.room || null
      }
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

    // Only sort by sortOrder - let frontend handle natural title sorting
    const results = await query.orderBy(asc(libraryEntries.sortOrder));
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

    // Only sort by usageCount - let frontend handle natural title sorting
    const results = await dbQuery.orderBy(desc(libraryEntries.usageCount));
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

  async deleteAllLibraryEntryConnections(entryId: number): Promise<void> {
    await db.delete(libraryEntryConnections).where(
      or(
        eq(libraryEntryConnections.fromEntryId, entryId),
        eq(libraryEntryConnections.toEntryId, entryId)
      )
    );
  }

  async getConnectedEntries(entryId: number): Promise<(LibraryEntry & { connectionType: string; connectionStrength: number; connectionId: number; category: LibraryCategory })[]> {
    const results = await db
      .select({
        entry: libraryEntries,
        category: libraryCategories,
        connectionId: libraryEntryConnections.id,
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
      connectionId: result.connectionId!,
      connectionType: result.connectionType!,
      connectionStrength: result.connectionStrength! 
    }));
  }

  // Assessment Templates Management
  async getAssessmentTemplates(): Promise<(AssessmentTemplate & { createdBy: User | null; sectionsCount: number })[]> {
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
  
  /**
   * Normalize option IDs to numbers for consistent typing across the application.
   * Drizzle ORM sometimes returns IDs as strings, causing type mismatches.
   * This helper ensures all option data uses numeric IDs.
   * Handles edge cases: null, undefined, NaN, and invalid data gracefully.
   */
  private normalizeOptionIds(options: any[]): AssessmentQuestionOption[] {
    if (!options || !Array.isArray(options) || options.length === 0) {
      return [];
    }
    
    return options
      .filter(opt => opt && opt.id != null) // Filter out null/undefined entries
      .map(opt => {
        // Safely convert ID to number
        let normalizedId = opt.id;
        if (typeof opt.id === 'string') {
          const parsed = parseInt(opt.id, 10);
          normalizedId = isNaN(parsed) ? opt.id : parsed;
        }
        
        // Safely convert questionId to number
        let normalizedQuestionId = opt.questionId;
        if (typeof opt.questionId === 'string') {
          const parsed = parseInt(opt.questionId, 10);
          normalizedQuestionId = isNaN(parsed) ? opt.questionId : parsed;
        }
        
        return {
          ...opt,
          id: normalizedId,
          questionId: normalizedQuestionId
        };
      });
  }
  
  async createAssessmentQuestionOption(optionData: InsertAssessmentQuestionOption): Promise<AssessmentQuestionOption> {
    const [option] = await db
      .insert(assessmentQuestionOptions)
      .values(optionData)
      .returning();
    return this.normalizeOptionIds([option])[0];
  }

  async createAssessmentQuestionOptionsBulk(options: InsertAssessmentQuestionOption[]): Promise<AssessmentQuestionOption[]> {
    if (options.length === 0) return [];
    
    const createdOptions = await db
      .insert(assessmentQuestionOptions)
      .values(options)
      .returning();
    return this.normalizeOptionIds(createdOptions);
  }

  async getAssessmentQuestionOptions(questionId: number): Promise<AssessmentQuestionOption[]> {
    const options = await db
      .select()
      .from(assessmentQuestionOptions)
      .where(eq(assessmentQuestionOptions.questionId, questionId))
      .orderBy(asc(assessmentQuestionOptions.sortOrder));
    return this.normalizeOptionIds(options);
  }

  async updateAssessmentQuestionOption(id: number, optionData: Partial<InsertAssessmentQuestionOption>): Promise<AssessmentQuestionOption> {
    const [option] = await db
      .update(assessmentQuestionOptions)
      .set(optionData)
      .where(eq(assessmentQuestionOptions.id, id))
      .returning();
    return this.normalizeOptionIds([option])[0];
  }

  async deleteAssessmentQuestionOption(id: number): Promise<void> {
    await db.delete(assessmentQuestionOptions).where(eq(assessmentQuestionOptions.id, id));
  }

  async deleteAllAssessmentQuestionOptions(questionId: number): Promise<void> {
    await db.delete(assessmentQuestionOptions).where(eq(assessmentQuestionOptions.questionId, questionId));
  }

  async checkOptionHasResponses(optionId: number): Promise<boolean> {
    const responses = await db
      .select({ id: assessmentResponses.id })
      .from(assessmentResponses)
      .where(sql`${optionId} = ANY(${assessmentResponses.selectedOptions})`)
      .limit(1);
    return responses.length > 0;
  }

  async checkQuestionHasResponses(questionId: number): Promise<boolean> {
    const responses = await db
      .select({ id: assessmentResponses.id })
      .from(assessmentResponses)
      .where(eq(assessmentResponses.questionId, questionId))
      .limit(1);
    return responses.length > 0;
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
            const rawOptions = await db
              .select()
              .from(assessmentQuestionOptions)
              .where(eq(assessmentQuestionOptions.questionId, q.id))
              .orderBy(asc(assessmentQuestionOptions.sortOrder));
            
            // Normalize option IDs to ensure consistent number types
            const options = this.normalizeOptionIds(rawOptions);

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
              scoreValues: options.map(opt => Number(opt.optionValue) || 0),
              allOptions: options  // CRITICAL: Include full option objects for proper ID-based saves
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

  // Normalize selectedOptions from legacy indices to option IDs
  private async normalizeSelectedOptions(questionId: number, selectedOptions: number[]): Promise<number[]> {
    if (!selectedOptions || selectedOptions.length === 0) {
      return selectedOptions;
    }

    // Get all options for this question
    const allOptions = await db
      .select()
      .from(assessmentQuestionOptions)
      .where(eq(assessmentQuestionOptions.questionId, questionId))
      .orderBy(assessmentQuestionOptions.sortOrder);

    if (allOptions.length === 0) {
      return selectedOptions;
    }

    // Check if values are already option IDs (they match existing option IDs)
    // Convert both to numbers for proper comparison (Drizzle may return IDs as strings)
    const optionIds = allOptions.map(opt => Number(opt.id));
    const numericValues = selectedOptions.map(val => Number(val));
    const allAreIds = numericValues.every(val => optionIds.includes(val));
    
    if (allAreIds) {
      // Already normalized option IDs, return as numbers
      return numericValues;
    }

    // Legacy format detected: convert indices/score values to option IDs
    const normalized: number[] = [];
    
    for (const value of numericValues) {
      // Try to match by sort order (for index-based)
      let matched = allOptions.find(opt => (opt.sortOrder ?? 0) === value);
      
      // If not found, try to match by score value (for BDI-II where scores are 0,1,2,3)
      if (!matched) {
        matched = allOptions.find(opt => Number(opt.optionValue) === value);
      }
      
      if (matched) {
        normalized.push(matched.id);
      } else {
        // If still not matched and value is a valid array index, use it
        if (value >= 0 && value < allOptions.length) {
          normalized.push(allOptions[value].id);
        }
      }
    }

    return normalized;
  }

  // Save or update assessment response using atomic upsert
  async saveAssessmentResponse(responseData: any): Promise<AssessmentResponse> {
    // Normalize selectedOptions from legacy indices to option IDs if needed
    if (responseData.selectedOptions) {
      responseData.selectedOptions = await this.normalizeSelectedOptions(
        responseData.questionId,
        responseData.selectedOptions
      );
    }

    // Calculate score value for this response
    const scoreValue = await this.calculateResponseScore(responseData);

    // Use atomic upsert with ON CONFLICT to handle concurrent requests safely
    const [savedResponse] = await db
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
      .onConflictDoUpdate({
        target: [assessmentResponses.assignmentId, assessmentResponses.questionId, assessmentResponses.responderId],
        set: {
          responseText: responseData.responseText,
          selectedOptions: responseData.selectedOptions,
          ratingValue: responseData.ratingValue,
          scoreValue: scoreValue !== null ? scoreValue.toString() : null,
          updatedAt: new Date()
        }
      })
      .returning();

    // Update the overall assessment total score
    await this.updateAssessmentTotalScore(responseData.assignmentId);

    return savedResponse;
  }

  // Calculate score value for an individual response
  async calculateResponseScore(responseData: any): Promise<number | null> {
    // Get the question AND its section to check if it contributes to scoring
    const [result] = await db
      .select({
        question: assessmentQuestions,
        section: assessmentSections
      })
      .from(assessmentQuestions)
      .leftJoin(assessmentSections, eq(assessmentQuestions.sectionId, assessmentSections.id))
      .where(eq(assessmentQuestions.id, responseData.questionId));

    if (!result || !result.question) {
      return null;
    }

    // Check if scoring is enabled: either question.contributesToScore OR section.isScoring
    const shouldScore = result.question.contributesToScore || result.section?.isScoring;
    if (!shouldScore) {
      return null; // Neither question nor section enables scoring
    }

    // For multiple choice/checkbox questions - use option values
    if (responseData.selectedOptions && responseData.selectedOptions.length > 0) {
      // selectedOptions contains OPTION IDs from the frontend (not indices)
      // Convert to numbers to ensure type safety
      const optionIds = responseData.selectedOptions.map((id: any) => Number(id));
      
      // Get the selected options by their IDs
      const selectedOptions = await db
        .select()
        .from(assessmentQuestionOptions)
        .where(
          and(
            eq(assessmentQuestionOptions.questionId, responseData.questionId),
            inArray(assessmentQuestionOptions.id, optionIds)
          )
        );

      // Sum up the values from selected options
      let totalScore = 0;
      for (const option of selectedOptions) {
        if (option && option.optionValue !== null) {
          totalScore += Number(option.optionValue) || 0;
        }
      }

      return totalScore;
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

    if (results.length === 0) {
      return [];
    }

    // DEDUPLICATE: Keep the BEST response per question (prefers data over empty)
    // Priority: response with data > empty response, then use timestamp as tiebreaker
    const latestResponsesByQuestion = new Map<number, typeof results[0]>();
    
    const hasData = (resp: any): boolean => {
      return (resp.selectedOptions && resp.selectedOptions.length > 0) || 
             resp.responseText || 
             (resp.scoreValue !== null && resp.scoreValue !== undefined);
    };
    
    for (const result of results) {
      const questionId = result.assessment_responses.questionId;
      const existing = latestResponsesByQuestion.get(questionId);
      
      if (!existing) {
        latestResponsesByQuestion.set(questionId, result);
      } else {
        const newHasData = hasData(result.assessment_responses);
        const existingHasData = hasData(existing.assessment_responses);
        
        if (newHasData && !existingHasData) {
          // New has data, existing is empty → use new
          latestResponsesByQuestion.set(questionId, result);
        } else if (!newHasData && existingHasData) {
          // New is empty, existing has data → keep existing (do nothing)
        } else {
          // Both have data OR both empty → use most recent
          if (result.assessment_responses.createdAt! > existing.assessment_responses.createdAt!) {
            latestResponsesByQuestion.set(questionId, result);
          }
        }
      }
    }
    
    // Convert back to array
    const deduplicatedResults = Array.from(latestResponsesByQuestion.values());

    // OPTIMIZATION: Load ALL question options in ONE query instead of N+1 queries
    // CRITICAL FIX: Convert question IDs to numbers for database query
    const questionIds = Array.from(new Set(deduplicatedResults.map(r => {
      const id = r.assessment_questions!.id;
      return typeof id === 'string' ? parseInt(id) : id;
    })));
    const rawOptions = await db
      .select()
      .from(assessmentQuestionOptions)
      .where(inArray(assessmentQuestionOptions.questionId, questionIds))
      .orderBy(asc(assessmentQuestionOptions.sortOrder));
    
    // Normalize option IDs using centralized helper
    const allOptions = this.normalizeOptionIds(rawOptions);

    // Group options by question ID for quick lookup
    // CRITICAL FIX: Convert option questionId to string to match question.id type
    const optionsByQuestion = new Map<string, any[]>();
    for (const option of allOptions) {
      const questionId = String(option.questionId);  // Convert to string to match question.id
      if (!optionsByQuestion.has(questionId)) {
        optionsByQuestion.set(questionId, []);
      }
      optionsByQuestion.get(questionId)!.push(option);
    }

    // Build responses with options (using deduplicated results)
    const responsesWithOptions = deduplicatedResults.map(result => {
      const question = result.assessment_questions!;
      const options = optionsByQuestion.get(question.id as any) || [];
      
      const questionWithOptions = {
        ...question,
        options: options.map(opt => opt.optionText),
        scoreValues: options.map(opt => Number(opt.optionValue) || 0),
        allOptions: options  // Already normalized by normalizeOptionIds helper
      };

      return {
        ...result.assessment_responses,
        question: questionWithOptions,
        responder: result.users!
      };
    });

    return responsesWithOptions;
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
    // First try to get the latest finalized report
    const [finalizedResult] = await db
      .select()
      .from(assessmentReports)
      .leftJoin(assessmentAssignments, eq(assessmentReports.assignmentId, assessmentAssignments.id))
      .leftJoin(users, eq(assessmentReports.createdById, users.id))
      .where(
        and(
          eq(assessmentReports.assignmentId, assignmentId),
          eq(assessmentReports.isFinalized, true)
        )
      )
      .orderBy(desc(assessmentReports.finalizedAt))
      .limit(1);

    if (finalizedResult) {
      return {
        ...finalizedResult.assessment_reports,
        assignment: finalizedResult.assessment_assignments!,
        createdBy: finalizedResult.users!
      };
    }

    // If no finalized report, get the latest draft
    const [draftResult] = await db
      .select()
      .from(assessmentReports)
      .leftJoin(assessmentAssignments, eq(assessmentReports.assignmentId, assessmentAssignments.id))
      .leftJoin(users, eq(assessmentReports.createdById, users.id))
      .where(eq(assessmentReports.assignmentId, assignmentId))
      .orderBy(desc(assessmentReports.generatedAt))
      .limit(1);

    if (!draftResult) return undefined;

    return {
      ...draftResult.assessment_reports,
      assignment: draftResult.assessment_assignments!,
      createdBy: draftResult.users!
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

  // Update assessment report draft content (matching session notes pattern)
  async updateAssessmentReportDraft(assignmentId: number, draftContent: string): Promise<AssessmentReport> {
    const [report] = await db
      .update(assessmentReports)
      .set({ 
        draftContent,
        editedAt: new Date(),
        isDraft: true
      })
      .where(eq(assessmentReports.assignmentId, assignmentId))
      .returning();
    return report;
  }

  // Get assessment report by ID (for finalization)
  async getAssessmentReportById(id: number): Promise<AssessmentReport | undefined> {
    const [report] = await db
      .select()
      .from(assessmentReports)
      .where(eq(assessmentReports.id, id));
    return report || undefined;
  }

  // ===== Report Templates =====
  async getReportTemplates(includeInactive = false): Promise<(ReportTemplate & { createdBy?: User })[]> {
    const rows = await db
      .select()
      .from(reportTemplates)
      .leftJoin(users, eq(reportTemplates.createdById, users.id))
      .where(includeInactive ? undefined : eq(reportTemplates.isActive, true))
      .orderBy(desc(reportTemplates.createdAt));
    return rows.map((r) => ({ ...r.report_templates, createdBy: r.users || undefined }));
  }

  async getReportTemplate(id: number): Promise<ReportTemplate | undefined> {
    const [template] = await db
      .select()
      .from(reportTemplates)
      .where(eq(reportTemplates.id, id));
    return template || undefined;
  }

  async createReportTemplate(template: InsertReportTemplate): Promise<ReportTemplate> {
    const [created] = await db.insert(reportTemplates).values(template).returning();
    return created;
  }

  async updateReportTemplate(id: number, template: Partial<InsertReportTemplate>): Promise<ReportTemplate> {
    const [updated] = await db
      .update(reportTemplates)
      .set({ ...template, updatedAt: new Date() })
      .where(eq(reportTemplates.id, id))
      .returning();
    return updated;
  }

  async deleteReportTemplate(id: number): Promise<void> {
    await db.delete(reportTemplates).where(eq(reportTemplates.id, id));
  }

  // ===== Report Supporting Files =====
  async getReportSupportingFilesByClient(clientId: number): Promise<ReportSupportingFile[]> {
    return db
      .select()
      .from(reportSupportingFiles)
      .where(eq(reportSupportingFiles.clientId, clientId))
      .orderBy(desc(reportSupportingFiles.createdAt));
  }

  async getReportSupportingFile(id: number): Promise<ReportSupportingFile | undefined> {
    const [file] = await db
      .select()
      .from(reportSupportingFiles)
      .where(eq(reportSupportingFiles.id, id));
    return file || undefined;
  }

  async createReportSupportingFile(file: InsertReportSupportingFile): Promise<ReportSupportingFile> {
    const [created] = await db.insert(reportSupportingFiles).values(file).returning();
    return created;
  }

  async updateReportSupportingFile(id: number, file: Partial<InsertReportSupportingFile>): Promise<ReportSupportingFile> {
    const [updated] = await db
      .update(reportSupportingFiles)
      .set(file)
      .where(eq(reportSupportingFiles.id, id))
      .returning();
    return updated;
  }

  async deleteReportSupportingFile(id: number): Promise<void> {
    await db.delete(reportSupportingFiles).where(eq(reportSupportingFiles.id, id));
  }

  // ===== Client Reports =====
  async getClientReports(clientId: number): Promise<(ClientReport & { createdBy?: User; template?: ReportTemplate })[]> {
    const rows = await db
      .select()
      .from(clientReports)
      .leftJoin(users, eq(clientReports.createdById, users.id))
      .leftJoin(reportTemplates, eq(clientReports.templateId, reportTemplates.id))
      .where(eq(clientReports.clientId, clientId))
      .orderBy(desc(clientReports.generatedAt));
    return rows.map((r) => ({
      ...r.client_reports,
      createdBy: r.users || undefined,
      template: r.report_templates || undefined,
    }));
  }

  async getClientReport(id: number): Promise<(ClientReport & { client?: Client; createdBy?: (User & { profile?: UserProfile | null }); template?: ReportTemplate }) | undefined> {
    const [row] = await db
      .select()
      .from(clientReports)
      .leftJoin(clients, eq(clientReports.clientId, clients.id))
      .leftJoin(users, eq(clientReports.createdById, users.id))
      .leftJoin(userProfiles, eq(users.id, userProfiles.userId))
      .leftJoin(reportTemplates, eq(clientReports.templateId, reportTemplates.id))
      .where(eq(clientReports.id, id));
    if (!row) return undefined;
    return {
      ...row.client_reports,
      client: row.clients || undefined,
      createdBy: row.users ? { ...row.users, profile: row.user_profiles || null } : undefined,
      template: row.report_templates || undefined,
    };
  }

  async createClientReport(report: InsertClientReport): Promise<ClientReport> {
    const [created] = await db.insert(clientReports).values(report).returning();
    return created;
  }

  async updateClientReport(id: number, report: Partial<InsertClientReport>): Promise<ClientReport> {
    const [updated] = await db
      .update(clientReports)
      .set(report)
      .where(eq(clientReports.id, id))
      .returning();
    return updated;
  }

  async deleteClientReport(id: number): Promise<void> {
    await db.delete(clientReports).where(eq(clientReports.id, id));
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
            scoreValues: options.map(opt => Number(opt.optionValue) || 0),
            allOptions: options  // Include full option objects for AI report generation
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
    // Get session, service, and client information
    const [sessionData] = await db.select({
      session: sessions,
      service: services,
      client: clients
    })
    .from(sessions)
    .leftJoin(services, eq(sessions.serviceId, services.id))
    .leftJoin(clients, eq(sessions.clientId, clients.id))
    .where(eq(sessions.id, sessionId));
    
    if (!sessionData || !sessionData.session) {
      throw new Error('Session not found');
    }
    
    if (!sessionData.service) {
      // Skip billing for sessions without service information
      return null;
    }
    
    const profileCopay = sessionData.client?.copayAmount;
    const hasCopay = profileCopay != null && Number(profileCopay) > 0;
    const hasInsurance = !!(sessionData.client?.insuranceProvider) || hasCopay;
    // When insured but no profile copay set, default to '0' so the split is always known
    // (client owes $0, insurance covers full). Prevents the dialog from falling back to
    // "client owes full amount" for bills with NULL copay.
    const copayAmount = hasInsurance ? (profileCopay ?? '0') : null;
    
    // Create billing record with client insurance information
    const units = 1;
    const ratePerUnit = sessionData.service.baseRate;
    const billingData: InsertSessionBilling = {
      sessionId: sessionId,
      serviceCode: sessionData.service.serviceCode,
      units: units,
      ratePerUnit: ratePerUnit,
      totalAmount: (parseFloat(ratePerUnit) * units).toFixed(2),
      insuranceCovered: hasInsurance,
      copayAmount: copayAmount,
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
    supervisedTherapistIds?: number[];
    status?: string;
    serviceCode?: string;
    clientSearch?: string;
    clientType?: string;
    sessionStatus?: string;
  }): Promise<any[]> {
    // Special case: list every session that was NEVER billed (no session_billing
    // row at all) so practice owners can see exactly what fell through the cracks
    // across ALL therapists/clients/months in one place. Money columns don't
    // exist for these (no fee is established until a session is billed), so the
    // row is returned with `billing: null` and the frontend renders it plainly.
    if (params.status === 'not_billed') {
      // A 'scheduled' session in the FUTURE simply hasn't happened yet — it can
      // still be billed when it's completed, so it is NOT a billing gap and we
      // exclude it (otherwise hundreds of upcoming appointments would drown the
      // list). But a scheduled session whose date has already passed and was
      // never progressed IS a real gap that fell through the cracks, so we keep
      // those alongside completed / cancelled / rescheduled / no-show sessions.
      const ubConditions: any[] = [
        isNull(sessionBilling.id),
        sql`NOT (${sessions.status} = 'scheduled' AND ${sessions.sessionDate} >= now())`,
      ];
      if (params.startDate) {
        ubConditions.push(sql`DATE(${sessions.sessionDate}) >= ${params.startDate}`);
      }
      if (params.endDate) {
        ubConditions.push(sql`DATE(${sessions.sessionDate}) <= ${params.endDate}`);
      }
      if (params.supervisedTherapistIds && params.supervisedTherapistIds.length > 0) {
        ubConditions.push(inArray(sessions.therapistId, params.supervisedTherapistIds));
      } else if (params.therapistId) {
        ubConditions.push(eq(sessions.therapistId, params.therapistId));
      }
      if (params.clientSearch) {
        ubConditions.push(sql`LOWER(${clients.fullName}) LIKE LOWER(${'%' + params.clientSearch + '%'})`);
      }
      if (params.clientType) {
        ubConditions.push(eq(clients.clientType, params.clientType));
      }
      if (params.sessionStatus) {
        ubConditions.push(eq(sessions.status, params.sessionStatus as any));
      }
      if (params.serviceCode) {
        ubConditions.push(eq(services.serviceCode, params.serviceCode));
      }
      const ubResults = await db.select({
        billing: sessionBilling,
        session: sessions,
        client: clients,
        therapist: users,
        service: services,
      })
        .from(sessions)
        .leftJoin(sessionBilling, eq(sessionBilling.sessionId, sessions.id))
        .innerJoin(clients, eq(sessions.clientId, clients.id))
        .innerJoin(users, eq(sessions.therapistId, users.id))
        .leftJoin(services, eq(sessions.serviceId, services.id))
        .where(and(...ubConditions))
        .orderBy(desc(sessions.sessionDate));
      // On a left join with no match Drizzle still returns a billing object of
      // all-null columns; normalize it to a real null so the UI can branch on it.
      return ubResults.map((r: any) => ({ ...r, billing: null }));
    }

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
    
    if (params.supervisedTherapistIds && params.supervisedTherapistIds.length > 0) {
      conditions.push(inArray(sessions.therapistId, params.supervisedTherapistIds));
    } else if (params.therapistId) {
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

    if (params.sessionStatus) {
      conditions.push(eq(sessions.status, params.sessionStatus as any));
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
        
        // Use parameterized query with sql.identifier for safe dynamic table/column names
        await db.execute(sql`
          UPDATE ${sql.identifier(migration.table)} 
          SET ${sql.identifier(migration.column)} = ${newKey} 
          WHERE ${sql.identifier(migration.column)} = ${oldKey}
        `);
        
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
