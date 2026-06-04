import { createContext, useContext, useState, useCallback, useEffect, useRef, ReactNode } from "react";

export type DrawerSize = "normal" | "wide";

/**
 * Sentinel `type` for drawers whose body is rendered inline by the page that
 * opened them (via a portal into the host outlet) rather than by a registered
 * component. Used for the lighter staff child-record dialogs that stay coupled
 * to the client page's local state/mutations.
 */
export const INLINE_DRAWER_TYPE = "__inline__";

export interface DrawerEntry {
  /** Unique instance id for this open drawer. */
  id: string;
  /** Registry key that maps to the component rendered inside the drawer. */
  type: string;
  /** Title shown in the drawer header and breadcrumb. */
  title: string;
  /** Optional secondary line under the title. */
  subtitle?: string;
  /** Visual width of the drawer. Defaults to "normal". */
  size?: DrawerSize;
  /** Arbitrary props forwarded to the registered drawer component. */
  props?: Record<string, any>;
  /**
   * For inline drawers (type === INLINE_DRAWER_TYPE): identifies which inline
   * body the opening page should portal into the host outlet.
   */
  inlineKey?: string;
}

export interface OpenDrawerInput {
  type: string;
  title: string;
  subtitle?: string;
  size?: DrawerSize;
  props?: Record<string, any>;
  inlineKey?: string;
}

interface RecordDrawerContextValue {
  stack: DrawerEntry[];
  openDrawer: (input: OpenDrawerInput) => void;
  /** Swap the contents of the top drawer without changing the stack depth. */
  replaceTopDrawer: (input: OpenDrawerInput) => void;
  closeTopDrawer: () => void;
  closeAllDrawers: () => void;
  /** Pop drawers until only the first `index + 1` remain (used by breadcrumbs). */
  closeToIndex: (index: number) => void;
  /** Drop all drawers immediately WITHOUT touching history (used on real navigation). */
  resetDrawers: () => void;
  isOpen: boolean;
  /**
   * DOM node inside the host's body where the page should portal the inline
   * drawer body. Non-null only while an inline drawer is the top of the stack.
   */
  outletEl: HTMLElement | null;
  /** Ref callback the host uses to publish/clear the inline outlet element. */
  registerOutletEl: (el: HTMLElement | null) => void;
}

/** Maximum number of stacked drawers. The plan caps nesting at two levels. */
export const MAX_DRAWER_DEPTH = 2;

const RecordDrawerContext = createContext<RecordDrawerContextValue | undefined>(undefined);

let drawerIdCounter = 0;
function nextDrawerId(): string {
  drawerIdCounter += 1;
  return `drawer-${drawerIdCounter}`;
}

function buildEntry(input: OpenDrawerInput): DrawerEntry {
  return {
    id: nextDrawerId(),
    type: input.type,
    title: input.title,
    subtitle: input.subtitle,
    size: input.size ?? "normal",
    props: input.props,
    inlineKey: input.inlineKey,
  };
}

