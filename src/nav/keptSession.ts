// What the desktop bar remembers about the open session. Plan and Settings
// are not sessions, but one click from them goes back, so they keep the
// session's box, its lap selection and its last corner; any other page
// forgets it. Pure: imports only its own folder.

import {sessionTabOf} from './activeTab';

export type Kept = {
  id: string;
  /** The `laps` param as it was in the URL. */
  laps?: string;
  hl?: string;
  /** The last corner used in this session, for the "Corner T5" tab. */
  corner: number | null;
};

export type KeptRoute = {
  pathname: string;
  id?: string;
  laps?: string;
  hl?: string;
  /** The open corner, on the Corner page. */
  n?: string;
  /** The first corner of the section open in Compare, once the map is in. */
  sectionCorner?: number | null;
};

/** The remembered session after a route change. */
export function nextKept(prev: Kept | null, route: KeptRoute): Kept | null {
  const tab = sessionTabOf(route.pathname);
  if (tab && route.id) {
    const fromPage = tab === 'corner' && route.n ? Number(route.n) : null;
    const remembered = prev?.id === route.id ? prev.corner : null;
    return {
      id: route.id,
      laps: route.laps,
      hl: route.hl,
      corner: fromPage ?? route.sectionCorner ?? remembered,
    };
  }
  if (route.pathname === '/plan' || route.pathname === '/settings') return prev;
  return null;
}

export const sameKept = (a: Kept | null, b: Kept | null): boolean =>
  a === b ||
  (a != null &&
    b != null &&
    a.id === b.id &&
    a.laps === b.laps &&
    a.hl === b.hl &&
    a.corner === b.corner);
