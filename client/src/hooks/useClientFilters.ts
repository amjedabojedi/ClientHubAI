import { useQuery } from "@tanstack/react-query";

// Custom hook to fetch all client filter data in one batch call
export const useClientFilters = () => {
  return useQuery({
    queryKey: ["/api/client-filters/batch"],
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes since this data rarely changes
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const response = await fetch("/api/client-filters/batch");
      if (!response.ok) throw new Error('Failed to fetch client filters');
      return response.json();
    },
  });
};

// Helper hook to get specific system options from the batch data
export const useSystemOption = (categoryKey: string) => {
  const { data: batchData, ...rest } = useClientFilters();
  
  const systemOption = batchData?.systemOptions?.[categoryKey];
  
  return {
    data: systemOption ? {
      category: systemOption.category,
      options: systemOption.options
    } : { category: null, options: [] },
    ...rest
  };
};