export function RecordDrawerProvider({ children }: { children: ReactNode }) {
  const [stack, setStack] = useState<DrawerEntry[]>([]);
  const [outletEl, setOutletEl] = useState<HTMLElement | null>(null);
  const registerOutletEl = useCallback((el: HTMLElement | null) => setOutletEl(el), []);

  // --- Browser history / Back-button integration ---------------------------
  // Each time a drawer LEVEL opens we push one history entry with the SAME URL
  // (empty url arg), so the route never changes and the page underneath stays
  // mounted. The browser Back button then fires `popstate`, which we use to
  // close the top drawer instead of leaving the client page.
  //
  // `depthRef` is the source of truth for the number of open levels (== number
  // of history entries we pushed == stack length). `intendedDepthRef` is the
  // depth we want to settle at. Every close (X / Escape / breadcrumb / page
  // "Back" / browser Back) ultimately removes levels via a SINGLE
  // `history.back()` step at a time — never `history.go(-n)` — so the number of
  // popstate events is always exactly one per step, regardless of browser. A
  // programmatic multi-level close chains additional `history.back()` calls
  // from the popstate handler until `depthRef` reaches `intendedDepthRef`.
  const depthRef = useRef(0);
  const intendedDepthRef = useRef(0);

  useEffect(() => {
    // If we reloaded while sitting on a synthetic drawer history entry, strip
    // the marker from the current entry so it is never misread as an open
    // drawer. (Drawer state itself does not survive a reload; the standalone
    // routes are the refresh-safe / shareable entry points.)
    if (typeof window !== "undefined" && window.history.state && (window.history.state as any).recordDrawer) {
      window.history.replaceState(null, "");
    }

    const onPopState = () => {
      if (depthRef.current <= 0) {
        // No drawer is open: this is normal app navigation. Keep refs at rest
        // and let the navigation proceed untouched.
        depthRef.current = 0;
        intendedDepthRef.current = 0;
        return;
      }
      // One history step back == close one drawer level.
      depthRef.current -= 1;
      setStack((prev) => (prev.length > 0 ? prev.slice(0, -1) : prev));
      if (depthRef.current > intendedDepthRef.current) {
        // A programmatic multi-level close is still in progress: take the next
        // step. Each back() yields exactly one more popstate.
        window.history.back();
      } else {
        // Settled (also covers a genuine single Back press): align intent.
        intendedDepthRef.current = depthRef.current;
      }
    };

    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const openDrawer = useCallback((input: OpenDrawerInput) => {
    const entry = buildEntry(input);
    if (depthRef.current >= MAX_DRAWER_DEPTH) {
      // At the cap: replace the top entry in place; depth and history unchanged.
      setStack((prev) => [...prev.slice(0, MAX_DRAWER_DEPTH - 1), entry]);
      return;
    }
    depthRef.current += 1;
    intendedDepthRef.current = depthRef.current;
    // Empty URL keeps the current route; we only want a history entry to
    // intercept the Back button, not a navigation.
    window.history.pushState({ recordDrawer: depthRef.current }, "");
    setStack((prev) => [...prev, entry]);
  }, []);

  const replaceTopDrawer = useCallback((input: OpenDrawerInput) => {
    // Invariant: never create depth without a matching history entry. If no
    // drawer is open, do nothing (callers should use openDrawer instead).
    if (depthRef.current <= 0) return;
    const entry = buildEntry(input);
    setStack((prev) => (prev.length === 0 ? prev : [...prev.slice(0, -1), entry]));
  }, []);

  const closeTopDrawer = useCallback(() => {
    if (depthRef.current <= 0) return;
    intendedDepthRef.current = depthRef.current - 1;
    window.history.back();
  }, []);

  const closeAllDrawers = useCallback(() => {
    if (depthRef.current <= 0) return;
    intendedDepthRef.current = 0;
    window.history.back();
  }, []);

  const closeToIndex = useCallback((index: number) => {
    const target = Math.max(0, index + 1);
    if (target >= depthRef.current) return;
    intendedDepthRef.current = target;
    window.history.back();
  }, []);

  const resetDrawers = useCallback(() => {
    // Drop all drawers without touching history. Used when a genuine route
    // change navigates away from the page the drawers belonged to, so they do
    // not hang over a different page. The synthetic history entries are left
    // behind harmlessly (their path is unchanged) and the popstate handler
    // treats depth 0 as normal navigation.
    if (depthRef.current === 0) return;
    depthRef.current = 0;
    intendedDepthRef.current = 0;
    setStack([]);
  }, []);

  return (
    <RecordDrawerContext.Provider
      value={{
        stack,
        openDrawer,
        replaceTopDrawer,
        closeTopDrawer,
        closeAllDrawers,
        closeToIndex,
        resetDrawers,
        isOpen: stack.length > 0,
        outletEl,
        registerOutletEl,
      }}
    >
      {children}
    </RecordDrawerContext.Provider>
  );
}

export function useRecordDrawer(): RecordDrawerContextValue {
  const context = useContext(RecordDrawerContext);
  if (context === undefined) {
    throw new Error("useRecordDrawer must be used within a RecordDrawerProvider");
  }
  return context;
}
