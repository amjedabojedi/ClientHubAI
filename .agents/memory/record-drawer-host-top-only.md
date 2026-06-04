---
name: Record drawer host renders only stack top
description: Why nesting a stateful page as a drawer level remounts it, and the tradeoffs chosen for client-detail-as-drawer.
---

# Record drawer host renders only the top of the stack

`RecordDrawerHost` renders only `stack[stack.length - 1]` inside a single Radix Sheet. Lower stack levels are NOT in the React tree while a higher level is open.

**Consequence:** If you put a stateful page (e.g. the client-detail page) into the stack as a level-1 drawer, it UNMOUNTS when a child record opens at level 2 and REMOUNTS when that child closes. Scroll position, in-progress inline edits, and open sub-panels are lost on remount; react-query keeps fetched data warm so there is no spinner for cached queries.

**Mitigations chosen (lowest-risk path):**
- Persist the active tab per client in sessionStorage (`smarthub.clientDetail.tab.<id>`) so the most visible bit of context survives the remount.
- A fully faithful fix is to render the whole stack and keep lower levels mounted (e.g. `visibility:hidden` keep-alive layers — preserves scroll and removes hidden controls from tab order). This was deliberately NOT done because it changes the shared host for all drawers and **drawer stacking is not interactively testable here** (static screenshots + login wall).

**Navigation + history:** Drawer open/close uses empty-url `pushState`/`history.back` so the path never changes. `resetDrawers()` clears drawer state WITHOUT touching history; the host calls it whenever the wouter pathname changes (genuine navigation, e.g. sidebar click while a drawer is open) so a drawer never hangs over a different page. The orphaned synthetic entries it leaves share the original path, so the first Back press still lands correctly and the popstate handler's `depthRef<=0` branch prevents loops. Removing those past entries cleanly is not possible via the DOM without re-navigating.

**Why:** the user is strongly risk-averse and wanted minimal, reviewable changes; both residual symptoms are benign (no data loss, correct first-Back, no crash).
**How to apply:** before making any drawer body a long-lived stateful surface, decide whether remount-on-nesting is acceptable; if not, upgrade the host to render the full stack first.
