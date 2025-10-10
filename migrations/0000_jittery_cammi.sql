CREATE TYPE "public"."assessment_status" AS ENUM('pending', 'client_in_progress', 'waiting_for_therapist', 'therapist_completed', 'completed');--> statement-breakpoint
CREATE TYPE "public"."connection_type" AS ENUM('relates_to', 'follows_from', 'supports', 'alternative_to', 'prerequisite_for', 'expands_on');--> statement-breakpoint
CREATE TYPE "public"."question_type" AS ENUM('short_text', 'long_text', 'multiple_choice', 'rating_scale', 'checkbox', 'date', 'number');--> statement-breakpoint
CREATE TYPE "public"."report_section" AS ENUM('referral_reason', 'presenting_symptoms', 'background_history', 'mental_status_exam', 'risk_assessment', 'treatment_recommendations', 'goals_objectives', 'summary_impressions', 'objective_findings');--> statement-breakpoint
CREATE TYPE "public"."section_access" AS ENUM('therapist_only', 'client_only', 'shared');--> statement-breakpoint
CREATE TABLE "assessment_assignments" (
	"id" serial PRIMARY KEY NOT NULL,
	"template_id" integer NOT NULL,
	"client_id" integer NOT NULL,
	"assigned_by_id" integer NOT NULL,
	"status" varchar(30) DEFAULT 'pending' NOT NULL,
	"due_date" date,
	"completed_at" timestamp,
	"finalized_at" timestamp,
	"client_submitted_at" timestamp,
	"therapist_completed_at" timestamp,
	"total_score" numeric(10, 2),
	"notes" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "assessment_question_options" (
	"id" serial PRIMARY KEY NOT NULL,
	"question_id" integer NOT NULL,
	"option_text" text NOT NULL,
	"option_value" numeric(10, 2),
	"sort_order" integer DEFAULT 0
);
--> statement-breakpoint
CREATE TABLE "assessment_questions" (
	"id" serial PRIMARY KEY NOT NULL,
	"section_id" integer NOT NULL,
	"question_text" text NOT NULL,
	"question_type" varchar(30) NOT NULL,
	"is_required" boolean DEFAULT false,
	"sort_order" integer DEFAULT 0,
	"rating_min" integer,
	"rating_max" integer,
	"rating_labels" text[],
	"contributes_to_score" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "assessment_reports" (
	"id" serial PRIMARY KEY NOT NULL,
	"assignment_id" integer NOT NULL,
	"generated_content" text,
	"edited_content" text,
	"report_data" text,
	"generated_at" timestamp,
	"edited_at" timestamp,
	"exported_at" timestamp,
	"created_by_id" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assessment_responses" (
	"id" serial PRIMARY KEY NOT NULL,
	"assignment_id" integer NOT NULL,
	"question_id" integer NOT NULL,
	"responder_id" integer NOT NULL,
	"response_text" text,
	"selected_options" integer[],
	"rating_value" integer,
	"score_value" numeric(10, 2),
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "assessment_sections" (
	"id" serial PRIMARY KEY NOT NULL,
	"template_id" integer NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"access_level" varchar(20) DEFAULT 'therapist_only' NOT NULL,
	"is_scoring" boolean DEFAULT false,
	"report_mapping" varchar(50),
	"ai_report_prompt" text,
	"sort_order" integer DEFAULT 0,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "assessment_templates" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"category" varchar(100),
	"is_standardized" boolean DEFAULT false,
	"is_active" boolean DEFAULT true,
	"created_by_id" integer NOT NULL,
	"version" varchar(20) DEFAULT '1.0',
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"username" varchar(100),
	"action" varchar(100) NOT NULL,
	"result" varchar(20) NOT NULL,
	"resource_type" varchar(50),
	"resource_id" varchar(50),
	"client_id" integer,
	"ip_address" varchar(45),
	"user_agent" text,
	"session_id" varchar(255),
	"details" text,
	"risk_level" varchar(20) DEFAULT 'low',
	"timestamp" timestamp DEFAULT now() NOT NULL,
	"hipaa_relevant" boolean DEFAULT false NOT NULL,
	"data_fields" text,
	"access_reason" text
);
--> statement-breakpoint
CREATE TABLE "checklist_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"template_id" integer NOT NULL,
	"title" varchar(200) NOT NULL,
	"description" text,
	"category" varchar(50) NOT NULL,
	"is_required" boolean DEFAULT false NOT NULL,
	"days_from_start" integer,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "checklist_templates" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(100) NOT NULL,
	"description" text,
	"client_type" varchar(20),
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "client_checklist_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"client_checklist_id" integer NOT NULL,
	"checklist_item_id" integer NOT NULL,
	"is_completed" boolean DEFAULT false NOT NULL,
	"completed_at" timestamp,
	"completed_by" integer,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "client_checklists" (
	"id" serial PRIMARY KEY NOT NULL,
	"client_id" integer NOT NULL,
	"template_id" integer NOT NULL,
	"is_completed" boolean DEFAULT false NOT NULL,
	"completed_at" timestamp,
	"completed_by" integer,
	"notes" text,
	"due_date" date,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "clients" (
	"id" serial PRIMARY KEY NOT NULL,
	"client_id" varchar(20) NOT NULL,
	"full_name" text NOT NULL,
	"date_of_birth" date,
	"gender" varchar(20),
	"marital_status" varchar(50),
	"preferred_language" varchar(50),
	"pronouns" varchar(20),
	"email_notifications" boolean,
	"has_portal_access" boolean,
	"portal_email" text,
	"portal_password" varchar(255),
	"last_login" timestamp,
	"password_reset_token" varchar(255),
	"activation_token" varchar(255),
	"phone" varchar(20),
	"emergency_phone" varchar(20),
	"email" text,
	"street_address_1" text,
	"street_address_2" text,
	"city" varchar(100),
	"province" varchar(50),
	"postal_code" varchar(20),
	"country" varchar(100),
	"start_date" date,
	"referrer_name" text,
	"referral_date" date,
	"reference_number" varchar(100),
	"client_source" text,
	"employment_status" varchar(100),
	"education_level" varchar(100),
	"dependents" integer,
	"client_type" varchar(100),
	"status" varchar(50),
	"stage" varchar(50),
	"last_update_date" timestamp DEFAULT now() NOT NULL,
	"assigned_therapist_id" integer,
	"notes" text,
	"address" text,
	"state" varchar(50),
	"zip_code" varchar(10),
	"emergency_contact_name" text,
	"emergency_contact_phone" varchar(20),
	"emergency_contact_relationship" varchar(50),
	"insurance_provider" text,
	"policy_number" text,
	"group_number" text,
	"insurance_phone" varchar(20),
	"copay_amount" numeric(10, 2),
	"deductible" numeric(10, 2),
	"service_type" text,
	"service_frequency" varchar(100),
	"referral_source" text,
	"referral_type" text,
	"referring_person" text,
	"referral_notes" text,
	"needs_follow_up" boolean DEFAULT false,
	"follow_up_priority" varchar(20),
	"follow_up_date" date,
	"follow_up_notes" text,
	"last_session_date" timestamp,
	"next_appointment_date" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "clients_client_id_unique" UNIQUE("client_id")
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" serial PRIMARY KEY NOT NULL,
	"client_id" integer NOT NULL,
	"uploaded_by_id" integer NOT NULL,
	"file_name" text NOT NULL,
	"original_name" text NOT NULL,
	"file_size" integer NOT NULL,
	"mime_type" varchar(100) NOT NULL,
	"category" varchar(50) NOT NULL,
	"is_shared_in_portal" boolean DEFAULT false NOT NULL,
	"download_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "library_categories" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"parent_id" integer,
	"sort_order" integer DEFAULT 0,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "library_entries" (
	"id" serial PRIMARY KEY NOT NULL,
	"category_id" integer NOT NULL,
	"title" text NOT NULL,
	"content" text NOT NULL,
	"tags" text[],
	"created_by_id" integer NOT NULL,
	"is_active" boolean DEFAULT true,
	"sort_order" integer DEFAULT 0,
	"usage_count" integer DEFAULT 0,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "library_entry_connections" (
	"id" serial PRIMARY KEY NOT NULL,
	"from_entry_id" integer NOT NULL,
	"to_entry_id" integer NOT NULL,
	"connection_type" varchar(20) NOT NULL,
	"description" text,
	"strength" integer DEFAULT 1,
	"is_active" boolean DEFAULT true,
	"created_by_id" integer NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "login_attempts" (
	"id" serial PRIMARY KEY NOT NULL,
	"username" varchar(100) NOT NULL,
	"ip_address" varchar(45) NOT NULL,
	"user_agent" text,
	"success" boolean NOT NULL,
	"failure_reason" varchar(100),
	"timestamp" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notes" (
	"id" serial PRIMARY KEY NOT NULL,
	"client_id" integer NOT NULL,
	"author_id" integer NOT NULL,
	"title" text,
	"content" text NOT NULL,
	"note_type" varchar(50) DEFAULT 'general' NOT NULL,
	"is_private" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_preferences" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"trigger_type" varchar(50) NOT NULL,
	"delivery_methods" text,
	"timing" varchar(30) DEFAULT 'immediate' NOT NULL,
	"enable_in_app" boolean DEFAULT true NOT NULL,
	"enable_email" boolean DEFAULT false NOT NULL,
	"enable_sms" boolean DEFAULT false NOT NULL,
	"quiet_hours_start" varchar(8),
	"quiet_hours_end" varchar(8),
	"weekends_enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_templates" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(100) NOT NULL,
	"type" varchar(50) NOT NULL,
	"subject" varchar(255) NOT NULL,
	"body_template" text NOT NULL,
	"action_url_template" varchar(500),
	"action_label" varchar(100),
	"recipient_roles" text,
	"variables" text,
	"is_system" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "notification_templates_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "notification_triggers" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(100) NOT NULL,
	"description" text,
	"event_type" varchar(50) NOT NULL,
	"entity_type" varchar(50) NOT NULL,
	"condition_rules" text,
	"recipient_rules" text,
	"template_id" integer,
	"priority" varchar(20) DEFAULT 'medium' NOT NULL,
	"delay_minutes" integer DEFAULT 0,
	"batch_window_minutes" integer DEFAULT 5,
	"max_batch_size" integer DEFAULT 10,
	"is_scheduled" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "notification_triggers_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"type" varchar(50) NOT NULL,
	"title" varchar(255) NOT NULL,
	"message" text NOT NULL,
	"data" text,
	"priority" varchar(20) DEFAULT 'medium' NOT NULL,
	"is_read" boolean DEFAULT false NOT NULL,
	"read_at" timestamp,
	"action_url" varchar(500),
	"action_label" varchar(100),
	"grouping_key" varchar(100),
	"expires_at" timestamp,
	"related_entity_type" varchar(50),
	"related_entity_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "option_categories" (
	"id" serial PRIMARY KEY NOT NULL,
	"category_key" varchar(100) NOT NULL,
	"category_name" varchar(255) NOT NULL,
	"description" text,
	"is_system" boolean DEFAULT true NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "option_categories_category_key_unique" UNIQUE("category_key")
);
--> statement-breakpoint
CREATE TABLE "permissions" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(100) NOT NULL,
	"display_name" varchar(150) NOT NULL,
	"description" text,
	"category" varchar(50) NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "permissions_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "practice_configuration" (
	"id" serial PRIMARY KEY NOT NULL,
	"practice_name" varchar(255) DEFAULT 'TherapyFlow Healthcare Services' NOT NULL,
	"practice_address" text DEFAULT '123 Healthcare Ave, Suite 100
Mental Health City, CA 90210',
	"practice_phone" varchar(50) DEFAULT '(555) 123-4567',
	"practice_email" varchar(255) DEFAULT 'contact@therapyflow.com',
	"practice_website" varchar(255) DEFAULT 'www.therapyflow.com',
	"tax_id" varchar(50) DEFAULT '12-3456789',
	"license_number" varchar(100) DEFAULT 'PSY-12345-CA',
	"license_state" varchar(50) DEFAULT 'California',
	"npi_number" varchar(50) DEFAULT '1234567890',
	"description" text DEFAULT 'Professional Mental Health Services',
	"subtitle" text DEFAULT 'Licensed Clinical Practice',
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recent_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"entity_type" varchar(20) NOT NULL,
	"entity_id" integer NOT NULL,
	"viewed_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "role_permissions" (
	"id" serial PRIMARY KEY NOT NULL,
	"role_id" integer NOT NULL,
	"permission_id" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(50) NOT NULL,
	"display_name" varchar(100) NOT NULL,
	"description" text,
	"is_system" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "roles_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "room_bookings" (
	"id" serial PRIMARY KEY NOT NULL,
	"room_id" integer NOT NULL,
	"session_id" integer NOT NULL,
	"start_time" timestamp NOT NULL,
	"end_time" timestamp NOT NULL,
	"booked_by" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rooms" (
	"id" serial PRIMARY KEY NOT NULL,
	"room_number" varchar(50) NOT NULL,
	"room_name" varchar(255) NOT NULL,
	"capacity" integer,
	"equipment" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "rooms_room_number_unique" UNIQUE("room_number")
);
--> statement-breakpoint
CREATE TABLE "scheduled_notifications" (
	"id" serial PRIMARY KEY NOT NULL,
	"trigger_id" integer NOT NULL,
	"session_id" integer,
	"entity_type" varchar(50) NOT NULL,
	"entity_id" integer NOT NULL,
	"entity_data" text NOT NULL,
	"execute_at" timestamp NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"processed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "services" (
	"id" serial PRIMARY KEY NOT NULL,
	"service_code" varchar(50) NOT NULL,
	"service_name" varchar(255) NOT NULL,
	"description" text,
	"duration" integer NOT NULL,
	"base_rate" numeric(10, 2) NOT NULL,
	"category" varchar(100),
	"is_active" boolean DEFAULT true NOT NULL,
	"therapist_visible" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "services_service_code_unique" UNIQUE("service_code")
);
--> statement-breakpoint
CREATE TABLE "session_billing" (
	"id" serial PRIMARY KEY NOT NULL,
	"session_id" integer NOT NULL,
	"service_code" varchar(20) NOT NULL,
	"units" integer DEFAULT 1 NOT NULL,
	"rate_per_unit" numeric(10, 2) NOT NULL,
	"total_amount" numeric(10, 2) NOT NULL,
	"insurance_covered" boolean DEFAULT false NOT NULL,
	"copay_amount" numeric(10, 2),
	"billing_date" date,
	"payment_status" varchar(20) DEFAULT 'pending' NOT NULL,
	"payment_amount" numeric(10, 2),
	"payment_date" date,
	"payment_reference" varchar(100),
	"payment_method" varchar(50),
	"payment_notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session_notes" (
	"id" serial PRIMARY KEY NOT NULL,
	"session_id" integer NOT NULL,
	"client_id" integer NOT NULL,
	"therapist_id" integer NOT NULL,
	"date" timestamp NOT NULL,
	"session_focus" text,
	"symptoms" text,
	"short_term_goals" text,
	"intervention" text,
	"progress" text,
	"remarks" text,
	"recommendations" text,
	"client_rating" integer,
	"therapist_rating" integer,
	"progress_toward_goals" integer,
	"mood_before" integer,
	"mood_after" integer,
	"generated_content" text,
	"draft_content" text,
	"final_content" text,
	"is_draft" boolean DEFAULT true NOT NULL,
	"is_finalized" boolean DEFAULT false NOT NULL,
	"finalized_at" timestamp,
	"ai_enabled" boolean DEFAULT false NOT NULL,
	"custom_ai_prompt" text,
	"ai_processing_status" varchar(50) DEFAULT 'idle',
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"client_id" integer NOT NULL,
	"therapist_id" integer NOT NULL,
	"service_id" integer NOT NULL,
	"room_id" integer,
	"session_date" timestamp NOT NULL,
	"session_type" varchar(100) NOT NULL,
	"status" varchar(50) DEFAULT 'scheduled' NOT NULL,
	"notes" text,
	"calculated_rate" numeric(10, 2),
	"insurance_applicable" boolean DEFAULT false NOT NULL,
	"billing_notes" text,
	"zoom_enabled" boolean DEFAULT false NOT NULL,
	"zoom_meeting_id" varchar(50),
	"zoom_join_url" text,
	"zoom_password" varchar(50),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "supervisor_assignments" (
	"id" serial PRIMARY KEY NOT NULL,
	"supervisor_id" integer NOT NULL,
	"therapist_id" integer NOT NULL,
	"assigned_date" timestamp DEFAULT now() NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"notes" text,
	"required_meeting_frequency" varchar(50),
	"next_meeting_date" timestamp,
	"last_meeting_date" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "system_options" (
	"id" serial PRIMARY KEY NOT NULL,
	"category_id" integer NOT NULL,
	"option_key" varchar(100) NOT NULL,
	"option_label" varchar(255) NOT NULL,
	"sort_order" integer DEFAULT 0,
	"is_default" boolean DEFAULT false NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"price" numeric(10, 2) DEFAULT '0.00',
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task_comments" (
	"id" serial PRIMARY KEY NOT NULL,
	"task_id" integer NOT NULL,
	"author_id" integer NOT NULL,
	"content" text NOT NULL,
	"is_internal" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" serial PRIMARY KEY NOT NULL,
	"client_id" integer NOT NULL,
	"assigned_to_id" integer,
	"title" text NOT NULL,
	"description" text,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"priority" varchar(20) DEFAULT 'medium' NOT NULL,
	"due_date" timestamp,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_activity_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"action" text NOT NULL,
	"resource_type" text,
	"resource_id" integer,
	"details" text,
	"ip_address" varchar(45),
	"user_agent" text,
	"timestamp" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_profiles" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"license_number" varchar(50),
	"license_type" varchar(100),
	"license_state" varchar(50),
	"license_expiry" date,
	"license_status" varchar(20) DEFAULT 'active',
	"specializations" text[],
	"treatment_approaches" text[],
	"age_groups" text[],
	"languages" text[],
	"certifications" text[],
	"education" text[],
	"years_of_experience" integer,
	"working_days" text[],
	"working_hours" text,
	"max_clients_per_day" integer,
	"session_duration" integer DEFAULT 50,
	"availability_status" varchar(20) DEFAULT 'available',
	"emergency_contact_name" text,
	"emergency_contact_phone" varchar(20),
	"emergency_contact_relationship" varchar(50),
	"previous_positions" text[],
	"clinical_experience" text,
	"research_background" text,
	"publications" text[],
	"professional_memberships" text[],
	"continuing_education" text[],
	"supervisory_experience" text,
	"award_recognitions" text[],
	"professional_references" text[],
	"career_objectives" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"session_token" varchar(255) NOT NULL,
	"ip_address" varchar(45) NOT NULL,
	"user_agent" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_activity" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp NOT NULL,
	CONSTRAINT "user_sessions_session_token_unique" UNIQUE("session_token")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"password" text NOT NULL,
	"full_name" text NOT NULL,
	"email" text NOT NULL,
	"role" varchar(20) DEFAULT 'therapist' NOT NULL,
	"custom_role_id" integer,
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"last_login" timestamp,
	"password_reset_token" text,
	"password_reset_expiry" timestamp,
	"email_verified" boolean DEFAULT false NOT NULL,
	"email_verification_token" text,
	"phone" varchar(20),
	"title" varchar(100),
	"department" varchar(100),
	"bio" text,
	"profile_picture" text,
	"signature_image" text,
	"zoom_account_id" varchar(255),
	"zoom_client_id" varchar(255),
	"zoom_client_secret" text,
	"zoom_access_token" text,
	"zoom_token_expiry" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_by" integer,
	"is_active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "users_username_unique" UNIQUE("username"),
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "assessment_assignments" ADD CONSTRAINT "assessment_assignments_template_id_assessment_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."assessment_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessment_assignments" ADD CONSTRAINT "assessment_assignments_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessment_assignments" ADD CONSTRAINT "assessment_assignments_assigned_by_id_users_id_fk" FOREIGN KEY ("assigned_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessment_question_options" ADD CONSTRAINT "assessment_question_options_question_id_assessment_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."assessment_questions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessment_questions" ADD CONSTRAINT "assessment_questions_section_id_assessment_sections_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."assessment_sections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessment_reports" ADD CONSTRAINT "assessment_reports_assignment_id_assessment_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."assessment_assignments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessment_reports" ADD CONSTRAINT "assessment_reports_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessment_responses" ADD CONSTRAINT "assessment_responses_assignment_id_assessment_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."assessment_assignments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessment_responses" ADD CONSTRAINT "assessment_responses_question_id_assessment_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."assessment_questions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessment_responses" ADD CONSTRAINT "assessment_responses_responder_id_users_id_fk" FOREIGN KEY ("responder_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessment_sections" ADD CONSTRAINT "assessment_sections_template_id_assessment_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."assessment_templates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessment_templates" ADD CONSTRAINT "assessment_templates_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checklist_items" ADD CONSTRAINT "checklist_items_template_id_checklist_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."checklist_templates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_checklist_items" ADD CONSTRAINT "client_checklist_items_client_checklist_id_client_checklists_id_fk" FOREIGN KEY ("client_checklist_id") REFERENCES "public"."client_checklists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_checklist_items" ADD CONSTRAINT "client_checklist_items_checklist_item_id_checklist_items_id_fk" FOREIGN KEY ("checklist_item_id") REFERENCES "public"."checklist_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_checklist_items" ADD CONSTRAINT "client_checklist_items_completed_by_users_id_fk" FOREIGN KEY ("completed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_checklists" ADD CONSTRAINT "client_checklists_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_checklists" ADD CONSTRAINT "client_checklists_template_id_checklist_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."checklist_templates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_checklists" ADD CONSTRAINT "client_checklists_completed_by_users_id_fk" FOREIGN KEY ("completed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clients" ADD CONSTRAINT "clients_assigned_therapist_id_users_id_fk" FOREIGN KEY ("assigned_therapist_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_uploaded_by_id_users_id_fk" FOREIGN KEY ("uploaded_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "library_entries" ADD CONSTRAINT "library_entries_category_id_library_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."library_categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "library_entries" ADD CONSTRAINT "library_entries_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "library_entry_connections" ADD CONSTRAINT "library_entry_connections_from_entry_id_library_entries_id_fk" FOREIGN KEY ("from_entry_id") REFERENCES "public"."library_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "library_entry_connections" ADD CONSTRAINT "library_entry_connections_to_entry_id_library_entries_id_fk" FOREIGN KEY ("to_entry_id") REFERENCES "public"."library_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "library_entry_connections" ADD CONSTRAINT "library_entry_connections_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_triggers" ADD CONSTRAINT "notification_triggers_template_id_notification_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."notification_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recent_items" ADD CONSTRAINT "recent_items_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_id_permissions_id_fk" FOREIGN KEY ("permission_id") REFERENCES "public"."permissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_bookings" ADD CONSTRAINT "room_bookings_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_bookings" ADD CONSTRAINT "room_bookings_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_bookings" ADD CONSTRAINT "room_bookings_booked_by_users_id_fk" FOREIGN KEY ("booked_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_notifications" ADD CONSTRAINT "scheduled_notifications_trigger_id_notification_triggers_id_fk" FOREIGN KEY ("trigger_id") REFERENCES "public"."notification_triggers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_notifications" ADD CONSTRAINT "scheduled_notifications_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_billing" ADD CONSTRAINT "session_billing_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_notes" ADD CONSTRAINT "session_notes_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_notes" ADD CONSTRAINT "session_notes_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_notes" ADD CONSTRAINT "session_notes_therapist_id_users_id_fk" FOREIGN KEY ("therapist_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_therapist_id_users_id_fk" FOREIGN KEY ("therapist_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supervisor_assignments" ADD CONSTRAINT "supervisor_assignments_supervisor_id_users_id_fk" FOREIGN KEY ("supervisor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supervisor_assignments" ADD CONSTRAINT "supervisor_assignments_therapist_id_users_id_fk" FOREIGN KEY ("therapist_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "system_options" ADD CONSTRAINT "system_options_category_id_option_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."option_categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_comments" ADD CONSTRAINT "task_comments_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_comments" ADD CONSTRAINT "task_comments_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_assigned_to_id_users_id_fk" FOREIGN KEY ("assigned_to_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_activity_log" ADD CONSTRAINT "user_activity_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_profiles" ADD CONSTRAINT "user_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_sessions" ADD CONSTRAINT "user_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_custom_role_id_roles_id_fk" FOREIGN KEY ("custom_role_id") REFERENCES "public"."roles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_logs_user_idx" ON "audit_logs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "audit_logs_timestamp_idx" ON "audit_logs" USING btree ("timestamp");--> statement-breakpoint
CREATE INDEX "audit_logs_action_idx" ON "audit_logs" USING btree ("action");--> statement-breakpoint
CREATE INDEX "audit_logs_client_idx" ON "audit_logs" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "audit_logs_hipaa_idx" ON "audit_logs" USING btree ("hipaa_relevant");--> statement-breakpoint
CREATE INDEX "audit_logs_risk_idx" ON "audit_logs" USING btree ("risk_level");--> statement-breakpoint
CREATE INDEX "audit_logs_user_timestamp_idx" ON "audit_logs" USING btree ("user_id","timestamp");--> statement-breakpoint
CREATE INDEX "client_checklist_items_checklist_item_idx" ON "client_checklist_items" USING btree ("client_checklist_id","checklist_item_id");--> statement-breakpoint
CREATE INDEX "client_checklists_client_template_idx" ON "client_checklists" USING btree ("client_id","template_id");--> statement-breakpoint
CREATE INDEX "clients_name_idx" ON "clients" USING btree ("full_name");--> statement-breakpoint
CREATE INDEX "clients_email_idx" ON "clients" USING btree ("email");--> statement-breakpoint
CREATE INDEX "clients_phone_idx" ON "clients" USING btree ("phone");--> statement-breakpoint
CREATE INDEX "clients_status_idx" ON "clients" USING btree ("status");--> statement-breakpoint
CREATE INDEX "clients_therapist_idx" ON "clients" USING btree ("assigned_therapist_id");--> statement-breakpoint
CREATE INDEX "clients_created_at_idx" ON "clients" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "documents_client_id_idx" ON "documents" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "login_attempts_username_idx" ON "login_attempts" USING btree ("username");--> statement-breakpoint
CREATE INDEX "login_attempts_ip_idx" ON "login_attempts" USING btree ("ip_address");--> statement-breakpoint
CREATE INDEX "login_attempts_timestamp_idx" ON "login_attempts" USING btree ("timestamp");--> statement-breakpoint
CREATE INDEX "login_attempts_success_idx" ON "login_attempts" USING btree ("success");--> statement-breakpoint
CREATE INDEX "notification_preferences_user_trigger_idx" ON "notification_preferences" USING btree ("user_id","trigger_type");--> statement-breakpoint
CREATE INDEX "notification_templates_type_idx" ON "notification_templates" USING btree ("type");--> statement-breakpoint
CREATE INDEX "notification_templates_active_idx" ON "notification_templates" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "notification_triggers_event_type_idx" ON "notification_triggers" USING btree ("event_type");--> statement-breakpoint
CREATE INDEX "notification_triggers_entity_type_idx" ON "notification_triggers" USING btree ("entity_type");--> statement-breakpoint
CREATE INDEX "notification_triggers_active_idx" ON "notification_triggers" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "notifications_user_type_idx" ON "notifications" USING btree ("user_id","type");--> statement-breakpoint
CREATE INDEX "notifications_unread_idx" ON "notifications" USING btree ("user_id","is_read");--> statement-breakpoint
CREATE INDEX "notifications_entity_idx" ON "notifications" USING btree ("related_entity_type","related_entity_id");--> statement-breakpoint
CREATE INDEX "notifications_created_at_idx" ON "notifications" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "permissions_name_idx" ON "permissions" USING btree ("name");--> statement-breakpoint
CREATE INDEX "permissions_category_idx" ON "permissions" USING btree ("category");--> statement-breakpoint
CREATE INDEX "recent_items_user_entity_idx" ON "recent_items" USING btree ("user_id","entity_type");--> statement-breakpoint
CREATE INDEX "recent_items_user_viewed_idx" ON "recent_items" USING btree ("user_id","viewed_at");--> statement-breakpoint
CREATE INDEX "role_permissions_role_permission_idx" ON "role_permissions" USING btree ("role_id","permission_id");--> statement-breakpoint
CREATE INDEX "roles_name_idx" ON "roles" USING btree ("name");--> statement-breakpoint
CREATE INDEX "unique_room_time_slot" ON "room_bookings" USING btree ("room_id","start_time","end_time");--> statement-breakpoint
CREATE INDEX "scheduled_notifications_execute_at_idx" ON "scheduled_notifications" USING btree ("execute_at","status");--> statement-breakpoint
CREATE INDEX "scheduled_notifications_session_trigger_idx" ON "scheduled_notifications" USING btree ("session_id","trigger_id");--> statement-breakpoint
CREATE INDEX "scheduled_notifications_status_idx" ON "scheduled_notifications" USING btree ("status");--> statement-breakpoint
CREATE INDEX "billing_date_idx" ON "session_billing" USING btree ("billing_date");--> statement-breakpoint
CREATE INDEX "payment_status_idx" ON "session_billing" USING btree ("payment_status");--> statement-breakpoint
CREATE INDEX "service_code_idx" ON "session_billing" USING btree ("service_code");--> statement-breakpoint
CREATE INDEX "session_billing_session_id_idx" ON "session_billing" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "billing_date_status_idx" ON "session_billing" USING btree ("billing_date","payment_status");--> statement-breakpoint
CREATE INDEX "billing_date_service_idx" ON "session_billing" USING btree ("billing_date","service_code");--> statement-breakpoint
CREATE INDEX "sessions_therapist_id_idx" ON "sessions" USING btree ("therapist_id");--> statement-breakpoint
CREATE INDEX "sessions_client_id_idx" ON "sessions" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "sessions_date_idx" ON "sessions" USING btree ("session_date");--> statement-breakpoint
CREATE INDEX "sessions_service_id_idx" ON "sessions" USING btree ("service_id");--> statement-breakpoint
CREATE INDEX "supervisor_assignments_supervisor_id_idx" ON "supervisor_assignments" USING btree ("supervisor_id");--> statement-breakpoint
CREATE INDEX "supervisor_assignments_therapist_id_idx" ON "supervisor_assignments" USING btree ("therapist_id");--> statement-breakpoint
CREATE INDEX "supervisor_assignments_active_idx" ON "supervisor_assignments" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "unique_category_option" ON "system_options" USING btree ("category_id","option_key");--> statement-breakpoint
CREATE INDEX "user_activity_log_user_id_idx" ON "user_activity_log" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "user_activity_log_action_idx" ON "user_activity_log" USING btree ("action");--> statement-breakpoint
CREATE INDEX "user_activity_log_timestamp_idx" ON "user_activity_log" USING btree ("timestamp");--> statement-breakpoint
CREATE INDEX "user_profiles_user_id_idx" ON "user_profiles" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "user_profiles_license_number_idx" ON "user_profiles" USING btree ("license_number");--> statement-breakpoint
CREATE INDEX "user_profiles_specializations_idx" ON "user_profiles" USING btree ("specializations");--> statement-breakpoint
CREATE INDEX "user_sessions_token_idx" ON "user_sessions" USING btree ("session_token");--> statement-breakpoint
CREATE INDEX "user_sessions_user_idx" ON "user_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "user_sessions_active_idx" ON "user_sessions" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "user_sessions_expires_idx" ON "user_sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "users_email_idx" ON "users" USING btree ("email");--> statement-breakpoint
CREATE INDEX "users_role_idx" ON "users" USING btree ("role");--> statement-breakpoint
CREATE INDEX "users_status_idx" ON "users" USING btree ("status");