/**
 * Centralized timezone utilities for server-side operations
 * All practice operations use America/New_York timezone
 */

import { toZonedTime, fromZonedTime, formatInTimeZone } from 'date-fns-tz';

export const PRACTICE_TIMEZONE = 'America/New_York';

/**
 * Convert a date string (yyyy-MM-dd) in practice timezone to UTC date range
 * Returns the start and end of that day in UTC
 */
export function localDateToUtcBounds(dateString: string): { start: Date; end: Date } {
  const [year, month, day] = dateString.split('-').map(Number);
  
  // Create start of day in America/New_York
  const startLocal = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T00:00:00`;
  const start = fromZonedTime(startLocal, PRACTICE_TIMEZONE);
  
  // Create end of day in America/New_York
  const endLocal = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T23:59:59.999`;
  const end = fromZonedTime(endLocal, PRACTICE_TIMEZONE);
  
  return { start, end };
}

/**
 * Convert a local date + time (HH:MM) in practice timezone to UTC Date
 */
export function localTimeToUtc(dateString: string, hour: number, minute: number): Date {
  const [year, month, day] = dateString.split('-').map(Number);
  const timeString = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00`;
  return fromZonedTime(timeString, PRACTICE_TIMEZONE);
}

/**
 * Check if a UTC date falls on a specific calendar day in practice timezone
 */
export function utcDateMatchesLocalDate(utcDate: Date, localDateString: string): boolean {
  // Format the UTC date as yyyy-MM-dd in America/New_York timezone
  const formatted = formatInTimeZone(utcDate, PRACTICE_TIMEZONE, 'yyyy-MM-dd');
  return formatted === localDateString;
}

/**
 * Get the local date string (yyyy-MM-dd) for a UTC date in practice timezone
 */
export function utcToLocalDateString(utcDate: Date): string {
  return formatInTimeZone(utcDate, PRACTICE_TIMEZONE, 'yyyy-MM-dd');
}
