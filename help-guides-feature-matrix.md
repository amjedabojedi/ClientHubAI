# TherapyFlow Help Guides - Feature Matrix
## Verified from Actual Code (No Assumptions)

---

## THERAPIST FEATURES

### 1. Dashboard (dashboard.tsx)
**Verified Features:**
- **Metric Cards** (clickable, navigate to pages):
  - Active Clients (shows count, percentage, navigates to /clients)
  - Today's Sessions (shows count, "X done" indicator, navigates to /scheduling)
  - Pending Tasks (shows count, "X urgent" warning, navigates to /tasks)
  - Billing Summary (Admin/Supervisor only, shows estimated revenue)

- **Widgets:**
  - Recent Sessions (shows last 5 completed sessions with client name, date, service code, status badge)
  - Upcoming Sessions (shows next 5 future scheduled/confirmed sessions)
  - Recent Tasks (shows last 5 tasks with client, priority badge, status)
  - Overdue Sessions (shows sessions missing documentation with action menu)
  - Upcoming Deadlines (shows tasks with due dates)

- **Action Buttons:**
  - "View All" buttons on each widget (navigate to respective pages)
  - "Schedule Session" button (goes to scheduling)
  - "Create First Task" button (goes to tasks)

- **Overdue Session Actions** (⋮ dropdown menu):
  - Mark Completed
  - No-Show (Cancel)
  - Cancel Session
  - Reschedule

- **Help Section** (collapsible blue card with ? icon):
  - Key Metrics Overview guide
  - Quick Actions guide
  - Task Management guide
  - Session Tracking guide
  - Recent Items Sidebar guide

---

### 2. Clients Page (clients.tsx)
**Verified Features:**
- **Top Action Buttons:**
  - "Add Client" button (opens modal, always visible)
  - "Export" button (Administrator only, downloads Excel)
  - "Import" button (Administrator only, bulk upload modal)

- **Stage Tabs** (filter clients by stage):
  - All
  - Intake
  - Assessment
  - Psychotherapy
  - Closed

- **Search & Filter Section:**
  - Search bar (searches name, email, phone)
  - Stage dropdown filter
  - Therapist filter
  - Client Type filter
  - Portal Access filter (Yes/No)
  - Pending Tasks filter (Yes/No)
  - No Sessions filter (Yes/No)
  - Checklist Template filter
  - Checklist Item IDs filter

- **Client Data Grid:**
  - Shows: Client ID, Full Name, Email, Phone, Stage, Therapist, Status badges
  - Row actions (⋮ menu): View, Edit, Delete
  - Click row → Navigate to Client Detail page

- **Add Client Modal Form Fields:**
  - Full Name*
  - Email*
  - Phone
  - Date of Birth
  - Address fields
  - Emergency Contact
  - Insurance Info
  - Assigned Therapist
  - Client Type
  - Stage
  - Referral Source

- **Help Section:**
  - Adding New Clients
  - Search & Filter
  - Stage Management
  - Client Profile Actions
  - Bulk Operations (Administrators)

**Client Detail Page Tabs (from App.tsx routing):**
1. Overview
2. Sessions
3. Assessments
4. Documents
5. Billing
6. Tasks
7. Checklist
8. Communications
9. History
10. Portal Access

---

### 3. Scheduling (scheduling.tsx)
**Verified Features:**
- **View Mode Tabs:**
  - Day
  - Week
  - Month
  - List

- **Top Action Buttons:**
  - "Schedule Session" button (opens modal)
  - Calendar navigation (prev/next month)
  - "Import Sessions" button (bulk upload)

- **Filters:**
  - Therapist dropdown (Admin can see all, therapists see own)
  - "My Sessions Only" toggle switch
  - Search query
  - Date range (for list view)
  - Status filter (list view)
  - Service Code filter (list view)

- **Schedule Session Form Fields:**
  - Client* (searchable dropdown)
  - Therapist* (dropdown)
  - Session Date* (date picker)
  - Session Time* (time picker)
  - Service* (dropdown with duration)
  - Room* (dropdown, filtered by availability)
  - Session Type* (Assessment, Psychotherapy, Consultation)
  - Zoom Enabled toggle switch
  - Notes (textarea)

