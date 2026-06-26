---
name: AI doc-extraction must chunk large inputs
description: Why large-document OpenAI extraction must be chunked + parallel, not one call.
---

A single `chat.completions` call over a whole large document is a double trap:
- The JSON output silently truncates at `max_tokens`, so `JSON.parse` throws and
  the route returns 422 / drops lines.
- A 40–100s+ call risks the platform gateway cutting the connection, so the
  browser gets an empty/partial body and `res.json()` throws the cryptic
  "Unexpected end of JSON input" (looks like a client bug, is really a timeout).

**Rule:** for any AI extraction over user-uploaded documents (insurance EOBs,
reports, etc.), split the extracted text into bounded line-preserving chunks,
run them with bounded concurrency, and merge (header fields from first chunk,
line items concatenated in order). Detect `finish_reason === 'length'` and fail
loudly with a "split the file" message rather than ingesting garbled JSON.

**How to apply:** insurance path is `extractInsuranceStatementFromText`
(server/ai/openai.ts). Also guard the client `res.json()` so a cut-off body
shows a friendly message, and wrap multer so size/type errors return clean JSON
(413/400) instead of a generic 500.
