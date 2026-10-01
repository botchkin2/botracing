import {useGlobalSearchParams, usePathname, useRouter} from 'expo-router';
import {useState} from 'react';

import {
  firstCornerOf,
  trackCorners,
  useSession,
  useSessionLaps,
  useSessionMap,
} from '@/src/data/sessions';
import {useLayout, useTheme} from '@/src/design';
import {type SessionTab, sessionTabOf} from '@/src/nav/activeTab';
import {type Kept, nextKept, sameKept} from '@/src/nav/keptSession';
import {sessionsHref} from '@/src/nav/routes';
import {AppChrome, type ChromeSession} from '@/src/ui';

import {chromeBox} from './chromeBox';
import {SessionSwitcher} from './SessionSwitcher';
import {usePlanCombo} from './usePlanCombo';
import {useWorkspaceGo} from './useWorkspaceGo';

/**
 * The desktop bar (≥900), fed from the URL and from what `nextKept` remembers:
 * the open session, its lap selection and its last corner become the box, so
 * switching tabs keeps context. The rules are pure, in `nav` and `chromeBox`.
 */
export function DesktopChrome() {
  const pathname = usePathname();
  const router = useRouter();
  const {id, laps, hl, n, c} = useGlobalSearchParams<{
    id?: string;
    laps?: string;
    hl?: string;
    n?: string;
    c?: string;
  }>();
  const {scheme} = useTheme();
  const {isWide} = useLayout();
  const tab = sessionTabOf(pathname);
  const openMap = useSessionMap(tab && id ? id : '');
  const sectionCorner =
    openMap.data && c
      ? firstCornerOf(trackCorners(openMap.data), Number(c))
      : null;

  // Derived from the route while rendering, not in an effect: no extra paint.
  const [kept, setKept] = useState<Kept | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const next = nextKept(kept, {pathname, id, laps, hl, n, sectionCorner});
  if (!sameKept(next, kept)) setKept(next);

  const sessionId = next?.id ?? null;
  const plan = usePlanCombo(
    sessionId,
    pathname.startsWith('/track/') ? id ?? null : null,
    true,
  );
  const go = useWorkspaceGo({
    sessionId,
    selection: {laps: next?.laps, hl: next?.hl},
    cornerN: next?.corner ?? 1,
    planCombo: plan.key,
  });
  const {data: session} = useSession(sessionId ?? '', sessionId != null);
  const lapData = useSessionLaps(sessionId ?? '');
  const map = useSessionMap(sessionId ?? '');

  const content =
    next && session
      ? chromeBox({
          session,
          laps: lapData.data,
          selection: {laps: next.laps, hl: next.hl},
          cornerN: next.corner,
          corners: map.data ? trackCorners(map.data) : undefined,
          tab,
          scheme,
        })
      : null;
  const box: ChromeSession<SessionTab> | null = content
    ? {
        ...content,
        onTab: key => go(key),
        onMenu: () => setMenuOpen(true),
        onClose: () => {
          setKept(null);
          router.navigate(sessionsHref());
        },
      }
    : null;
  return (
    <>
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
      {session && content && sessionId && (
        <SessionSwitcher
          visible={menuOpen}
          onClose={() => setMenuOpen(false)}
          sessionId={sessionId}
          trackId={session.trackId}
          trackName={content.track}
          detail={content.detail}
        />
      )}
    </>
  );
}
