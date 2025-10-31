# Therapist Availability & Client Booking Flow

## 📊 Complete System Architecture

### Database Schema

#### 1. **userProfiles Table** (Enhanced)
```typescript
{
  workingDays: string[],        // ["Monday", "Tuesday", "Wednesday"...]
  workingHours: string,          // JSON: {"Monday": {"start": "09:00", "end": "17:00"}, ...}
  maxClientsPerDay: number,      // Maximum appointments per day (e.g., 8)
  sessionDuration: number,       // Default session length in minutes (e.g., 50)
  availabilityStatus: string     // "available", "on_leave", "limited"
}
```

#### 2. **therapistBlockedTimes Table** (New)
```typescript
{
  id: number,
  therapistId: number,           // Reference to therapist
  startTime: timestamp,          // Block start (e.g., "2025-01-15 10:00:00")
  endTime: timestamp,            // Block end (e.g., "2025-01-15 11:30:00")
  allDay: boolean,               // Full day block vs specific hours
  blockType: string,             // "vacation", "meeting", "sick_leave", "personal", "training"
  reason: string,                // Optional description
  isRecurring: boolean,          // For recurring blocks (e.g., weekly team meeting)
  recurrencePattern: string,     // JSON for recurrence rules
  isActive: boolean
}
```

#### 3. **services Table** (Existing)
```typescript
{
  id: number,
  serviceName: string,           // "Individual Therapy", "Family Session"
  duration: number,              // Service-specific duration (45, 60, 90 minutes)
  baseRate: decimal,
  isActive: boolean
}
```

#### 4. **sessions Table** (Existing)
```typescript
{
  therapistId: number,
  clientId: number,
  serviceId: number,
  sessionDate: timestamp,        // Scheduled appointment time
  status: string,                // "scheduled", "confirmed", "cancelled", "completed"
  roomId: number
}
```

---

## 🔄 **Availability Calculation Logic**

### Algorithm: `getAvailableTimeSlots(therapistId, date, serviceId)`

**Input:**
- `therapistId`: Which therapist
- `date`: Which day (e.g., "2025-01-15")
- `serviceId`: What type of session (determines duration)

**Process:**

1. **Load Therapist Profile**
   - Get `workingHours` JSON
   - Get `maxClientsPerDay`
   - Get default `sessionDuration`

2. **Get Service Duration**
   - Query services table for specific duration
   - Fallback to therapist's default if not specified

3. **Determine Working Hours for the Day**
   ```javascript
   const workingHours = JSON.parse(profile.workingHours);
   const dayOfWeek = "Monday"; // from date
   const dayHours = workingHours["Monday"]; 
   // Returns: { start: "09:00", end: "17:00" }
   ```

4. **Load Conflicts**
   - **Blocked Times**: Vacation, meetings, time-off for this day
   - **Existing Sessions**: Already scheduled appointments

5. **Generate Time Slots (15-minute intervals)**
   ```
   Start: 09:00 AM
   End:   05:00 PM
   Interval: Every 15 minutes
   
   Slots: [
     "09:00 AM", "09:15 AM", "09:30 AM", "09:45 AM",
     "10:00 AM", "10:15 AM", ...
   ]
   ```

6. **Check Availability for Each Slot**
   ```javascript
   for each slot:
     slotEnd = slot + sessionDuration (e.g., 09:00 + 50 min = 09:50)
     
     isBlocked = any blockedTime overlaps with [slot, slotEnd]
     hasSession = any existing session overlaps with [slot, slotEnd]
     
     available = NOT isBlocked AND NOT hasSession
   ```

**Output:**
```json
[
  { "time": "9:00 AM", "available": true },
  { "time": "9:15 AM", "available": true },
  { "time": "9:30 AM", "available": false },  // Existing appointment
  { "time": "10:00 AM", "available": false }, // Blocked (vacation)
  { "time": "11:00 AM", "available": true }
]
```

---

## 👨‍⚕️ **Therapist Availability Management Flow**

### Step 1: Set Working Hours

**Location:** User Profiles > Edit Professional Details > Schedule Tab

