export type TraceQueryStatus = 'pending' | 'success' | 'error';

/**
 * What a screen shows for the traces of the laps it asked for (round 3 R4c):
 * skeletons until the first trace lands, the charts with a banner while some
 * failed, one banner when none loaded.
 */
export type TraceLoad =
  | {kind: 'idle'}
  | {kind: 'loading'}
  | {kind: 'ready'}
  | {kind: 'partial'; failed: number}
  | {kind: 'failed'; failed: number};

export function traceLoad(statuses: TraceQueryStatus[]): TraceLoad {
  if (statuses.length === 0) return {kind: 'idle'};
  const failed = statuses.filter(s => s === 'error').length;
  const loaded = statuses.filter(s => s === 'success').length;
  if (loaded === statuses.length) return {kind: 'ready'};
  // A failure only shows once nothing is still loading; until then the laps
  // that did arrive draw and the rest are still on their way.
  if (statuses.includes('pending'))
    return loaded > 0 ? {kind: 'ready'} : {kind: 'loading'};
  return loaded > 0 ? {kind: 'partial', failed} : {kind: 'failed', failed};
}
