# TherapyFlow

## Overview
TherapyFlow is a comprehensive therapy practice management application for healthcare professionals. It offers a full-stack solution to streamline operations by managing client information, scheduling, documentation, and administrative tasks. Key capabilities include robust client management, advanced scheduling, efficient data handling, AI-assisted note generation, and comprehensive billing integration, all designed to support modern therapy practices. The project aims to enhance efficiency and organization in clinical settings.

## User Preferences
Preferred communication style: Simple, everyday language.
Code organization: Keep code clean and well-organized when making changes.
Application name: TherapyFlow (to be used consistently throughout the application).

## System Architecture

### Frontend
- **Framework**: React 18 with TypeScript
- **Routing**: Wouter
- **State Management**: TanStack Query (React Query)
- **UI Framework**: Radix UI components with custom styling
- **Styling**: Tailwind CSS with CSS variables
- **Form Handling**: React Hook Form with Zod validation
- **Build Tool**: Vite
- **Design Principles**: Responsive (mobile-first), clean visual hierarchy, professional UI, color-coded indicators.
- **Date/Time Handling**:
    - Standardized display: "MMM dd, yyyy" for dates, "MMM dd, yyyy HH:mm:ss" for timestamps.
    - **CRITICAL Timezone Handling**: ALL dates and times MUST consistently use `America/New_York` (EST/EDT) timezone for display and input interpretation, while storing in UTC in the database.

### Backend
- **Runtime**: Node.js with TypeScript
- **Framework**: Express.js for REST API
- **Database ORM**: Drizzle ORM
- **Session Management**: Express sessions with PostgreSQL storage
- **API Design**: RESTful endpoints with CRUD operations.
- **Security**:
    - Role-based access control (Administrator, Clinical Supervisor, Therapist, Intern/Trainee) with 15 granular permissions.
    - Data isolation based on roles and supervisor assignments.
    - Authentication: `requireAuth` middleware for sensitive endpoints.
    - Authorization: Backend derives ALL access control decisions from `req.user` session context; never use user-supplied IDs/roles to prevent privilege escalation.

### Database
- **Database**: PostgreSQL (configured for Neon serverless)
- **ORM**: Drizzle ORM with schema-first approach
- **Migrations**: Drizzle Kit
- **Connection**: Connection pooling with `@neondatabase/serverless`
- **Data Models**: Clients, Users, Sessions, Tasks, Notes, Documents, System Options, Library (hierarchical), Assessment Templates, Checklist Templates, Supervisor Assignments.
- **Scalability**: Optimized for 5000+ client records with indexing and query optimization.

### Key Features
- **Client Management**: Comprehensive profiles, status tracking, search/filtering, bulk operations, direct scheduling.
- **Scheduling & Calendar**: Multi-view calendar, session management, role-based access, visual indicators, in-place session editing.
- **Session Notes**: Mood tracking, goals, interventions, clinical documentation, rich text editing (ReactQuill), and AI-assisted generation.
- **System Options Management**: Dynamic, database-driven configuration for all dropdown options.
- **Bulk Data Operations**: Bulk client and session upload via Excel with validation.
- **Task Management**: Creation, assignment, tracking, filtering, and commenting.
- **Hierarchical Library System**: Categorized clinical content with smart auto-connection and search.
- **Risk Assessment**: 10-factor matrix with automated scoring.
- **User Profile System**: Detailed user profiles with credentials and role management.
- **Billing Integration**: Service catalog (CPT codes), room management, automatic billing triggers, payment status tracking.
- **Assessment Management**: Template creation, client assignment, AI-powered report generation (ReactQuill), draft/finalize workflow, digital signatures, PDF/Word export, HIPAA audit logging.
- **Checklist Management**: Comprehensive templates for process workflows.
- **Dashboard**: Key metrics, quick actions, recent activity, upcoming deadlines.
- **HIPAA Compliance Audit System**: Comprehensive activity tracking for PHI access, data modifications, login attempts across critical operations (session notes, billing, client access, documents, user auth).
- **Email Communications History**: Audit trail of client emails (scheduling, reminders) with content and timestamps, accessible in client profiles.
- **Login Error Feedback**: Professional handling with specific backend messages, visual cues, and persistent error state.

## External Dependencies

### Core
- **@neondatabase/serverless**: PostgreSQL connection.
- **drizzle-orm**: Type-safe ORM.
- **@tanstack/react-query**: Server state management.
- **react-hook-form**: Form handling and validation.
- **zod**: Runtime type validation.
- **tailwindcss**: Utility-first CSS framework.
- **react-quill**: Rich text editor.

### UI & Utilities
- **@radix-ui/***: Headless UI components.
- **class-variance-authority**: Type-safe CSS class variants.
- **lucide-react**: Icon library.
- **date-fns**: Date manipulation utilities.
- **date-fns-tz**: Timezone-aware date utilities for consistent `America/New_York` handling.

### Development
- **typescript**: Type safety.
- **vite**: Fast development and build tooling.
- **tsx**: TypeScript execution for Node.js.

## Known Issues & Future Enhancements

### Assessment Report System - Recent Fixes (October 2025)
The following issues were identified and **successfully resolved**:

1. ✅ **Hardcoded Therapist ID (SECURITY ISSUE) - FIXED**
   - **Solution**: Now uses authenticated user context (`user.id`) with validation guards
   - **Impact**: All assessment responses and assignments correctly attributed to the actual logged-in user
   - **Validation**: Added authentication checks to prevent saving with invalid user IDs

2. ✅ **Data Display Inconsistency - FIXED**
   - **Solution**: Standardized all response formats to show readable text
   - **Rating Display**: Now shows "Moderate (3)" instead of "Rating: 3"
   - **Options Display**: Shows "Option 1" instead of "Selected option 0"
   - **Impact**: Professional, consistent report formatting

3. ✅ **Confusing Assessment Workflow - FIXED**
   - **Solution**: Implemented comprehensive completion flow with dialogs
   - **New Workflow**:
     1. Click "Complete Assessment"
     2. View completion summary (questions answered/skipped)
     3. See validation warnings for required questions
     4. Confirm completion
     5. Choose next action via clear dialog buttons:
        - **Edit Assessment** → Modify questions/answers
        - **View & Edit Report** → Generate and work with AI report
   - **Regenerate Protection**: Added confirmation dialog warning about data loss

4. ✅ **Missing Completion Summary/Validation - FIXED**
   - **Solution**: Added comprehensive validation dialog showing:
     - Total questions count
     - Answered questions count
     - Skipped questions count
     - Warnings for unanswered required questions
   - **Impact**: Users see exactly what they've completed before finalizing

5. ✅ **Unfilled Questions Validation - FIXED**
   - **Solution**: Validation warnings now displayed for incomplete required sections
   - **Impact**: Users are informed about missing data before completion

6. ✅ **Assessment Action Buttons Redesigned - FIXED (Oct 14, 2025)**
   - **Solution**: Redesigned to match Session Notes pattern exactly
   - **New Design**:
     - Single primary action button (color-coded by status):
       - PENDING → 🔵 "Start Assessment" (blue) - Auto-updates status to "in_progress"
       - IN_PROGRESS → 🟠 "Continue Assessment" (orange)
       - COMPLETED → 🟢 "View Report" (green)
     - Dropdown menu (⋮) with secondary actions (Edit Assessment, Delete)
   - **Status Management**: Clicking "Start Assessment" automatically changes status from "pending" to "in_progress"
   - **Impact**: Consistent UX with Session Notes, clear visual status indicators, organized action hierarchy

**Note**: Detailed AI-generated reports are intentional and necessary for proper clinical documentation.