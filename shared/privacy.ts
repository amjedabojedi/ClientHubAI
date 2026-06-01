// Privacy helpers for any client information that LEAVES SmartHub (calendar
// feeds, emails, or any other external surface).
//
// HARD RULE: client identity that leaves the system must be reduced to TWO
// INITIALS ONLY (e.g. "J.D."). Never expose the full name, and never include
// diagnosis, notes, or any other clinical detail externally.

/**
 * Reduce a client's full name to two initials, e.g. "John Doe" -> "J.D.".
 *
 * - "Madonna" (single name) -> "M."
 * - "Mary Jane Watson" -> "M.W." (first + last initial only)
 * - empty / missing -> "C." (always an initials-shaped placeholder; never the
 *   word "Client" or any other free text, so external surfaces stay strictly
 *   initials-only)
 */
export function clientInitials(fullName?: string | null): string {
  const parts = (fullName || "")
    .trim()
    .split(/\s+/)
    .filter((p) => p.length > 0);

  if (parts.length === 0) return "C.";

  const firstInitial = parts[0].charAt(0).toUpperCase();
  if (parts.length === 1) return `${firstInitial}.`;

  const lastInitial = parts[parts.length - 1].charAt(0).toUpperCase();
  return `${firstInitial}.${lastInitial}.`;
}
