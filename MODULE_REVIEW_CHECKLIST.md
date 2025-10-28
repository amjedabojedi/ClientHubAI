# TherapyFlow Module Review Checklist
## Systematic Verification of Help Guide Content

---

## REVIEW METHODOLOGY

For each module:
1. ✅ Check actual UI components in code
2. ✅ Verify button names, field names, tab names
3. ✅ Confirm workflows and processes
4. ✅ Validate statuses, options, dropdowns
5. ✅ Update help guide with verified details

---

## MODULE 1: DASHBOARD
**Status:** ⏳ TO REVIEW

**What to Verify:**
- [ ] Stats cards shown (Active Clients, Pending Tasks, etc.)
- [ ] Quick action buttons available
- [ ] Navigation menu items
- [ ] Recent activity section

**Code Location:** `client/src/pages/dashboard.tsx`

---

## MODULE 2: CLIENT MANAGEMENT
**Status:** ⏳ TO REVIEW

**What to Verify:**
- [ ] Add Client form fields
- [ ] Client status options (Active, Inactive, Pending)
- [ ] Client profile tabs (Overview, Sessions, Assessments, Documents, Billing, Tasks, Checklist, Communications, History)
- [ ] Edit client functionality
- [ ] Search and filter options

**Code Location:** `client/src/pages/clients.tsx`, `client/src/pages/client-detail.tsx`

---

## MODULE 3: SCHEDULING
**Status:** ⏳ TO REVIEW

**What to Verify:**
- [ ] Calendar view modes (Day, Week, Month, List)
- [ ] Schedule appointment form fields
- [ ] Session status options
- [ ] Edit/cancel appointment options
- [ ] Room selection
- [ ] Service selection

**Code Location:** `client/src/pages/scheduling.tsx`

---

## MODULE 4: BILLING
**Status:** ✅ VERIFIED (Payment statuses confirmed)

**Verified Details:**
- ✅ Payment statuses: Pending, Billed, Paid, Denied, Follow Up, Refunded
- [ ] Service management fields
- [ ] Room management fields
- [ ] Invoice details
- [ ] Payment recording process

**Code Location:** `client/src/pages/billing-dashboard.tsx`

---

## MODULE 5: TASKS
**Status:** ⏳ TO REVIEW

**What to Verify:**
- [ ] Create task form fields
- [ ] Task status options (Pending, In Progress, Completed)
- [ ] Priority levels (Low, Medium, High, Urgent)
- [ ] Filter options
- [ ] Task completion methods

**Code Location:** `client/src/pages/tasks.tsx`

---

## MODULE 6: SESSION NOTES
**Status:** ⏳ TO REVIEW

**What to Verify:**
- [ ] Clinical Documentation tab fields (Session Focus, Symptoms, Goals, Intervention, Progress, Remarks, Recommendations)
- [ ] Risk Assessment tab - 10 factors with 0-4 scale
- [ ] AI generation feature
- [ ] Save/edit process

**Code Location:** `client/src/components/session-notes/`

---

## MODULE 7: ASSESSMENTS
**Status:** ⏳ TO REVIEW

**What to Verify:**
- [ ] Assign assessment process
- [ ] Assessment templates (admin creates, therapist assigns)
- [ ] Complete assessment workflow
- [ ] Generate report feature
- [ ] AI-powered report generation

**Code Location:** `client/src/pages/assessments.tsx`

---

## MODULE 8: MY PROFILE
**Status:** ⏳ TO REVIEW

**What to Verify:**
- [ ] Personal information fields
- [ ] Working hours configuration
- [ ] Days of week setup
- [ ] Credentials/title fields

**Code Location:** `client/src/pages/my-profile.tsx`

---

## MODULE 9: CLIENT PORTAL - LOGIN
**Status:** ⏳ TO REVIEW

**What to Verify:**
- [ ] Login process
- [ ] Activation flow
- [ ] Password reset process
- [ ] First-time setup

**Code Location:** `client/src/pages/portal/`

---

## MODULE 10: CLIENT PORTAL - APPOINTMENTS
**Status:** ⏳ TO REVIEW

**What to Verify:**
- [ ] Book appointment fields
- [ ] View appointments display
- [ ] Upcoming vs past appointments
- [ ] Cancellation process

**Code Location:** `client/src/pages/portal/`

---

## MODULE 11: CLIENT PORTAL - DOCUMENTS
**Status:** ⏳ TO REVIEW

**What to Verify:**
- [ ] Upload document process
- [ ] Supported file types
- [ ] Document list view
- [ ] Download options

**Code Location:** `client/src/pages/portal/`

---

## MODULE 12: CLIENT PORTAL - INVOICES
**Status:** ✅ VERIFIED (Payment statuses confirmed)

**Verified Details:**
- ✅ Payment statuses visible to clients
- [ ] Invoice detail view
- [ ] Payment information display

**Code Location:** `client/src/pages/portal/`

---

## MODULE 13: CLIENT PORTAL - NOTIFICATIONS
**Status:** ⏳ TO REVIEW

**What to Verify:**
- [ ] Types of notifications sent
- [ ] Notification delivery methods
- [ ] Email settings

**Code Location:** Email/notification system

---

## PRIORITY REVIEW ORDER

1. **HIGH PRIORITY** - Core therapist workflows:
   - Dashboard
   - Clients (Add, View, Edit)
   - Scheduling
   - Session Notes
   
2. **MEDIUM PRIORITY** - Supporting features:
   - Tasks
   - Billing (Services, Rooms)
   - Assessments
   - My Profile

3. **LOW PRIORITY** - Client Portal:
   - All portal features (already mostly verified)

---

## NEXT STEPS

Starting with Module 1 (Dashboard) to verify all details...
