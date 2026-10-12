// The map of a track layout, served by track id (pit-wall thread 1 #3479):
// shared app data in tracks/{trackId} and surface/{trackId}/, the same for
// every signed-in user, so no session is needed to draw it. The pure parts:
// which ids are valid and the validators that let a repeat open be a 304.

// Track ids are the layout's sim-prefixed slug, e.g.
// lmu-michelin_raceway_road_atlanta, iracing-127-full_course.
const TRACK_ID = /^[a-z][a-z0-9]*-[a-z0-9_-]{1,120}$/;

export function trackIdOk(id: unknown): id is string {
  return typeof id === 'string' && TRACK_ID.test(id) && !id.includes('..');
}

// The map's validator: the track doc's last write. The map changes only when
// the curator writes the doc (corners, boundaries, georef, the outline path).
export function mapEtag(updateTime: {seconds: number; nanoseconds: number}) {
  return `"m-${updateTime.seconds}.${updateTime.nanoseconds}"`;
}

// The surface's validator: what surface.mjs records on the track doc each time
// it folds sessions in (tracks/{id}.surface.updatedAt and .laps), so a 304 is
// decided without downloading the file.
export function surfaceEtag(surface: unknown): string | null {
  const s = surface as {updatedAt?: unknown; laps?: unknown} | null;
  if (!s || typeof s.updatedAt !== 'string') return null;
  return `"s-${s.updatedAt}-${typeof s.laps === 'number' ? s.laps : 0}"`;
}

/** True when the client already holds `etag` (If-None-Match, a list or *). */
export function notModified(ifNoneMatch: unknown, etag: string): boolean {
  if (typeof ifNoneMatch !== 'string') return false;
  return ifNoneMatch
    .split(',')
    .map(v => v.trim().replace(/^W\//, ''))
    .some(v => v === '*' || v === etag);
}
