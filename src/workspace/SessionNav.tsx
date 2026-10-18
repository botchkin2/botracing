import {usePathname} from 'expo-router';

import {useCornerOff, useSession} from '@/src/data/sessions';
import {sessionTabOf} from '@/src/nav/activeTab';
import {sessionTabs} from '@/src/nav/sessionTabs';
import {SessionTabs} from '@/src/ui';

import {useUrlTarget, useWorkspaceGo} from './useWorkspaceGo';

/**
 * The phone's Laps / Compare / Corner / Race-or-Field row. Each session screen puts it
 * under its title (round 4 nav frame, item 8); the desktop chrome has the
 * same destinations, so screens render this only below the chrome width.
 */
export function SessionNav({
  sessionId,
  set = null,
}: {
  sessionId: string;
  /** `day`: the session is open as its sitting. */
  set?: 'day' | null;
}) {
  const tab = sessionTabOf(usePathname());
  const go = useWorkspaceGo(useUrlTarget(sessionId, tab));
  const {data} = useSession(sessionId);
  const cornerOff = useCornerOff(sessionId, data?.trackId, set === 'day');
  if (!tab) return null;
  return (
    <SessionTabs
      items={sessionTabs(
        data && {sessionType: data.sessionType, hasField: data.field != null},
        'Corner',
        cornerOff,
      )}
      active={tab}
      onSelect={go}
    />
  );
}