- **Session Card Actions** (⋮ menu):
  - Edit Session
  - Change Status → Scheduled, Confirmed, Completed, Cancelled, No-Show
  - Reschedule

- **Conflict Detection:**
  - Real-time warnings for therapist conflicts
  - Real-time warnings for room conflicts
  - Shows during form entry before submission

- **Quick Stats:**
  - Total Sessions
  - Confirmed
  - Scheduled
  - Completed

- **Help Section:**
  - View Modes guide
  - Creating Sessions guide
  - Editing Sessions guide
  - Status Management guide
  - Conflict Detection guide

---

### 4. Billing (billing-dashboard.tsx)
**Verified Features:**
- **Filters:**
  - Date Range (Start Date, End Date)
  - Payment Status (All, Pending, Billed, Paid, Denied, Refunded, Follow-up)
  - Therapist (Admin/Supervisor can filter, Therapists see own only)
  - Service dropdown
  - Client Type
  - Client Search (by name)

- **Billing Record Display:**
  - Shows: Client Name, Session Date, Service Code, Total Amount, Payment Status, Payment Method

- **Action Menu (⋮) Options:**
  - **For Pending status:**
    - Email Invoice
    - Preview Invoice
    - Download Invoice
  
  - **For Paid status:**
    - Download Invoice
    - Email Invoice
  
  - **For Other statuses (Billed, Denied, etc):**
    - Record Payment (opens payment dialog)
    - Email Invoice
    - Preview Invoice
    - Download Invoice
  
  - **Change Status submenu:**
    - Mark Pending
    - Mark Billed
    - Mark Paid
    - Mark Denied
    - Mark Refunded
    - Mark Follow-up

