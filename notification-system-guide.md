# TherapyFlow Notification System Guide

## How the Notification System Works

The notification system automatically monitors your therapy practice and sends alerts when important events happen. It uses **Triggers** (what to watch for) and **Templates** (what message to send).

### System Flow:
1. **Event Happens** → Something occurs in your system (client assigned, task overdue, etc.)
2. **Trigger Checks** → System checks if any triggers match this event
3. **Conditions Evaluated** → If conditions are met, notification is created
4. **Template Applied** → Message is generated using the template
5. **Notification Sent** → Alert is delivered to the right person

---

## Complete Trigger Reference Table

### 🔷 CLIENT EVENTS

| Trigger Event | Purpose | When It Fires | Who Gets Notified | Expected Outcome |
|---------------|---------|---------------|-------------------|------------------|
| **New Client Created** | Track all new client registrations | When a new client is added to the system | Administrators, Clinical Supervisors | Ensure proper intake procedures are followed |
| **Client Assigned to Therapist** | Monitor therapist workload and assignments | When a client is assigned to a therapist | Assigned therapist, their supervisor | Therapist schedules initial session within 24-48 hours |
| **Client Status Changed** | Track changes in client therapy stage | When client moves between stages (intake → active → discharge) | Therapist, supervisor, billing department | Appropriate follow-up actions taken based on new status |

### 🔷 SESSION EVENTS

| Trigger Event | Purpose | When It Fires | Who Gets Notified | Expected Outcome |
|---------------|---------|---------------|-------------------|------------------|
| **Session Scheduled** | Confirm session bookings | When a new session is scheduled | Therapist, client (if enabled) | Session preparation and confirmation |
| **Session Rescheduled** | Track scheduling changes | When existing session time is changed | Therapist, client, billing dept | Updated calendars and billing adjustments |
| **Session Cancelled** | Monitor cancellation patterns | When a session is cancelled | Therapist, supervisor (if frequent) | Reschedule attempt or follow-up with client |
| **Session Completed** | Trigger post-session workflows | When session is marked complete | Billing department, supervisor (for review) | Notes completed, billing processed, next session scheduled |
| **Session Overdue/Missed** | Identify attendance issues | When scheduled session time passes without completion | Therapist, supervisor | Client follow-up, attendance pattern review |

### 🔷 TASK EVENTS

| Trigger Event | Purpose | When It Fires | Who Gets Notified | Expected Outcome |
|---------------|---------|---------------|-------------------|------------------|
| **Task Assigned** | Ensure task awareness | When a task is assigned to someone | Task assignee, task creator | Task is acknowledged and prioritized |
| **Task Completed** | Track progress and outcomes | When a task is marked complete | Task creator, supervisor (for important tasks) | Results reviewed, next steps planned |
| **Task Overdue** | Prevent important items from being forgotten | When task due date passes | Task assignee, their supervisor | Immediate attention to overdue item |
| **Task Status Changed** | Monitor workflow progress | When task moves between stages | Relevant team members | Appropriate action based on new status |

### 🔷 DOCUMENT EVENTS

| Trigger Event | Purpose | When It Fires | Who Gets Notified | Expected Outcome |
|---------------|---------|---------------|-------------------|------------------|
| **Document Uploaded** | Track all document submissions | When any document is added to client file | Therapist, supervisor (for certain doc types) | Document review and filing |
| **Document Needs Supervisor Review** | Ensure clinical oversight | When clinical documents require approval | Clinical supervisor, department head | Review completed within 24-48 hours |
| **Document Reviewed** | Confirm completion of review process | When supervisor completes document review | Original uploader, relevant team | Document finalized, next steps initiated |

### 🔷 ASSESSMENT EVENTS

| Trigger Event | Purpose | When It Fires | Who Gets Notified | Expected Outcome |
|---------------|---------|---------------|-------------------|------------------|
| **Assessment Assigned** | Ensure assessments are completed | When assessment is assigned to client | Assigned therapist, supervisor | Assessment scheduled and completed on time |
| **Assessment Completed** | Trigger clinical review | When assessment results are submitted | Clinical supervisor, treating therapist | Results reviewed, treatment plan updated |
| **Assessment Overdue** | Prevent regulatory compliance issues | When assessment due date passes | Therapist, clinical supervisor, admin | Immediate completion or explanation |

### 🔷 BILLING EVENTS

| Trigger Event | Purpose | When It Fires | Who Gets Notified | Expected Outcome |
|---------------|---------|---------------|-------------------|------------------|
| **Payment Overdue** | Manage accounts receivable | When payment due date passes | Billing department, therapist | Payment follow-up initiated |
| **Billing Record Generated** | Confirm billing accuracy | When new billing record is created | Billing department, supervisor | Billing record reviewed and processed |

### 🔷 SYSTEM EVENTS

| Trigger Event | Purpose | When It Fires | Who Gets Notified | Expected Outcome |
|---------------|---------|---------------|-------------------|------------------|
| **Failed Login Attempt** | Monitor security | After multiple failed login attempts | IT administrator, security team | Account security review |
| **System Backup Completed** | Confirm data protection | When scheduled backup finishes | IT administrator | Backup integrity verified |

---

## Real-World Usage Examples

### Example 1: New Client Workflow
**Trigger**: "Client Assigned to Therapist"
**Conditions**: Priority = "High" (for urgent referrals)
**Template**: "Client Assignment Alert"
**Outcome**: Therapist gets immediate email to schedule intake within 24 hours

### Example 2: Clinical Oversight
**Trigger**: "Document Needs Supervisor Review"
**Conditions**: Document Type = "Treatment Plan" 
**Template**: "Document Review Required"
**Outcome**: Supervisor reviews and approves treatment plan within 48 hours

### Example 3: Task Management
**Trigger**: "Task Overdue"
**Conditions**: Priority = "High" OR Priority = "Urgent"
**Template**: "Task Overdue Alert"
**Outcome**: Immediate attention to critical overdue items

### Example 4: Quality Assurance
**Trigger**: "Assessment Overdue"
**Conditions**: Days Overdue > 7
**Template**: "Assessment Completion Alert"
**Outcome**: Clinical supervisor ensures compliance with assessment requirements

---

## Setting Up Effective Triggers

### Best Practices:
1. **Start Simple**: Begin with basic triggers (client assignments, task overdue)
2. **Use Conditions**: Filter for specific priorities, client types, or therapists
3. **Test First**: Create triggers with yourself as recipient to test functionality
4. **Review Regularly**: Adjust trigger conditions based on actual workflow needs
5. **Avoid Spam**: Don't create too many overlapping triggers

### Common Condition Examples:
- `{"priority": "high"}` - Only high priority items
- `{"therapistId": "17"}` - Only for specific therapist
- `{"clientType": "new"}` - Only for new clients
- `{"priority": "urgent", "clientStatus": "active"}` - Multiple conditions

This system ensures that critical events in your therapy practice never go unnoticed and appropriate actions are taken promptly.