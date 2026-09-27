import {getJson} from '../http';

import {
  type Lap,
  type SessionDetail,
  type SessionLapsResponse,
  type SessionListResponse,
  type SessionSummary,
  toLaps,
  toSessionDetail,
  toSessionSummary,
} from './adapters';
import {type SessionFilter} from './keys';

export async function fetchSessions(
  filter: SessionFilter,
  signal?: AbortSignal,
): Promise<{items: SessionSummary[]; total: number}> {
  const params = new URLSearchParams();
  if (filter.ageDays) params.set('age', String(filter.ageDays));
  if (filter.trackId) params.set('track', filter.trackId);
  const query = params.toString();
  const body = await getJson<SessionListResponse>(
    `/sessions${query ? `?${query}` : ''}`,
    signal,
  );
  return {items: body.items.map(toSessionSummary), total: body.total};
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
