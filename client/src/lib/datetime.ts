/**
 * Centralized datetime utility library for TherapyFlow
 * Provides consistent time formatting and manipulation across the application
 * 
 * STANDARD DATE FORMATS (ALL dates in America/New_York timezone):
 * - Date only: 'MMM dd, yyyy' (e.g., "Jan 15, 2025")
 * - Date with time: "MMM dd, yyyy 'at' h:mm a" (e.g., "Jan 15, 2025 at 2:30 PM")
 * - Full month date: 'MMMM dd, yyyy' (e.g., "January 15, 2025")
 * - Input dates: 'yyyy-MM-dd' (e.g., "2025-01-15")
 */

import { toZonedTime, fromZonedTime, format as tzFormat, formatInTimeZone } from 'date-fns-tz';
import { format } from 'date-fns';

// User time format preferences
export type TimeFormat = '12h' | '24h';
export type DurationPreset = '30m' | '45m' | '1h' | '1.5h' | '2h';

// Default user preferences (can be overridden by user settings)
const DEFAULT_TIME_FORMAT: TimeFormat = '12h';
const DEFAULT_TIMEZONE = 'America/New_York'; // EST/EDT timezone for entire app

// STANDARD FORMAT STRINGS - Use these throughout the app for consistency
export const DATE_FORMATS = {
  DISPLAY: 'MMM dd, yyyy',              // Standard date display (Jan 15, 2025)
  DISPLAY_FULL: 'MMMM dd, yyyy',        // Full month name (January 15, 2025)
  DISPLAY_WITH_TIME: "MMM dd, yyyy 'at' h:mm a", // Date with time (Jan 15, 2025 at 2:30 PM)
  INPUT: 'yyyy-MM-dd',                  // Date input format (2025-01-15)
  MONTH_YEAR: 'MMMM yyyy',              // Month and year (January 2025)
  AUDIT: 'MMM dd, yyyy HH:mm:ss',       // Audit logs with seconds
} as const;

/**
 * Get user's preferred time format (12h/24h)
 * TODO: Replace with actual user preference from database
 */
export const getUserTimeFormat = (): TimeFormat => {
  // For now, detect from locale or use default
  // In future, fetch from user preferences API
  const locale = navigator.language;
  const use24Hour = locale.startsWith('en-GB') || 
                   locale.startsWith('de') || 
                   locale.startsWith('fr') || 
                   locale.startsWith('es') ||
                   locale.startsWith('it');
  return use24Hour ? '24h' : '12h';
};

/**
 * Get user's timezone (returns practice timezone)
 */
export const getUserTimeZone = (): string => {
  return DEFAULT_TIMEZONE;
};

/**
 * Get today's date in the practice timezone (America/New_York)
 * Returns the date string in yyyy-MM-dd format for use in date inputs
 */
export const getTodayInPracticeTimezone = (): string => {
  const now = new Date();
  return formatInTimeZone(now, DEFAULT_TIMEZONE, DATE_FORMATS.INPUT);
};

/**
 * STANDARD DATE FORMATTING FUNCTIONS
 * Use these functions throughout the app for consistent date display
 */

/**
 * Format date for standard display (MMM dd, yyyy)
 * Example: Jan 15, 2025
 */
export const formatDateDisplay = (date: Date | string | null | undefined): string => {
  if (!date) return 'No date';
  
  // Handle date-only strings (yyyy-MM-dd) without timezone conversion
  if (typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
    const [year, month, day] = date.split('-').map(Number);
    const dateObj = new Date(year, month - 1, day); // Use local timezone
    if (isNaN(dateObj.getTime())) return 'Invalid Date';
    return format(dateObj, DATE_FORMATS.DISPLAY);
  }
  
  // Handle full datetime strings with timezone conversion
  const dateObj = typeof date === 'string' ? new Date(date) : date;
  if (isNaN(dateObj.getTime())) return 'Invalid Date';
  return formatInTimeZone(dateObj, DEFAULT_TIMEZONE, DATE_FORMATS.DISPLAY);
};

/**
 * Format date with full month name (MMMM dd, yyyy)
 * Example: January 15, 2025
 */
