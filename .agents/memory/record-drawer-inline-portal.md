---
name: RecordDrawer inline-drawer portal pattern
description: How stateful client-detail child dialogs are migrated into the RecordDrawer slide-over without extracting their bodies.
---

# RecordDrawer inline-drawer portal pattern

When migrating an existing stateful Dialog (local useState + mutations defined in
the page) into the RecordDrawer slide-over system, do NOT extract its body into a
registry component (the page-wrapper registry pattern from the heavy-record-drawers
work). For bodies that share the page's closures (mutations, form state, helpers),
extraction is high-risk and high-churn.

Instead use the **inline-drawer portal** mechanism:
- `RecordDrawerContext` exposes `INLINE_DRAWER_TYPE`, an `inlineKey` on each entry,
  and a host `outletEl` / `registerOutletEl`.
- The drawer host renders an empty outlet div for inline-type entries.
- The page keeps the dialog body inline but wraps it as
  `{drawerOutletEl && topInlineKey === "<key>" && createPortal(<>...</>, drawerOutletEl)}`.
- Triggers call an `openInlineDrawer(inlineKey, {title, subtitle, size})` helper;
  cancel/close buttons call `closeTopDrawer()` instead of the old boolean setters.
- The host renders title/subtitle/breadcrumb, so the body must DROP
  DialogHeader/DialogTitle/DialogDescription (Radix Title needs Dialog context and
  will throw outside it). DialogFooter is a plain div and is safe to keep.

**Why:** gains breadcrumb + browser-Back support without rewriting ~1200 lines of
coupled dialog bodies. Lower risk than registry extraction.

**How to apply:** remove the now-dead `isXOpen` boolean useState (keep state that
holds DATA, e.g. the selected record). Drawers can stack (MAX_DRAWER_DEPTH=2), e.g.
review → preview by calling openInlineDrawer from inside the first drawer's body.
Patient portal (/portal/*) is excluded; standalone routes stay as deep-link entry
points. Dead-code dialogs and close-guarded modals (Session Recorder, delete
confirmations) were intentionally left as plain Dialogs.
