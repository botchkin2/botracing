import {usePathname} from 'expo-router';

import {useSession} from '@/src/data/sessions';
import {SessionTabs} from '@/src/ui';

import {sessionTabOf} from '@/src/nav/activeTab';
import {useWorkspaceGo} from './useWorkspaceGo';

const TABS = [
  {key: 'session', label: 'Laps'},
  {key: 'compare', label: 'Compare'},
  {key: 'corner', label: 'Corner'},
  {key: 'race', label: 'Race'},
] as const;

/**
 * The phone's Laps / Compare / Corner / Race row. Each session screen puts it
 * under its title (round 4 nav frame, item 8); the desktop chrome has the
 * same destinations, so screens render this only below the chrome width.
 */
export function SessionNav({sessionId}: {sessionId: string}) {
  const tab = sessionTabOf(usePathname());
  const go = useWorkspaceGo(sessionId, tab);
  const {data} = useSession(sessionId);
  // The Race view is only for race sessions; while the session loads the
  // row shows the three that always apply.
  const items =
    data?.sessionType === 'R' ? TABS : TABS.filter(t => t.key !== 'race');
  if (!tab) return null;
  return <SessionTabs items={items} active={tab} onSelect={go} />;
}
