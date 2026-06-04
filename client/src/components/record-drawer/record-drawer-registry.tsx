import type { ComponentType } from "react";
import { SessionDetailDrawer } from "./session-detail-drawer";

// Drawer body components receive the entry's `props` spread in, plus `entry`.
// Each component declares its own concrete prop shape, so the registry uses a
// permissive component type.
export type DrawerComponent = ComponentType<any>;

/**
 * Maps a drawer `type` to the component rendered inside the drawer body.
 * Add new record types here as they are migrated onto the drawer system.
 */
export const recordDrawerRegistry: Record<string, DrawerComponent> = {
  session: SessionDetailDrawer,
};
