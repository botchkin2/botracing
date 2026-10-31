import {type ErrorBoundaryProps, router} from 'expo-router';

import {ThemeProvider} from '@/src/design';
import {ErrorScreen} from '@/src/ui';

const toSessions = () => router.replace('/');

/**
 * The root layout's boundary replaces the layout itself, theme provider
 * included, so it brings its own.
 */
export function RootErrorBoundary({error, retry}: ErrorBoundaryProps) {
  return (
    <ThemeProvider>
      <ErrorScreen
        error={error}
        where='app'
        onRetry={() => void retry()}
        onLeave={toSessions}
      />
    </ThemeProvider>
  );
}

/**
 * Exported by each session route (`export {SessionErrorBoundary as
 * ErrorBoundary}`): the root layout stays around it, so the sessions list and
 * the bottom bar still work.
 */
export function SessionErrorBoundary({error, retry}: ErrorBoundaryProps) {
  return (
    <ErrorScreen
      error={error}
      where='session'
      onRetry={() => void retry()}
      onLeave={toSessions}
    />
  );
}
