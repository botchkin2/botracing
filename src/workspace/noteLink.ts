// "Send a note" (pit-wall thread 112 #7901/#7908/#7980): a link that opens
// GitHub's new-issue form on the private pit-wall repo with the `his-note`
// template, prefilled with facts only. He types the note and attaches a
// screenshot there; it needs him signed in to GitHub on that device. The form
// field ids are the contract with `.github/ISSUE_TEMPLATE/his-note.yml` in the
// pit-wall repo: note, screen, session, version, device. `note` is left blank.

const FORM_URL = 'https://github.com/botchkin2/pit-wall/issues/new';
const TEMPLATE = 'his-note.yml';

export type NoteFacts = {
  /** "Sessions", "Plan", "Race"... (screenName). */
  screen: string;
  sessionId: string | null;
  appVersion: string;
  /** The tray version of the PC last heard from; null when none reported. */
  trayVersion: string | null;
  device: 'phone' | 'desktop';
};

/** The screen a path is, in the words the app uses; no ids in it. */
export function screenName(pathname: string): string {
  if (pathname === '/' || pathname === '') return 'Sessions';
  if (pathname === '/plan') return 'Plan';
  if (pathname === '/settings') return 'Settings';
  if (pathname === '/tracks') return 'Tracks';
  if (pathname.startsWith('/track/')) return 'Track';
  if (pathname.startsWith('/session/')) {
    if (pathname.includes('/compare')) return 'Compare';
    if (pathname.includes('/race')) return 'Race';
    if (pathname.includes('/corner/')) return 'Corner';
    return 'Session';
  }
  return 'App';
}

/** The id in /session/<id>/..., else null. */
export function sessionIdOf(pathname: string): string | null {
  const m = /^\/session\/([^/]+)/.exec(pathname);
  return m ? decodeURIComponent(m[1]) : null;
}

/** "App 1.0.18 · tray 0.1.18", or "· tray unknown" when no PC has reported. */
export function versionText(appVersion: string, trayVersion: string | null) {
  return `App ${appVersion || 'unknown'} · tray ${trayVersion ?? 'unknown'}`;
}

/**
 * The tray version of the PC heard from last: the newest heartbeat with a
 * version. Null with no PC.
 */
export function trayVersionOf(
  uploaders: readonly {version: string; lastSeenAt: number | null}[],
): string | null {
  let best: {version: string; lastSeenAt: number} | null = null;
  for (const u of uploaders) {
    if (!u.version) continue;
    const at = u.lastSeenAt ?? 0;
    if (!best || at > best.lastSeenAt)
      best = {version: u.version, lastSeenAt: at};
  }
  return best?.version ?? null;
}

/** The issue-form link with the facts in it, well under GitHub's URL limit. */
export function noteUrl(facts: NoteFacts): string {
  const params: [string, string][] = [
    ['template', TEMPLATE],
    ['title', `Note: ${facts.screen}`],
    ['screen', facts.screen],
    ...(facts.sessionId
      ? [['session', facts.sessionId] as [string, string]]
      : []),
    ['version', versionText(facts.appVersion, facts.trayVersion)],
    ['device', facts.device],
  ];
  const query = params
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join('&');
  return `${FORM_URL}?${query}`;
}
