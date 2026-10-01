// The session tabs, in one place for the phone row and the desktop bar.
// Pure: imports only its own folder.

import {type SessionTab} from './activeTab';

export type SessionTabItem = {key: SessionTab; label: string};

/**
 * Laps / Compare / Corner, and Race for a race session only (removed, not
 * greyed, for practice and qualifying). The desktop bar passes its "Corner T5"
 * label; the phone keeps the plain word.
 */
export function sessionTabs(
  sessionType: string | undefined,
  cornerLabel = 'Corner',
): SessionTabItem[] {
  const tabs: SessionTabItem[] = [
    {key: 'session', label: 'Laps'},
    {key: 'compare', label: 'Compare'},
    {key: 'corner', label: cornerLabel},
  ];
  if (sessionType === 'R') tabs.push({key: 'race', label: 'Race'});
  return tabs;
}
