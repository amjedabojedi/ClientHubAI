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
import { normalizePhoneE164 } from "@shared/phone";

// Re-exported so existing importers (`./sms-service`) keep working; the pure
// implementation now lives in shared/ so the client can reuse it too.
export { normalizePhoneE164 };

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

// --- Inbound replies (opt-out / opt-in) --------------------------------------
//
// Carriers and TCPA require honoring standard SMS keywords a recipient can text
// back. We classify a raw inbound body into an opt-out, an opt-in, or neither.
// Matching is case-insensitive and ignores surrounding whitespace/punctuation so
// "Stop.", " STOP ", and "stop" all count. Only a message whose meaningful text
// IS the keyword counts — a sentence that merely contains the word "stop" does
// not silently unsubscribe someone.
const OPT_OUT_KEYWORDS = new Set(["stop", "stopall", "unsubscribe", "cancel", "end", "quit"]);
const OPT_IN_KEYWORDS = new Set(["start", "unstop", "yes"]);

export type InboundSmsIntent = "opt-out" | "opt-in" | null;

export function classifyInboundSms(body: string | null | undefined): InboundSmsIntent {
  if (!body) return null;
  // Reduce to the core token: trim, lowercase, drop trailing punctuation.
  const normalized = String(body).trim().toLowerCase().replace(/[^a-z]/g, "");
  if (!normalized) return null;
  if (OPT_OUT_KEYWORDS.has(normalized)) return "opt-out";
  if (OPT_IN_KEYWORDS.has(normalized)) return "opt-in";
  return null;
}

/**
 * Validate that an inbound request really came from Twilio by checking the
 * `X-Twilio-Signature` header against the request URL + POST params using the
 * account auth token. Returns false (reject) when SMS isn't configured or the
 * signature is missing/invalid, so an unsigned/forged request can never mutate
 * a client's consent.
 */
export function validateTwilioSignature(
  signature: string | undefined,
  url: string,
  params: Record<string, unknown>,
): boolean {
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!authToken || !signature) return false;
  try {
    return twilio.validateRequest(authToken, signature, url, params as any);
  } catch {
    return false;
  }
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
