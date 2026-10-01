// Where a workspace tab goes (round 3 N2). Session, Compare, Race and Corner need a
// selected session; with none, the tab takes you to Sessions instead of being
// disabled, and no empty workspace is drawn. Plan, Tracks and Settings never
// need one. Pure: imports nothing.

export type TabName =
  | 'sessions'
  | 'session'
  | 'compare'
  | 'race'
  | 'corner'
  | 'plan'
  | 'settings'
  | 'tracks';

export type TabTarget =
  | {kind: 'sessions'}
  | {kind: 'tracks'}
  | {kind: 'plan'}
  | {kind: 'settings'}
  | {kind: 'session' | 'compare' | 'race' | 'corner'; sessionId: string};

export function tabTarget(tab: TabName, sessionId: string | null): TabTarget {
  if (tab === 'sessions') return {kind: 'sessions'};
  if (tab === 'tracks') return {kind: 'tracks'};
  if (tab === 'plan') return {kind: 'plan'};
  if (tab === 'settings') return {kind: 'settings'};
  return sessionId ? {kind: tab, sessionId} : {kind: 'sessions'};
}
