import {type TrackSurface} from '@/src/analysis/trackSurface';

import {getJson, HttpError} from '../http';

import {
  type Lap,
  type SessionDetail,
  type SessionFacets,
  type SessionLapsResponse,
  type SessionListResponse,
  type SessionSummary,
  type SessionBand,
  type TrackMapData,
  toLaps,
  toSessionBand,
  toTrackMap,
  toTrackSurface,
  toSessionDetail,
  toSessionFacets,
  toSessionSummary,
} from './adapters';
import {type SessionFilter} from './keys';
import {type PlanSession, toPlanSessions} from './planBlock';

export async function fetchSessions(
  filter: SessionFilter,
  signal?: AbortSignal,
): Promise<{items: SessionSummary[]; total: number}> {
  const params = new URLSearchParams();
  if (filter.ageDays) params.set('age', String(filter.ageDays));
  if (filter.trackId) params.set('track', filter.trackId);
  if (filter.sim) params.set('sim', filter.sim);
  const query = params.toString();
  const body = await getJson<SessionListResponse>(
    `/sessions${query ? `?${query}` : ''}`,
    signal,
  );
  return {items: body.items.map(toSessionSummary), total: body.total};
}

/**
 * The Plan's one request for a track and car: every session's `plan` block,
 * newest first (the newest few with their lap rows). `carModel` is the car
 * without its livery, the Plan's own key.
 */
export async function fetchPlanSessions(
  combo: {sim: string; trackId: string; carModel: string},
  signal?: AbortSignal,
): Promise<{items: PlanSession[]; truncated: boolean}> {
  const params = new URLSearchParams({
    sim: combo.sim,
    trackId: combo.trackId,
    car: combo.carModel,
  });
  return toPlanSessions(await getJson<unknown>(`/plan?${params}`, signal));
}

export async function fetchSessionFacets(
  signal?: AbortSignal,
): Promise<SessionFacets> {
  return toSessionFacets(await getJson<unknown>('/sessions/facets', signal));
}

export async function fetchSession(
  id: string,
  signal?: AbortSignal,
): Promise<SessionDetail> {
  const raw = await getJson<Record<string, unknown> & {id: string}>(
    `/sessions/${encodeURIComponent(id)}`,
    signal,
  );
  return toSessionDetail(raw);
}

export async function fetchSessionLaps(
  id: string,
  signal?: AbortSignal,
): Promise<Lap[]> {
  const body = await getJson<SessionLapsResponse>(
    `/sessions/${encodeURIComponent(id)}/laps`,
    signal,
  );
  return toLaps(body.items);
}

export async function fetchSessionBand(
  id: string,
  signal?: AbortSignal,
): Promise<SessionBand> {
  return toSessionBand(
    await getJson<Record<string, unknown>>(
      `/sessions/${encodeURIComponent(id)}/band`,
      signal,
    ),
  );
}

/** A track layout's corner map, by its id (GET /tracks/{trackId}/map). */
export async function fetchTrackMap(
  trackId: string,
  signal?: AbortSignal,
): Promise<TrackMapData> {
  return toTrackMap(
    await getJson<Record<string, unknown>>(
      `/tracks/${encodeURIComponent(trackId)}/map`,
      signal,
    ),
  );
}

/** A track layout's measured surface, or null when it has none yet (404) or the file is not usable. */
export async function fetchTrackSurface(
  trackId: string,
  signal?: AbortSignal,
): Promise<TrackSurface | null> {
  try {
    return toTrackSurface(
      await getJson<Record<string, unknown>>(
        `/tracks/${encodeURIComponent(trackId)}/surface`,
        signal,
      ),
    );
  } catch (error) {
    if (error instanceof HttpError && error.status === 404) return null;
    throw error;
  }
}