**UI Components:**
- **Working Days Selector**: Checkboxes for Mon-Fri
- **Hours Editor**: For each selected day:
  ```
  Monday:    [09:00 AM] to [05:00 PM]  ✓ Active
  Tuesday:   [10:00 AM] to [06:00 PM]  ✓ Active
  Wednesday: [09:00 AM] to [01:00 PM]  ✓ Active
  Thursday:  [OFF]                     ✗ Inactive
  Friday:    [09:00 AM] to [03:00 PM]  ✓ Active
  ```

**Stored as:**
```json
{
  "Monday": { "start": "09:00", "end": "17:00" },
  "Tuesday": { "start": "10:00", "end": "18:00" },
  "Wednesday": { "start": "09:00", "end": "13:00" },
  "Friday": { "start": "09:00", "end": "15:00" }
}
```

### Step 2: Block Time Off

**Location:** User Profiles > Availability Management

**UI Components:**
- **Vacation Calendar**: Visual calendar to select date ranges
- **Quick Blocks**:
  ```
  ┌─────────────────────────────────────┐
  │ Add Time Block                      │
  ├─────────────────────────────────────┤
  │ Type: [Vacation ▼]                  │
  │ Date Range: [Jan 20] to [Jan 25]    │
  │ All Day: [✓]                        │
  │ Reason: Family vacation             │
  │                                     │
  │ [ Cancel ]          [ Save Block ]  │
  └─────────────────────────────────────┘
  ```

- **Recurring Blocks** (e.g., Weekly team meeting every Monday 9-10 AM):
  ```
  ┌─────────────────────────────────────┐
  │ Recurring Block                     │
  ├─────────────────────────────────────┤
  │ Type: [Meeting ▼]                   │
  │ Every: [Monday ▼]                   │
  │ Time: [09:00 AM] to [10:00 AM]      │
  │ Repeat: [Weekly ▼]                  │
  │ Reason: Team meeting                │
  │                                     │
  │ [ Cancel ]          [ Save Block ]  │
  └─────────────────────────────────────┘
  ```

### Step 3: View Availability Preview

**Calendar View:**
```
┌────────────────── January 2025 ──────────────────┐
│  Mon    Tue    Wed    Thu    Fri    Sat    Sun  │
├──────────────────────────────────────────────────┤
│   13     14     15     16     17     18     19   │
│  9-5    10-6   9-1    OFF    9-3    OFF    OFF  │
│  ●●●    ●●●    ●●     -      ●●●    -      -    │
│  6/8    7/8    3/4    0/0    5/8    0/0    0/0  │
│                                                  │
│   20     21     22     23     24     25     26   │
│  🏖️     🏖️     🏖️     🏖️     🏖️    OFF    OFF  │
│ VACATION - Family trip                          │
└──────────────────────────────────────────────────┘

Legend:
● = Booked appointments
6/8 = 6 sessions booked out of 8 max
🏖️ = Blocked time (vacation, meetings, etc.)
```

---

## 👤 **Client Booking Flow**

### Step 1: Client Portal Login

```
┌─────────────────────────────────────────┐
│          TherapyFlow Portal             │
├─────────────────────────────────────────┤
│                                         │
│  Welcome back, Sarah Johnson           │
│                                         │
│  📅 Upcoming Appointments               │
│  • Jan 18, 2025 at 2:00 PM             │
│    with Dr. Emily Carter                │
│                                         │
│  [ 📅 Book New Appointment ]            │
│  [ 💳 View Invoices ]                   │
│  [ 📄 Upload Documents ]                │
│                                         │
└─────────────────────────────────────────┘
```

### Step 2: Select Service Type

```
┌─────────────────────────────────────────┐
│  Book New Appointment                   │
├─────────────────────────────────────────┤
│                                         │
│  Select Service:                        │
│                                         │
│  ○ Individual Therapy (50 min) - $150  │
│  ○ Family Session (90 min) - $250      │
│  ○ Initial Assessment (60 min) - $200  │
│                                         │
│  [ Cancel ]            [ Continue → ]   │
└─────────────────────────────────────────┘
```

### Step 3: View Available Time Slots

**Backend API Call:**
```javascript
GET /api/availability?therapistId=5&date=2025-01-15&serviceId=2
```

