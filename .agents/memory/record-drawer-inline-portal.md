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

The two session editing modals are migrated too: "session-details" (Session
Details & Actions) opens from the session card menu, and its "Edit This Session"
button stacks "full-edit-session" on top (size "wide" → host blocks
outside-click close, guarding the form). Save success calls closeAllDrawers();
Cancel/Close call closeTopDrawer(). The full-page nav buttons (Schedule Another /
removed View in Calendar) just set window.location.href — they intentionally do
NOT call closeTopDrawer() because the reload wipes drawer state and history.back()
would race the navigation.

## Browser-testing the inline drawers
- The host's drawer header has `data-testid="record-drawer"` (SheetContent) and
  `data-testid="record-drawer-title"` (SheetTitle) — assert open + title via the
  title text, which changes in place as the stack pushes/pops (the drawer element
  stays mounted). Breadcrumb back-buttons are `data-testid="breadcrumb-drawer-<i>"`
  (only present at depth ≥ 2).
- Client-detail accepts a `?tab=<value>` URL param (documents/billing/checklist/…)
  to land directly on a tab — far simpler in tests than driving the DropdownMenu
  tab switcher. Valid values are the `TAB_GROUPS[].items[].value`s.
- Escape (Sheet onOpenChange) routes through `closeTopDrawer` (history.back), so it
  pops exactly one level — good enough to exercise the close path in puppeteer.
- See test/client-detail-drawers-ui.test.ts (in test-privacy) for the pattern.