export const formatDateFull = (date: Date | string | null | undefined): string => {
  if (!date) return 'No date';
  
  // Handle date-only strings (yyyy-MM-dd) without timezone conversion
  if (typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
    const [year, month, day] = date.split('-').map(Number);
    const dateObj = new Date(year, month - 1, day); // Use local timezone
    if (isNaN(dateObj.getTime())) return 'Invalid Date';
    return format(dateObj, DATE_FORMATS.DISPLAY_FULL);
  }
  
  // Handle full datetime strings with timezone conversion
  const dateObj = typeof date === 'string' ? new Date(date) : date;
  if (isNaN(dateObj.getTime())) return 'Invalid Date';
  return formatInTimeZone(dateObj, DEFAULT_TIMEZONE, DATE_FORMATS.DISPLAY_FULL);
};

/**
 * Format date with time (MMM dd, yyyy 'at' h:mm a)
 * Example: Jan 15, 2025 at 2:30 PM
 */
export const formatDateTimeDisplay = (date: Date | string | null | undefined): string => {
  if (!date) return 'No date';
  const dateObj = typeof date === 'string' ? new Date(date) : date;
  if (isNaN(dateObj.getTime())) return 'Invalid Date';
  return formatInTimeZone(dateObj, DEFAULT_TIMEZONE, DATE_FORMATS.DISPLAY_WITH_TIME);
};

/**
 * Format date for input fields (yyyy-MM-dd)
 * Example: 2025-01-15
 */
export const formatDateInput = (date: Date | string | null | undefined): string => {
  if (!date) return '';
  const dateObj = typeof date === 'string' ? new Date(date) : date;
  if (isNaN(dateObj.getTime())) return '';
  return formatInTimeZone(dateObj, DEFAULT_TIMEZONE, DATE_FORMATS.INPUT);
};

/**
 * Format month and year (MMMM yyyy)
 * Example: January 2025
 */
export const formatMonthYear = (date: Date | string): string => {
  const dateObj = typeof date === 'string' ? new Date(date) : date;
  if (isNaN(dateObj.getTime())) return 'Invalid Date';
  return formatInTimeZone(dateObj, DEFAULT_TIMEZONE, DATE_FORMATS.MONTH_YEAR);
};

/**
 * Format date for audit logs with seconds (MMM dd, yyyy HH:mm:ss)
 * Example: Jan 15, 2025 14:30:45
 */
export const formatDateAudit = (date: Date | string | null | undefined): string => {
  if (!date) return 'No date';
  const dateObj = typeof date === 'string' ? new Date(date) : date;
  if (isNaN(dateObj.getTime())) return 'Invalid Date';
  return formatInTimeZone(dateObj, DEFAULT_TIMEZONE, DATE_FORMATS.AUDIT);
};

/**
 * Convert local date/time string to UTC using practice timezone
 * Use this when creating sessions to ensure consistent timezone handling
 */
export const localToUTC = (dateString: string, timeString: string, timezone?: string): Date => {
  const tz = timezone || DEFAULT_TIMEZONE;
  // Build a date-time string: "2025-10-02 15:00:00"
  const dateTimeString = `${dateString} ${timeString}:00`;
  // fromZonedTime interprets this string as if it's in the specified timezone
  // and returns the equivalent UTC Date
  return fromZonedTime(dateTimeString, tz);
};

/**
 * Convert UTC date to local date in practice timezone
 */
export const utcToLocal = (date: Date | string, timezone?: string): Date => {
  const tz = timezone || DEFAULT_TIMEZONE;
  const dateObj = typeof date === 'string' ? new Date(date) : date;
  return toZonedTime(dateObj, tz);
};

/**
 * Format time string or date consistently based on user preference
 */
