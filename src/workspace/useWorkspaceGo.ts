import {useGlobalSearchParams, useRouter} from 'expo-router';

import {firstCornerOf, trackCorners, useSessionMap} from '@/src/data/sessions';
import {type SessionTab} from '@/src/nav/activeTab';
import {
  compareHref,
  cornerHref,
  parseSelection,
  planHref,
  raceHref,
  sessionHref,
  sessionsHref,
  settingsHref,
  tracksHref,
} from '@/src/nav/routes';
import {type TabName, tabTarget} from '@/src/nav/tabTarget';

/**
 * The corner the Corner tab opens, read from the URL: the open corner, else
 * the open section's first corner, else T1. `used` is false in the last case.
 */
export function useCornerTarget(
  sessionId: string | null,
  tab: SessionTab | null,
): {n: number; used: boolean} {
  const {c, n} = useGlobalSearchParams<{c?: string; n?: string}>();
  const map = useSessionMap(sessionId ?? '');
  if (tab === 'corner' && n) return {n: Number(n), used: true};
  const fromSection =
    map.data && c ? firstCornerOf(trackCorners(map.data), Number(c)) : null;
  return {n: fromSection ?? 1, used: fromSection != null};
}

/** Everything `go` needs, already resolved by the caller. */
export type WorkspaceTarget = {
  sessionId: string | null;
  /** The lap selection to carry between tabs. */
  selection: {laps?: string; hl?: string};
  /** The corner the Corner tab opens. */
  cornerN: number;
  /** The Plan link's combo, when one is named. */
  planCombo?: string;
};

/**
 * The target read straight from the URL: the phone has no bar state to keep,
 * so what is open is what the route says.
 */
export function useUrlTarget(
  sessionId: string | null,
  tab: SessionTab | null,
): Omit<WorkspaceTarget, 'planCombo'> {
  const {laps, hl} = useGlobalSearchParams<{laps?: string; hl?: string}>();
  return {
    sessionId,
    selection: {laps, hl},
    cornerN: useCornerTarget(sessionId, tab).n,
  };
}

/**
 * One `go` for the desktop bar and the phone bars, so switching keeps the lap
 * selection and lands on the same places. It only navigates; the caller
 * resolves what to carry.
 */
export function useWorkspaceGo({
  sessionId,
  selection,
  cornerN,
  planCombo,
}: WorkspaceTarget) {
  const router = useRouter();
  const {laps: lapIds, hl: hlId} = parseSelection(selection);
  const sel = {laps: lapIds, hl: hlId};
  return (name: TabName) => {
    const target = tabTarget(name, sessionId);
    switch (target.kind) {
      case 'sessions':
        return router.navigate(sessionsHref());
      case 'tracks':
        return router.navigate(tracksHref());
      case 'plan':
        return router.navigate(planHref(planCombo));
      case 'settings':
        return router.navigate(settingsHref());
      case 'session':
        return router.navigate(sessionHref(target.sessionId, sel));
      case 'compare':
        return router.navigate(compareHref(target.sessionId, sel));
      case 'race':
        return router.navigate(raceHref(target.sessionId, sel));
      case 'corner':
        return router.navigate(cornerHref(target.sessionId, cornerN, sel));
    }
  };
}
