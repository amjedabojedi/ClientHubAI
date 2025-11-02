# TherapyFlow Dynamic Role-Based Permission System

## Overview
TherapyFlow implements a comprehensive role-based permission system designed specifically for healthcare therapy practice management. This system ensures appropriate access controls while maintaining compliance with healthcare industry standards.

## System Architecture

### Navigation Structure
- **User Management** dropdown menu containing:
  - **User Profiles**: View and manage user accounts
  - **Role Management**: Create and manage roles and permissions

### Permission Categories

#### 1. Client Management (client_management)
- **view_clients**: Can view client list and information
- **edit_clients**: Can create and modify client information  
- **delete_clients**: Can delete client records

#### 2. Session Management (session_management)
- **manage_sessions**: Can schedule and manage therapy sessions

#### 3. Assessment Management (assessment_management)
- **manage_assessments**: Can create and assign assessments

#### 4. User Management (user_management)
- **view_users**: Can view user profiles and information
- **edit_users**: Can create and modify user accounts
- **delete_users**: Can delete user accounts
- **manage_roles**: Can create and assign user roles and permissions

#### 5. Task Management (task_management)
- **view_tasks**: Can view tasks and assignments
- **edit_tasks**: Can create and modify tasks

#### 6. Resource Management (resource_management)
- **view_library**: Can access clinical resource library
- **edit_library**: Can create and modify library content

#### 7. Financial Management (financial_management)
- **view_billing**: Can access billing and payment information
- **manage_billing**: Can process payments and manage billing

## Standard Role Definitions

### Administrator (Full System Access)
**Permissions**: All 15 permissions
- Complete system control and user management
- Full access to all modules and administrative functions
- Can create, modify, and delete any data
- User management and role assignment capabilities

### Clinical Supervisor (Supervisory Access) 
**Permissions**: 11 permissions (excludes delete_users, manage_roles, edit_library, manage_billing)
- Clinical oversight without destructive administrative functions
- Can supervise therapists and review clinical work
- Cannot delete users or modify system roles
- Limited billing access (view only)

### Therapist (Core Clinical Access)
**Permissions**: 9 permissions (client management, sessions, assessments, users view, tasks, library view, billing view)
- Client care and session management
- Can manage assigned clients and sessions
- Cannot perform administrative functions
- Read-only access to user profiles and billing

### Intern/Trainee (Limited Access)
**Permissions**: 5 permissions (view_clients, manage_sessions, view_users, view_tasks, view_library)
- Read-only access with basic clinical functionality
- Can view clients and participate in sessions
- Cannot modify critical data
- Supervised access appropriate for training

## Implementation Details

### Database Schema
- **roles**: Core role definitions with system/custom flags
- **permissions**: Individual permission definitions with categories
- **role_permissions**: Junction table mapping roles to permissions

### API Endpoints
- `GET/POST /api/roles` - Role management
- `GET/POST /api/permissions` - Permission management  
- `PUT /api/roles/:id` - Update role permissions
- Role-specific CRUD operations with proper validation

### Frontend Features
- Dropdown navigation for organized access
- Role creation interface with permission checkboxes
- Real-time permission assignment and updates
- Visual role and permission indicators

## Best Practices Implementation

### Healthcare Compliance
- Least privilege principle: Users receive minimum necessary permissions
- Role separation: Clear distinction between clinical and administrative functions
- Audit trail: All role changes tracked with timestamps
- Data protection: Sensitive functions restricted to appropriate roles

### Scalability
- Custom role creation beyond system defaults
- Granular permission assignment
- Category-based permission organization
- Easy role modification and extension

### User Experience
- Intuitive menu organization under "User Management"
- Clear role descriptions and permission explanations
- Real-time feedback for permission changes
- Visual indicators for role status and capabilities

## Usage Guidelines

### For Administrators
1. Access Role Management through User Management dropdown
2. Create custom roles by selecting specific permission combinations
3. Assign roles to users through User Profiles section
4. Monitor permission usage and adjust as needed

### For Role Creation
1. Navigate to User Management > Role Management
2. Click "Create New Role"
3. Select appropriate permissions from categorized list
4. Save role and assign to relevant users
5. Test role functionality with appropriate user accounts

### For Permission Management
- Review permissions regularly for compliance
- Ensure role assignments match job responsibilities
- Update permissions when job roles change
- Document custom role purposes and scope

This system provides TherapyFlow with enterprise-level access control while maintaining the flexibility needed for diverse therapy practice workflows.