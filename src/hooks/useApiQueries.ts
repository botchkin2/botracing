import {apiClient} from '@src/utils/api';
import {useQuery} from '@tanstack/react-query';

// Query keys for consistent cache management
export const queryKeys = {
  tracks: ['tracks'] as const,
  laps: (params?: Record<string, any>) => {
    if (!params) {
      return ['laps'];
    }
    // Create a stable query key by sorting object keys and creating a string
    const sortedKeys = Object.keys(params).sort();
    const keyString = sortedKeys.map(key => `${key}:${params[key]}`).join('|');
    return ['laps', keyString];
  },
  telemetry: (lapId: string) => ['telemetry', lapId] as const,
};

// Tracks list (for track selector; required by laps API)
export const useTracks = (options?: {enabled?: boolean}) => {
  return useQuery({
    queryKey: queryKeys.tracks,
    queryFn: () => apiClient.getTracks(),
    staleTime: 60 * 60 * 1000, // 1 hour
    gcTime: 2 * 60 * 60 * 1000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    enabled: options?.enabled ?? true,
  });
};

// Lap data with filters - aggressive caching to prevent redundant requests
export const useLaps = (
  params?: {
    limit?: number;
    offset?: number;
    age?: number;
    drivers?: string;
    cars?: number[];
    tracks?: number[];
    sessionTypes?: number[];
    event?: string;
    unclean?: boolean;
    minLapTime?: number;
    maxLapTime?: number;
    group?: 'driver' | 'driver-car' | 'none';
  },
  options?: {enabled?: boolean},
) => {
  return useQuery({
    queryKey: queryKeys.laps(params),
    queryFn: () => apiClient.getLaps(params),
    staleTime: 15 * 60 * 1000, // 15 minutes - increased
    gcTime: 60 * 60 * 1000, // 1 hour - increased
    // Allow refetch on mount if no cached data, but prevent other refetches
    refetchOnMount: false, // Changed to false to prevent automatic refetches
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    enabled: options?.enabled ?? !!params, // Only run if explicitly enabled
  });
};

// Telemetry data - cache for 7 days (expensive to fetch, rarely changes)
export const useTelemetry = (lapId: string, options?: {enabled?: boolean}) => {
  return useQuery({
    queryKey: queryKeys.telemetry(lapId),
    queryFn: async () => {
      // Fetch CSV directly from the API endpoint
      const csvText = await apiClient.getCsv(`/laps/${lapId}/csv`);
      return csvText;
    },
    staleTime: 7 * 24 * 60 * 60 * 1000, // 7 days
    gcTime: 7 * 24 * 60 * 60 * 1000, // 7 days (keep in cache for 7 days)
    // Controlled enabling to prevent premature requests
    enabled: options?.enabled ?? !!lapId,
    refetchOnMount: true,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
};
