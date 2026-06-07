// Pure phone-number normalization shared by the client and server.
//
// This lives in `shared/` (no Twilio / Node dependencies) so the same logic
// drives:
//   - server SMS sending and the stored standardized copy (phoneE164), and
//   - client-side form feedback ("this number can't receive texts as written").
//
// Keep this file dependency-free so it can be imported from the browser bundle.

/**
 * Normalize a raw phone string to E.164 (e.g. "+15195551234").
 *
 * Returns null when the number cannot be confidently normalized, so callers
 * can skip-and-log (server) or warn (client) rather than treating an invalid
 * destination as textable. The practice operates in North America, so bare
 * 10-digit numbers are assumed to be +1; an explicit leading "+" is always
 * trusted as already-international.
 */
export function normalizePhoneE164(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = String(raw).trim();
  if (!trimmed) return null;

  // Already international: keep the leading + and digits only.
  if (trimmed.startsWith("+")) {
    const digits = trimmed.slice(1).replace(/\D/g, "");
    // E.164 allows up to 15 digits; require at least 8 to avoid junk.
    if (digits.length < 8 || digits.length > 15) return null;
    return `+${digits}`;
  }

  const digits = trimmed.replace(/\D/g, "");
  if (digits.length === 10) {
    // North American number without country code.
    return `+1${digits}`;
  }
  if (digits.length === 11 && digits.startsWith("1")) {
    return `+${digits}`;
  }
  // Ambiguous (no country code and not a NANP-length number) — refuse rather
  // than guess, so we never text a wrong/invalid destination.
  return null;
}
