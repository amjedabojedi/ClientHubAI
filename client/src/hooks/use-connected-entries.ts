import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import type { LibraryEntry } from '@shared/schema';

export const useConnectedEntries = (selectedIds: number[]) => {
  return useQuery({
    queryKey: ['/api/library/entries/connected-bulk', selectedIds.sort().join(',')],
    queryFn: async () => {
      if (selectedIds.length === 0) return [];
      const connectionsMap = await apiRequest('/api/library/entries/connected-bulk', 'POST', { 
        entryIds: selectedIds 
      }) as Record<number, LibraryEntry[]>;
      
      // Flatten all connection arrays from the map
      const allConnectedEntries = Object.values(connectionsMap).flat();
      
      // Deduplicate by entry ID
      const uniqueEntries = Array.from(
        new Map(allConnectedEntries.map(entry => [entry.id, entry])).values()
      );
      
      return uniqueEntries as LibraryEntry[];
    },
    enabled: selectedIds.length > 0,
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes
  });
};
