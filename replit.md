# TherapyFlow

## Overview
TherapyFlow is a comprehensive therapy practice management application designed for healthcare professionals. It provides a full-stack solution for managing client information, scheduling, documentation, and administrative tasks, aiming to streamline operations for therapists. The application focuses on robust client management, advanced scheduling, and efficient data handling, supporting a modern therapy practice with features like AI-assisted note generation and comprehensive billing integration.

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
- **Design Principles**: Responsive design (mobile-first), clean visual hierarchy, professional UI components, color-coded indicators.
- **Date Formatting**: Standardized date display - "MMM dd, yyyy" for dates (e.g., "Oct 08, 2025") and "MMM dd, yyyy HH:mm:ss" for timestamps across all user-facing components.
- **Timezone Handling**: ALL dates and times MUST use America/New_York (EST/EDT) timezone consistently throughout the application. See Timezone Handling Pattern section below for implementation details.

### Backend
- **Runtime**: Node.js with TypeScript
- **Framework**: Express.js for REST API
- **Database ORM**: Drizzle ORM for type-safe operations
- **Session Management**: Express sessions with PostgreSQL storage
- **API Design**: RESTful endpoints with comprehensive CRUD operations.
- **Security**: Role-based access control (Administrator, Clinical Supervisor, Therapist, Intern/Trainee) with 15 granular permissions across 6 categories. Comprehensive data isolation based on roles and supervisor assignments.

### Database
- **Database**: PostgreSQL (configured for Neon serverless)
- **ORM**: Drizzle ORM with schema-first approach
- **Migrations**: Drizzle Kit for schema management
- **Connection**: Connection pooling with @neondatabase/serverless
- **Data Models**: Clients, Users, Sessions, Tasks, Notes, Documents, System Options, Library (hierarchical), Assessment Templates, Checklist Templates, Supervisor Assignments.
- **Scalability**: Optimized for 5000+ client records with efficient indexing, connection pooling, and query optimization.

### Key Features
- **Client Management**: Comprehensive profiles, status tracking, search/filtering, bulk operations, direct scheduling.
- **Scheduling & Calendar**: Multi-view calendar (monthly, day/week), session management, role-based access, visual indicators. In-place session editing from client profiles for client-centric workflow (with optional calendar view for full context).
- **Session Notes**: Comprehensive session note management with mood tracking, goals, interventions, clinical documentation fields, rich text editing capability (react-quill), and AI-assisted generation from templates. Full create/edit/delete functionality with authenticated user tracking.
- **System Options Management**: Dynamic, database-driven configuration for all dropdown options.
- **Bulk Data Operations**: Bulk client and session upload via Excel with field mapping, robust validation, and error reporting.
- **Task Management**: Comprehensive task creation, assignment, tracking, filtering, and commenting system.
- **Hierarchical Library System**: Categorized library of clinical content with smart auto-connection and search.
- **Risk Assessment**: Professional 10-factor risk matrix with automated scoring and clinical documentation.
- **User Profile System**: Detailed user profiles with professional credentials, role-based management, and supervisor assignments.
- **Billing Integration**: Service catalog with CPT codes, room management, automatic billing triggers from completed sessions, payment status tracking.
- **Assessment Management**: Creation of assessment templates with various question types, assignment to clients, and AI-powered report generation.
- **Checklist Management**: Comprehensive checklist templates for process workflows.
- **Dashboard**: Informative homepage with key metrics, quick actions, recent activity, and upcoming deadlines.
- **HIPAA Compliance Audit System**: Comprehensive activity tracking for healthcare privacy compliance including PHI access, data modifications, and login attempts.
  - **Audit Coverage**: Session notes (create/update/delete/AI), billing operations (status changes/payments/invoices), session updates (date/status/details), client access/modifications, document operations (upload/download/delete), user authentication (login/logout/failed attempts).
  - **Audit Data**: Each log captures user identity, client/session identifiers, timestamp, IP address, user agent, action type, and operation-specific metadata.
  - **Implementation**: Centralized AuditLogger service in `server/audit-logger.ts` with route-level integration in `server/routes.ts`. All PHI-sensitive operations trigger corresponding audit entries.
- **Email Communications History**: Complete audit trail of all client emails (session scheduled, rescheduled, 24hr reminders, intake reminders) with timestamps, email content, and collapsible view. Accessible via dedicated Communications tab in client profiles.
- **Login Error Feedback**: Professional login error handling with specific backend error messages (Invalid credentials, Network error, etc.), visual shake animation, and AlertCircle icon. Error state stored in AuthContext to persist across component re-renders.

## External Dependencies

### Core
- **@neondatabase/serverless**: PostgreSQL connection for serverless environments.
- **drizzle-orm**: Type-safe ORM.
- **@tanstack/react-query**: Server state management.
- **react-hook-form**: Form handling and validation.
- **zod**: Runtime type validation.
- **tailwindcss**: Utility-first CSS framework.
- **react-quill**: Rich text editor for formatted note content.

