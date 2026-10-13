import {focusManager, QueryClient} from '@tanstack/react-query';
import {AppState, Platform} from 'react-native';

// The web build renders every route once in Node. A cache timer there keeps
// Node alive and the export never exits, so no cache timers on the server.
export const onServer = typeof window === 'undefined';
export const cacheTime = (ms: number) => (onServer ? Infinity : ms);

// The browser reports focus itself (visibilitychange); the phone's app coming to
// the foreground is AppState, which React Query does not read by itself.
if (Platform.OS !== 'web')
  focusManager.setEventListener(handleFocus => {
    const sub = AppState.addEventListener('change', state =>
      handleFocus(state === 'active'),
    );
    return () => sub.remove();
  });

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 10 * 60 * 1000, // 10 minutes default - increased
      gcTime: cacheTime(30 * 60 * 1000), // 30 minutes garbage collection - increased
      retry: (failureCount, error: any) => {
        // Don't retry on 4xx errors
        if (error?.code?.startsWith('4')) {
          return false;
        }
        return failureCount < 3;
      },
      retryDelay: attemptIndex => Math.min(1000 * 2 ** attemptIndex, 30000),
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      // Disable background refetching to prevent duplicate requests
      refetchOnMount: false,
      refetchInterval: false,
      refetchIntervalInBackground: false,
    },
  },
});
