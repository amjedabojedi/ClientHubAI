import { 
  pgTable, 
  text, 
  serial, 
  integer, 
  boolean, 
  timestamp, 
  decimal, 
  date,
  varchar,
  pgEnum,
  uuid,
  index
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod";

// Enums
export const clientStatusEnum = pgEnum('client_status', ['active', 'inactive', 'pending']);
export const clientStageEnum = pgEnum('client_stage', ['intake', 'assessment', 'psychotherapy']);
export const clientTypeEnum = pgEnum('client_type', ['individual', 'couple', 'family', 'group']);
export const sessionTypeEnum = pgEnum('session_type', ['assessment', 'psychotherapy', 'consultation']);
export const sessionStatusEnum = pgEnum('session_status', ['scheduled', 'completed', 'cancelled', 'no_show']);
export const serviceTypeEnum = pgEnum('service_type', ['individual_therapy', 'group_therapy', 'family_therapy', 'assessment', 'consultation']);
export const billingStatusEnum = pgEnum('billing_status', ['pending', 'billed', 'paid', 'denied', 'refunded']);
export const taskStatusEnum = pgEnum('task_status', ['pending', 'in_progress', 'completed', 'overdue']);
export const taskPriorityEnum = pgEnum('task_priority', ['low', 'medium', 'high', 'urgent']);
export const genderEnum = pgEnum('gender', ['male', 'female', 'non_binary', 'prefer_not_to_say']);

// Users/Therapists table
export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
  fullName: text("full_name").notNull(),
  email: text("email").notNull().unique(),
  role: text("role").notNull().default('therapist'),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Clients table with comprehensive fields and proper indexing for 5000+ records
export const clients = pgTable("clients", {
  id: serial("id").primaryKey(),
  clientId: varchar("client_id", { length: 20 }).notNull().unique(), // CL-2024-0001 format
  
  // Personal Information (Tab 1)
  fullName: text("full_name").notNull(), // Required field for client identification
  dateOfBirth: date("date_of_birth"), // Client's birth date
  gender: genderEnum("gender"), // Client's gender
  maritalStatus: varchar("marital_status", { length: 50 }), // Single, married, divorced, etc.
  preferredLanguage: varchar("preferred_language", { length: 50 }).default('English'), // Client's communication preference
  pronouns: varchar("pronouns", { length: 20 }),
  emailNotifications: boolean("email_notifications").notNull().default(true), // Whether client wants email updates
  
  // Client Portal Access
  hasPortalAccess: boolean("has_portal_access").notNull().default(false), // Portal Enabled - Whether client can access online portal
  portalEmail: text("portal_email"),
  portalPassword: varchar("portal_password", { length: 255 }), // Portal Password - Login credentials for portal (hashed)
  lastLogin: timestamp("last_login"), // Last Login - When client last accessed portal
  passwordResetToken: varchar("password_reset_token", { length: 255 }), // Password Reset Token - For portal password recovery
  activationToken: varchar("activation_token", { length: 255 }), // Activation Token - For initial portal setup
  
  // Contact & Address Information (Tab 2)
  phone: varchar("phone", { length: 20 }), // Primary contact number
  emergencyPhone: varchar("emergency_phone", { length: 20 }), // Backup contact number
  email: text("email"), // Email address (optional)
  streetAddress1: text("street_address_1"), // Primary address line
  streetAddress2: text("street_address_2"), // Apartment, suite, etc.
  city: varchar("city", { length: 100 }), // City name
  province: varchar("province", { length: 50 }), // State/province
  postalCode: varchar("postal_code", { length: 20 }), // ZIP/postal code
  country: varchar("country", { length: 100 }).default('United States'), // Country name
  
  // Referral & Case Information (Tab 3)
  startDate: date("start_date"), // When therapy began
  referrerName: text("referrer_name"), // Who referred this client
  referralDate: date("referral_date"), // When referral was made
  referenceNumber: varchar("reference_number", { length: 100 }), // Case reference ID
  clientSource: text("client_source"), // How client found the practice
  
  // Employment & Socioeconomic (Tab 4)
  employmentStatus: varchar("employment_status", { length: 100 }), // Working, unemployed, retired, etc.
  educationLevel: varchar("education_level", { length: 100 }), // Highest education completed
  dependents: integer("dependents"), // Number of dependents
  
  // Client Status & Progress (Tab 5)
  clientType: clientTypeEnum("client_type").notNull().default('individual'), // New, returning, or referred
  status: clientStatusEnum("status").notNull().default('pending'), // Active, inactive, or closed
  stage: clientStageEnum("stage").notNull().default('intake'), // Current stage in treatment process
  lastUpdateDate: timestamp("last_update_date").notNull().defaultNow(), // When profile was last modified
  assignedTherapistId: integer("assigned_therapist_id").references(() => users.id), // Primary therapist for this client
  
  // Additional Information
  notes: text("notes"), // General notes about the client
  
  // Legacy Fields (For Compatibility)
  address: text("address"), // Old address field (replaced by structured address)
  state: varchar("state", { length: 50 }),
  zipCode: varchar("zip_code", { length: 10 }),
  emergencyContactName: text("emergency_contact_name"), // Legacy emergency contact
  emergencyContactPhone: varchar("emergency_contact_phone", { length: 20 }),
  emergencyContactRelationship: varchar("emergency_contact_relationship", { length: 50 }),
  
  // Insurance Information - Provider, policy, and group numbers
  insuranceProvider: text("insurance_provider"),
  policyNumber: text("policy_number"),
  groupNumber: text("group_number"),
  insurancePhone: varchar("insurance_phone", { length: 20 }),
  copayAmount: decimal("copay_amount", { precision: 10, scale: 2 }),
  deductible: decimal("deductible", { precision: 10, scale: 2 }),
  
  // Service Type & Frequency - Treatment service details
  serviceType: text("service_type"), // Treatment service details
  serviceFrequency: varchar("service_frequency", { length: 100 }), // Frequency of treatment
  
  // Referral information (Legacy)
  referralSource: text("referral_source"),
  referralType: text("referral_type"),
  referringPerson: text("referring_person"),
  referralNotes: text("referral_notes"),
  
  // Timestamps
  lastSessionDate: timestamp("last_session_date"),
  nextAppointmentDate: timestamp("next_appointment_date"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  // Indexes for performance with 5000+ records
  nameIdx: index("clients_name_idx").on(table.fullName),
  emailIdx: index("clients_email_idx").on(table.email),
  phoneIdx: index("clients_phone_idx").on(table.phone),
  statusIdx: index("clients_status_idx").on(table.status),
  therapistIdx: index("clients_therapist_idx").on(table.assignedTherapistId),
  createdAtIdx: index("clients_created_at_idx").on(table.createdAt),
}));

// Services table - Healthcare service codes and billing rates
export const services = pgTable("services", {
  id: serial("id").primaryKey(),
  serviceCode: varchar("service_code", { length: 50 }).notNull().unique(), // CPT codes like "90834", "90837"
  serviceName: varchar("service_name", { length: 255 }).notNull(), // "Individual Psychotherapy 45 min"
  description: text("description"),
  duration: integer("duration").notNull(), // 45, 60, 90 minutes
  baseRate: decimal("base_rate", { precision: 10, scale: 2 }).notNull(),
  category: varchar("category", { length: 100 }),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Rooms table - Physical therapy rooms and spaces
export const rooms = pgTable("rooms", {
  id: serial("id").primaryKey(),
  roomNumber: varchar("room_number", { length: 50 }).notNull().unique(),
  roomName: varchar("room_name", { length: 255 }).notNull(),
  capacity: integer("capacity"),
  equipment: text("equipment"), // Equipment description as text
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Room bookings table - Prevent double booking conflicts
export const roomBookings = pgTable("room_bookings", {
  id: serial("id").primaryKey(),
  roomId: integer("room_id").notNull().references(() => rooms.id),
  sessionId: integer("session_id").notNull().references(() => sessions.id),
  startTime: timestamp("start_time").notNull(),
  endTime: timestamp("end_time").notNull(),
  bookedBy: integer("booked_by").notNull().references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  // Prevent double booking - same room at same time
  uniqueRoomTimeSlot: index("unique_room_time_slot").on(table.roomId, table.startTime, table.endTime),
}));

// Enhanced Sessions table with service and room references
export const sessions = pgTable("sessions", {
  id: serial("id").primaryKey(),
  clientId: integer("client_id").notNull().references(() => clients.id, { onDelete: 'cascade' }),
  therapistId: integer("therapist_id").notNull().references(() => users.id),
  serviceId: integer("service_id").notNull().references(() => services.id), // Links to service catalog
  roomId: integer("room_id").references(() => rooms.id), // Links to room management
  sessionDate: timestamp("session_date").notNull(),
  sessionType: sessionTypeEnum("session_type").notNull(),
  status: sessionStatusEnum("status").notNull().default('scheduled'),
  notes: text("notes"),
  calculatedRate: decimal("calculated_rate", { precision: 10, scale: 2 }), // Auto-calculated from service
  insuranceApplicable: boolean("insurance_applicable").notNull().default(false),
  billingNotes: text("billing_notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Session billing table - Comprehensive billing records
export const sessionBilling = pgTable("session_billing", {
  id: serial("id").primaryKey(),
  sessionId: integer("session_id").notNull().references(() => sessions.id, { onDelete: 'cascade' }),
  serviceCode: varchar("service_code", { length: 20 }).notNull(),
  units: integer("units").notNull().default(1),
  ratePerUnit: decimal("rate_per_unit", { precision: 10, scale: 2 }).notNull(),
  totalAmount: decimal("total_amount", { precision: 10, scale: 2 }).notNull(),
  insuranceCovered: boolean("insurance_covered").notNull().default(false),
  copayAmount: decimal("copay_amount", { precision: 10, scale: 2 }),
  billingDate: date("billing_date"),
  paymentStatus: billingStatusEnum("payment_status").notNull().default('pending'),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Tasks table
export const tasks = pgTable("tasks", {
  id: serial("id").primaryKey(),
  clientId: integer("client_id").notNull().references(() => clients.id, { onDelete: 'cascade' }),
  assignedToId: integer("assigned_to_id").references(() => users.id),
  title: text("title").notNull(),
  description: text("description"),
  status: taskStatusEnum("status").notNull().default('pending'),
  priority: taskPriorityEnum("priority").notNull().default('medium'),
  dueDate: timestamp("due_date"),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Notes table
export const notes = pgTable("notes", {
  id: serial("id").primaryKey(),
  clientId: integer("client_id").notNull().references(() => clients.id, { onDelete: 'cascade' }),
  authorId: integer("author_id").notNull().references(() => users.id),
  title: text("title"),
  content: text("content").notNull(),
  noteType: varchar("note_type", { length: 50 }).notNull().default('general'), // session, general, clinical, communication, supervisor
  isPrivate: boolean("is_private").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Documents table
export const documents = pgTable("documents", {
  id: serial("id").primaryKey(),
  clientId: integer("client_id").notNull().references(() => clients.id, { onDelete: 'cascade' }),
  uploadedById: integer("uploaded_by_id").notNull().references(() => users.id),
  fileName: text("file_name").notNull(),
  originalName: text("original_name").notNull(),
  fileSize: integer("file_size").notNull(),
  mimeType: varchar("mime_type", { length: 100 }).notNull(),
  category: varchar("category", { length: 50 }).notNull(), // uploaded, shared, generated, forms, insurance
  isSharedInPortal: boolean("is_shared_in_portal").notNull().default(false),
  downloadCount: integer("download_count").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Session Notes table
export const sessionNotes = pgTable("session_notes", {
  id: serial("id").primaryKey(),
  sessionId: integer("session_id").notNull().references(() => sessions.id, { onDelete: 'cascade' }),
  clientId: integer("client_id").notNull().references(() => clients.id, { onDelete: 'cascade' }),
  therapistId: integer("therapist_id").notNull().references(() => users.id),
  date: timestamp("date").notNull(),
  
  // Clinical content fields
  sessionFocus: text("session_focus"),
  symptoms: text("symptoms"),
  shortTermGoals: text("short_term_goals"),
  intervention: text("intervention"),
  progress: text("progress"),
  remarks: text("remarks"),
  recommendations: text("recommendations"),
  
  // Rating & outcome fields
  clientRating: integer("client_rating"), // 0-10
  therapistRating: integer("therapist_rating"), // 0-10
  progressTowardGoals: integer("progress_toward_goals"), // 0-100%
  moodBefore: integer("mood_before"), // 1-10
  moodAfter: integer("mood_after"), // 1-10
  
  // AI & content management
  generatedContent: text("generated_content"),
  draftContent: text("draft_content"),
  finalContent: text("final_content"),
  isDraft: boolean("is_draft").notNull().default(true),
  isFinalized: boolean("is_finalized").notNull().default(false),
  aiEnabled: boolean("ai_enabled").notNull().default(false),
  customAiPrompt: text("custom_ai_prompt"),
  aiProcessingStatus: varchar("ai_processing_status", { length: 50 }).default('idle'), // idle, processing, completed, error
  
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Hierarchical Library Tables for Clinical Content
export const libraryCategories = pgTable("library_categories", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  parentId: integer("parent_id").references(() => libraryCategories.id, { onDelete: "cascade" }),
  sortOrder: integer("sort_order").default(0),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const libraryEntries = pgTable("library_entries", {
  id: serial("id").primaryKey(),
  categoryId: integer("category_id").notNull().references(() => libraryCategories.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  content: text("content").notNull(),
  tags: text("tags").array(),
  createdById: integer("created_by_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  isActive: boolean("is_active").default(true),
  sortOrder: integer("sort_order").default(0),
  usageCount: integer("usage_count").default(0),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const connectionTypeEnum = pgEnum('connection_type', [
  'relates_to', 'follows_from', 'supports', 'alternative_to', 'prerequisite_for', 'expands_on'
]);

// Assessment Template Enums
export const questionTypeEnum = pgEnum('question_type', ['short_text', 'long_text', 'multiple_choice', 'rating_scale', 'checkbox']);
export const sectionAccessEnum = pgEnum('section_access', ['therapist_only', 'client_only', 'shared']);
export const assessmentStatusEnum = pgEnum('assessment_status', ['pending', 'client_in_progress', 'waiting_for_therapist', 'therapist_completed', 'completed']);
export const reportSectionEnum = pgEnum('report_section', [
  'referral_reason', 'presenting_symptoms', 'background_history', 'mental_status_exam', 
  'risk_assessment', 'treatment_recommendations', 'goals_objectives', 'summary_impressions'
]);

export const libraryEntryConnections = pgTable("library_entry_connections", {
  id: serial("id").primaryKey(),
  fromEntryId: integer("from_entry_id").notNull().references(() => libraryEntries.id, { onDelete: "cascade" }),
  toEntryId: integer("to_entry_id").notNull().references(() => libraryEntries.id, { onDelete: "cascade" }),
  connectionType: connectionTypeEnum("connection_type").notNull(),
  description: text("description"), // Optional description of the connection
  strength: integer("strength").default(1), // 1-5 scale for connection strength
  isActive: boolean("is_active").default(true),
  createdById: integer("created_by_id").notNull().references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Assessment Templates System
export const assessmentTemplates = pgTable("assessment_templates", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  category: varchar("category", { length: 100 }),
  isStandardized: boolean("is_standardized").default(false), // Whether it's a clinical standard assessment
  isActive: boolean("is_active").default(true),
  createdById: integer("created_by_id").notNull().references(() => users.id),
  version: varchar("version", { length: 20 }).default("1.0"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const assessmentSections = pgTable("assessment_sections", {
  id: serial("id").primaryKey(),
  templateId: integer("template_id").notNull().references(() => assessmentTemplates.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  description: text("description"),
  accessLevel: sectionAccessEnum("access_level").notNull().default('therapist_only'),
  isScoring: boolean("is_scoring").default(false), // Whether this section contributes to scoring
  reportMapping: reportSectionEnum("report_mapping"), // Maps to AI report sections
  aiReportPrompt: text("ai_report_prompt"), // Optional AI prompt for report generation
  sortOrder: integer("sort_order").default(0),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const assessmentQuestions = pgTable("assessment_questions", {
  id: serial("id").primaryKey(),
  sectionId: integer("section_id").notNull().references(() => assessmentSections.id, { onDelete: "cascade" }),
  questionText: text("question_text").notNull(),
  questionType: questionTypeEnum("question_type").notNull(),
  isRequired: boolean("is_required").default(false),
  sortOrder: integer("sort_order").default(0),
  // For rating scales
  ratingMin: integer("rating_min"),
  ratingMax: integer("rating_max"),
  ratingLabels: text("rating_labels").array(), // ["Poor", "Good", "Excellent"]
  // Configuration for scoring
  contributesToScore: boolean("contributes_to_score").default(false),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const assessmentQuestionOptions = pgTable("assessment_question_options", {
  id: serial("id").primaryKey(),
  questionId: integer("question_id").notNull().references(() => assessmentQuestions.id, { onDelete: "cascade" }),
  optionText: text("option_text").notNull(),
  optionValue: decimal("option_value", { precision: 10, scale: 2 }), // Numeric value for scoring
  sortOrder: integer("sort_order").default(0),
});

// Assessment Instances and Responses
export const assessmentAssignments = pgTable("assessment_assignments", {
  id: serial("id").primaryKey(),
  templateId: integer("template_id").notNull().references(() => assessmentTemplates.id),
  clientId: integer("client_id").notNull().references(() => clients.id, { onDelete: 'cascade' }),
  assignedById: integer("assigned_by_id").notNull().references(() => users.id),
  status: assessmentStatusEnum("status").notNull().default('pending'),
  dueDate: date("due_date"),
  completedAt: timestamp("completed_at"),
  finalizedAt: timestamp("finalized_at"),
  clientSubmittedAt: timestamp("client_submitted_at"),
  therapistCompletedAt: timestamp("therapist_completed_at"),
  totalScore: decimal("total_score", { precision: 10, scale: 2 }),
  notes: text("notes"), // Therapist notes about the assessment
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const assessmentResponses = pgTable("assessment_responses", {
  id: serial("id").primaryKey(),
  assignmentId: integer("assignment_id").notNull().references(() => assessmentAssignments.id, { onDelete: 'cascade' }),
  questionId: integer("question_id").notNull().references(() => assessmentQuestions.id, { onDelete: 'cascade' }),
  responderId: integer("responder_id").notNull().references(() => users.id), // Who answered (client or therapist)
  responseText: text("response_text"), // For text responses
  selectedOptions: integer("selected_options").array(), // For multiple choice/checkboxes
  ratingValue: integer("rating_value"), // For rating scales
  scoreValue: decimal("score_value", { precision: 10, scale: 2 }), // Calculated score for this response
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const assessmentReports = pgTable("assessment_reports", {
  id: serial("id").primaryKey(),
  assignmentId: integer("assignment_id").notNull().references(() => assessmentAssignments.id, { onDelete: 'cascade' }),
  generatedContent: text("generated_content"), // AI-generated report content
  editedContent: text("edited_content"), // Therapist-edited version
  reportData: text("report_data"), // JSON structure of organized data
  generatedAt: timestamp("generated_at"),
  editedAt: timestamp("edited_at"),
  exportedAt: timestamp("exported_at"),
  createdById: integer("created_by_id").notNull().references(() => users.id),
});

// Relations
export const usersRelations = relations(users, ({ many }) => ({
  clients: many(clients),
  sessions: many(sessions),
  tasks: many(tasks),
  notes: many(notes),
  documents: many(documents),
  sessionNotes: many(sessionNotes),
  libraryEntries: many(libraryEntries),
  assessmentTemplates: many(assessmentTemplates),
  assessmentResponses: many(assessmentResponses),
  roomBookings: many(roomBookings),
}));

export const clientsRelations = relations(clients, ({ one, many }) => ({
  assignedTherapist: one(users, {
    fields: [clients.assignedTherapistId],
    references: [users.id],
  }),
  sessions: many(sessions),
  tasks: many(tasks),
  notes: many(notes),
  documents: many(documents),
  sessionNotes: many(sessionNotes),
}));

export const servicesRelations = relations(services, ({ many }) => ({
  sessions: many(sessions),
  sessionBilling: many(sessionBilling),
}));

export const roomsRelations = relations(rooms, ({ many }) => ({
  sessions: many(sessions),
  roomBookings: many(roomBookings),
}));

export const roomBookingsRelations = relations(roomBookings, ({ one }) => ({
  room: one(rooms, { fields: [roomBookings.roomId], references: [rooms.id] }),
  session: one(sessions, { fields: [roomBookings.sessionId], references: [sessions.id] }),
  bookedBy: one(users, { fields: [roomBookings.bookedBy], references: [users.id] }),
}));

export const sessionsRelations = relations(sessions, ({ one, many }) => ({
  client: one(clients, {
    fields: [sessions.clientId],
    references: [clients.id],
  }),
  therapist: one(users, {
    fields: [sessions.therapistId],
    references: [users.id],
  }),
  service: one(services, { fields: [sessions.serviceId], references: [services.id] }),
  room: one(rooms, { fields: [sessions.roomId], references: [rooms.id] }),
  sessionNotes: many(sessionNotes),
  roomBooking: one(roomBookings),
  billing: one(sessionBilling),
}));

export const sessionBillingRelations = relations(sessionBilling, ({ one }) => ({
  session: one(sessions, { fields: [sessionBilling.sessionId], references: [sessions.id] }),
}));

export const tasksRelations = relations(tasks, ({ one }) => ({
  client: one(clients, {
    fields: [tasks.clientId],
    references: [clients.id],
  }),
  assignedTo: one(users, {
    fields: [tasks.assignedToId],
    references: [users.id],
  }),
}));

export const notesRelations = relations(notes, ({ one }) => ({
  client: one(clients, {
    fields: [notes.clientId],
    references: [clients.id],
  }),
  author: one(users, {
    fields: [notes.authorId],
    references: [users.id],
  }),
}));

export const documentsRelations = relations(documents, ({ one }) => ({
  client: one(clients, {
    fields: [documents.clientId],
    references: [clients.id],
  }),
  uploadedBy: one(users, {
    fields: [documents.uploadedById],
    references: [users.id],
  }),
}));

export const sessionNotesRelations = relations(sessionNotes, ({ one }) => ({
  session: one(sessions, {
    fields: [sessionNotes.sessionId],
    references: [sessions.id],
  }),
  client: one(clients, {
    fields: [sessionNotes.clientId],
    references: [clients.id],
  }),
  therapist: one(users, {
    fields: [sessionNotes.therapistId],
    references: [users.id],
  }),
}));

export const libraryCategoriesRelations = relations(libraryCategories, ({ one, many }) => ({
  parent: one(libraryCategories, {
    fields: [libraryCategories.parentId],
    references: [libraryCategories.id],
  }),
  children: many(libraryCategories),
  entries: many(libraryEntries),
}));

export const libraryEntriesRelations = relations(libraryEntries, ({ one, many }) => ({
  category: one(libraryCategories, {
    fields: [libraryEntries.categoryId],
    references: [libraryCategories.id],
  }),
  createdBy: one(users, {
    fields: [libraryEntries.createdById],
    references: [users.id],
  }),
  connectionsFrom: many(libraryEntryConnections, { relationName: "fromEntry" }),
  connectionsTo: many(libraryEntryConnections, { relationName: "toEntry" }),
}));

export const libraryEntryConnectionsRelations = relations(libraryEntryConnections, ({ one }) => ({
  fromEntry: one(libraryEntries, {
    fields: [libraryEntryConnections.fromEntryId],
    references: [libraryEntries.id],
    relationName: "fromEntry",
  }),
  toEntry: one(libraryEntries, {
    fields: [libraryEntryConnections.toEntryId],
    references: [libraryEntries.id],
    relationName: "toEntry",
  }),
  createdBy: one(users, {
    fields: [libraryEntryConnections.createdById],
    references: [users.id],
  }),
}));

// Assessment Template Relations
export const assessmentTemplatesRelations = relations(assessmentTemplates, ({ one, many }) => ({
  createdBy: one(users, {
    fields: [assessmentTemplates.createdById],
    references: [users.id],
  }),
  sections: many(assessmentSections),
  assignments: many(assessmentAssignments),
}));

export const assessmentSectionsRelations = relations(assessmentSections, ({ one, many }) => ({
  template: one(assessmentTemplates, {
    fields: [assessmentSections.templateId],
    references: [assessmentTemplates.id],
  }),
  questions: many(assessmentQuestions),
}));

export const assessmentQuestionsRelations = relations(assessmentQuestions, ({ one, many }) => ({
  section: one(assessmentSections, {
    fields: [assessmentQuestions.sectionId],
    references: [assessmentSections.id],
  }),
  options: many(assessmentQuestionOptions),
  responses: many(assessmentResponses),
}));

export const assessmentQuestionOptionsRelations = relations(assessmentQuestionOptions, ({ one }) => ({
  question: one(assessmentQuestions, {
    fields: [assessmentQuestionOptions.questionId],
    references: [assessmentQuestions.id],
  }),
}));

export const assessmentAssignmentsRelations = relations(assessmentAssignments, ({ one, many }) => ({
  template: one(assessmentTemplates, {
    fields: [assessmentAssignments.templateId],
    references: [assessmentTemplates.id],
  }),
  client: one(clients, {
    fields: [assessmentAssignments.clientId],
    references: [clients.id],
  }),
  assignedBy: one(users, {
    fields: [assessmentAssignments.assignedById],
    references: [users.id],
  }),
  responses: many(assessmentResponses),
  reports: many(assessmentReports),
}));

export const assessmentResponsesRelations = relations(assessmentResponses, ({ one }) => ({
  assignment: one(assessmentAssignments, {
    fields: [assessmentResponses.assignmentId],
    references: [assessmentAssignments.id],
  }),
  question: one(assessmentQuestions, {
    fields: [assessmentResponses.questionId],
    references: [assessmentQuestions.id],
  }),
  responder: one(users, {
    fields: [assessmentResponses.responderId],
    references: [users.id],
  }),
}));

export const assessmentReportsRelations = relations(assessmentReports, ({ one }) => ({
  assignment: one(assessmentAssignments, {
    fields: [assessmentReports.assignmentId],
    references: [assessmentAssignments.id],
  }),
  createdBy: one(users, {
    fields: [assessmentReports.createdById],
    references: [users.id],
  }),
}));

// Zod schemas
export const insertUserSchema = createInsertSchema(users).omit({
  id: true,
  createdAt: true,
});

export const insertClientSchema = createInsertSchema(clients).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertServiceSchema = createInsertSchema(services).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertRoomSchema = createInsertSchema(rooms).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertRoomBookingSchema = createInsertSchema(roomBookings).omit({
  id: true,
  createdAt: true,
});

export const insertSessionSchema = createInsertSchema(sessions).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertSessionBillingSchema = createInsertSchema(sessionBilling).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertTaskSchema = createInsertSchema(tasks).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertNoteSchema = createInsertSchema(notes).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertDocumentSchema = createInsertSchema(documents).omit({
  id: true,
  createdAt: true,
});

export const insertSessionNoteSchema = createInsertSchema(sessionNotes).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertLibraryCategorySchema = createInsertSchema(libraryCategories).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertLibraryEntrySchema = createInsertSchema(libraryEntries).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertLibraryEntryConnectionSchema = createInsertSchema(libraryEntryConnections).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

// Assessment Template Schemas
export const insertAssessmentTemplateSchema = createInsertSchema(assessmentTemplates).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertAssessmentSectionSchema = createInsertSchema(assessmentSections).omit({
  id: true,
  createdAt: true,
});

export const insertAssessmentQuestionSchema = createInsertSchema(assessmentQuestions).omit({
  id: true,
  createdAt: true,
});

export const insertAssessmentQuestionOptionSchema = createInsertSchema(assessmentQuestionOptions).omit({
  id: true,
});

export const insertAssessmentAssignmentSchema = createInsertSchema(assessmentAssignments).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertAssessmentResponseSchema = createInsertSchema(assessmentResponses).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertAssessmentReportSchema = createInsertSchema(assessmentReports).omit({
  id: true,
});

// Export types
export type User = typeof users.$inferSelect;
export type InsertUser = z.infer<typeof insertUserSchema>;

export type Client = typeof clients.$inferSelect;
export type InsertClient = z.infer<typeof insertClientSchema>;

export type Session = typeof sessions.$inferSelect;
export type InsertSession = z.infer<typeof insertSessionSchema>;

export type Task = typeof tasks.$inferSelect;
export type InsertTask = z.infer<typeof insertTaskSchema>;

export type Note = typeof notes.$inferSelect;
export type InsertNote = z.infer<typeof insertNoteSchema>;

export type Document = typeof documents.$inferSelect;
export type InsertDocument = z.infer<typeof insertDocumentSchema>;

export type SessionNote = typeof sessionNotes.$inferSelect;
export type InsertSessionNote = z.infer<typeof insertSessionNoteSchema>;

export type LibraryCategory = typeof libraryCategories.$inferSelect;
export type InsertLibraryCategory = z.infer<typeof insertLibraryCategorySchema>;

export type LibraryEntry = typeof libraryEntries.$inferSelect;
export type InsertLibraryEntry = z.infer<typeof insertLibraryEntrySchema>;

export type LibraryEntryConnection = typeof libraryEntryConnections.$inferSelect;
export type InsertLibraryEntryConnection = z.infer<typeof insertLibraryEntryConnectionSchema>;

// Assessment Template Types
export type AssessmentTemplate = typeof assessmentTemplates.$inferSelect;
export type InsertAssessmentTemplate = z.infer<typeof insertAssessmentTemplateSchema>;

export type AssessmentSection = typeof assessmentSections.$inferSelect;
export type InsertAssessmentSection = z.infer<typeof insertAssessmentSectionSchema>;

export type AssessmentQuestion = typeof assessmentQuestions.$inferSelect;
export type InsertAssessmentQuestion = z.infer<typeof insertAssessmentQuestionSchema>;

export type AssessmentQuestionOption = typeof assessmentQuestionOptions.$inferSelect;
export type InsertAssessmentQuestionOption = z.infer<typeof insertAssessmentQuestionOptionSchema>;

export type AssessmentAssignment = typeof assessmentAssignments.$inferSelect;
export type InsertAssessmentAssignment = z.infer<typeof insertAssessmentAssignmentSchema>;

export type AssessmentResponse = typeof assessmentResponses.$inferSelect;
export type InsertAssessmentResponse = z.infer<typeof insertAssessmentResponseSchema>;

export type AssessmentReport = typeof assessmentReports.$inferSelect;
export type InsertAssessmentReport = z.infer<typeof insertAssessmentReportSchema>;

// Service and Room Types
export type SelectService = typeof services.$inferSelect;
export type InsertService = z.infer<typeof insertServiceSchema>;

export type SelectRoom = typeof rooms.$inferSelect;
export type InsertRoom = z.infer<typeof insertRoomSchema>;

export type SelectRoomBooking = typeof roomBookings.$inferSelect;
export type InsertRoomBooking = z.infer<typeof insertRoomBookingSchema>;

export type SelectSessionBilling = typeof sessionBilling.$inferSelect;
export type InsertSessionBilling = z.infer<typeof insertSessionBillingSchema>;
