import {getJson} from '../http';

import {
  type SessionListResponse,
  type SessionSummary,
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