- **Record Payment Dialog Fields:**
  - Payment Amount* (pre-filled with total)
  - Payment Method* (Cash, Check, Credit Card, Debit Card, Insurance, Bank Transfer, Online Payment)
  - Reference Number (check #, transaction ID)
  - Notes (textarea)

- **Admin Features:**
  - Export button (download reports)
  - View all therapists' billing

- **Help Section:**
  - Viewing Billing Records
  - Recording Payments
  - Invoice Management
  - Status Management

---

### 5. Tasks (tasks.tsx)
**Verified Features:**
- **Top Action Button:**
  - "Add Task" button (opens modal)

- **Filters:**
  - Status (All, Pending, In Progress, Completed, Overdue)
  - Priority (All, Low, Medium, High, Urgent)
  - Assigned To (All, specific therapist, Unassigned)
  - Due Date range

- **Task Form Fields:**
  - Title* (dropdown from system options OR custom text input)
  - Description (textarea)
  - Client* (searchable dropdown)
  - Assigned To (dropdown, can be Unassigned)
  - Priority* (Low, Medium, High, Urgent)
  - Status* (Pending, In Progress, Completed, Overdue)
  - Due Date (date picker)

- **Task Display:**
  - Task cards show: Title, Client, Assigned To, Priority badge, Status badge, Due Date
  - Color-coded by priority (Urgent=red, High=orange, Medium=yellow, Low=green)
  - Color-coded by status (Completed=green, In Progress=blue, Overdue=red, Pending=yellow)

- **Task Actions** (⋮ menu):
  - Edit Task
  - Delete Task
  - View Comments
  - Mark Complete
  - Change Status
  - Change Priority

- **Task Comments:**
  - Add comment (textarea)
  - View comment history
  - Shows commenter name and timestamp

- **Help Section:**
  - Creating Tasks guide
  - Task Filters guide
  - Priority Management guide
  - Status Updates guide

---

### 6. My Profile (my-profile.tsx)
**Verified Tabs & Features:**

**Tab 1: Basic Information**
- Full Name*
- Email*

**Tab 2: License & Credentials**
- License Number
- License Type
- License State
- License Expiry

**Tab 3: Professional Information**
- Years of Experience
- Max Clients Per Day
- Session Duration (default 50 minutes)
- Specializations (multi-select array)
- Treatment Approaches (multi-select array)
- Age Groups (multi-select array)
- Languages (multi-select array)
- Certifications (multi-select array)
- Education (multi-select array)

**Tab 4: Working Hours**
- Working Hours editor (JSON per day)
- Working Days (multi-select)

**Tab 5: Room Configuration**
- Virtual Room (select online room for virtual sessions)
- Available Physical Rooms (multi-select checkboxes)

**Tab 6: Emergency Contact**
- Emergency Contact Name
- Emergency Contact Phone
- Emergency Contact Relationship

**Tab 7: Clinical Background**
- Clinical Experience (textarea)
- Research Background (textarea)
- Supervisory Experience (textarea)
- Career Objectives (textarea)
- Previous Positions (array)
- Publications (array)
- Professional Memberships (array)
- Continuing Education (array)
- Award Recognitions (array)
- Professional References (array)

**Tab 8: Security Settings**
- Change Password form:
  - Current Password*
  - New Password* (min 6 characters)
  - Confirm Password*

**Tab 9: Zoom Integration**
- Zoom Account ID*
- Zoom Client ID*
- Zoom Client Secret*
- Save/Remove buttons
- Test Connection button

---

## CLIENT PORTAL FEATURES

### 7. Portal Login (portal-login.tsx)
**Verified Features:**
- **Login Form:**
  - Email Address* input
  - Password* input
  - "Sign In" button
  - "Forgot password?" link
  - "Staff member? Access Staff Portal →" link

- **Feature Highlights:**
  - Book Appointments (with calendar icon)
  - View Invoices (with credit card icon)
  - Upload Documents (with upload icon)
  - HIPAA Secure (with lock icon)

---

### 8. Portal Dashboard (portal-dashboard.tsx)
**Verified Features:**
- **Header:**
  - TherapyFlow branding
  - Notification bell icon (with unread count badge)
  - "Sign Out" button

- **Welcome Message:**
  - "Welcome Back, [Client Name]!"
  - Summary description

- **Quick Action Cards:**
  1. Book Appointment → "View Available Times" button
  2. View Invoices → "See All Invoices" button
  3. Upload Documents → "Upload Now" button
  4. View Appointments → "See All" button
  5. Notifications → "View All" button

- **Statistics Display:**
  - Upcoming Appointments count
  - Past Appointments count
  - Unread Notifications count

- **Help Section:**
  - 📅 Book Appointments guide
  - 💳 View & Pay Invoices guide
  - 📄 Upload Documents guide
  - 🔔 Check Notifications guide
  - 📋 View Your Appointments guide

---

### 9. Portal Book Appointment (portal-book-appointment.tsx)
**Verified Features:**
- **Step 1: Session Type Selection**
  - Online (video session) button
  - In-Person (office visit) button

- **Step 2: Date Selection**
  - Calendar picker (dates with available slots are clickable)
  - Shows 365 days ahead (1 year booking window)

- **Step 3: Time Selection**
  - Dropdown of available time slots for selected date

- **Step 4: Service Selection**
  - Dropdown of available services (shows name, duration, rate)

- **Action Buttons:**
  - "Back to Dashboard" button
  - "Book Appointment" button (after all selections made)

- **Success Confirmation:**
  - Checkmark icon
  - "Appointment Booked!" message
  - Auto-redirect to dashboard

- **Help Section:**
  - Choose Session Type guide
  - Select a Date guide
  - Choose a Time guide
  - Select Service guide

---

### 10. Portal Appointments (portal-appointments.tsx)
**Verified Features:**
- **Tabs:**
  - Upcoming (shows future sessions)
  - Past (shows completed/cancelled sessions)

- **Appointment Card Display:**
  - Date (formatted)
  - Time (formatted in 12-hour format)
  - Status badge (Scheduled/Confirmed/Completed/Cancelled)
  - Service Name
  - Therapist Name
  - Location/Room Name
  - Duration
  - Reference Number

- **Action Buttons:**
  - "Back to Dashboard" button
  - "Book Appointment" button (if no upcoming appointments)

- **Filtering:**
  - Automatic split by upcoming vs past based on current date/time (America/New_York timezone)

- **Help Section:**
  - View All Your Sessions guide
  - Appointment Details guide
  - Status Colors guide
  - Book New Session guide

---

### 11. Portal Invoices (portal-invoices.tsx)
**Verified Features:**
- **Invoice Table Columns:**
  - Date
  - Service (name + code)
  - Amount (total with breakdown: units × rate)
  - Insurance (Covered badge or —)
  - Copay (amount or —)
  - Status badge (Pending/Paid/Partially Paid/Overdue)
  - Actions

- **Actions Column:**
  - **For Pending:**
    - "Pay Now" button → Opens Stripe Checkout
  
  - **For Paid:**
    - "View Receipt" button → Opens receipt in new window

- **Payment Flow:**
  - Click "Pay Now" → Redirected to Stripe Checkout
  - Enter payment info on Stripe
  - Success → Return with confirmation toast
  - Cancel → Return with cancellation message

- **Help Section:**
  - View Invoice Details guide
  - Check Payment Status guide
  - Make a Payment guide (Stripe flow)
  - View Receipt guide

---

### 12. Portal Documents (portal-documents.tsx)
**Verified Features:**
- **Upload Section:**
  - "Select File" input (accepts .pdf, .jpg, .jpeg, .png, .doc, .docx)
  - Document Type dropdown:
    - Insurance Card/Info
    - Consent Forms
    - Other Documents
  - "Upload Document" button
  - Shows selected file name and size

- **Document Table Columns:**
  - File Name
  - Category (Insurance/Forms/Uploaded)
  - Size (formatted: KB, MB)
  - Uploaded Date
  - Actions

- **Actions Column:**
  - Eye icon button ("View") → Opens preview
  - Download icon button → Downloads file

- **Document Preview:**
  - PDFs open in new tab
  - Images show in modal dialog

- **Help Section:**
  - Choose Your File guide (file types, max 10MB)
  - Select Document Type guide
  - Upload & Track guide
  - View or Download guide

---

### 13. Portal Notifications (portal-notifications.tsx)
**Verified Features:**
- **Notification Display:**
  - Title
  - Message (full text)
  - Timestamp (with date-fns formatting in America/New_York)
  - Read/Unread status

- **Visual Indicators:**
  - Unread: Orange background + "New" badge + Bell icon
  - Read: White background + Checkmark icon

- **Automatic Read Marking:**
  - Notifications marked as read automatically when page is viewed

- **Notification Types** (from code comments):
  - Appointment confirmations
  - 24-hour reminders
  - Schedule changes
  - Billing updates
  - Messages from therapist

- **Help Section:**
  - Types of Notifications guide
  - Unread vs Read guide
  - Automatic Marking guide
  - Stay Informed guide

---

## SUMMARY: KEY FINDINGS

### What Therapists CAN Do in Billing:
✅ View their own billing records (therapists) or all records (admin/supervisor)
✅ Record payments (all payment methods)
✅ Change payment status (Pending → Billed → Paid → Denied → Refunded → Follow-up)
✅ Email invoices to clients
✅ Preview invoices
✅ Download invoices as PDF
✅ Filter by date range, status, service, client
✅ Search clients by name

### What Therapists CANNOT Do:
❌ Create billing records manually (auto-generated from completed sessions)
❌ Delete billing records
❌ Edit service codes or amounts after creation

### Portal Client Capabilities:
✅ Book appointments (online or in-person, 1 year ahead)
✅ View all appointments (upcoming/past tabs)
✅ Pay invoices via Stripe
✅ View payment receipts
✅ Upload documents (insurance, forms, other)
✅ View/download uploaded documents
✅ Check notifications (auto-marked as read)

### Portal Client Limitations:
❌ Cannot cancel appointments (must contact therapist)
❌ Cannot reschedule appointments (must contact therapist)
❌ Cannot edit profile information
❌ Cannot message therapist directly through portal
