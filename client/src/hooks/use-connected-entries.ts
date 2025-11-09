import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import type { LibraryEntry } from '@shared/schema';

export const useConnectedEntries = (selectedIds: number[]) => {
  return useQuery({
    queryKey: ['/api/library/entries/connected-bulk', selectedIds.sort().join(',')],
    queryFn: async () => {
      if (selectedIds.length === 0) return [];
      const response = await apiRequest('/api/library/entries/connected-bulk', 'POST', { 
        entryIds: selectedIds 
      });
      const results = (await response.json()) as LibraryEntry[][];
      
      // Flatten and deduplicate the array of arrays
      const allConnectedEntries = results.flat();
      const uniqueEntries = Array.from(
        new Map(allConnectedEntries.map(entry => [entry.id, entry])).values()
      );
      
      return uniqueEntries as LibraryEntry[];
    },
    enabled: selectedIds.length > 0,
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes
  });
};
