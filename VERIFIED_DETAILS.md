# THERAPYFLOW - VERIFIED ACCURATE DETAILS

**Last Updated:** Just now  
**Purpose:** All details verified against actual component code - NO assumptions

---

## 1. DASHBOARD PAGE ✅ VERIFIED

**File:** `client/src/pages/dashboard.tsx`

### Metric Cards (4 cards at top)
1. **Active Clients**
   - Shows: Active client count
   - Shows: Percentage of total
   - Shows: Total client count
   - Click: Goes to /clients

2. **Today's Sessions**
   - Shows: Count of today's sessions
   - Shows: How many completed
   - Shows: "scheduled for today"
   - Click: Goes to /scheduling

3. **Pending Tasks**
   - Shows: Pending task count
   - Shows: Urgent task count (if any)
   - Shows: Total task count
   - Click: Goes to /tasks

4. **Billing** (Admin/Supervisor only)
   - Shows: Estimated revenue from today's completed sessions
   - Shows: "today's completed sessions"
   - Click: Goes to /billing

### Main Sections

**Recent Sessions (left side)**
- Shows: Last 5 completed sessions
- Displays: Client name, date, service code, status badge
- Empty state: "No recent completed sessions" + Schedule Session button
- Action: Click to view in scheduling

**Upcoming Sessions (right side)**
- Shows: Next scheduled sessions
- Displays: Client name, date, service code, status badge
- Empty state: "No upcoming sessions" + Schedule Session button
- Action: Click to view in scheduling

**Recent Tasks (left side)**
- Shows: Last 5 tasks
- Displays: Task title, client name, due date, priority, status
- Empty state: "No recent tasks" + Create First Task button
- Action: Click task to edit inline

**Upcoming Tasks (right side)**
- Shows: Tasks due soon
- Displays: Task title, client name, due date, priority, status
- Empty state: "No upcoming tasks" + Create Task button
- Action: Click task to edit inline

**Overdue Sessions**
- Shows: Sessions missing documentation
- Displays: Client, therapist, session date, days overdue
- Actions: Mark Complete, Mark No-Show, Cancel Session
- Shows: Only for sessions user has permission to edit
- Empty state: "No overdue sessions to document"

**Recent Items Sidebar (right side)**
- Shows: Recently viewed clients
- Purpose: Quick access to workflow history
- Auto-tracked

### Help Section (collapsible blue card)
5 numbered sections explaining:
1. Key Metrics Overview
2. Navigation
3. Quick Actions
4. Session Tracking
5. Recent Items Sidebar

Pro tip mentions: Auto-refresh, click cards, Ctrl+K search, Eastern Time display

---

## 2. CLIENTS PAGE - TO BE VERIFIED

(Not yet verified)

---

## 3. SCHEDULING PAGE - TO BE VERIFIED

(Not yet verified)

---

## 4. SESSION NOTES - TO BE VERIFIED

(Not yet verified)

---

## 5. TASKS PAGE - TO BE VERIFIED

(Not yet verified)

---

## 6. BILLING PAGE ✅ VERIFIED

**File:** `client/src/pages/billing-dashboard.tsx`

### Structure
- **NO TABS** - Single view only
- Tabs component imported but never used

### What You See
1. Summary Cards (4 cards)
   - Outstanding Balance
   - Total Collected
   - Active Clients (with billing records)
   - Total Records

2. Filters Section
   - Client Name (search input)
   - Payment Status dropdown
   - Therapist dropdown (admin only)
   - Service Code dropdown
   - Client Type dropdown
   - Date Range picker (with presets: This Month, Last Month, Last 3 Months, This Year)
   - Reset Filters button

3. Billing Records Table
   - Columns: Client, Service, Date, Therapist, Amount, Paid, Status, Actions
   - Click client name to view profile
   - Click actions menu (⋮) for:
     - Record Payment
     - Email Invoice
     - Preview Invoice
     - Download Invoice

### Payment Statuses
- Pending (yellow)
- Billed (blue)
- Paid (green)
- Denied (red)
- Refunded (gray)
- Follow Up (orange)

### Important Notes
- Billing records **auto-create** when sessions marked completed
- Services and Rooms are NOT managed here (they're in Settings)
- Therapists see only their own billing records
- Admins see all records

---

## 7. SETTINGS PAGE ✅ VERIFIED

**File:** `client/src/pages/settings.tsx`

### Structure - 5 TABS

**Tab 1: System Options**
- Manage dropdown options for entire system
- Categories like session types, client types, etc.

**Tab 2: Service Prices**
- Add/Edit service codes (CPT codes)
- Fields: Service Code, Service Name, Duration, Base Rate, Category
- This is where you add services used in scheduling

**Tab 3: Service Visibility**
- Control what therapists/clients can see
- Toggle visibility settings

**Tab 4: Rooms**
- Add/Edit therapy rooms
- Fields: Name, Type (Physical/Virtual), Capacity, Location
- Used for scheduling and resource tracking

**Tab 5: Administration**
- Practice information
- Configuration settings

### Access
- **Administrators and Supervisors only**
- Therapists cannot access Settings

---

## 8. ASSESSMENTS - TO BE VERIFIED

(Not yet verified)

---

## 9. MY PROFILE - TO BE VERIFIED

(Not yet verified)

---

## 10. LIBRARY - TO BE VERIFIED

(Not yet verified)
