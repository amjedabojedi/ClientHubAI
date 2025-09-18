import { useRecentItemsContext } from '@/contexts/RecentItemsContext';

// Re-export types from context for backward compatibility
export type { RecentClient, RecentSession, RecentTask } from '@/contexts/RecentItemsContext';

// Simple wrapper hook that uses the context
export function useRecentItems() {
  return useRecentItemsContext();
}