import {useQueryClient} from '@tanstack/react-query';
import {queryKeys} from './useApiQueries';
import {apiClient} from '@src/utils/api';
import AsyncStorage from '@react-native-async-storage/async-storage';

export const useCacheManagement = () => {
  const queryClient = useQueryClient();

  return {
    // Refresh all lap data
    refreshLaps: () => queryClient.invalidateQueries({queryKey: ['laps']}),

    // Refresh specific lap query
    refreshLapsWithFilters: (params?: Record<string, any>) =>
      queryClient.invalidateQueries({queryKey: queryKeys.laps(params)}),

    // Clear all cache
    clearAllCache: () => queryClient.clear(),

    // Update cached data optimistically
    updateCachedLaps: (updater: (oldData: any) => any) =>
      queryClient.setQueryData(queryKeys.laps(), updater),

    // CSV cache management
    clearCsvCache: () => apiClient.clearCsvCache(),

    getCsvCacheStats: () => apiClient.getCacheStats(),

    // Invalidate telemetry cache (both React Query and file cache)
    invalidateTelemetryCache: (lapId?: string) => {
      if (lapId) {
        // Invalidate specific lap telemetry
        queryClient.invalidateQueries({queryKey: queryKeys.telemetry(lapId)});
      } else {
        // Invalidate all telemetry data
        queryClient.invalidateQueries({queryKey: ['telemetry']});
      }
    },

    // Clear AsyncStorage (useful for debugging)
    clearAsyncStorage: async () => {
      try {
        await AsyncStorage.clear();
        console.log('AsyncStorage cleared');
      } catch (error) {
        console.error('Error clearing AsyncStorage:', error);
      }
    },

    // Force refresh specific lap telemetry (bypassing cache)
    forceRefreshTelemetry: (lapId: string) => {
      // Remove from React Query cache
      queryClient.removeQueries({queryKey: queryKeys.telemetry(lapId)});
      // This will cause next request to fetch from API and recache
    },

    // Get combined cache statistics
    getCombinedCacheStats: async () => {
      const csvStats = await apiClient.getCacheStats();
      const reactQueryStats = queryClient.getQueryCache().getAll();

      return {
        csvCache: csvStats,
        reactQueryCache: {
          queries: reactQueryStats.length,
          // Estimate React Query cache size (rough approximation)
          estimatedSize: reactQueryStats.reduce((size, query) => {
            return size + JSON.stringify(query.state.data || {}).length;
          }, 0),
        },
      };
    },
  };
};