### UI & Utilities
- **@radix-ui/***: Headless UI components.
- **class-variance-authority**: Type-safe CSS class variants.
- **lucide-react**: Icon library.
- **date-fns**: Date manipulation utilities.

### Development
- **typescript**: Type safety.
- **vite**: Fast development and build tooling.
- **tsx**: TypeScript execution for Node.js.

## Timezone Handling Pattern

**CRITICAL**: ALL dates and times in TherapyFlow MUST use the America/New_York (EST/EDT) timezone consistently. This ensures accurate scheduling, notifications, billing, and clinical documentation regardless of server location or user browser timezone.

### Core Principle
- **Storage**: All dates are stored in UTC in the database
- **Display**: All dates are displayed in EST/EDT timezone to users
- **Input**: All user inputs are interpreted as EST/EDT and converted to UTC before storage

### Frontend Implementation

#### Saving Dates (Form Input → Database)
```typescript
// Import the helper function
import { localToUTC } from '@/lib/datetime';

// Convert EST date/time input to UTC before sending to server
const utcDate = localToUTC(date, time);
const isoString = utcDate.toISOString();
```

#### Displaying Dates (Database → User)
```typescript
// Import from date-fns-tz
import { formatInTimeZone } from 'date-fns-tz';

// Always use formatInTimeZone with America/New_York
const displayDate = formatInTimeZone(
  new Date(dbDate), 
  'America/New_York', 
  'MMM dd, yyyy'
);

const displayDateTime = formatInTimeZone(
  new Date(dbDateTime),
  'America/New_York',
  "MMM dd, yyyy 'at' h:mm a"
);
```

#### Common Frontend Patterns
```typescript
// ✅ CORRECT - Use formatInTimeZone
import { formatInTimeZone } from 'date-fns-tz';
formatInTimeZone(date, 'America/New_York', 'MMM dd, yyyy');

// ❌ WRONG - Never use plain format()
import { format } from 'date-fns';
format(date, 'MMM dd, yyyy'); // This uses browser timezone!

// ❌ WRONG - Never use browser methods
new Date().getHours(); // This uses browser timezone!
date.toLocaleString(); // This uses browser timezone!
```

### Backend Implementation

#### Saving Dates (User Input → Database)
```typescript
// Import from date-fns-tz
import { fromZonedTime } from 'date-fns-tz';

// Convert EST date/time string to UTC Date object
function convertESTToUTC(dateStr: string, timeStr: string): Date {
  const dateTime = `${dateStr}T${timeStr}`;
  return fromZonedTime(dateTime, 'America/New_York');
}

// Use when processing user input
const utcDate = convertESTToUTC('2025-10-11', '14:30');
```

#### Displaying Dates (Database → Output)
```typescript
// Import from date-fns-tz
import { formatInTimeZone } from 'date-fns-tz';

// For API responses, PDFs, emails, etc.
const formattedDate = formatInTimeZone(
  dbDate,
  'America/New_York',
  'MMM dd, yyyy'
);
```

#### Common Backend Patterns
```typescript
// ✅ CORRECT - Use formatInTimeZone for display
formatInTimeZone(date, 'America/New_York', 'MMM dd, yyyy');

// ✅ CORRECT - Use fromZonedTime for input
fromZonedTime(dateTime, 'America/New_York');

// ✅ CORRECT - Use toZonedTime for timezone conversion
import { toZonedTime } from 'date-fns-tz';
const estDate = toZonedTime(utcDate, 'America/New_York');

// ❌ WRONG - Never use plain format()
format(date, 'MMM dd, yyyy');

// ❌ WRONG - Never append 'Z' to force UTC
const dateStr = '2025-10-11T14:30Z'; // Wrong!
```

### Key Files Using Timezone Functions

#### Frontend
- `client/src/lib/datetime.ts` - Contains `localToUTC()` helper function
- `client/src/lib/task-utils.ts` - Contains shared `formatDate()` using EST
- `client/src/pages/scheduling.tsx` - Session creation/editing with timezone conversion
- `client/src/pages/client-detail.tsx` - Session display and editing with EST

#### Backend
- `server/routes.ts` - All date formatting for PDFs, emails, billing uses EST
- `server/pdf/session-note-pdf.ts` - PDF generation with EST dates
- `server/notification-service.ts` - Email scheduling and display using EST

### Critical Areas Requiring Timezone Handling
1. **Session Scheduling** - Creating/editing sessions must convert EST→UTC
2. **Session Display** - Calendar and session lists must show EST times
3. **Bulk Upload** - Excel date parsing must interpret as EST
4. **PDF Generation** - Session notes, billing invoices must show EST
5. **Email Notifications** - All dates in emails must be EST
6. **AI Context** - Session dates passed to AI must be formatted in EST
7. **Billing Reports** - Service dates and invoice dates must be EST
8. **Dashboard Widgets** - All date displays must use EST

### Testing Timezone Correctness
To verify timezone handling is correct:
1. Create a session at 2:00 PM EST
2. Check database - should store as UTC (likely 18:00 or 19:00 depending on DST)
3. Display session - should show 2:00 PM EST regardless of server/browser timezone
4. Generate PDF - should show 2:00 PM EST
5. Send email - should reference 2:00 PM EST

### Common Pitfalls to Avoid
- ❌ Using `format()` without timezone - always use `formatInTimeZone()`
- ❌ Using `new Date().getHours()` - always convert to EST first with `toZonedTime()`
- ❌ Using `.toLocaleString()` - browser-dependent, use `formatInTimeZone()`
- ❌ Appending 'Z' to date strings - use `fromZonedTime()` instead
- ❌ Assuming database dates are in EST - they're UTC, must convert for display