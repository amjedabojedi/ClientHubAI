import { db } from "../server/db";
import { helpGuides } from "../shared/schema";

const guides = [
  {
    title: "Understanding Your Dashboard",
    slug: "dashboard-overview",
    content: `# Understanding Your Dashboard

The Dashboard is your command center in TherapyFlow, showing key metrics and quick access to important information.

## Key Metrics (4 Cards at Top)

### 1. Active Clients
- Shows your active client count
- Displays percentage of total clients
- Click to go to Clients page

### 2. Today's Sessions  
- Count of sessions scheduled for today
- Shows how many are completed
- Click to go to Scheduling page

### 3. Pending Tasks
- Shows pending task count
- Displays urgent task count (if any)
- Click to go to Tasks page

### 4. Billing (Admin/Supervisor only)
- Estimated revenue from today's completed sessions
- Click to go to Billing page

## Main Sections

### Recent Sessions
- Shows last 5 completed sessions
- Displays: Client name, date, service code, status
- Click any session to view in scheduling

### Upcoming Sessions
- Shows next scheduled sessions
- Same details as recent sessions
- Quick access to upcoming appointments

### Recent Tasks
- Last 5 tasks created
- Shows: Title, client, due date, priority, status
- Click to edit inline

### Upcoming Tasks
- Tasks due soon
- Click to edit or update status

### Overdue Sessions
- Sessions missing documentation
- Shows: Client, therapist, date, days overdue
- Quick actions: Mark Complete, Mark No-Show, Cancel
- Only shows sessions you have permission to edit

### Recent Items Sidebar
- Recently viewed clients
- Auto-tracked for quick access
- Returns to your recent workflow

## Tips
- Dashboard auto-refreshes to show current data
- Click any metric card for details
- All times display in Eastern Time (America/New_York)
- Use Ctrl+K for quick search`,
    category: "dashboard",
    tags: ["dashboard", "overview", "metrics", "home"],
    searchTerms: ["dashboard", "home page", "overview", "metrics", "what is dashboard", "how to use dashboard"]
  },
  {
    title: "How to Add a New Client",
    slug: "add-client",
    content: `# How to Add a New Client

Adding clients to TherapyFlow is quick and organized into 5 tabs.

## Steps to Add a Client

1. Go to **Clients** page
2. Click **+ Add Client** button
3. Fill out the form (5 tabs)
4. Click **Save**

## Form Tabs

### Tab 1: Personal
- **Full Name** (REQUIRED - marked with *)
- Date of Birth
- Gender, Marital Status, Pronouns
- Preferred Language
- Email Notifications checkbox
- **Portal Access checkbox** - Enable Portal Access
  - Note: Client will use their primary email address for portal login

### Tab 2: Contact
- Phone Number
- Emergency Phone
- Email Address
- Full Address (Street, City, State, ZIP)

### Tab 3: Referral
- Start Date
- Referrer Name
- Referral Date
- Reference Number
- Client Source

### Tab 4: Employment
- Employment Status
- Education Level
- Number of Dependents

### Tab 5: Clinical
- Client Type
- Client Stage
- Status: Active, Inactive, or Discharged
- Risk Level: None, Low, Medium, High, Critical
- Assigned Therapist

## Required vs Optional

**Required:** Only Full Name is required (marked with *)

**Optional:** All other fields are optional - fill what you have

## Important Notes

- Email is needed if you want to enable Portal Access
- Risk Level triggers monitoring alerts
- Assigned Therapist links to scheduling
- Client Status affects visibility in lists`,
    category: "clients",
    tags: ["clients", "add client", "new client", "create client"],
    searchTerms: ["add client", "new client", "create client", "how to add client", "adding clients", "client form"]
  },
  {
    title: "Client Profile Overview",
    slug: "client-profile",
    content: `# Client Profile Overview

The client profile has 9 tabs with all information about a client.

## How to Access

1. Go to Clients page
2. Search or browse for the client
3. Click on the client's name

## The 9 Tabs

### 1. Overview
- Basic information and demographics
- Portal management section
  - Enable/disable portal access
  - Send activation email
- Quick actions and summary

### 2. Sessions
- All session notes and history
- Past and upcoming appointments
- Session details and documentation

### 3. Assessments
- Assigned assessments
- Completed reports
- Assessment history

### 4. Documents
- Uploaded files and forms
- Document management
- File history

### 5. Billing
- Payment history
- Invoices
- Billing records for this client

### 6. Tasks
- Client-related tasks
- Assigned to team members
- Task history

### 7. Checklists
- Process checklists
- Workflow tracking
- Completed checklists

### 8. Communications
- Email history
- Sent reminders
- Communication audit trail

### 9. History
- Complete audit trail
- All changes to client record
- HIPAA-compliant logging

## Important Notes

- **Portal Access** is in the Overview tab (not a separate tab)
- All tabs show information specific to this client
- Changes are tracked in the History tab`,
    category: "clients",
    tags: ["client profile", "client tabs", "client details"],
    searchTerms: ["client profile", "view client", "client tabs", "how many tabs", "client details", "9 tabs"]
  },
  {
    title: "Scheduling and Calendar Views",
    slug: "calendar-views",
    content: `# Scheduling and Calendar Views

TherapyFlow offers 4 different calendar views to help you manage appointments.

## The 4 Calendar Views

### 1. Day View
- Shows today's hourly schedule
- Hour-by-hour breakdown
- Detailed view of each appointment
- Best for: Managing today's sessions

### 2. Week View
- 7-day overview
- See the full week at a glance
- Plan ahead
- Best for: Weekly planning

### 3. Month View
- Full calendar grid
- See the entire month
- Identify busy and slow days
- Best for: Long-term planning

### 4. All Sessions (List View)
- Complete list of all appointments
- Filter and search
- See all details in one place
- Best for: Finding specific sessions

## How to Switch Views

1. Go to Scheduling page
2. Click the view buttons in the header
3. Choose: Day, Week, Month, or All Sessions

## Navigation

- **Arrow buttons** - Navigate forward/backward
- **Today button** - Jump to current date
- **Click on sessions** - Edit in-place

## Features

- Color-coded by session type
- Filter by therapist or room
- All times in Eastern Time (America/New_York)
- Quick add and edit`,
    category: "scheduling",
    tags: ["calendar", "scheduling", "views", "appointments"],
    searchTerms: ["calendar views", "switch view", "day view", "week view", "month view", "all sessions", "4 views"]
  },
  {
    title: "How to Schedule an Appointment",
    slug: "schedule-appointment",
    content: `# How to Schedule an Appointment

Schedule client appointments quickly using the calendar.

## Steps to Schedule

1. Go to **Scheduling** page
2. Choose your preferred view (Day/Week/Month)
3. Click a time slot OR click **+ Add Session** button
4. Fill in the form
5. Click **Save**

## Required Fields

- **Client** - Select from dropdown
- **Session Type** - Choose from system options
- **Service** - Select from service catalog
- **Date & Time** - Pick appointment date and time
- **Duration** - How long (in minutes)
- **Room/Location** - Where the session will be held

## Session Statuses

There are **4 session statuses**:

1. **Scheduled** (default) - Appointment is booked
2. **Completed** - Session finished
3. **Cancelled** - Appointment cancelled
4. **No Show** - Client didn't attend

**Important:** "Rescheduled" is NOT a status. To reschedule, just change the date and time.

## Features

- Sessions are color-coded by session type
- Service auto-creates billing record when marked completed
- All times display in Eastern Time
- Can edit in-place by clicking the session

## Tips

- Sessions link to client profiles
- Billing records created automatically on completion
- Filter by therapist or room to see specific schedules`,
    category: "scheduling",
    tags: ["schedule", "appointment", "session", "booking"],
    searchTerms: ["schedule appointment", "book session", "create session", "add appointment", "4 statuses", "session statuses"]
  },
  {
    title: "How to Create a Task",
    slug: "create-task",
    content: `# How to Create a Task

Tasks help you track to-dos linked to clients.

## Steps to Create a Task

1. Go to **Tasks** page
2. Click **+ Add Task** button
3. Fill in the form
4. Click **Save**

## Required Fields

- **Title** - What needs to be done
- **Client** - Must select a client
- **Assigned To** - Who will do it
- **Due Date** - When it's due

## Optional Fields

- **Description** - More details
- **Priority** - Low, Medium, High, or Urgent (defaults to Medium)
- **Status** - Pending, In Progress, Completed, Overdue (defaults to Pending)

## Task Statuses

There are **4 task statuses**:

1. **Pending** - Not started yet (default)
2. **In Progress** - Currently being worked on
3. **Completed** - Task finished
4. **Overdue** - Auto-set when past due date

## Features

- Tasks auto-mark as overdue when past due date
- Linked to clients (shows in client profile Tasks tab)
- Add comments to track progress
- Filter by status, priority, assignee, or client

## Priority Levels

- **Low** - Can wait
- **Medium** - Normal priority (default)
- **High** - Important
- **Urgent** - Needs immediate attention

## Tips

- Overdue tasks highlighted in red
- Comments create an audit trail
- Tasks appear in client profiles`,
    category: "tasks",
    tags: ["tasks", "create task", "to-do"],
    searchTerms: ["create task", "add task", "new task", "task form", "task statuses", "4 statuses"]
  },
  {
    title: "Understanding the Billing Page",
    slug: "billing-overview",
    content: `# Understanding the Billing Page

The Billing page shows all billing records and payment tracking.

## Page Structure

**Important:** The Billing page has NO tabs - it's a single view with cards, filters, and a table.

## What You See

### 1. Summary Cards (4 cards at top)
- **Outstanding Balance** - Money owed
- **Total Collected** - Payments received
- **Active Clients** - Clients with billing records
- **Total Records** - Count of billing entries

### 2. Filters Section
You can filter billing records by:
- Client Name (search)
- Payment Status
- Therapist (admin only)
- Service Code
- Client Type
- Date Range (presets: This Month, Last Month, Last 3 Months, This Year)
- **Reset Filters** button to clear all

### 3. Billing Records Table
Shows: Client, Service, Date, Therapist, Amount, Paid, Status, Actions

**Actions menu (⋮) includes:**
- Record Payment
- Email Invoice
- Preview Invoice
- Download Invoice

## Payment Statuses

- **Pending** (yellow) - Not yet billed
- **Billed** (blue) - Invoice sent
- **Paid** (green) - Payment received
- **Denied** (red) - Claim denied
- **Refunded** (gray) - Money returned
- **Follow Up** (orange) - Needs attention

## How Billing Records Are Created

Billing records **auto-create** when sessions are marked as completed.

## Important Notes

- **Services are NOT managed here** - Go to Administration → Settings → Service Prices
- **Rooms are NOT managed here** - Go to Administration → Settings → Rooms
- Therapists see only their own billing records
- Admins see all billing records`,
    category: "billing",
    tags: ["billing", "payments", "invoices"],
    searchTerms: ["billing", "billing page", "no tabs", "payments", "invoices", "payment status"]
  },
  {
    title: "Managing System Settings",
    slug: "settings-overview",
    content: `# Managing System Settings

Settings page has 5 tabs for configuring TherapyFlow.

## Access

**Administrators and Supervisors only** - Therapists cannot access Settings.

## The 5 Settings Tabs

### Tab 1: System Options
- Manage dropdown options for entire system
- Categories: Session types, Client types, etc.
- Add, edit, or remove options
- Used throughout the application

### Tab 2: Service Prices
**This is where you manage Services (NOT in Billing)**

- Add/Edit service codes (CPT codes)
- Fields: Service Code, Service Name, Duration, Base Rate, Category
- Services are used when scheduling sessions
- Determines billing amounts

### Tab 3: Service Visibility
- Control what therapists/clients can see
- Privacy and access settings
- Toggle visibility by role

### Tab 4: Rooms
**This is where you manage Rooms (NOT in Billing)**

- Add/Edit therapy rooms
- Fields: Name, Type (Physical/Virtual), Capacity, Location
- Used for scheduling and resource tracking
- Manage room availability

### Tab 5: Administration
- Practice information
- General configuration settings
- System-wide preferences

## Important Notes

- **Services are in Settings Tab 2** (not in Billing)
- **Rooms are in Settings Tab 4** (not in Billing)
- Only Admins and Supervisors can access
- Changes affect the entire system`,
    category: "settings",
    tags: ["settings", "configuration", "services", "rooms"],
    searchTerms: ["settings", "5 tabs", "services location", "rooms location", "where are services", "where are rooms", "system options"]
  }
];

async function createGuides() {
  try {
    console.log('Creating help guides...');
    
    for (const guide of guides) {
      await db.insert(helpGuides).values(guide);
      console.log(`✓ Created: ${guide.title}`);
    }
    
    console.log(`\n✅ Successfully created ${guides.length} help guides!`);
    process.exit(0);
  } catch (error) {
    console.error('❌ Error creating guides:', error);
    process.exit(1);
  }
}

createGuides();
