---
name: Record drawer is non-modal at depth 1, modal deeper
description: Why the top-level record drawer must stay modeless and how editor levels stay protected.
---

# Top record-drawer level is non-modal; deeper levels are modal

The staff record-drawer (a shadcn `Sheet` / Radix Dialog) is **non-modal at stack
depth 1** (no dimming overlay, background page stays clickable) and **modal at
depth 2+** (overlay returns). The toggle is `isModal = stack.length > 1`, driving
both `<Sheet modal>` and `<SheetContent overlay>`.

**Why:** users browse the client list with a profile open and want to click another
list row to switch records without closing anything (in-place swap via
`replaceTopDrawer`, no stack growth/flicker). But depth 2+ hosts heavy report /
assessment editors where an accidental outside click could discard unsaved edits —
so those keep the modal backdrop and prevent outside-close.

**How to apply:** keep depth-1 outside interactions from closing the panel
(`onPointerDownOutside`/`onInteractOutside` → `preventDefault` when `!isModal`);
close depth-1 only via X / breadcrumb / Escape / Back. `SheetContent` takes an
`overlay?: boolean` (default true) so other Sheets are unaffected. If more entry
points open depth-1 drawers, consider gating modeless behavior by drawer *type*,
not depth alone, so only intended browsing panels are modeless.
