---
name: apiRequest arg order
description: client apiRequest is (url, method, data) not (method, url, data), returns a raw Response, and handles CSRF + FormData.
---

The client helper `apiRequest` in `client/src/lib/queryClient.ts` has signature
`apiRequest(url, method, data?)` and returns a raw `Response` (call `.json()` to parse).
It already injects the `x-csrf-token` header and handles `FormData` (file uploads) — use it
for uploads instead of raw `fetch`, otherwise the POST is rejected by CSRF.

**Why:** Easy to write `apiRequest("POST", url, body)` by muscle memory — that silently swaps
method/url and the request hits the wrong endpoint with no TypeScript error (both are strings).

**How to apply:** Always `apiRequest(url, method, body)`; for path-param GETs see the
companion note `queryclient-key-url-trap.md` (numeric queryKey segments are dropped → use an
interpolated string key like `[\`/api/x/${id}\`]`).
