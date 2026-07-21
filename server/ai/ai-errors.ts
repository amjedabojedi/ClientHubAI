/**
 * User-facing AI failure helpers. Kept separate from the OpenAI client module
 * so routes/tests can map provider errors without requiring API credentials
 * at import time.
 */

export class AiServiceError extends Error {
  status: number;
  code: string;
  constructor(message: string, status: number, code: string) {
    super(message);
    this.name = "AiServiceError";
    this.status = status;
    this.code = code;
  }
}

/**
 * Map OpenAI / network failures to a clear staff-facing message.
 * Prefer this over leaking raw provider text like "429 insufficient_quota".
 */
export function toAiServiceError(
  error: unknown,
  fallback = "Could not generate AI content right now. Please try again, or contact your practice admin if this keeps happening.",
): AiServiceError {
  if (error instanceof AiServiceError) return error;

  const err = error as {
    status?: number;
    code?: string;
    message?: string;
    error?: { code?: string; message?: string };
    response?: { status?: number };
  };
  const status = err?.status ?? err?.response?.status;
  const code = String(err?.code || err?.error?.code || "");
  const rawMessage = String(err?.message || err?.error?.message || "");
  const lower = rawMessage.toLowerCase();

  if (
    code === "insufficient_quota" ||
    (status === 429 && (lower.includes("quota") || lower.includes("billing"))) ||
    lower.includes("insufficient_quota") ||
    (lower.includes("exceeded your current quota") && lower.includes("billing"))
  ) {
    return new AiServiceError(
      "AI note generation is unavailable because the practice OpenAI account is out of credits. Please ask your practice admin to add billing credits on platform.openai.com, then try again.",
      503,
      "INSUFFICIENT_QUOTA",
    );
  }

  if (code === "invalid_api_key" || status === 401 || lower.includes("incorrect api key")) {
    return new AiServiceError(
      "AI note generation is misconfigured (invalid API key). Please ask your practice admin to update the OpenAI API key.",
      503,
      "INVALID_API_KEY",
    );
  }

  if (status === 429 || code === "rate_limit_exceeded" || lower.includes("rate limit")) {
    return new AiServiceError(
      "AI is temporarily rate-limited. Please wait a minute and try again.",
      429,
      "RATE_LIMITED",
    );
  }

  if (
    lower.includes("timeout") ||
    lower.includes("etimedout") ||
    lower.includes("timed out") ||
    code === "ETIMEDOUT" ||
    code === "ECONNABORTED"
  ) {
    return new AiServiceError(
      "AI took too long to respond. Please try again.",
      504,
      "TIMEOUT",
    );
  }

  if (status === 403 || lower.includes("country, region, or territory not supported")) {
    return new AiServiceError(
      "AI provider blocked this request. Please ask your practice admin to check the OpenAI account region/settings.",
      503,
      "PROVIDER_FORBIDDEN",
    );
  }

  return new AiServiceError(fallback, 500, "AI_ERROR");
}
