import {type Field} from '@/src/analysis/field';

import {getJson, HttpError} from '../http';

import {toField} from './adapters';

/**
 * One session's field. The hash comes from the session doc (`field.hash`);
 * under it the response is immutable, and a hash that has since been replaced
 * answers 404. The body is gzipped on the wire and up to about 3 MB per
 * race-hour, so this loads only when a screen asks for it.
 *
 * The hash route is cached for a year, so a 200 that arrived truncated or
 * corrupt would stay broken in the browser. When the body fails to decode or
 * to parse, ask once more with `cache: 'reload'`, which skips the cache and
 * replaces the bad entry (thread 1 #883). A failed status is not retried
 * here: the query does that for a 5xx, and a 4xx will not change.
 */
export async function fetchField(
  sessionId: string,
  hash: string,
  signal?: AbortSignal,
): Promise<Field> {
  const path = `/sessions/${encodeURIComponent(
    sessionId,
  )}/field/${encodeURIComponent(hash)}`;
  try {
    return toField(await getJson<unknown>(path, signal));
  } catch (error) {
    if (error instanceof HttpError || signal?.aborted) throw error;
    return toField(await getJson<unknown>(path, signal, {cache: 'reload'}));
  }
}
