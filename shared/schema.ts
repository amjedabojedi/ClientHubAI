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

// Enums - Removed unused client/session enums (converted to varchar for flexibility)
// Keeping only enums that are still actively used in the database

// Notification System Enums

// HIPAA Audit Logging Enums

// Dynamic roles and permissions system
export const roles = pgTable("roles", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 50 }).notNull().unique(),
  displayName: varchar("display_name", { length: 100 }).notNull(),
  description: text("description"),
  isSystem: boolean("is_system").notNull().default(false), // Cannot be deleted
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  nameIdx: index("roles_name_idx").on(table.name),
}));

export const permissions = pgTable("permissions", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 100 }).notNull().unique(),
  displayName: varchar("display_name", { length: 150 }).notNull(),
  description: text("description"),
  category: varchar("category", { length: 50 }).notNull(), // client_management, scheduling, etc.
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  nameIdx: index("permissions_name_idx").on(table.name),
  categoryIdx: index("permissions_category_idx").on(table.category),
}));

export const rolePermissions = pgTable("role_permissions", {
  id: serial("id").primaryKey(),
  roleId: integer("role_id").notNull().references(() => roles.id, { onDelete: "cascade" }),
  permissionId: integer("permission_id").notNull().references(() => permissions.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  rolePermissionIdx: index("role_permissions_role_permission_idx").on(table.roleId, table.permissionId),
}));

// Keep enum for backwards compatibility but make it more flexible

// Enhanced Users table with comprehensive authentication and role management
export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
  fullName: text("full_name").notNull(),
  email: text("email").notNull().unique(),
  role: varchar("role", { length: 20 }).notNull().default('therapist'),
  customRoleId: integer("custom_role_id").references(() => roles.id), // For custom roles
  status: varchar("status", { length: 20 }).notNull().default('active'),
  
  // Authentication & Security
  lastLogin: timestamp("last_login"),
  passwordResetToken: text("password_reset_token"),
  passwordResetExpiry: timestamp("password_reset_expiry"),
  emailVerified: boolean("email_verified").notNull().default(false),
  emailVerificationToken: text("email_verification_token"),
  
  // Profile Information
  phone: varchar("phone", { length: 20 }),
  title: varchar("title", { length: 100 }), // Dr., Ms., Mr., etc.
  department: varchar("department", { length: 100 }),
  bio: text("bio"),
  profilePicture: text("profile_picture"),
  
  // Zoom Integration (per-therapist OAuth credentials)
  zoomAccountId: varchar("zoom_account_id", { length: 255 }),
  zoomClientId: varchar("zoom_client_id", { length: 255 }),
  zoomClientSecret: text("zoom_client_secret"), // Encrypted
  zoomAccessToken: text("zoom_access_token"), // Cached token
  zoomTokenExpiry: timestamp("zoom_token_expiry"), // Token expiration time
  
  // System Administration
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  createdBy: integer("created_by"),
  isActive: boolean("is_active").notNull().default(true),
}, (table) => ({
  emailIdx: index("users_email_idx").on(table.email),
  roleIdx: index("users_role_idx").on(table.role),
  statusIdx: index("users_status_idx").on(table.status),
}));

// Therapist/Supervisor Professional Profiles
export const userProfiles = pgTable("user_profiles", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  
  // Professional Information
  licenseNumber: varchar("license_number", { length: 50 }),
  licenseType: varchar("license_type", { length: 100 }), // LMFT, LCSW, etc.
  licenseState: varchar("license_state", { length: 50 }),
  licenseExpiry: date("license_expiry"),
  licenseStatus: varchar("license_status", { length: 20 }).default('active'),
  
  // Clinical Specializations
  specializations: text("specializations").array(), // Array of specialty areas
  treatmentApproaches: text("treatment_approaches").array(), // CBT, DBT, etc.
  ageGroups: text("age_groups").array(), // Children, Adults, Seniors
  languages: text("languages").array(), // Languages spoken
  
  // Professional Development
  certifications: text("certifications").array(), // Additional certifications
  education: text("education").array(), // Degrees and institutions
  yearsOfExperience: integer("years_of_experience"),
  
  // Availability & Scheduling
  workingDays: text("working_days").array(), // Monday, Tuesday, etc.
  workingHours: text("working_hours"), // JSON string of time ranges
  maxClientsPerDay: integer("max_clients_per_day"),
  sessionDuration: integer("session_duration").default(50), // Minutes
  availabilityStatus: varchar("availability_status", { length: 20 }).default('available'),
  
  // Emergency Contact
  emergencyContactName: text("emergency_contact_name"),
  emergencyContactPhone: varchar("emergency_contact_phone", { length: 20 }),
  emergencyContactRelationship: varchar("emergency_contact_relationship", { length: 50 }),
  
  // Professional Background & History
  previousPositions: text("previous_positions").array(), // Work history
  clinicalExperience: text("clinical_experience"), // Detailed clinical background
  researchBackground: text("research_background"), // Research experience
  publications: text("publications").array(), // Academic publications
  professionalMemberships: text("professional_memberships").array(), // Professional organizations
  continuingEducation: text("continuing_education").array(), // Recent training
  supervisoryExperience: text("supervisory_experience"), // Supervision background
  awardRecognitions: text("award_recognitions").array(), // Awards and recognitions
  professionalReferences: text("professional_references").array(), // References
  careerObjectives: text("career_objectives"), // Professional goals
  
  // System Fields
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  userIdIdx: index("user_profiles_user_id_idx").on(table.userId),
  licenseNumberIdx: index("user_profiles_license_number_idx").on(table.licenseNumber),
  specializationsIdx: index("user_profiles_specializations_idx").on(table.specializations),
}));

