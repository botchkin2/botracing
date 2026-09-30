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
 * The corner the Corner tab opens: the open corner, else the open section's
 * first corner, else T1. `used` is false in the last case, so the desktop tab
 * can read plain "Corner" until a corner has been used.
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

/**
 * One `go` for the desktop bar and the phone bars, so switching keeps the lap
 * selection and lands on the same places.
 */
export function useWorkspaceGo(
  sessionId: string | null,
  tab: SessionTab | null,
  opts: {
    planCombo?: string;
    /** The corner the Corner tab opens, when the caller remembers one. */
    cornerN?: number;
    /** The lap selection to carry, when the URL no longer holds it. */
    selection?: {laps?: string; hl?: string};
  } = {},
) {
  const router = useRouter();
  // Only the lap selection travels between tabs; corner and cursor belong
  // to the workspace that set them.
  const params = useGlobalSearchParams<{laps?: string; hl?: string}>();
  const urlCorner = useCornerTarget(sessionId, tab).n;
  const cornerN = opts.cornerN ?? urlCorner;
  const {laps: lapIds, hl: hlId} = parseSelection(opts.selection ?? params);
  const sel = {laps: lapIds, hl: hlId};
  return (name: TabName) => {
    const target = tabTarget(name, sessionId);
    switch (target.kind) {
      case 'sessions':
        return router.navigate(sessionsHref());
      case 'tracks':
        return router.navigate(tracksHref());
      case 'plan':
        return router.navigate(planHref(opts.planCombo));
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
