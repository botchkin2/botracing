import {type Field} from '@/src/analysis/field';

import {getJson} from '../http';

import {toField} from './adapters';

/**
 * One session's field. The hash comes from the session doc (`field.hash`);
 * under it the response is immutable, and a hash that has since been replaced
 * answers 404. The body is gzipped on the wire and up to about 3 MB per
 * race-hour, so this loads only when a screen asks for it.
 */
export async function fetchField(
  sessionId: string,
  hash: string,
  signal?: AbortSignal,
): Promise<Field> {
  const path = `/sessions/${encodeURIComponent(
    sessionId,
  )}/field/${encodeURIComponent(hash)}`;
  return toField(await getJson<unknown>(path, signal));
}
