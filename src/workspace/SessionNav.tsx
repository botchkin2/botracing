import {usePathname} from 'expo-router';

import {useSession} from '@/src/data/sessions';
import {sessionTabOf} from '@/src/nav/activeTab';
import {sessionTabs} from '@/src/nav/sessionTabs';
import {SessionTabs} from '@/src/ui';

import {useUrlTarget, useWorkspaceGo} from './useWorkspaceGo';

/**
 * The phone's Laps / Compare / Corner / Race row. Each session screen puts it
 * under its title (round 4 nav frame, item 8); the desktop chrome has the
 * same destinations, so screens render this only below the chrome width.
 */
export function SessionNav({sessionId}: {sessionId: string}) {
  const tab = sessionTabOf(usePathname());
  const go = useWorkspaceGo(useUrlTarget(sessionId, tab));
  const {data} = useSession(sessionId);
  if (!tab) return null;
  return (
    <SessionTabs
      items={sessionTabs(data?.sessionType)}
      active={tab}
      onSelect={go}
    />
  );
}