// Supervisor-Therapist Relationships
export const supervisorAssignments = pgTable("supervisor_assignments", {
  id: serial("id").primaryKey(),
  supervisorId: integer("supervisor_id").notNull().references(() => users.id),
  therapistId: integer("therapist_id").notNull().references(() => users.id),
  assignedDate: timestamp("assigned_date").notNull().defaultNow(),
  isActive: boolean("is_active").notNull().default(true),
  notes: text("notes"),
  
  // Supervision Requirements
  requiredMeetingFrequency: varchar("required_meeting_frequency", { length: 50 }), // Weekly, Bi-weekly
  nextMeetingDate: timestamp("next_meeting_date"),
  lastMeetingDate: timestamp("last_meeting_date"),
  
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  supervisorIdIdx: index("supervisor_assignments_supervisor_id_idx").on(table.supervisorId),
  therapistIdIdx: index("supervisor_assignments_therapist_id_idx").on(table.therapistId),
  activeIdx: index("supervisor_assignments_active_idx").on(table.isActive),
}));

// User Activity Audit Log
export const userActivityLog = pgTable("user_activity_log", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  action: text("action").notNull(), // login, logout, create_client, etc.
  resourceType: text("resource_type"), // client, session, task, etc.
  resourceId: integer("resource_id"), // ID of the affected resource
  details: text("details"), // JSON string with additional context
  ipAddress: varchar("ip_address", { length: 45 }),
  userAgent: text("user_agent"),
  timestamp: timestamp("timestamp").notNull().defaultNow(),
}, (table) => ({
  userIdIdx: index("user_activity_log_user_id_idx").on(table.userId),
  actionIdx: index("user_activity_log_action_idx").on(table.action),
  timestampIdx: index("user_activity_log_timestamp_idx").on(table.timestamp),
}));

// Clients table with comprehensive fields and proper indexing for 5000+ records
export const clients = pgTable("clients", {
  id: serial("id").primaryKey(),
  clientId: varchar("client_id", { length: 20 }).notNull().unique(), // CL-2024-0001 format
  
  // Personal Information (Tab 1)
  fullName: text("full_name").notNull(), // Required field for client identification
  dateOfBirth: date("date_of_birth"), // Client's birth date
  gender: varchar("gender", { length: 20 }), // Client's gender
  maritalStatus: varchar("marital_status", { length: 50 }), // Single, married, divorced, etc.
  preferredLanguage: varchar("preferred_language", { length: 50 }), // Client's communication preference
  pronouns: varchar("pronouns", { length: 20 }),
  emailNotifications: boolean("email_notifications"), // Whether client wants email updates
  
  // Client Portal Access
  hasPortalAccess: boolean("has_portal_access"), // Portal Enabled - Whether client can access online portal
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
  country: varchar("country", { length: 100 }), // Country name
  
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
  clientType: varchar("client_type", { length: 100 }), // New, returning, or referred
  status: varchar("status", { length: 50 }), // Active, inactive, or closed
  stage: varchar("stage", { length: 50 }), // Current stage in treatment process
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
  
  // Follow-up Management
  needsFollowUp: boolean("needs_follow_up").default(false),
  followUpPriority: varchar("follow_up_priority", { length: 20 }), // low, medium, high, urgent
  followUpDate: date("follow_up_date"),
  followUpNotes: text("follow_up_notes"),
  
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
  therapistVisible: boolean("therapist_visible").notNull().default(true), // Controls therapist visibility
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

// System Settings - Option Categories (following same pattern as Services/Rooms)
export const optionCategories = pgTable("option_categories", {
  id: serial("id").primaryKey(),
  categoryKey: varchar("category_key", { length: 100 }).notNull().unique(), // "education_levels", "employment_status", etc.
  categoryName: varchar("category_name", { length: 255 }).notNull(), // "Education Levels", "Employment Status", etc.
  description: text("description"),
  isSystem: boolean("is_system").notNull().default(true), // System categories cannot be deleted
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// System Settings - Option Values (following same pattern as Services/Rooms)
export const systemOptions = pgTable("system_options", {
  id: serial("id").primaryKey(),
  categoryId: integer("category_id").notNull().references(() => optionCategories.id, { onDelete: 'cascade' }),
  optionKey: varchar("option_key", { length: 100 }).notNull(), // "elementary", "high_school", etc.
  optionLabel: varchar("option_label", { length: 255 }).notNull(), // "Elementary School", "High School", etc.
  sortOrder: integer("sort_order").default(0),
  isDefault: boolean("is_default").notNull().default(false), // Default selection for new records
  isSystem: boolean("is_system").notNull().default(false), // System options cannot be deleted
  isActive: boolean("is_active").notNull().default(true),
  price: decimal("price", { precision: 10, scale: 2 }).default("0.00"), // Price for service codes
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  uniqueCategoryOption: index("unique_category_option").on(table.categoryId, table.optionKey),
}));

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
  sessionType: varchar("session_type", { length: 100 }).notNull(),
  status: varchar("status", { length: 50 }).notNull().default('scheduled'),
  notes: text("notes"),
  calculatedRate: decimal("calculated_rate", { precision: 10, scale: 2 }), // Auto-calculated from service
  insuranceApplicable: boolean("insurance_applicable").notNull().default(false),
  billingNotes: text("billing_notes"),
  // Zoom integration fields
  zoomEnabled: boolean("zoom_enabled").notNull().default(false),
  zoomMeetingId: varchar("zoom_meeting_id", { length: 50 }),
  zoomJoinUrl: text("zoom_join_url"),
  zoomPassword: varchar("zoom_password", { length: 50 }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  // Performance indexes for session queries
  therapistIdIdx: index("sessions_therapist_id_idx").on(table.therapistId),
  clientIdIdx: index("sessions_client_id_idx").on(table.clientId),
  sessionDateIdx: index("sessions_date_idx").on(table.sessionDate),
  serviceIdIdx: index("sessions_service_id_idx").on(table.serviceId),
}));

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
  paymentStatus: varchar("payment_status", { length: 20 }).notNull().default('pending'),
  // Payment details
  paymentAmount: decimal("payment_amount", { precision: 10, scale: 2 }),
  paymentDate: date("payment_date"),
  paymentReference: varchar("payment_reference", { length: 100 }),
  paymentMethod: varchar("payment_method", { length: 50 }),
  paymentNotes: text("payment_notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  // Critical performance indexes for billing queries
  billingDateIdx: index("billing_date_idx").on(table.billingDate),
  paymentStatusIdx: index("payment_status_idx").on(table.paymentStatus),
  serviceCodeIdx: index("service_code_idx").on(table.serviceCode),
  sessionIdIdx: index("session_billing_session_id_idx").on(table.sessionId),
  // Composite indexes for common query patterns
  dateStatusIdx: index("billing_date_status_idx").on(table.billingDate, table.paymentStatus),
  dateServiceIdx: index("billing_date_service_idx").on(table.billingDate, table.serviceCode),
}));