export const formatTime = (
  time: string | Date, 
  format?: TimeFormat,
  showSeconds = false
): string => {
  const timeFormat = format || getUserTimeFormat();
  
  let date: Date;
  
  if (typeof time === 'string') {
    // Handle HH:MM format (24-hour)
    if (/^\d{2}:\d{2}$/.test(time)) {
      date = new Date(`2000-01-01T${time}:00`);
    } else {
      date = new Date(time);
    }
  } else {
    date = time;
  }

  if (isNaN(date.getTime())) {
    return 'Invalid Time';
  }

  const options: Intl.DateTimeFormatOptions = {
    hour: 'numeric',
    minute: '2-digit',
    hour12: timeFormat === '12h',
    timeZone: getUserTimeZone()
  };

  if (showSeconds) {
    options.second = '2-digit';
  }

  return date.toLocaleTimeString('en-US', options);
};

/**
 * Format date consistently
 */
export const formatDate = (date: string | Date | null, includeYear = true): string => {
  if (!date) return 'No date';
  
  const dateObj = typeof date === 'string' ? new Date(date) : date;
  
  if (isNaN(dateObj.getTime())) {
    return 'Invalid Date';
  }

  const options: Intl.DateTimeFormatOptions = {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: getUserTimeZone()
  };

  if (includeYear) {
    options.year = 'numeric';
  }

  return dateObj.toLocaleDateString('en-US', options);
};

/**
 * Format date and time together
 */
export const formatDateTime = (
  date: string | Date, 
  timeFormat?: TimeFormat,
  includeYear = true
): string => {
  const formattedDate = formatDate(date, includeYear);
  const formattedTime = formatTime(date, timeFormat);
  return `${formattedDate} at ${formattedTime}`;
};

/**
 * Convert HH:MM string to minutes since midnight
 */
export const parseHHMMToMinutes = (time: string): number => {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
};

/**
 * Convert minutes since midnight to HH:MM string
 */
export const minutesToHHMM = (minutes: number): string => {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`;
};

/**
 * Add minutes to a date
 */
export const addMinutes = (date: Date, minutes: number): Date => {
  return new Date(date.getTime() + minutes * 60000);
};

/**
 * Convert duration preset to minutes
 */
export const durationToMinutes = (duration: DurationPreset): number => {
  switch (duration) {
    case '30m': return 30;
    case '45m': return 45;
    case '1h': return 60;
    case '1.5h': return 90;
    case '2h': return 120;
    default: return 60;
  }
};

/**
 * Convert minutes to human-readable duration
 */
export const minutesToDuration = (minutes: number): string => {
  if (minutes < 60) {
    return `${minutes}m`;
  } else if (minutes % 60 === 0) {
    return `${minutes / 60}h`;
  } else {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${hours}h ${mins}m`;
  }
};

/**
 * Generate time slots with flexible intervals
 */
export const generateTimeSlots = (
  startHour = 8,
  endHour = 24, 
  intervalMinutes = 30
): string[] => {
  const slots: string[] = [];
  const startMinutes = startHour * 60;
  const endMinutes = endHour * 60; // Include up to 24:00 (midnight)
  
  for (let minutes = startMinutes; minutes < endMinutes; minutes += intervalMinutes) {
    slots.push(minutesToHHMM(minutes));
  }
  
  return slots;
};

/**
 * Check if two time ranges overlap
 */
export const timeRangesOverlap = (
  start1: string, 
  duration1: number,
  start2: string,
  duration2: number
): boolean => {
  const start1Minutes = parseHHMMToMinutes(start1);
  const end1Minutes = start1Minutes + duration1;
  const start2Minutes = parseHHMMToMinutes(start2);
  const end2Minutes = start2Minutes + duration2;
  
  return start1Minutes < end2Minutes && start2Minutes < end1Minutes;
};

/**
 * Duration preset options for UI
 */
export const DURATION_PRESETS: Array<{
  value: DurationPreset;
  label: string;
  minutes: number;
}> = [
  { value: '30m', label: '30 minutes', minutes: 30 },
  { value: '45m', label: '45 minutes', minutes: 45 },
  { value: '1h', label: '1 hour', minutes: 60 },
  { value: '1.5h', label: '1.5 hours', minutes: 90 },
  { value: '2h', label: '2 hours', minutes: 120 }
];

/**
 * Time format display labels for settings
 */
export const TIME_FORMAT_OPTIONS = [
  { value: '12h' as const, label: '12-hour (1:30 PM)' },
  { value: '24h' as const, label: '24-hour (13:30)' }
];