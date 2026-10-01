// The session tabs, in one place for the phone row and the desktop bar.
// Pure: imports only its own folder.

import {type SessionTab} from './activeTab';

export type SessionTabItem = {key: SessionTab; label: string};

/**
 * Laps / Compare / Corner, and the full-field map: "Race" in a race, "Field"
 * in practice and qualifying, where it shows whenever the session has a
 * recorded field (removed, not greyed, otherwise; pit-wall thread 45 #1589).
 * One rule for the phone row and the desktop bar. The desktop bar passes its
 * "Corner T5" label; the phone keeps the plain word.
 */
export function sessionTabs(
  session: {sessionType: string; hasField: boolean} | undefined,
  cornerLabel = 'Corner',
): SessionTabItem[] {
  const tabs: SessionTabItem[] = [
    {key: 'session', label: 'Laps'},
    {key: 'compare', label: 'Compare'},
    {key: 'corner', label: cornerLabel},
  ];
  if (session?.sessionType === 'R') tabs.push({key: 'race', label: 'Race'});
  else if (session?.hasField) tabs.push({key: 'race', label: 'Field'});
  return tabs;
}
