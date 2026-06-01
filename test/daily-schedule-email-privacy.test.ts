/**
 * Automated Tests for the Daily 8 AM Therapist Schedule Email Privacy Rules
 *
 * The daily schedule digest is an external surface (it leaves SmartHub as an
 * email), so the HARD privacy rule applies: any client identity must be reduced
 * to TWO INITIALS ONLY ("J.D.") — never the full name, diagnosis, or notes.
 *
 * These tests exercise the in-memory email builder directly (no DB writes, no
 * SparkPost), so they are fast and free of the client-seeding concurrency race
 * that affects the HTTP-based privacy tests.
 *
 * Run with: npx tsx test/daily-schedule-email-privacy.test.ts
 */

import { notificationService } from "../server/notification-service";

let testsPassed = 0;
let testsFailed = 0;

function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`✅ PASS: ${message}`);
    testsPassed++;
  } else {
    console.error(`❌ FAIL: ${message}`);
    testsFailed++;
  }
}

// Reach the private builder. It is deterministic and side-effect free.
const svc = notificationService as any;

const therapist = { id: 1, fullName: "Dr. Alex Therapist", email: "alex@example.com" };

const sessions = [
  {
    sessionDate: "2026-06-02T13:00:00.000Z", // 9:00 AM ET
    status: "scheduled",
    client: { fullName: "John Doe" },
    service: { serviceName: "Individual Psychotherapy" },
    zoomEnabled: false,
    room: { roomName: "Maple Room", roomNumber: "101" },
  },
  {
    sessionDate: "2026-06-02T14:30:00.000Z", // 10:30 AM ET
    status: "confirmed",
    client: { fullName: "Mary Jane Watson" },
    service: { serviceName: "Couples Therapy" },
    zoomEnabled: true,
    zoomJoinUrl: "https://zoom.us/j/abc123",
    room: null,
  },
];

// ---------------------------------------------------------------------------
// Test 1: full names never appear; initials do
// ---------------------------------------------------------------------------
{
  const { subject, body } = svc.buildDailyScheduleEmail(
    therapist,
    sessions,
    "Tuesday, June 2, 2026",
  );
  const haystack = `${subject}\n${body}`;

  assert(!haystack.includes("John Doe"), "Full name 'John Doe' is NOT in the email");
  assert(
    !haystack.includes("Mary Jane Watson") && !haystack.includes("Mary"),
    "Full name 'Mary Jane Watson' is NOT in the email",
  );
  assert(haystack.includes("J.D."), "Initials 'J.D.' ARE in the email");
  assert(haystack.includes("M.W."), "Initials 'M.W.' ARE in the email");

  // Useful, non-PHI content is present.
  assert(haystack.includes("9:00 AM"), "First appointment start time (ET) is shown");
  assert(haystack.includes("10:30 AM"), "Second appointment start time (ET) is shown");
  assert(
    haystack.includes("Individual Psychotherapy"),
    "Session type is shown",
  );
  assert(
    haystack.includes("Maple Room (101)"),
    "Physical room location is shown",
  );
  assert(
    haystack.includes("https://zoom.us/j/abc123"),
    "Telehealth Zoom join link is shown",
  );
  assert(
    haystack.includes("Tuesday, June 2, 2026"),
    "Day label is shown in the email",
  );
}

// ---------------------------------------------------------------------------
// Test 2: missing client name still yields initials-shaped placeholder, never PHI
// ---------------------------------------------------------------------------
{
  const { body } = svc.buildDailyScheduleEmail(
    therapist,
    [
      {
        sessionDate: "2026-06-02T13:00:00.000Z",
        status: "in-progress",
        client: { fullName: "" },
        service: { serviceName: "Intake" },
        zoomEnabled: false,
        room: { roomName: "Oak", roomNumber: null },
      },
    ],
    "Tuesday, June 2, 2026",
  );
  // Each appointment line begins with "• <time> — <initials> —". With no name,
  // the initials slot must be the placeholder "C." (never the word "Client").
  assert(
    /•[^\n]*— C\. —/.test(body),
    "Missing client name falls back to initials-shaped 'C.' placeholder",
  );
  assert(body.includes("Oak"), "Room without a number still shows its name");
}

// ---------------------------------------------------------------------------
// Test 3: empty-day digest is still sent with a clear message
// ---------------------------------------------------------------------------
{
  const { subject, body } = svc.buildDailyScheduleEmail(
    therapist,
    [],
    "Tuesday, June 2, 2026",
  );
  assert(
    subject.includes("Tuesday, June 2, 2026"),
    "Empty-day subject still names the day",
  );
  assert(
    body.toLowerCase().includes("no appointments"),
    "Empty-day body says there are no appointments",
  );
}

console.log(`\n${testsPassed} passed, ${testsFailed} failed`);
if (testsFailed > 0) process.exit(1);
