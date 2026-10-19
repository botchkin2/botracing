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

// The shape of the map body (trackMapPayload). Bump it whenever the payload
// gains or changes a field: a client holding the old body then misses on its
// If-None-Match and downloads the new one, instead of a 304 for a body without
// the field until a curator happens to write the track (2: `elevation`).
export const MAP_PAYLOAD_V = 2;

// The map's validator: the payload's shape and the track doc's last write. The
// map changes only when the curator writes the doc (corners, boundaries,
// georef, the outline path) or when the payload's shape does.
export function mapEtag(updateTime: {seconds: number; nanoseconds: number}) {
  return `"m${MAP_PAYLOAD_V}-${updateTime.seconds}.${updateTime.nanoseconds}"`;
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

// The map a client draws from: the track doc's fields plus its outline. One
// builder for the owner's and the shared route, so a field added here reaches
// both. `elevation` is the curated height profile (stepM, heightM[]), null for
// a track without one.
export function trackMapPayload(
  trackId: string,
  name: string | null,
  track: Record<string, any>,
  outline: unknown,
) {
  return {
    trackId,
    track: name,
    lengthM: track.lengthM ?? null,
    corners: track.corners ?? [],
    // Where each section's window starts and the windows that tile the lap
    // (tools/sessions/layoutBoundaries.mjs); null before the first resync.
    boundaries: track.boundaries ?? null,
    quality: track.quality ?? null,
    qualityNote: track.qualityNote ?? null,
    georef: track.georef ?? null,
    attribution: track.outline?.attribution ?? null,
    elevation: track.elevation ?? null,
    outline,
  };
}