// Tasks table
export const tasks = pgTable("tasks", {
  id: serial("id").primaryKey(),
  clientId: integer("client_id").notNull().references(() => clients.id, { onDelete: 'cascade' }),
  assignedToId: integer("assigned_to_id").references(() => users.id),
  title: text("title").notNull(),
  description: text("description"),
  status: varchar("status", { length: 20 }).notNull().default('pending'),
  priority: varchar("priority", { length: 20 }).notNull().default('medium'),
  dueDate: timestamp("due_date"),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Task Comments table - For tracking progress and communication on tasks
export const taskComments = pgTable("task_comments", {
  id: serial("id").primaryKey(),
  taskId: integer("task_id").notNull().references(() => tasks.id, { onDelete: 'cascade' }),
  authorId: integer("author_id").notNull().references(() => users.id),
  content: text("content").notNull(),
  isInternal: boolean("is_internal").notNull().default(false), // Internal staff notes vs client-visible
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
  clientId: integer("client_id").notNull().references(() => clients.id),
  uploadedById: integer("uploaded_by_id").notNull().references(() => users.id),
  fileName: text("file_name").notNull(),
  originalName: text("original_name").notNull(),
  fileSize: integer("file_size").notNull(),
  mimeType: varchar("mime_type", { length: 100 }).notNull(),
  category: varchar("category", { length: 50 }).notNull(), // uploaded, shared, generated, forms, insurance
  isSharedInPortal: boolean("is_shared_in_portal").notNull().default(false),
  downloadCount: integer("download_count").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  clientIdIdx: index("documents_client_id_idx").on(table.clientId),
}));

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

// Recent Items Table - Server-backed for PHI security compliance
export const recentItems = pgTable("recent_items", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  entityType: varchar("entity_type", { length: 20 }).notNull(), // 'client', 'task', 'session'
  entityId: integer("entity_id").notNull(),
  viewedAt: timestamp("viewed_at").notNull().defaultNow(),
}, (table) => ({
  userEntityIdx: index("recent_items_user_entity_idx").on(table.userId, table.entityType),
  userViewedIdx: index("recent_items_user_viewed_idx").on(table.userId, table.viewedAt),
}));

