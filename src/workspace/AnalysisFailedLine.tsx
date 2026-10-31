import {useQueryClient} from '@tanstack/react-query';
import {useGlobalSearchParams} from 'expo-router';
import {useSyncExternalStore} from 'react';

import {analysisFailed, analyzeDeps, retryAnalysis} from '@/src/data/sessions';
import {StatusBanner} from '@/src/ui';

/**
 * The open session's analysis ended without an answer (analysisOnOpen.ts): its
 * stored numbers are on screen and this says so, with Retry. Neutral dot, no
 * advice (round 3 R4c, thread 47).
 */
export function AnalysisFailedLine() {
  const {id} = useGlobalSearchParams<{id?: string}>();
  const client = useQueryClient();
  const failed = useSyncExternalStore(
    analysisFailed.subscribe,
    () => (id ? analysisFailed.has(id) : false),
    () => false,
  );
  if (!id || !failed) return null;
  return (
    <StatusBanner
      dot='idle'
      text='Re-analysis failed'
      actionLabel='Retry'
      onAction={() => void retryAnalysis(id, analyzeDeps(client))}
    />
  );
}
