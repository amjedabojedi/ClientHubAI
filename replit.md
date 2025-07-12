# Client Management System

## Overview

This is a comprehensive Client Management System (CMS) designed for healthcare professionals, specifically therapists. The application provides a full-stack solution for managing client information, scheduling, documentation, and administrative tasks. It's built as a modern web application with a React frontend and Express.js backend, using PostgreSQL for data persistence.

## User Preferences

Preferred communication style: Simple, everyday language.
Code organization: Keep code clean and well-organized when making changes.

## System Architecture

### Frontend Architecture
- **Framework**: React 18 with TypeScript
- **Routing**: Wouter for client-side navigation
- **State Management**: TanStack Query (React Query) for server state management
- **UI Framework**: Radix UI components with custom styling
- **Styling**: Tailwind CSS with CSS variables for theming
- **Form Handling**: React Hook Form with Zod validation
- **Build Tool**: Vite for development and bundling

### Backend Architecture
- **Runtime**: Node.js with TypeScript
- **Framework**: Express.js for REST API
- **Database ORM**: Drizzle ORM for type-safe database operations
- **Session Management**: Express sessions with PostgreSQL storage
- **API Design**: RESTful endpoints with comprehensive CRUD operations

### Database Architecture
- **Database**: PostgreSQL (configured for Neon serverless)
- **ORM**: Drizzle ORM with schema-first approach
- **Migrations**: Drizzle Kit for database schema management
- **Connection**: Connection pooling with @neondatabase/serverless

## Key Components

### Client Management Module
The core feature providing comprehensive client lifecycle management:
- **Client Profiles**: Complete demographic and contact information
- **Status Tracking**: Active, inactive, and pending client states
- **Stage Management**: Intake, assessment, and psychotherapy phases
- **Search & Filtering**: Advanced filtering by multiple criteria
- **Bulk Operations**: Mass actions on multiple client records
- **Direct Scheduling**: Schedule button on each client for immediate appointment creation

### Scheduling & Calendar System
Advanced appointment management with multi-view calendar system:
- **Monthly Calendar View**: Full calendar grid with session indicators and click-to-edit
- **Day/Week Views**: Detailed timeline views with session blocks
- **Client Integration**: Direct links between sessions and client profiles
- **Search & Filtering**: Find sessions by client name or therapist
- **Session Management**: Create, edit, reschedule, and cancel appointments
- **Role-Based Access**: Therapist-specific views and admin oversight
- **Quick Actions**: Schedule additional sessions, view client profiles
- **Visual Indicators**: Color-coded session types and status badges
- **Avatar Integration**: Client initials and profile pictures in session cards

### Data Models
- **Clients**: Full client profiles with demographics, contact info, and clinical data
- **Users**: Therapist and staff accounts with role-based permissions
- **Sessions**: Appointment and session tracking
- **Tasks**: Task management with priorities and status tracking
- **Notes**: Clinical notes and documentation
- **Documents**: File attachments and document management

### UI Components
- **Responsive Design**: Mobile-first approach with desktop optimization
- **Component Library**: Comprehensive set of reusable UI components
- **Data Grid**: Sortable, filterable table with pagination
- **Modal System**: Detailed client information overlays
- **Form Controls**: Validated forms with real-time feedback

## Data Flow

### Client Data Retrieval
1. Frontend requests client data via TanStack Query
2. Express API handles request with filtering/pagination parameters
3. Drizzle ORM constructs optimized PostgreSQL queries
4. Results are returned with metadata (total count, pagination info)
5. Frontend updates UI with loading states and error handling

### Client Operations
1. User interactions trigger form submissions or bulk actions
2. Frontend validates data using Zod schemas
3. API endpoints process requests with proper error handling
4. Database operations are executed within transactions
5. Success/error feedback is provided to the user

### Real-time Updates
- Optimistic updates for immediate user feedback
- Query invalidation for data consistency
- Debounced search to reduce API calls
- Pagination and sorting maintained across operations

## External Dependencies

### Core Dependencies
- **@neondatabase/serverless**: PostgreSQL connection for serverless environments
- **drizzle-orm**: Type-safe ORM for database operations
- **@tanstack/react-query**: Server state management
- **react-hook-form**: Form handling and validation
- **zod**: Runtime type validation
- **tailwindcss**: Utility-first CSS framework