// Client Process Checklist System
export const checklistTemplates = pgTable("checklist_templates", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 100 }).notNull(),
  description: text("description"),
  clientType: varchar("client_type", { length: 20 }), // Dynamic client type from system options
  isActive: boolean("is_active").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const checklistItems = pgTable("checklist_items", {
  id: serial("id").primaryKey(),
  templateId: integer("template_id").notNull().references(() => checklistTemplates.id, { onDelete: "cascade" }),
  title: varchar("title", { length: 200 }).notNull(),
  description: text("description"),
  category: varchar("category", { length: 50 }).notNull(), // 'intake', 'assessment', 'ongoing', 'discharge'
  isRequired: boolean("is_required").notNull().default(false),
  itemOrder: integer("days_from_start"), // Order/sequence of items in the checklist
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const clientChecklists = pgTable("client_checklists", {
  id: serial("id").primaryKey(),
  clientId: integer("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
  templateId: integer("template_id").notNull().references(() => checklistTemplates.id, { onDelete: "cascade" }),
  isCompleted: boolean("is_completed").notNull().default(false),
  completedAt: timestamp("completed_at"),
  completedBy: integer("completed_by").references(() => users.id),
  notes: text("notes"),
  dueDate: date("due_date"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  clientTemplateIdx: index("client_checklists_client_template_idx").on(table.clientId, table.templateId),
}));

export const clientChecklistItems = pgTable("client_checklist_items", {
  id: serial("id").primaryKey(),
  clientChecklistId: integer("client_checklist_id").notNull().references(() => clientChecklists.id, { onDelete: "cascade" }),
  checklistItemId: integer("checklist_item_id").notNull().references(() => checklistItems.id, { onDelete: "cascade" }),
  isCompleted: boolean("is_completed").notNull().default(false),
  completedAt: timestamp("completed_at"),
  completedBy: integer("completed_by").references(() => users.id),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  clientChecklistItemIdx: index("client_checklist_items_checklist_item_idx").on(table.clientChecklistId, table.checklistItemId),
}));

// Hierarchical Library Tables for Clinical Content
export const libraryCategories = pgTable("library_categories", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  parentId: integer("parent_id"),
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
export const questionTypeEnum = pgEnum('question_type', ['short_text', 'long_text', 'multiple_choice', 'rating_scale', 'checkbox', 'date', 'number']);
export const sectionAccessEnum = pgEnum('section_access', ['therapist_only', 'client_only', 'shared']);
export const assessmentStatusEnum = pgEnum('assessment_status', ['pending', 'client_in_progress', 'waiting_for_therapist', 'therapist_completed', 'completed']);
export const reportSectionEnum = pgEnum('report_section', [
  'referral_reason', 'presenting_symptoms', 'background_history', 'mental_status_exam', 
  'risk_assessment', 'treatment_recommendations', 'goals_objectives', 'summary_impressions',
  'objective_findings'
]);

export const libraryEntryConnections = pgTable("library_entry_connections", {
  id: serial("id").primaryKey(),
  fromEntryId: integer("from_entry_id").notNull().references(() => libraryEntries.id, { onDelete: "cascade" }),
  toEntryId: integer("to_entry_id").notNull().references(() => libraryEntries.id, { onDelete: "cascade" }),
  connectionType: varchar("connection_type", { length: 20 }).notNull(),
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
  accessLevel: varchar("access_level", { length: 20 }).notNull().default('therapist_only'),
  isScoring: boolean("is_scoring").default(false), // Whether this section contributes to scoring
  reportMapping: varchar("report_mapping", { length: 50 }), // Maps to AI report sections
  aiReportPrompt: text("ai_report_prompt"), // Optional AI prompt for report generation
  sortOrder: integer("sort_order").default(0),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const assessmentQuestions = pgTable("assessment_questions", {
  id: serial("id").primaryKey(),
  sectionId: integer("section_id").notNull().references(() => assessmentSections.id, { onDelete: "cascade" }),
  questionText: text("question_text").notNull(),
  questionType: varchar("question_type", { length: 30 }).notNull(),
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
  status: varchar("status", { length: 30 }).notNull().default('pending'),
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

// ===== NOTIFICATION SYSTEM TABLES =====

// Main notifications table - stores individual notification instances
export const notifications = pgTable("notifications", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: 'cascade' }),
  type: varchar("type", { length: 50 }).notNull(),
  title: varchar("title", { length: 255 }).notNull(),
  message: text("message").notNull(),
  data: text("data"), // JSON string for additional data
  priority: varchar("priority", { length: 20 }).notNull().default('medium'),
  isRead: boolean("is_read").notNull().default(false),
  readAt: timestamp("read_at"),
  actionUrl: varchar("action_url", { length: 500 }), // URL to navigate when clicked
  actionLabel: varchar("action_label", { length: 100 }), // Button text for action
  groupingKey: varchar("grouping_key", { length: 100 }), // For batching similar notifications
  expiresAt: timestamp("expires_at"), // Auto-cleanup date
  // Related entity info for flexible linking
  relatedEntityType: varchar("related_entity_type", { length: 50 }), // 'client', 'session', 'task', etc.
  relatedEntityId: integer("related_entity_id"), // ID of the related entity
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  userTypeIdx: index("notifications_user_type_idx").on(table.userId, table.type),
  unreadIdx: index("notifications_unread_idx").on(table.userId, table.isRead),
  entityIdx: index("notifications_entity_idx").on(table.relatedEntityType, table.relatedEntityId),
  createdAtIdx: index("notifications_created_at_idx").on(table.createdAt),
}));

// Flexible trigger configuration - defines when notifications are sent
export const notificationTriggers = pgTable("notification_triggers", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 100 }).notNull().unique(),
  description: text("description"),
  eventType: varchar("event_type", { length: 50 }).notNull(),
  entityType: varchar("entity_type", { length: 50 }).notNull(), // 'client', 'session', 'task'
  conditionRules: text("condition_rules"), // JSON string for flexible conditions
  recipientRules: text("recipient_rules"), // JSON string for who gets notified
  templateId: integer("template_id").references(() => notificationTemplates.id),
  priority: varchar("priority", { length: 20 }).notNull().default('medium'),
  delayMinutes: integer("delay_minutes").default(0), // Delay before sending
  batchWindowMinutes: integer("batch_window_minutes").default(5), // Grouping window
  maxBatchSize: integer("max_batch_size").default(10),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  eventTypeIdx: index("notification_triggers_event_type_idx").on(table.eventType),
  entityTypeIdx: index("notification_triggers_entity_type_idx").on(table.entityType),
  activeIdx: index("notification_triggers_active_idx").on(table.isActive),
}));

