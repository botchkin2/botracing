import {useQueryClient} from '@tanstack/react-query';
import {useEffect, useRef} from 'react';

import {type Uploader, useUploaders} from '../uploaders';

import {sessionKeys} from './keys';

/** What the tray last sent, by PC: changes when a lap or a session lands. */
export function uploadSignature(uploaders: Uploader[] | undefined) {
  return (uploaders ?? [])
    .map(u => `${u.hostId}:${u.lastUploadAt ?? ''}:${u.lastSessionId ?? ''}`)
    .join('|');
}

/**
 * The Sessions list has no interval: a list of every session per call is too
 * much to poll. The uploaders (one small call a minute while this is mounted)
 * say when a PC uploaded; the list and its filters are read again then, so a
 * drive that starts while the list is open appears (thread 1 #4997, #5022).
 */
export function useNewUploads() {
  const client = useQueryClient();
  const uploaders = useUploaders();
  const signature = uploadSignature(uploaders.data);
  const seen = useRef<string | null>(null);
  useEffect(() => {
    if (!uploaders.data) return;
    if (seen.current != null && seen.current !== signature) {
      void client.invalidateQueries({
        queryKey: [...sessionKeys.all, 'list'],
      });
      void client.invalidateQueries({queryKey: sessionKeys.facets});
    }
    seen.current = signature;
  }, [uploaders.data, signature, client]);
}

/**
 * When a PC last uploaded to this session (its newest `lastUploadAt` among the
 * PCs whose last upload was this session), else null.
 */
export function sessionUploadMark(
  uploaders: Uploader[] | undefined,
  sessionId: string,
): number | null {
  let mark: number | null = null;
  for (const u of uploaders ?? [])
    if (u.lastSessionId === sessionId && u.lastUploadAt != null)
      mark = Math.max(mark ?? 0, u.lastUploadAt);
  return mark;
}

/**
 * An open session hears of a lap from the same signal as the list: the
 * uploaders say a PC uploaded to it, and the session doc is read again. Its
 * own 5 s poll runs only while the session is live (live.ts), so a drive
 * that went quiet for 10 minutes and then resumed into the same session was
 * never seen until the screen was left and opened again (pit-wall #5283,
 * #5290). No new polling: the uploaders call is the list's (one a minute).
 */
export function useSessionNewUploads(sessionId: string, listen: boolean) {
  const client = useQueryClient();
  const uploaders = useUploaders(listen);
  const mark = sessionUploadMark(uploaders.data, sessionId);
  const seen = useRef<{id: string; mark: number | null} | null>(null);
  useEffect(() => {
    if (!listen || !uploaders.data) return;
    const was = seen.current;
    if (was && was.id === sessionId && mark != null && mark !== was.mark)
      void client.invalidateQueries({queryKey: sessionKeys.detail(sessionId)});
    seen.current = {id: sessionId, mark};
  }, [listen, uploaders.data, mark, sessionId, client]);
}
