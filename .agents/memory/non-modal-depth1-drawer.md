---
name: Record drawer is non-modal at depth 1, modal deeper
description: Why the top-level record drawer must stay modeless and how editor levels stay protected.
---

# Top record-drawer level is non-modal; deeper levels are modal

The staff record-drawer (a shadcn `Sheet` / Radix Dialog) is **non-modal at stack
depth 1** (no dimming overlay, background page stays clickable) and **modal-feeling
at depth 2+** (overlay returns + outside-close guards). `isModal = stack.length > 1`
drives `<SheetContent overlay>` and the outside-close guards.

**CRITICAL: never bind `isModal` to the Sheet's `modal` prop.** The `Sheet` must
stay `modal={false}` for the WHOLE stack. Radix Dialog renders two *different*
component types depending on `modal` (`DialogContentModal` vs
`DialogContentNonModal`), so flipping `modal` as the stack grows (false→true when
the first child opens) **remounts the entire drawer body**. That tears down the
page mounted in the body (e.g. `ClientDetailPage` rendered by `ClientDetailDrawer`),
resetting its `useState`. The symptom is a child inline-drawer that opens with the
right title/breadcrumb but a **completely EMPTY body, no console error**. It only
bites inline bodies gated on local state set *right before* opening — the
`session-details` portal (gated on `selectedSessionForModal`) broke this way while
payment/document inline drawers (no such state guard) silently survived, which is
why the depth-2 UI tests didn't catch it. The depth-2 "modal" feel is reproduced
without Radix modality: the rendered overlay (pointer-events on) blocks background
clicks, and the outside-close guards stop dismissal.

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

**Width must stay consistent across the whole open stack.** The host width is the
*widest* level present (`effectiveSize = stack.some(e => e.size === 'wide') ? 'wide'
: 'normal'`), NOT each level's own `size`. **Why:** per-level width made the panel
visibly shrink (wide profile → normal child) then jump back wide, which reads as a
jarring, unsteady stacked-drawer flow. Driving width off the stack-max means it
never shrinks when drilling in. Keep the outside-close guard keyed to the *actual*
top level's `size` though, so only genuine heavy editors block accidental close.
