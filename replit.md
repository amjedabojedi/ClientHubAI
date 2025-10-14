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

6. ✅ **Assessment Workflow & Status Management - FIXED (Oct 14, 2025)**
   - **Solution**: Redesigned to match Session Notes pattern with clear status progression
   - **Status Flow**:
     - **pending** → "Start Assessment" (blue) - Auto-updates to "therapist_completed"
     - **therapist_completed** → "Continue Assessment" (orange) - Therapist filling out questions
     - **waiting_for_therapist** → "Draft" (yellow) - Report generated, needs review/finalization
     - **completed** → "Finalized" (green) - Report locked and signed
   - **Workflow Transitions**:
     - Start: pending → therapist_completed (when clicking "Start Assessment")
     - Generate Report: therapist_completed → waiting_for_therapist (AI creates draft)
     - Finalize: waiting_for_therapist → completed (report locked with timestamp)
     - Edit Completed: completed → therapist_completed (unlocks for re-editing, must regenerate/finalize)
   - **UI Design**: Single primary action button (color-coded) + dropdown menu (⋮) for secondary actions (Edit, Delete)
   - **Impact**: Clear workflow progression, intuitive status transitions, matches session notes UX pattern

7. ✅ **Assessment Response Label Display - FIXED (Oct 14, 2025)**
   - **Problem**: Assessment responses showed generic "Option 1", "Option 2" instead of meaningful text labels
   - **Root Cause**: Completion form used hardcoded BDI-II options when database options missing, but report view had no such fallback
   - **Solution**: Added identical hardcoded BDI-II options fallback to report display (assessment-report.tsx)
   - **Result**: 
     - Responses now show actual text: "I am more irritable than usual." instead of "Option 2"
     - All 21 BDI-II questions display proper labels from hardcoded fallbacks
     - Status display shows "Draft" for waiting_for_therapist (matching button labels)
   - **Impact**: Professional, human-readable assessment reports with consistent status messaging
   - **Future Enhancement**: Centralize BDI-II constants to prevent drift between completion and report pages

8. ✅ **Assessment Edit Data Persistence & Refresh - FIXED (Oct 14, 2025)**
   - **Problem**: When editing assessments, changes appeared saved locally but didn't reflect properly or persist
   - **Root Cause**: 
     - Query invalidation was disabled to prevent UI flicker (commented out)
     - Response loading logic only loaded data once when state was empty, preventing fresh data updates
   - **Solution**: 
     - Enabled query invalidation after saves to refresh both responses and assignment data
     - Updated response loading to check for actual data changes and update accordingly
     - Added safety check to prevent infinite update loops
   - **Result**:
     - Assessment edits save to database correctly ✅
     - UI refreshes automatically after saves to show latest data ✅
     - Changes persist and display correctly when navigating away and returning ✅
   - **Impact**: Reliable data persistence with real-time UI updates for assessment editing

**Note**: Detailed AI-generated reports are intentional and necessary for proper clinical documentation.