**Frontend Display:**
```
┌─────────────────────────────────────────┐
│  Available Times - January 15, 2025     │
├─────────────────────────────────────────┤
│  Your Therapist: Dr. Emily Carter       │
│  Service: Individual Therapy (50 min)   │
│                                         │
│  Morning:                               │
│  ○ 9:00 AM   ✓ Available               │
│  ○ 10:00 AM  ✓ Available               │
│  ○ 11:00 AM  ✗ Booked                  │
│                                         │
│  Afternoon:                             │
│  ○ 1:00 PM   ✓ Available               │
│  ○ 2:00 PM   ✓ Available               │
│  ○ 3:00 PM   ✗ Booked                  │
│  ○ 4:00 PM   ✓ Available               │
│                                         │
│  [ ← Back ]              [ Book → ]     │
└─────────────────────────────────────────┘
```

### Step 4: Confirm Booking

```
┌─────────────────────────────────────────┐
│  Confirm Your Appointment               │
├─────────────────────────────────────────┤
│                                         │
│  📅 Date: January 15, 2025              │
│  🕐 Time: 2:00 PM - 2:50 PM             │
│  👨‍⚕️ Therapist: Dr. Emily Carter        │
│  🏥 Service: Individual Therapy         │
│  💵 Cost: $150.00                       │
│                                         │
│  📧 Email confirmation will be sent to: │
│     sarah.johnson@email.com             │
│                                         │
│  [ Cancel ]         [ Confirm Booking ] │
└─────────────────────────────────────────┘
```

### Step 5: Automatic Confirmation

**What Happens:**
1. ✅ Session created in database
2. ✅ Room automatically assigned (conflict-free)
3. ✅ Billing record created
4. ✅ Email sent to client (SparkPost)
5. ✅ Email sent to therapist
6. ✅ Calendar updated

**Email Template:**
```
Subject: Appointment Confirmed - Jan 15, 2025 at 2:00 PM

Dear Sarah,

Your appointment has been confirmed:

Date: Wednesday, January 15, 2025
Time: 2:00 PM - 2:50 PM
Therapist: Dr. Emily Carter
Service: Individual Therapy (50 minutes)
Location: SmartHub Center - Room 203

Cost: $150.00 (payment due at time of service)

Need to reschedule? Log in to your portal or call us at (555) 123-4567.

Best regards,
SmartHub Team
```

---

## 🔍 **Real-Time Conflict Detection**

### Scenario: Double-Booking Prevention

**Situation:** Two clients try to book the same slot simultaneously.

**Solution:**
```javascript
// Database-level transaction with row locking
BEGIN TRANSACTION;

// Check availability again inside transaction
const existingSessions = await db
  .select()
  .from(sessions)
  .where(...)
  .for('UPDATE'); // Row lock

if (slotAlreadyBooked) {
  ROLLBACK;
  return { error: "This time slot was just booked by another client" };
}

// Create session
INSERT INTO sessions ...;

COMMIT;
```

---

## 📈 **Advanced Features**

### 1. **Max Clients Per Day Enforcement**

```javascript
// Before showing available slots
const todaysSessions = await db
  .select({ count: count() })
  .from(sessions)
  .where(...)
  .groupBy(date);

if (todaysSessions.count >= profile.maxClientsPerDay) {
  return []; // No slots available (daily limit reached)
}
```

### 2. **Buffer Time Between Sessions**

```javascript
// Add 10-minute buffer between sessions
const bufferMinutes = 10;
const effectiveSessionDuration = sessionDuration + bufferMinutes;
```

### 3. **Emergency Override**

Admin/staff can override blocked times for urgent appointments:
```javascript
const canOverride = user.role === 'admin' || user.role === 'supervisor';
```

---

## 🎯 **Summary**

### **For Therapists:**
1. Set weekly working hours (flexible per day)
2. Block time off (vacation, meetings, training)
3. View availability calendar with booking stats
4. Receive automatic notifications for new bookings

### **For Clients:**
1. Log in to portal
2. See only available time slots (smart filtering)
3. Book in 2 clicks
4. Get instant email confirmation

### **For System:**
1. Real-time conflict detection
2. Room auto-assignment
3. Billing auto-creation
4. HIPAA audit logging
5. Email automation (SparkPost)

---

## 🛠️ **Technical Stack**

- **Database**: PostgreSQL with Drizzle ORM
- **Availability Logic**: Server-side calculation (security + accuracy)
- **Real-time Updates**: Database transactions with row locking
- **Email**: SparkPost integration
- **Frontend**: React + TanStack Query (auto-refresh)
- **Time Zones**: All times stored in UTC, displayed in America/New_York
