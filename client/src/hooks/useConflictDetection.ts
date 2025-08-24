import { useQuery } from '@tanstack/react-query';

interface ConflictCheckParams {
  therapistId: number;
  sessionDate: string; // ISO string
  duration?: number;
  excludeSessionId?: number;
  roomId?: number;
}

interface ConflictResult {
  hasConflict: boolean;
  therapistConflicts: Array<{
    id: number;
    clientName: string;
    sessionDate: string;
    sessionType: string;
    type: 'therapist';
  }>;
  roomConflicts: Array<{
    id: number;
    clientName: string;
    sessionDate: string;
    sessionType: string;
    therapistName: string;
    type: 'room';
  }>;
  suggestedTimes: string[];
}

export function useConflictDetection(params: ConflictCheckParams | null) {
  return useQuery<ConflictResult>({
    queryKey: ['/api/sessions/conflicts/check', params],
    queryFn: async () => {
      if (!params) throw new Error('No parameters provided');
      
      const searchParams = new URLSearchParams();
      searchParams.append('therapistId', params.therapistId.toString());
      searchParams.append('sessionDate', params.sessionDate);
      searchParams.append('duration', (params.duration || 60).toString());
      
      if (params.excludeSessionId) {
        searchParams.append('excludeSessionId', params.excludeSessionId.toString());
      }
      
      if (params.roomId) {
        searchParams.append('roomId', params.roomId.toString());
      }
      
      const response = await fetch(`/api/sessions/conflicts/check?${searchParams.toString()}`);
      if (!response.ok) {
        throw new Error('Failed to check for conflicts');
      }
      
      return response.json();
    },
    enabled: !!params && !!params.therapistId && !!params.sessionDate,
    staleTime: 30000, // Cache for 30 seconds
  });
}

export function useRealTimeConflictCheck(
  therapistId: number | undefined,
  sessionDate: string | undefined,
  sessionTime: string | undefined,
  excludeSessionId?: number,
  roomId?: number
) {
  const sessionDateTime = sessionDate && sessionTime 
    ? new Date(`${sessionDate}T${sessionTime}`).toISOString()
    : undefined;

  return useConflictDetection(
    therapistId && sessionDateTime 
      ? { 
          therapistId, 
          sessionDate: sessionDateTime, 
          excludeSessionId,
          roomId
        }
      : null
  );
}