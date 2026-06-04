---
name: Record drawer host renders the full stack
description: How RecordDrawerHost keeps lower drawer levels mounted so nested drawer bodies aren't lost, and why.
---

# Record drawer host renders the full stack (lower levels hidden)

`RecordDrawerHost` maps over EVERY stack entry and renders each entry's DrawerBody, keyed by `entry.id`. The top entry is visible; lower levels are rendered with `className="hidden"` (display:none). Keying by id means levels are NOT remounted as the stack pushes/pops.

**Why this matters (the bug it fixes):** Pages like client-detail render their child drawer bodies by `createPortal`-ing into the host's inline outlet. If the host renders ONLY the top entry, opening a child drawer over a stateful parent UNMOUNTS that parent — which destroys the portal source — so the nested drawer renders EMPTY. Rendering the full stack keeps the parent (and its portal source) alive, so nested inline bodies render.

**Outlet ref rule:** `DrawerBody` only renders/publishes the inline outlet (`ref={registerOutletEl}`) when `isTop`. Non-top inline entries return `null`. This prevents a hidden lower level from clobbering `outletEl`. Holds with `MAX_DRAWER_DEPTH=2` and at-cap `openDrawer` REPLACING the top rather than stacking.

**Accessibility/overlay:** still a single Radix `SheetContent` + single overlay; hidden lower levels are `display:none` so they're out of tab order and the a11y tree (no multi-dialog focus-trap conflict).

**Navigation + history:** Drawer open/close uses empty-url `pushState`/`history.back` so the path never changes. `resetDrawers()` clears drawer state WITHOUT touching history; the host calls it whenever the wouter pathname changes (genuine navigation) so a drawer never hangs over a different page. Orphaned synthetic entries share the original path, so the first Back press still lands correctly and the popstate handler's `depthRef<=0` branch prevents loops.

**How to apply:** any drawer body that owns state or portals content can now be safely nested; it will not remount when a child opens. If you ever revert to top-only rendering, the empty-nested-drawer bug returns.