### UI Dependencies
- **@radix-ui/***: Headless UI components for accessibility
- **class-variance-authority**: Type-safe CSS class variants
- **lucide-react**: Icon library
- **date-fns**: Date manipulation utilities

### Development Dependencies
- **typescript**: Type safety across the stack
- **vite**: Fast development and build tooling
- **tsx**: TypeScript execution for Node.js

## Deployment Strategy

### Development Environment
- **Dev Server**: Vite development server with HMR
- **API Server**: Express server with file watching
- **Database**: Local PostgreSQL or Neon development database
- **Environment Variables**: Database URL and configuration

### Production Build
- **Frontend**: Vite builds optimized static assets
- **Backend**: ESBuild bundles server code for Node.js
- **Static Serving**: Express serves built frontend assets
- **Database**: PostgreSQL with connection pooling

### Environment Configuration
- **DATABASE_URL**: PostgreSQL connection string
- **NODE_ENV**: Environment-specific configuration
- **Session Management**: Secure session configuration for production

### Scalability Considerations
- **Database Indexing**: Optimized for 5000+ client records
- **Connection Pooling**: Efficient database connection management
- **Query Optimization**: Drizzle ORM generates efficient SQL
- **Frontend Performance**: Code splitting and lazy loading ready

## Recent Changes

### Two-Step AI Session Note Generation (January 2025)
- **Two-Step Workflow**: Implemented separate template creation and content generation phases for optimal AI assistance
- **Template Creation**: Users save custom instructions that guide AI generation process for consistent, personalized output
- **Content Generation**: AI generates session notes after clinical fields are filled, using saved template instructions
- **Dual Button Interface**: "Create Template" button for saving instructions, "Generate Content" button for actual AI generation
- **State Management**: UI dynamically shows template status (create vs edit) and enables content generation only after template is saved
- **Field-Based Generation**: AI processes filled clinical fields combined with saved template instructions for contextual content
- **Professional Workflow**: Separates planning phase (template creation) from documentation phase (content generation)
- **Custom Instructions**: Users provide detailed therapy approach, formatting preferences, and clinical focus areas
- **Real-Time Processing**: AI processes user instructions along with client and session data for contextual content generation
- **Error Handling**: Comprehensive validation ensuring template exists before content generation
- **Integration Ready**: Works seamlessly with existing Library system for content insertion into AI-generated templates

### Session Notes Feature Implementation (January 2025)
- **Database Schema**: Added comprehensive session notes table with detailed tracking fields and AI management columns
- **Backend API**: Implemented full CRUD operations for session notes management with integrated AI processing
- **Session Notes Manager**: Built comprehensive component with advanced features including mood tracking, goals, interventions, assessments, and privacy controls
- **Workflow Integration**: Added "Add Notes" buttons to completed sessions in Sessions tab for direct access
- **User Workflow**: Session notes accessible through existing booked sessions, with Session Notes tab showing all existing notes for viewing and editing

### Code Organization Improvements (January 2025)
- **Import Structure**: Organized imports by category (UI Components, Icons, Utils)
- **Function Organization**: Grouped related functions with clear section comments
- **Type Safety**: Added explicit return types to utility functions
- **Code Clarity**: Improved variable declarations and function structure
- **Comment Structure**: Added clear section dividers for better navigation
- **Interface Documentation**: Enhanced storage interface with descriptive section comments

### Performance Optimization (January 2025)
- **Icon System Optimization**: Replaced heavy FontAwesome icons with lightweight Lucide React icons
- **Tree-shaking Benefits**: All icons now use tree-shakeable imports for reduced bundle size
- **Centralized Icon Management**: Created icon utility system for consistent performance
- **Bundle Size Reduction**: Eliminated FontAwesome dependency reducing potential timeouts
- **Consistent Icon Sizing**: Standardized icon sizes across application for better performance

### Hierarchical Library System Implementation (January 2025)
- **Database Schema**: Added comprehensive library tables with categories and entries supporting hierarchical structure
- **Backend API**: Implemented full CRUD operations for library categories and entries with search functionality
- **Frontend Component**: Built complete library page with category tree navigation and entry management
- **Navigation Integration**: Added library page to main application navigation
- **Sample Data**: Seeded 5 main categories (Session Focus, Symptoms, Short-term Goals, Interventions, Progress) with sample clinical content
- **Connected Entries**: Implemented intelligent connection system that identifies related entries through shared tags
- **Smart Navigation**: Added click-to-scroll functionality for navigating between connected library entries

### Auto-Connection System Enhancement (January 2025)
- **Smart Entry Creation**: Entry forms now auto-detect related entries from different categories based on shared keywords and tags
- **Cross-Category Focus**: Auto-suggestions only show entries from different categories, encouraging meaningful cross-category connections
- **Real-time Suggestions**: As users type titles or tags, system shows related entries with checkboxes for instant connection
- **Automatic Database Connections**: Selected suggestions automatically create database relationships when entry is created
- **Connection Intelligence**: System uses keyword matching to identify related clinical content across categories
- **User-Friendly Interface**: Green suggestion boxes show exactly how connections will help in session notes workflow

### Category Filter Consistency Fix (January 2025)
- **Consistent Filter Display**: Fixed category filter to show ALL 5 main categories regardless of entry count
- **Predictable Behavior**: Filter now works identically from any starting category tab
- **User Experience**: Eliminated confusion where different tabs showed different available categories
- **Complete Coverage**: All main therapeutic categories (Session Focus, Symptoms, Short-term Goals, Interventions, Progress) always visible in connection dialog

### Risk Assessment Integration (January 2025)
- **Comprehensive Risk Matrix**: Replaced simple Settings tab with professional 10-factor risk assessment system
- **Clinical Risk Factors**: Implemented detailed 0-4 scoring for Suicidal Ideation, Self-Harm, Homicidal Ideation, Psychosis, Substance Use, Impulsivity, Aggression, Trauma Symptoms, Non-Adherence, and Support System
- **Automated Risk Calculation**: Real-time overall risk scoring with color-coded levels (Low/Moderate/High/Critical)
- **Professional Documentation**: Each risk factor includes clinical descriptions and appropriate rating labels
- **AI Template Optimization**: Removed outdated mood rating references from AI generation, focusing on clinical documentation fields
- **Streamlined Interface**: Removed redundant privacy settings, focusing purely on clinical risk assessment

### Interface Streamlining (January 2025)
- **Redundant Tab Removal**: Removed basic "Notes" tab since comprehensive "Session Notes" tab provides all needed functionality
- **Session Integration**: Added "Add Notes" button to every session in the session list for direct access to session note creation
- **Workflow Enhancement**: Users can now click "Add Notes" from any session to jump directly to the Session Notes tab
- **UI Consistency**: Standardized session note access across all session entries regardless of status

### Assessment Template Builder Complete Resolution (January 2025)
- **Question Type Option Management**: Fixed critical bug where changing question types created duplicate mixed options instead of replacing them
- **Database Clean Delete Operations**: Implemented proper bulk delete functionality for question options to prevent accumulation
- **Validation Error Resolution**: Fixed questionId validation errors that prevented option creation for new questions
- **Question Deletion Persistence**: Fixed deleted questions reappearing by implementing proper database deletion on save
- **Systematic Error Handling**: Added proper error checking and validation to ensure questionId is available before creating options
- **Clean State Management**: Question type changes now properly clear all existing options before creating type-appropriate new ones
- **Complete CRUD Operations**: All Create, Read, Update, Delete operations now work correctly with proper state synchronization
- **API Response Parsing Fix**: Fixed critical issue where apiRequest Response objects weren't properly parsed with .json() before accessing data properties
- **Duplicate Function Cleanup**: Removed duplicate createAssessmentQuestion and createAssessmentSection functions causing database operation conflicts

### Library-Session Notes Integration (January 2025)
- **Direct Field Integration**: Added Library picker buttons (📚) to all clinical documentation fields in session notes
- **Category-Specific Content**: Each field shows only relevant library entries (Session Focus → Category 1, Symptoms → Category 2, etc.)
- **Seamless Content Insertion**: Click library entries to auto-populate session note fields with professional clinical content
- **Smart Content Combination**: New content appends to existing text instead of overwriting for flexible documentation
- **Usage Analytics**: Automatic tracking of which library entries are most frequently used in session documentation
- **Search Integration**: Built-in search within library picker for quick content discovery
- **Professional Workflow**: Enables rapid session documentation using pre-written, clinically-appropriate content templates

### PDF Document Management System (January 2025)
- **Direct PDF Preview**: Implemented one-click PDF preview that opens documents directly in new browser tabs
- **Browser Compatibility**: Resolved Microsoft Edge security restrictions with proper headers and direct file serving
- **File Serving Infrastructure**: Created secure PDF file serving endpoints with proper content type headers
- **Streamlined Workflow**: Eliminated multi-step preview process - PDFs open directly when clicking "Preview"
- **Error Handling**: Added comprehensive validation for document existence, file access, and proper error responses
- **Code Cleanup**: Removed unused PDF viewer components and consolidated file serving logic
- **Download Functionality**: Fixed download endpoints to serve actual files instead of placeholder content
- **Security Headers**: Added appropriate security headers for PDF file serving while maintaining browser compatibility

### Complete QA Code Cleanup (January 2025)
- **Document Delete Functionality**: Fixed query key mismatch between data fetching and cache invalidation for proper delete operations
- **Console.log Removal**: Eliminated all debugging console.log statements from client and server code for production readiness
- **Code Organization**: Improved import structure and removed dead code across all components
- **File Structure**: Organized imports by category (UI Components, Icons, Utils) for better maintainability
- **Error Handling**: Streamlined error handling without excessive logging while maintaining user feedback
- **Comprehensive Testing**: Verified all CRUD operations (Create, Read, Update, Delete) work properly across the application
- **Performance Optimization**: Removed unused imports and eliminated redundant code for better bundle size

### Code Organization Improvements (January 2025)
- **Import Structure**: Organized imports by category (UI Components, Icons, Utils)
- **Function Organization**: Grouped related functions with clear section comments
- **Type Safety**: Added explicit return types to utility functions
- **Code Clarity**: Improved variable declarations and function structure
- **Comment Structure**: Added clear section dividers for better navigation
- **Interface Documentation**: Enhanced storage interface with descriptive section comments

### Session Status Management Enhancement (January 2025)
- **Clickable Status Badges**: Replaced static status badges with interactive dropdown menus in Session History view
- **Direct Status Updates**: Users can now change session status (Scheduled → Completed, Cancelled, No-Show) directly from client detail page
- **Color-Coded Interface**: Status badges show appropriate colors with hover effects and dropdown indicators
- **Icon-Enhanced Options**: Each status option includes relevant icons (Clock, CheckCircle, X, AlertCircle) for visual clarity
- **Optimized Workflow**: Follows user-requested sequence: status change first, then date updates, then notes addition
- **Real-Time Updates**: Status changes immediately refresh session list and show success notifications
- **Professional UX**: Dropdown design matches application's clinical professional interface standards

### UI Simplification (January 2025)
- **Navigation Streamlining**: Removed duplicate Dashboard tab since it showed identical content to Clients tab
- **Sidebar Removal**: Eliminated redundant Quick Stats and AI Insights sidebar that duplicated information already shown in main tabs
- **Duplicate Menu Fix**: Removed duplicate navigation menu from ClientHeader component that was conflicting with main App navigation
- **Content Consolidation**: Simplified layout to focus on essential functionality without information duplication
- **Clean Interface**: Reduced visual clutter by removing unnecessary duplicate elements per user feedback
- **Icon Cleanup**: Replaced remaining FontAwesome icons with Lucide React for consistency

### Session Booking Flow Consistency Fix (January 2025)
- **Unified Booking Parameters**: Fixed inconsistency where client list required manual therapist selection while client detail pre-selected client
- **Cross-Location Consistency**: All schedule session buttons now pass both client and therapist information when available
- **Pre-filled Forms**: Session booking from client detail pages now pre-selects both client and assigned therapist for seamless workflow
- **Enhanced User Experience**: Eliminated confusion between different booking entry points by standardizing URL parameters
- **Therapist Auto-Selection**: When navigating from client profiles, assigned therapist information is automatically included

### Complete Billing Integration System (January 2025)
- **Healthcare Service Management**: Implemented comprehensive service catalog with standard CPT codes for billing compliance
- **Room Management System**: Added physical room booking with conflict prevention and availability checking
- **Automatic Billing Triggers**: Session completion (status change to 'completed') automatically creates billing records
- **CPT Code Compliance**: All services linked to healthcare CPT codes with proper duration and pricing structure
- **Insurance Integration**: Billing records include insurance coverage calculation and copay amount processing
- **Payment Status Tracking**: Complete payment lifecycle from pending through billed, paid, denied, and refunded states
- **Billing API Endpoints**: RESTful APIs for accessing session billing, client billing history, and payment status updates
- **Database Schema Alignment**: Fixed schema mismatches between application code and database structure for seamless operation
- **Production-Ready Flow**: Complete end-to-end billing process from session creation through payment processing

### Edit Client Modal Complete Fix (January 2025)
- **Form Validation Resolution**: Fixed clientId validation error that prevented form submission by making it optional for edits
- **API Request Parameter Fix**: Corrected apiRequest function parameter order from (method, url, data) to (url, method, data)
- **Boolean Field Handling**: Fixed boolean fields (emailNotifications, hasPortalAccess) to properly handle false values using undefined checks instead of || operator
- **Numeric Field Support**: Enhanced copay and deductible fields with proper number input types, step validation, and zero value handling
- **Cache Management**: Improved query invalidation and refetching to ensure form data reflects latest server state
- **Complete CRUD Operations**: All Create, Read, Update, Delete operations now work correctly with proper state synchronization
- **Production Ready**: Edit client functionality fully operational for all field types including text, numbers, booleans, and selections

### Comprehensive QA and Cross-System Consistency Fix (January 2025)
- **Session Status API Consistency**: Fixed critical inconsistency where client-detail.tsx used `/api/sessions/{id}` while scheduling.tsx used `/api/sessions/{id}/status` endpoint
- **Billing System Consistency**: Resolved billing gap where 8 completed sessions only had 3 billing records, now all completed sessions have proper billing entries
- **Console.log Cleanup**: Removed all debugging console.log statements from server storage for production readiness
- **Code Organization**: Organized imports by category (UI Components, Icons, Utils) across all major files for maintainability
- **API Endpoint Standardization**: Unified session status update endpoints across the entire application
- **Error Handling Enhancement**: Improved error handling for sessions without service information to prevent billing system failures
- **Cache Invalidation Fix**: Enhanced cache invalidation in session status updates to ensure UI reflects changes immediately
- **Import Structure Optimization**: Cleaned up unused imports and organized import statements for better code maintainability
- **Cross-Component Consistency**: Verified consistent behavior between scheduling calendar and client detail session management
- **Production Deployment Ready**: System now has consistent APIs, proper error handling, and clean codebase for production deployment

### Invoice History Layout Simplification (January 2025)
- **Consolidated Billing Interface**: Combined separate Insurance Information and Invoice History sections into single streamlined view
- **Compact Design**: Insurance details now display inline at header level (Insurance: Provider • Policy: Number • Copay: Amount)
- **Improved User Experience**: Eliminated unnecessary screen space usage and reduced scrolling between billing sections
- **Maintained Functionality**: All invoice actions (Preview, Download, Email, Record Payment) remain fully accessible
- **Clean Visual Hierarchy**: Single card layout provides better focus on invoice management without information duplication

### Assessment Delete Functionality Implementation (January 2025)
- **Delete Assessment Assignments**: Added red "Delete" button to every assessment card in client detail page
- **Comprehensive Backend Support**: Implemented DELETE API endpoint for assessment assignments with cascade deletion
- **Database Cleanup**: Delete operation removes both assignment and all associated responses to maintain data integrity
- **User Confirmation**: Added confirmation dialog to prevent accidental deletions with clear warning message
- **Visual Feedback**: Delete button shows loading state ("Deleting...") during operation with red styling for danger indication
- **Immediate UI Updates**: Proper cache invalidation and refetching ensures UI reflects changes immediately after deletion

### Code Organization and Performance Optimization (January 2025)
- **Import Structure Enhancement**: Organized all imports alphabetically by category (UI Components, Icons, Utils/Hooks, Types, Components)
- **Function Organization**: Added clear section comments dividing code into logical groups (React Query Setup, API Mutations, Event Handlers, Assessment Management)
- **Mutation Pattern Consistency**: Converted assessment assignment from async/await pattern to proper useMutation pattern for consistency
- **Timing Issue Resolution**: Enhanced mutation handling with immediate cache invalidation and refetching to prevent race conditions
- **Error State Management**: Improved error handling with proper loading states and user feedback during operations
- **Code Cleanliness**: Removed all debugging console.log statements and unused imports for production readiness