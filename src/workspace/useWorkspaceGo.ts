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
 * One `go` for the desktop bar and the phone bars, so switching keeps the lap
 * selection and lands on the same places.
 */
export function useWorkspaceGo(
  sessionId: string | null,
  tab: SessionTab | null,
  planCombo?: string,
) {
  const router = useRouter();
  // Only the lap selection travels between tabs; corner and cursor belong
  // to the workspace that set them.
  const {laps, hl, c, n} = useGlobalSearchParams<{
    laps?: string;
    hl?: string;
    c?: string;
    n?: string;
  }>();
  const map = useSessionMap(sessionId ?? '');
  // Corner tab: the open corner, else the open section's first corner, else C1.
  const cornerN =
    tab === 'corner' && n
      ? Number(n)
      : (map.data && c
          ? firstCornerOf(trackCorners(map.data), Number(c))
          : null) ?? 1;
  const {laps: lapIds, hl: hlId} = parseSelection({laps, hl});
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
