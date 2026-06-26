---
name: puppeteer page.evaluate __name shim
description: tsx/esbuild keepNames injects __name into page.evaluate callbacks; stub objects with arrow methods throw "__name is not defined" in the browser.
---

# `__name is not defined` in puppeteer `page.evaluate` callbacks

When a browser test runs under tsx, esbuild's `keepNames` rewrites named/arrow
functions to `__name(fn, "label")`. Puppeteer serializes the callback you pass to
`page.evaluate(...)` and runs it in the **page** context, where `__name` does not
exist. Simple callbacks often survive, but a callback that **lazily constructs and
returns an object whose properties are arrow functions** (e.g. a `window.open`
stub: `{ document: { write: (s)=>{...}, close: ()=>{} }, focus: ()=>{} }`) gets its
methods wrapped in `__name(...)`. The wrapping runs when the object literal is
built — i.e. each time the page calls the stub — so it throws **"__name is not
defined"** at that moment, silently aborting whatever page code called it.

**Symptom seen:** intercepting the printed report via a `window.open` override —
`openCalls` incremented to 1 (override installed and called) but the capture stayed
`null` and a `pageerror: __name is not defined` fired. `document.write` never ran.

**Fix:** before installing the override, define an identity shim **via a STRING
evaluate** (strings are not transformed by esbuild, so no `__name` is injected into
the shim itself):
```ts
await page.evaluate(
  "window.__name = window.__name || function (f) { return f; };",
);
```
Then the normal arrow-function override evaluate works because injected `__name`
calls resolve to identity.

**Why:** the page's own bundle may define `__name` only in module scope, not
globally; the test's evaluate'd code references a global `__name`.

**How to apply:** any browser test whose `page.evaluate` callback returns/constructs
objects with function-valued properties (open/print stubs, fetch wrappers, fake
APIs). A plain inline arrow that returns a primitive/DOM-read usually does NOT need
it. Diagnose by adding `page.on("pageerror", ...)` and a call counter.
