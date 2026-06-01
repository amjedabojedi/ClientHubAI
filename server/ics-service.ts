// Builds a read-only iCalendar (RFC 5545) feed of a therapist's appointments.
//
// PRIVACY: this feed leaves SmartHub, so it must never contain a client's full
// name, diagnosis, notes, contact details, or any other PHI. Each event title
// is limited to the client's two initials (see shared/privacy.ts). Times are
// emitted in UTC ("Z" form) so external calendars render them in the viewer's
// own timezone without any ambiguity.

export interface CalendarEventInput {
  id: number;
  start: Date;
  durationMinutes: number;
  // Already privacy-reduced (e.g. "J.D.") before reaching this module.
  initials: string;
  status: string;
  location?: string | null;
}

export interface BuildCalendarOptions {
  calendarName: string;
  // Host/domain used to make UIDs globally unique and stable.
  host: string;
  events: CalendarEventInput[];
  now?: Date;
}

const CRLF = "\r\n";

/** Escape a text value per RFC 5545 (backslash, semicolon, comma, newlines). */
function escapeText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n|\n|\r/g, "\\n");
}

/** Format a Date as a UTC iCalendar timestamp, e.g. 20260601T133000Z. */
function toIcsUtc(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}` +
    `T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`
  );
}

/** Fold a content line to <=75 octets per RFC 5545 (continuation lines start with a space). */
function foldLine(line: string): string {
  const bytes = Buffer.from(line, "utf8");
  if (bytes.length <= 75) return line;

  const chunks: string[] = [];
  let current = "";
  let currentBytes = 0;
  for (const char of line) {
    const charBytes = Buffer.byteLength(char, "utf8");
    // Continuation lines are prefixed with a space, so budget 74 for them.
    const limit = chunks.length === 0 ? 75 : 74;
    if (currentBytes + charBytes > limit) {
      chunks.push(current);
      current = "";
      currentBytes = 0;
    }
    current += char;
    currentBytes += charBytes;
  }
  if (current.length > 0) chunks.push(current);
  return chunks.join(`${CRLF} `);
}

function mapStatus(status: string): "CONFIRMED" | "TENTATIVE" | "CANCELLED" {
  const s = (status || "").toLowerCase();
  if (s === "cancelled" || s === "canceled" || s === "no_show") return "CANCELLED";
  if (s === "scheduled") return "TENTATIVE";
  return "CONFIRMED"; // confirmed, in-progress, completed, etc.
}

export function buildTherapistCalendar(options: BuildCalendarOptions): string {
  const { calendarName, host, events } = options;
  const now = options.now ?? new Date();
  const dtstamp = toIcsUtc(now);

  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//SmartHub//Therapist Calendar//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeText(calendarName)}`,
    "X-WR-TIMEZONE:America/New_York",
    "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
    "X-PUBLISHED-TTL:PT1H",
  ];

  for (const event of events) {
    const durationMs = Math.max(1, event.durationMinutes) * 60 * 1000;
    const end = new Date(event.start.getTime() + durationMs);

    lines.push("BEGIN:VEVENT");
    lines.push(`UID:smarthub-session-${event.id}@${host}`);
    lines.push(`DTSTAMP:${dtstamp}`);
    lines.push(`DTSTART:${toIcsUtc(event.start)}`);
    lines.push(`DTEND:${toIcsUtc(end)}`);
    lines.push(`SUMMARY:${escapeText(event.initials)}`);
    if (event.location) {
      lines.push(`LOCATION:${escapeText(event.location)}`);
    }
    lines.push(`STATUS:${mapStatus(event.status)}`);
    lines.push("END:VEVENT");
  }

  lines.push("END:VCALENDAR");

  return lines.map(foldLine).join(CRLF) + CRLF;
}
