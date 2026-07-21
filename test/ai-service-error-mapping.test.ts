/**
 * Hermetic: maps OpenAI-style failures to clear staff-facing AiServiceError
 * messages (no network / no DB).
 */
import assert from "node:assert/strict";
import { AiServiceError, toAiServiceError } from "../server/ai/ai-errors";

function run() {
  const quota = toAiServiceError({
    status: 429,
    code: "insufficient_quota",
    message: "429 You exceeded your current quota, please check your plan and billing details.",
  });
  assert.equal(quota.code, "INSUFFICIENT_QUOTA");
  assert.equal(quota.status, 503);
  assert.match(quota.message, /out of credits/i);
  assert.match(quota.message, /practice admin/i);

  const rate = toAiServiceError({
    status: 429,
    code: "rate_limit_exceeded",
    message: "Rate limit reached",
  });
  assert.equal(rate.code, "RATE_LIMITED");
  assert.equal(rate.status, 429);

  const key = toAiServiceError({
    status: 401,
    code: "invalid_api_key",
    message: "Incorrect API key provided",
  });
  assert.equal(key.code, "INVALID_API_KEY");
  assert.equal(key.status, 503);

  const passthrough = toAiServiceError(
    new AiServiceError("already mapped", 503, "INSUFFICIENT_QUOTA"),
  );
  assert.equal(passthrough.message, "already mapped");
  assert.equal(passthrough.code, "INSUFFICIENT_QUOTA");

  console.log("ai-service-error-mapping: ok");
}

run();
