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

type Kept = {
  id: string;
  laps?: string;
  hl?: string;
  /** The last corner used in this session, for the "Corner T5" tab. */
  corner: number | null;
};

const sameKept = (a: Kept | null, b: Kept | null) =>
  a === b ||
  (a != null &&
    b != null &&
    a.id === b.id &&
    a.laps === b.laps &&
    a.hl === b.hl &&
    a.corner === b.corner);

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
  // Plan and Settings keep the session box, its laps and its corner so one
  // click goes back; any other page forgets the session. Derived from the
  // route while rendering, not in an effect: no extra paint.
  const keeps = pathname === '/plan' || pathname === '/settings';
  const [kept, setKept] = useState<Kept | null>(null);
  const sessionId = openId ?? (keeps ? kept?.id ?? null : null);
  const urlCorner = useCornerTarget(sessionId, tab);
  const current: Kept | null = openId
    ? {
        id: openId,
        laps,
        hl,
        corner: urlCorner.used
          ? urlCorner.n
          : kept?.id === openId
          ? kept.corner
          : null,
      }
    : keeps
    ? kept
    : null;
  if (!sameKept(current, kept)) setKept(current);
  const selection = openId ? {laps, hl} : {laps: kept?.laps, hl: kept?.hl};
  const cornerN = current?.corner ?? null;
  const plan = usePlanCombo(
    sessionId,
    pathname.startsWith('/track/') ? id ?? null : null,
    true,
  );
  const go = useWorkspaceGo(sessionId, tab, {
    planCombo: plan.key,
    cornerN: cornerN ?? undefined,
    selection,
  });
  const {data: session} = useSession(sessionId ?? '', sessionId != null);
  const lapData = useSessionLaps(sessionId ?? '');
  const map = useSessionMap(sessionId ?? '');

  let box: ChromeSession<SessionTab> | null = null;
  if (sessionId && session) {
    const car = carLabel(session.car);
    const {laps: lapIds} = parseSelection(selection);
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
    const cornerLabel =
      cornerN != null
        ? `Corner T${turnNumber(
            cornerN ?? 1,
            map.data
              ? trackCorners(map.data).find(c => c.n === cornerN)?.official
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
