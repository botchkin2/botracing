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
