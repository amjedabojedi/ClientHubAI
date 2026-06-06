// SMS delivery helper built on Twilio.
//
// This module is intentionally narrow: it only knows how to (1) report whether
// SMS is configured, (2) normalize a phone number to E.164, and (3) send a
// single text. All consent / preference gating lives in the notification
// service — this file never decides *whether* to text someone, only *how*.
//
// Configuration is via three secrets (all required for SMS to be active):
//   TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER
// When any are missing, isSmsConfigured() returns false and the caller skips
// SMS gracefully (mirrors the SparkPost-not-configured email behavior).
import twilio from "twilio";

let cachedClient: ReturnType<typeof twilio> | null = null;

export function isSmsConfigured(): boolean {
  return Boolean(
    process.env.TWILIO_ACCOUNT_SID &&
      process.env.TWILIO_AUTH_TOKEN &&
      process.env.TWILIO_FROM_NUMBER,
  );
}

function getClient(): ReturnType<typeof twilio> {
  if (!cachedClient) {
    cachedClient = twilio(
      process.env.TWILIO_ACCOUNT_SID as string,
      process.env.TWILIO_AUTH_TOKEN as string,
    );
  }
  return cachedClient;
}

// Test seam: lets hermetic tests inject a fake Twilio client so SMS sending can
// be asserted without network calls or real credentials. Guarded so it can
// never be used to redirect real SMS traffic in a production deployment.
export function __setSmsClientForTests(client: unknown): void {
  if (process.env.NODE_ENV === "production") {
    throw new Error("__setSmsClientForTests must not be called in production");
  }
  cachedClient = client as ReturnType<typeof twilio> | null;
}

/**
 * Normalize a raw phone string to E.164 (e.g. "+15195551234").
 *
 * Returns null when the number cannot be confidently normalized, so callers
 * can skip-and-log rather than handing Twilio an invalid destination. The
 * practice operates in North America, so bare 10-digit numbers are assumed to
 * be +1; an explicit leading "+" is always trusted as already-international.
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

export interface SmsSendResult {
  success: boolean;
  sid?: string;
  error?: string;
}

/**
 * Send a single SMS. Never throws — always resolves to a result the caller can
 * audit. Assumes `to` is already E.164 (use normalizePhoneE164 first).
 */
export async function sendSms(to: string, body: string): Promise<SmsSendResult> {
  if (!isSmsConfigured()) {
    return { success: false, error: "SMS not configured" };
  }
  try {
    const message = await getClient().messages.create({
      to,
      from: process.env.TWILIO_FROM_NUMBER as string,
      body,
    });
    return { success: true, sid: message.sid };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}