// User notification preferences - how each user wants to receive notifications
export const notificationPreferences = pgTable("notification_preferences", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: 'cascade' }),
  triggerType: varchar("trigger_type", { length: 50 }).notNull(),
  deliveryMethods: text("delivery_methods"), // JSON array: ['in_app', 'email']
  timing: varchar("timing", { length: 30 }).notNull().default('immediate'),
  enableInApp: boolean("enable_in_app").notNull().default(true),
  enableEmail: boolean("enable_email").notNull().default(false),
  enableSms: boolean("enable_sms").notNull().default(false),
  quietHoursStart: varchar("quiet_hours_start", { length: 8 }), // '22:00:00'
  quietHoursEnd: varchar("quiet_hours_end", { length: 8 }), // '08:00:00'
  weekendsEnabled: boolean("weekends_enabled").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  userTriggerIdx: index("notification_preferences_user_trigger_idx").on(table.userId, table.triggerType),
}));

// Notification templates - reusable message templates
export const notificationTemplates = pgTable("notification_templates", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 100 }).notNull().unique(),
  type: varchar("type", { length: 50 }).notNull(),
  subject: varchar("subject", { length: 255 }).notNull(),
  bodyTemplate: text("body_template").notNull(), // Template with {{variables}}
  actionUrlTemplate: varchar("action_url_template", { length: 500 }),
  actionLabel: varchar("action_label", { length: 100 }),
  recipientRoles: text("recipient_roles"), // JSON array of roles that should receive this
  variables: text("variables"), // JSON describing available template variables
  isSystem: boolean("is_system").notNull().default(false), // System templates cannot be deleted
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  typeIdx: index("notification_templates_type_idx").on(table.type),
  activeIdx: index("notification_templates_active_idx").on(table.isActive),
}));

// HIPAA Audit Logging System
export const auditLogs = pgTable("audit_logs", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id, { onDelete: 'set null' }),
  username: varchar("username", { length: 100 }), // Store username for records even if user deleted
  action: varchar("action", { length: 100 }).notNull(),
  result: varchar("result", { length: 20 }).notNull(),
  resourceType: varchar("resource_type", { length: 50 }), // 'client', 'session', 'document', etc.
  resourceId: varchar("resource_id", { length: 50 }), // ID of the resource accessed
  clientId: integer("client_id").references(() => clients.id, { onDelete: 'set null' }), // PHI access tracking
  ipAddress: varchar("ip_address", { length: 45 }), // IPv4/IPv6
  userAgent: text("user_agent"),
  sessionId: varchar("session_id", { length: 255 }), // Browser/app session ID
  details: text("details"), // JSON with additional context
  riskLevel: varchar("risk_level", { length: 20 }).default('low'), // low, medium, high, critical
  timestamp: timestamp("timestamp").notNull().defaultNow(),
  
  // Additional HIPAA-specific fields
  hipaaRelevant: boolean("hipaa_relevant").notNull().default(false), // PHI access flag
  dataFields: text("data_fields"), // JSON array of specific PHI fields accessed
  accessReason: text("access_reason"), // Business justification for access
  
  // Index for fast queries
}, (table) => ({
  userIdx: index("audit_logs_user_idx").on(table.userId),
  timestampIdx: index("audit_logs_timestamp_idx").on(table.timestamp),
  actionIdx: index("audit_logs_action_idx").on(table.action),
  clientIdx: index("audit_logs_client_idx").on(table.clientId),
  hipaaIdx: index("audit_logs_hipaa_idx").on(table.hipaaRelevant),
  riskIdx: index("audit_logs_risk_idx").on(table.riskLevel),
  userTimestampIdx: index("audit_logs_user_timestamp_idx").on(table.userId, table.timestamp),
}));

