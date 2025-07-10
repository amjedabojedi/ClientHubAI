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

// Clients table with proper indexing for 5000+ records
export const clients = pgTable("clients", {
  id: serial("id").primaryKey(),
  clientId: varchar("client_id", { length: 20 }).notNull().unique(), // CL-2024-0001 format
  fullName: text("full_name").notNull(),
  dateOfBirth: date("date_of_birth"),
  phone: varchar("phone", { length: 20 }),
  email: text("email"),
  gender: genderEnum("gender"),
  preferredLanguage: varchar("preferred_language", { length: 50 }).default('English'),
  pronouns: varchar("pronouns", { length: 20 }),
  
  // Address fields
  address: text("address"),
  city: varchar("city", { length: 100 }),
  state: varchar("state", { length: 50 }),
  zipCode: varchar("zip_code", { length: 10 }),
  
  // Emergency contact
  emergencyContactName: text("emergency_contact_name"),
  emergencyContactPhone: varchar("emergency_contact_phone", { length: 20 }),
  emergencyContactRelationship: varchar("emergency_contact_relationship", { length: 50 }),
  
  // Status and assignment
  status: clientStatusEnum("status").notNull().default('pending'),
  stage: clientStageEnum("stage").notNull().default('intake'),
  clientType: clientTypeEnum("client_type").notNull().default('individual'),
  assignedTherapistId: integer("assigned_therapist_id").references(() => users.id),
  
  // Portal and access
  hasPortalAccess: boolean("has_portal_access").notNull().default(false),
  portalEmail: text("portal_email"),
  
  // Referral information
  referralSource: text("referral_source"),
  referralType: text("referral_type"),
  referringPerson: text("referring_person"),
  referralDate: date("referral_date"),
  referralNotes: text("referral_notes"),
  
  // Insurance information
  insuranceProvider: text("insurance_provider"),
  policyNumber: text("policy_number"),
  groupNumber: text("group_number"),
  insurancePhone: varchar("insurance_phone", { length: 20 }),
  copayAmount: decimal("copay_amount", { precision: 10, scale: 2 }),
  deductible: decimal("deductible", { precision: 10, scale: 2 }),
  
  // Timestamps
  startDate: date("start_date"),
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

// Sessions table
export const sessions = pgTable("sessions", {
  id: serial("id").primaryKey(),
  clientId: integer("client_id").notNull().references(() => clients.id, { onDelete: 'cascade' }),
  therapistId: integer("therapist_id").notNull().references(() => users.id),
  sessionDate: timestamp("session_date").notNull(),
  sessionType: sessionTypeEnum("session_type").notNull(),
  status: sessionStatusEnum("status").notNull().default('scheduled'),
  duration: integer("duration"), // in minutes
  notes: text("notes"),
  serviceProvided: text("service_provided"),
  room: varchar("room", { length: 50 }),
  price: decimal("price", { precision: 10, scale: 2 }),
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

// Relations
export const usersRelations = relations(users, ({ many }) => ({
  clients: many(clients),
  sessions: many(sessions),
  tasks: many(tasks),
  notes: many(notes),
  documents: many(documents),
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
}));

export const sessionsRelations = relations(sessions, ({ one }) => ({
  client: one(clients, {
    fields: [sessions.clientId],
    references: [clients.id],
  }),
  therapist: one(users, {
    fields: [sessions.therapistId],
    references: [users.id],
  }),
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

export const insertSessionSchema = createInsertSchema(sessions).omit({
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
