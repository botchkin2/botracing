// Which nav item a path belongs to. The desktop bar highlights a workspace
// tab; the phone highlights one of its three destinations and, inside a
// session, one segment. Pure: imports nothing.

export type SessionTab = 'session' | 'compare' | 'corner' | 'race';

/** The open session workspace, or null off the session routes. */
export function sessionTabOf(pathname: string): SessionTab | null {
  if (!pathname.startsWith('/session/')) return null;
  if (pathname.includes('/compare')) return 'compare';
  if (pathname.includes('/race')) return 'race';
  if (pathname.includes('/corner/')) return 'corner';
  return 'session';
}

export type Destination = 'sessions' | 'plan' | 'settings';

/** The phone bottom-bar item for a path. Tracks and a Track page are reached
 * from Sessions, so they keep Sessions lit. */
export function destinationOf(pathname: string): Destination {
  if (pathname === '/plan') return 'plan';
  if (pathname === '/settings') return 'settings';
  return 'sessions';
}