// Login/Session tracking for security
export const userSessions = pgTable("user_sessions", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: 'cascade' }),
  sessionToken: varchar("session_token", { length: 255 }).notNull().unique(),
  ipAddress: varchar("ip_address", { length: 45 }).notNull(),
  userAgent: text("user_agent"),
  isActive: boolean("is_active").notNull().default(true),
  lastActivity: timestamp("last_activity").notNull().defaultNow(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  expiresAt: timestamp("expires_at").notNull(),
}, (table) => ({
  tokenIdx: index("user_sessions_token_idx").on(table.sessionToken),
  userIdx: index("user_sessions_user_idx").on(table.userId),
  activeIdx: index("user_sessions_active_idx").on(table.isActive),
  expiresIdx: index("user_sessions_expires_idx").on(table.expiresAt),
}));

// Failed login attempts tracking
export const loginAttempts = pgTable("login_attempts", {
  id: serial("id").primaryKey(),
  username: varchar("username", { length: 100 }).notNull(),
  ipAddress: varchar("ip_address", { length: 45 }).notNull(),
  userAgent: text("user_agent"),
  success: boolean("success").notNull(),
  failureReason: varchar("failure_reason", { length: 100 }), // 'invalid_password', 'account_locked', etc.
  timestamp: timestamp("timestamp").notNull().defaultNow(),
}, (table) => ({
  usernameIdx: index("login_attempts_username_idx").on(table.username),
  ipIdx: index("login_attempts_ip_idx").on(table.ipAddress),
  timestampIdx: index("login_attempts_timestamp_idx").on(table.timestamp),
  successIdx: index("login_attempts_success_idx").on(table.success),
}));

