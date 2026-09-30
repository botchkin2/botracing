import {useGlobalSearchParams, usePathname, useRouter} from 'expo-router';
import {useState} from 'react';

import {
  trackCorners,
  useSession,
  useSessionLaps,
  useSessionMap,
} from '@/src/data/sessions';
import {
  carLabel,
  formatDayMonth,
  lapStroke,
  shortTrackName,
  turnNumber,
  useLayout,
  useTheme,
} from '@/src/design';
import {parseSelection, sessionsHref} from '@/src/nav/routes';
import {sessionTabOf, type SessionTab} from '@/src/nav/activeTab';
import {AppChrome, type ChromeSession, type ChromeTab} from '@/src/ui';

import {usePlanCombo} from './usePlanCombo';
import {useCornerTarget, useWorkspaceGo} from './useWorkspaceGo';

/**
 * The desktop bar (≥900), fed from the URL: the open session and its lap
 * selection become the box, so switching tabs keeps context.
 */
export function DesktopChrome() {
  const pathname = usePathname();
  const router = useRouter();
  const {id, laps, hl} = useGlobalSearchParams<{
    id?: string;
    laps?: string;
    hl?: string;
  }>();
  const {scheme} = useTheme();
  const {isWide} = useLayout();
  const tab = sessionTabOf(pathname);
  const openId = tab ? id ?? null : null;
  // Plan and Settings keep the session box so one click goes back; any other
  // page forgets the session.
  const [kept, setKept] = useState<string | null>(null);
  const keeps = pathname === '/plan' || pathname === '/settings';
  const sessionId = openId ?? (keeps ? kept : null);
  // Derived from the route while rendering, not in an effect: no extra paint.
  if (sessionId !== kept) setKept(sessionId);
  const plan = usePlanCombo(
    sessionId,
    pathname.startsWith('/track/') ? id ?? null : null,
    true,
  );
  const go = useWorkspaceGo(sessionId, tab, plan.key);
  const {data: session} = useSession(sessionId ?? '', sessionId != null);
  const lapData = useSessionLaps(sessionId ?? '');
  const map = useSessionMap(sessionId ?? '');
  const corner = useCornerTarget(sessionId, tab);

  let box: ChromeSession<SessionTab> | null = null;
  if (sessionId && session) {
    const car = carLabel(session.car);
    const {laps: lapIds} = parseSelection({laps, hl});
    const lapRows = lapIds.flatMap((lapId, i) => {
      const lap = lapData.data?.find(l => l.id === lapId);
      return lap
        ? [
            {
              label: `L${lap.lapIndex}`,
              color: lapStroke(scheme, i, lapIds.length, false).color,
            },
          ]
        : [];
    });
    const cornerLabel = corner.used
      ? `Corner T${turnNumber(
          corner.n,
          map.data
            ? trackCorners(map.data).find(c => c.n === corner.n)?.official
            : undefined,
        )}`
      : 'Corner';
    const tabs: ChromeTab<SessionTab>[] = [
      {key: 'session', label: 'Laps'},
      {key: 'compare', label: 'Compare'},
      {key: 'corner', label: cornerLabel},
    ];
    // Practice and qualifying have no Race tab: removed, not greyed.
    if (session.sessionType === 'R') tabs.push({key: 'race', label: 'Race'});
    box = {
      badge: session.sessionType,
      track: shortTrackName(session.track),
      detail: [car.model, car.entry, formatDayMonth(session.startedAt)]
        .filter(Boolean)
        .join(' · '),
      tabs,
      activeTab: tab,
      onTab: key => go(key),
      laps: lapRows,
      onClose: () => {
        setKept(null);
        router.navigate(sessionsHref());
      },
    };
  }
  return (
    <AppChrome
      session={box}
      compact={!isWide}
      onHome={() => go('sessions')}
      onSessions={() => go('sessions')}
      planPair={plan.pair}
      planActive={pathname === '/plan'}
      onPlan={() => go('plan')}
      settingsActive={pathname === '/settings'}
      onSettings={() => go('settings')}
    />
  );
}
