// Where a workspace tab goes (round 3 N2). Session, Compare, Race and Corner need a
// selected session; with none, the tab takes you to Sessions instead of being
// disabled, and no empty workspace is drawn. Pure: imports nothing.

export type TabName = 'session' | 'compare' | 'race' | 'corner' | 'tracks';

export type TabTarget =
  | {kind: 'sessions'}
  | {kind: 'tracks'}
  | {kind: 'session' | 'compare' | 'race' | 'corner'; sessionId: string};

export function tabTarget(tab: TabName, sessionId: string | null): TabTarget {
  if (tab === 'tracks') return {kind: 'tracks'};
  return sessionId ? {kind: tab, sessionId} : {kind: 'sessions'};
}
