import { createContext, useContext, useState, useCallback, ReactNode } from "react";

export type DrawerSize = "normal" | "wide";

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
}

export interface OpenDrawerInput {
  type: string;
  title: string;
  subtitle?: string;
  size?: DrawerSize;
  props?: Record<string, any>;
}

interface RecordDrawerContextValue {
  stack: DrawerEntry[];
  openDrawer: (input: OpenDrawerInput) => void;
  closeTopDrawer: () => void;
  closeAllDrawers: () => void;
  /** Pop drawers until only the first `index + 1` remain (used by breadcrumbs). */
  closeToIndex: (index: number) => void;
  isOpen: boolean;
}

/** Maximum number of stacked drawers. The plan caps nesting at two levels. */
export const MAX_DRAWER_DEPTH = 2;

const RecordDrawerContext = createContext<RecordDrawerContextValue | undefined>(undefined);

let drawerIdCounter = 0;
function nextDrawerId(): string {
  drawerIdCounter += 1;
  return `drawer-${drawerIdCounter}`;
}

export function RecordDrawerProvider({ children }: { children: ReactNode }) {
  const [stack, setStack] = useState<DrawerEntry[]>([]);

  const openDrawer = useCallback((input: OpenDrawerInput) => {
    setStack((prev) => {
      const entry: DrawerEntry = {
        id: nextDrawerId(),
        type: input.type,
        title: input.title,
        subtitle: input.subtitle,
        size: input.size ?? "normal",
        props: input.props,
      };
      // Enforce the depth cap: if we are already at the maximum, replace the
      // top entry instead of growing the stack beyond the limit.
      if (prev.length >= MAX_DRAWER_DEPTH) {
        return [...prev.slice(0, MAX_DRAWER_DEPTH - 1), entry];
      }
      return [...prev, entry];
    });
  }, []);

  const closeTopDrawer = useCallback(() => {
    setStack((prev) => prev.slice(0, -1));
  }, []);

  const closeAllDrawers = useCallback(() => {
    setStack([]);
  }, []);

  const closeToIndex = useCallback((index: number) => {
    setStack((prev) => prev.slice(0, Math.max(0, index + 1)));
  }, []);

  return (
    <RecordDrawerContext.Provider
      value={{
        stack,
        openDrawer,
        closeTopDrawer,
        closeAllDrawers,
        closeToIndex,
        isOpen: stack.length > 0,
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
