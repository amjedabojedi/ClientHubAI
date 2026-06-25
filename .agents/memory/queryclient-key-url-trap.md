---
name: queryClient default queryFn URL building
description: How the default TanStack queryFn turns a queryKey into a fetch URL, and the silent trap with non-object second segments.
---

The app's default `getQueryFn` (client/src/lib/queryClient.ts) builds the fetch URL from `queryKey` with only three cases:

1. `length === 1` → uses `queryKey[0]` as the URL.
2. `length === 2 && typeof queryKey[1] === 'object'` → treats `queryKey[1]` as a **query-string params object** (`?a=b`), NOT path segments.
3. Otherwise → `queryKey.filter(k => typeof k === 'string').join('/')`.

**Trap:** a key like `["/api/foo", someNumber]` falls into case 3, the number is filtered out, and the request silently hits `/api/foo` (no id) → wrong route / 404, with no obvious error.

**How to apply:** For a path param like `/api/foo/:id`, do NOT rely on the default queryFn with `["/api/foo", id]`. Either:
- give the query an explicit `queryFn` that calls `apiRequest(\`/api/foo/${id}\`, "GET")` and returns `res.json()`, or
- use the object form `["/api/foo", { id }]` only if the endpoint actually reads `?id=` query params.

Invalidation by prefix (`["/api/foo", id]`) still works fine regardless — this trap is only about the **fetch URL**, not cache matching.
