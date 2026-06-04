import { useEffect, useRef } from "react";
import { ChevronRight } from "lucide-react";
import { useLocation } from "wouter";
import { Sheet, SheetContent, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { useRecordDrawer, INLINE_DRAWER_TYPE, type DrawerEntry } from "@/contexts/RecordDrawerContext";
import { recordDrawerRegistry } from "./record-drawer-registry";

const sizeClass: Record<string, string> = {
  normal: "w-full sm:max-w-xl",
  wide: "w-full sm:max-w-5xl",
};

/**
 * Renders the stacked record drawers. Mounts once near the app root.
 * The top of the stack is shown in a right-side sheet; pressing Escape,
 * clicking the overlay, or the close button pops one level so the drawer
 * beneath is revealed (the page underneath always stays mounted).
 */
export function RecordDrawerHost() {
  const { stack, closeTopDrawer, closeToIndex, resetDrawers } = useRecordDrawer();
  const [location] = useLocation();

  // Clear any open drawers when a genuine navigation occurs. Our own drawer
  // history operations never change the path, so this only fires on real route
  // changes (e.g. an in-drawer "go to Tasks/Billing" link), preventing a drawer
  // from hanging over a different page.
  const prevLocationRef = useRef(location);
  useEffect(() => {
    if (prevLocationRef.current !== location) {
      prevLocationRef.current = location;
      resetDrawers();
    }
  }, [location, resetDrawers]);

  // The drawer system is staff-only. The client/patient portal must never be
  // affected, so the host never renders on portal routes.
  if (location.startsWith("/portal")) {
    return null;
  }

  const top = stack[stack.length - 1];
  const open = stack.length > 0;

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) closeTopDrawer();
      }}
    >
      {top && (
        <SheetContent
          side="right"
          className={cn(sizeClass[top.size ?? "normal"], "p-0 flex flex-col gap-0 h-full")}
          data-testid="record-drawer"
          onPointerDownOutside={(e) => {
            // Wide drawers host heavy editors (reports/assessments) where an
            // accidental click outside could discard unsaved edits. Require an
            // explicit close (X / Back) for those. Normal drawers close freely.
            if ((top.size ?? "normal") === "wide") e.preventDefault();
          }}
        >
          {/* Header + breadcrumb */}
          <div className="border-b px-6 py-4 pr-12">
            {stack.length > 1 && (
              <nav
                className="mb-2 flex flex-wrap items-center gap-1 text-xs text-muted-foreground"
                aria-label="Breadcrumb"
              >
                {stack.map((entry, index) => {
                  const isLast = index === stack.length - 1;
                  return (
                    <span key={entry.id} className="flex items-center gap-1">
                      {index > 0 && <ChevronRight className="h-3 w-3" />}
                      {isLast ? (
                        <span className="font-medium text-foreground">{entry.title}</span>
                      ) : (
                        <button
                          type="button"
                          className="hover:text-foreground hover:underline"
                          onClick={() => closeToIndex(index)}
                          data-testid={`breadcrumb-drawer-${index}`}
                        >
                          {entry.title}
                        </button>
                      )}
                    </span>
                  );
                })}
              </nav>
            )}
            <SheetTitle className="text-lg" data-testid="record-drawer-title">{top.title}</SheetTitle>
            {top.subtitle ? (
              <SheetDescription>{top.subtitle}</SheetDescription>
            ) : (
              <SheetDescription className="sr-only">{top.title} details</SheetDescription>
            )}
          </div>

          {/* Body. Every open level stays mounted so a lower level that
              supplies an upper level's inline body (via a portal into the host
              outlet) keeps rendering. Only the top level is visible; the levels
              beneath it are kept mounted but hidden, instead of being unmounted
              (which would tear down the page that owns the upper level's body). */}
          <div className="flex-1 overflow-y-auto px-6 py-4">
            {stack.map((entry, index) => {
              const isTop = index === stack.length - 1;
              return (
                <div key={entry.id} className={isTop ? undefined : "hidden"}>
                  <DrawerBody entry={entry} isTop={isTop} />
                </div>
              );
            })}
          </div>
        </SheetContent>
      )}
    </Sheet>
  );
}

function DrawerBody({ entry, isTop }: { entry: DrawerEntry; isTop: boolean }) {
  const { registerOutletEl } = useRecordDrawer();

  // Inline drawers have no registered component. The host renders an empty
  // outlet element and the page that opened the drawer portals its body into
  // it (keeping the body coupled to the page's local state/mutations). Only the
  // top inline level publishes the outlet: the owning page always portals into
  // the topmost drawer, and a lower (hidden) level must never clobber the
  // outlet ref. The ref callback publishes the element when mounted and clears
  // it on unmount (when this drawer stops being the top of the stack).
  if (entry.type === INLINE_DRAWER_TYPE) {
    // Only the top inline level has a visible body: the owning page portals into
    // the top outlet (it gates on the top inline key, which only matches the
    // topmost drawer). A lower inline level renders nothing and never publishes
    // the outlet, so it can't clobber the live outlet ref.
    if (!isTop) return null;
    return <div ref={registerOutletEl} data-testid="record-drawer-inline-outlet" />;
  }

  const Component = recordDrawerRegistry[entry.type];
  if (!Component) {
    return <p className="text-sm text-muted-foreground">Unable to display this item.</p>;
  }
  return <Component {...(entry.props ?? {})} entry={entry} />;
}