// Practice Configuration Table
export const practiceConfiguration = pgTable("practice_configuration", {
  id: serial("id").primaryKey(),
  practiceName: varchar("practice_name", { length: 255 }).notNull().default("TherapyFlow Healthcare Services"),
  practiceAddress: text("practice_address").default("123 Healthcare Ave, Suite 100\nMental Health City, CA 90210"),
  practicePhone: varchar("practice_phone", { length: 50 }).default("(555) 123-4567"),
  practiceEmail: varchar("practice_email", { length: 255 }).default("contact@therapyflow.com"),
  practiceWebsite: varchar("practice_website", { length: 255 }).default("www.therapyflow.com"),
  taxId: varchar("tax_id", { length: 50 }).default("12-3456789"),
  licenseNumber: varchar("license_number", { length: 100 }).default("PSY-12345-CA"),
  licenseState: varchar("license_state", { length: 50 }).default("California"),
  npiNumber: varchar("npi_number", { length: 50 }).default("1234567890"),
  description: text("description").default("Professional Mental Health Services"),
  subtitle: text("subtitle").default("Licensed Clinical Practice"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Relations
export const usersRelations = relations(users, ({ one, many }) => ({
  profile: one(userProfiles, {
    fields: [users.id],
    references: [userProfiles.userId],
  }),
  createdBy: one(users, {
    fields: [users.createdBy],
    references: [users.id],
  }),
  createdUsers: many(users),
  supervisorAssignments: many(supervisorAssignments, {
    relationName: "supervisorAssignments",
  }),
  therapistAssignments: many(supervisorAssignments, {
    relationName: "therapistAssignments",
  }),
  activityLogs: many(userActivityLog),
  clients: many(clients),
  sessions: many(sessions),
  tasks: many(tasks),
  taskComments: many(taskComments),
  notes: many(notes),
  documents: many(documents),
  sessionNotes: many(sessionNotes),
  libraryEntries: many(libraryEntries),
  assessmentTemplates: many(assessmentTemplates),
  assessmentResponses: many(assessmentResponses),
  roomBookings: many(roomBookings),
  auditLogs: many(auditLogs),
  userSessions: many(userSessions),
}));

export const userProfilesRelations = relations(userProfiles, ({ one }) => ({
  user: one(users, {
    fields: [userProfiles.userId],
    references: [users.id],
  }),
}));

export const supervisorAssignmentsRelations = relations(supervisorAssignments, ({ one }) => ({
  supervisor: one(users, {
    fields: [supervisorAssignments.supervisorId],
    references: [users.id],
    relationName: "supervisorAssignments",
  }),
  therapist: one(users, {
    fields: [supervisorAssignments.therapistId],
    references: [users.id],
    relationName: "therapistAssignments",
  }),
}));

export const userActivityLogRelations = relations(userActivityLog, ({ one }) => ({
  user: one(users, {
    fields: [userActivityLog.userId],
    references: [users.id],
  }),
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

export const tasksRelations = relations(tasks, ({ one, many }) => ({
  client: one(clients, {
    fields: [tasks.clientId],
    references: [clients.id],
  }),
  assignedTo: one(users, {
    fields: [tasks.assignedToId],
    references: [users.id],
  }),
  comments: many(taskComments),
}));

export const taskCommentsRelations = relations(taskComments, ({ one }) => ({
  task: one(tasks, {
    fields: [taskComments.taskId],
    references: [tasks.id],
  }),
  author: one(users, {
    fields: [taskComments.authorId],
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

// System Options Relations (following same pattern as Services/Rooms)
export const optionCategoriesRelations = relations(optionCategories, ({ many }) => ({
  options: many(systemOptions),
}));

export const systemOptionsRelations = relations(systemOptions, ({ one }) => ({
  category: one(optionCategories, {
    fields: [systemOptions.categoryId],
    references: [optionCategories.id],
  }),
}));

// Relations for roles and permissions
export const rolesRelations = relations(roles, ({ many }) => ({
  rolePermissions: many(rolePermissions),
  users: many(users),
}));

export const permissionsRelations = relations(permissions, ({ many }) => ({
  rolePermissions: many(rolePermissions),
}));

export const rolePermissionsRelations = relations(rolePermissions, ({ one }) => ({
  role: one(roles, {
    fields: [rolePermissions.roleId],
    references: [roles.id],
  }),
  permission: one(permissions, {
    fields: [rolePermissions.permissionId],
    references: [permissions.id],
  }),
}));

// ===== NOTIFICATION RELATIONS =====

export const notificationsRelations = relations(notifications, ({ one }) => ({
  user: one(users, {
    fields: [notifications.userId],
    references: [users.id],
  }),
}));

export const notificationTriggersRelations = relations(notificationTriggers, ({ one }) => ({
  template: one(notificationTemplates, {
    fields: [notificationTriggers.templateId],
    references: [notificationTemplates.id],
  }),
}));

export const notificationPreferencesRelations = relations(notificationPreferences, ({ one }) => ({
  user: one(users, {
    fields: [notificationPreferences.userId],
    references: [users.id],
  }),
}));

export const notificationTemplatesRelations = relations(notificationTemplates, ({ many }) => ({
  triggers: many(notificationTriggers),
}));

// HIPAA Audit Logging Relations
export const auditLogsRelations = relations(auditLogs, ({ one }) => ({
  user: one(users, {
    fields: [auditLogs.userId],
    references: [users.id],
  }),
  client: one(clients, {
    fields: [auditLogs.clientId],
    references: [clients.id],
  }),
}));

export const userSessionsRelations = relations(userSessions, ({ one }) => ({
  user: one(users, {
    fields: [userSessions.userId],
    references: [users.id],
  }),
}));

// Zod schemas
export const insertRoleSchema = createInsertSchema(roles).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertPermissionSchema = createInsertSchema(permissions).omit({
  id: true,
  createdAt: true,
});

export const insertRolePermissionSchema = createInsertSchema(rolePermissions).omit({
  id: true,
  createdAt: true,
});

export const insertUserSchema = createInsertSchema(users).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertUserProfileSchema = createInsertSchema(userProfiles).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertSupervisorAssignmentSchema = createInsertSchema(supervisorAssignments).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertUserActivityLogSchema = createInsertSchema(userActivityLog).omit({
  id: true,
});

export const insertClientSchema = createInsertSchema(clients).omit({
  id: true,
  clientId: true, // Auto-generated
  createdAt: true,
  updatedAt: true,
}).extend({
  // Make all fields optional except fullName which remains required
  emailNotifications: z.boolean().optional(),
  hasPortalAccess: z.boolean().optional(),
  clientType: z.string().optional(),
  status: z.enum(['active', 'inactive', 'pending']).optional(),
  stage: z.enum(['intake', 'assessment', 'psychotherapy']).optional(),
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

export const insertOptionCategorySchema = createInsertSchema(optionCategories).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertSystemOptionSchema = createInsertSchema(systemOptions).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  price: z.string().optional().transform((val) => val ? parseFloat(val).toFixed(2) : "0.00"),
});

// Checklist Schemas
export const insertChecklistTemplateSchema = createInsertSchema(checklistTemplates).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertChecklistItemSchema = createInsertSchema(checklistItems).omit({
  id: true,
  createdAt: true,
});

export const insertClientChecklistSchema = createInsertSchema(clientChecklists).omit({
  id: true,
  createdAt: true,
});

export const insertClientChecklistItemSchema = createInsertSchema(clientChecklistItems).omit({
  id: true,
  createdAt: true,
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
  completedAt: true,
}).extend({
  clientId: z.number().optional(), // Make clientId optional for tasks
  dueDate: z.string().optional().transform((val) => val ? new Date(val) : undefined),
});

export const insertTaskCommentSchema = createInsertSchema(taskComments).omit({
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
}).extend({
  sessionId: z.coerce.number(),
  clientId: z.coerce.number(),
  therapistId: z.coerce.number(),
  date: z.coerce.date(),
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

// Practice Configuration Schema  
export const insertPracticeConfigurationSchema = createInsertSchema(practiceConfiguration).omit({
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

// Notification Schemas
export const insertNotificationSchema = createInsertSchema(notifications).omit({
  id: true,
  createdAt: true,
});

export const insertNotificationTriggerSchema = createInsertSchema(notificationTriggers).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertNotificationPreferenceSchema = createInsertSchema(notificationPreferences).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertNotificationTemplateSchema = createInsertSchema(notificationTemplates).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

// HIPAA Audit Logging Schemas
export const insertAuditLogSchema = createInsertSchema(auditLogs).omit({
  id: true,
  timestamp: true,
});

export const insertUserSessionSchema = createInsertSchema(userSessions).omit({
  id: true,
  createdAt: true,
});

export const insertLoginAttemptSchema = createInsertSchema(loginAttempts).omit({
  id: true,
  timestamp: true,
});

// Types
export type AuditLog = typeof auditLogs.$inferSelect;
export type InsertAuditLog = typeof insertAuditLogSchema._type;
export type UserSession = typeof userSessions.$inferSelect;
export type InsertUserSession = typeof insertUserSessionSchema._type;
export type LoginAttempt = typeof loginAttempts.$inferSelect;
export type InsertLoginAttempt = typeof insertLoginAttemptSchema._type;

// Export types
export type Role = typeof roles.$inferSelect;
export type InsertRole = z.infer<typeof insertRoleSchema>;

export type Permission = typeof permissions.$inferSelect;
export type InsertPermission = z.infer<typeof insertPermissionSchema>;

export type RolePermission = typeof rolePermissions.$inferSelect;
export type InsertRolePermission = z.infer<typeof insertRolePermissionSchema>;

export type User = typeof users.$inferSelect;
export type InsertUser = z.infer<typeof insertUserSchema>;

// Safe user type for API responses (excludes sensitive fields)
export type SafeUser = Omit<User, 'password' | 'passwordResetToken' | 'passwordResetExpiry' | 'emailVerificationToken'>;

export type UserProfile = typeof userProfiles.$inferSelect;
export type InsertUserProfile = z.infer<typeof insertUserProfileSchema>;

export type SupervisorAssignment = typeof supervisorAssignments.$inferSelect;
export type InsertSupervisorAssignment = z.infer<typeof insertSupervisorAssignmentSchema>;

export type UserActivityLog = typeof userActivityLog.$inferSelect;
export type InsertUserActivityLog = z.infer<typeof insertUserActivityLogSchema>;

export type Client = typeof clients.$inferSelect;
export type InsertClient = z.infer<typeof insertClientSchema>;

export type Session = typeof sessions.$inferSelect;
export type InsertSession = z.infer<typeof insertSessionSchema>;

export type Task = typeof tasks.$inferSelect;
export type InsertTask = z.infer<typeof insertTaskSchema>;

export type TaskComment = typeof taskComments.$inferSelect;
export type InsertTaskComment = z.infer<typeof insertTaskCommentSchema>;

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

// System Options Types (following same pattern as Services/Rooms)
export type SelectOptionCategory = typeof optionCategories.$inferSelect;
export type InsertOptionCategory = z.infer<typeof insertOptionCategorySchema>;

export type SelectSystemOption = typeof systemOptions.$inferSelect;
export type InsertSystemOption = z.infer<typeof insertSystemOptionSchema>;

export type SelectRoomBooking = typeof roomBookings.$inferSelect;
export type InsertRoomBooking = z.infer<typeof insertRoomBookingSchema>;

export type SelectSessionBilling = typeof sessionBilling.$inferSelect;
export type InsertSessionBilling = z.infer<typeof insertSessionBillingSchema>;

// Checklist Types
export type ChecklistTemplate = typeof checklistTemplates.$inferSelect;
export type InsertChecklistTemplate = z.infer<typeof insertChecklistTemplateSchema>;

export type ChecklistItem = typeof checklistItems.$inferSelect;
export type InsertChecklistItem = z.infer<typeof insertChecklistItemSchema>;

export type ClientChecklist = typeof clientChecklists.$inferSelect;
export type InsertClientChecklist = z.infer<typeof insertClientChecklistSchema>;

export type ClientChecklistItem = typeof clientChecklistItems.$inferSelect;
export type InsertClientChecklistItem = z.infer<typeof insertClientChecklistItemSchema>;

// Notification Types
export type Notification = typeof notifications.$inferSelect;
export type InsertNotification = z.infer<typeof insertNotificationSchema>;

export type NotificationTrigger = typeof notificationTriggers.$inferSelect;
export type InsertNotificationTrigger = z.infer<typeof insertNotificationTriggerSchema>;

export type NotificationPreference = typeof notificationPreferences.$inferSelect;
export type InsertNotificationPreference = z.infer<typeof insertNotificationPreferenceSchema>;

export type NotificationTemplate = typeof notificationTemplates.$inferSelect;
export type InsertNotificationTemplate = z.infer<typeof insertNotificationTemplateSchema>;

// Practice Configuration Types
export type PracticeConfiguration = typeof practiceConfiguration.$inferSelect;
export type InsertPracticeConfiguration = z.infer<typeof insertPracticeConfigurationSchema>;

// Recent Items Types
export type RecentItem = typeof recentItems.$inferSelect;
export const insertRecentItemSchema = createInsertSchema(recentItems);
export type InsertRecentItem = z.infer<typeof insertRecentItemSchema>;
