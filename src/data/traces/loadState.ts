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
  | {kind: 'failed'; failed: number}
  /** The session has no corner slices: it was uploaded before analysis
   *  version 13 and needs a resync. Retrying cannot help. */
  | {kind: 'needsResync'};

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

/**
 * The load state of a corner's slice file. `hasFile`: the session doc lists
 * this corner's file; `sessionKnown`: the session doc has loaded, so a missing
 * file is a fact and not just a doc still on its way.
 */
export function sliceLoad(input: {
  lapCount: number;
  sessionKnown: boolean;
  hasFile: boolean;
  status: TraceQueryStatus;
}): TraceLoad {
  const {lapCount, sessionKnown, hasFile, status} = input;
  if (lapCount === 0) return {kind: 'idle'};
  if (sessionKnown && !hasFile) return {kind: 'needsResync'};
  if (status === 'error') return {kind: 'failed', failed: lapCount};
  return status === 'success' ? {kind: 'ready'} : {kind: 'loading'};
}
