import {useEffect} from 'react';
import {AppState, Platform} from 'react-native';

import {useAuthStore} from '@/src/auth/authStore';
import {fetchPresets, presetKeys, putPresets} from '@/src/data/presets';
import {queryClient} from '@/src/utils/queryClient';

import {useFuelPresets} from '@/src/state/fuelPresets';

import {type SyncDeps, syncPresets} from './presetSync';

/** How long after a failed sync (offline, a server error) the next try is. */
export const RETRY_MS = 30_000;
/** A save waits this long for the next one before it is sent. */
export const SEND_AFTER_MS = 500;

/**
 * The device's presets against the account, over the network and the store. The account's list
 * lives in the query cache under `presetKeys.account`; the store stays the device's copy and
 * the source of what screens draw.
 */
export const presetSyncDeps: SyncDeps = {
  get: () =>
    queryClient.fetchQuery({
      queryKey: presetKeys.account,
      queryFn: ({signal}) => fetchPresets(signal),
      staleTime: 0,
    }),
  put: async body => {
    const written = await putPresets(body);
    queryClient.setQueryData(presetKeys.account, written.doc);
    return written;
  },
  local: () => useFuelPresets.getState(),
  applyServer: doc => useFuelPresets.getState().applyServer(doc, Date.now()),
};

/**
 * Keeps the presets level with the account while someone is signed in (pit-wall thread 104,
 * B2): once at start, when a save or remove makes the device's list differ from the
 * account's (after a short wait), when the app comes back to the foreground or the browser
 * comes online, and again every RETRY_MS after a failure. A list saved offline stays
 * `pending` in the store, across restarts, until a sync gets it to the account.
 */
export function usePresetSync(): void {
  const uid = useAuthStore(s => (s.state.kind === 'signed-in' ? s.state.uid : null));
  useEffect(() => {
    if (uid == null) return undefined;
    let stopped = false;
    let busy = false;
    let again = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = (ms: number) => {
      clearTimeout(timer);
      timer = setTimeout(() => void run(), ms);
    };
    const run = async () => {
      if (stopped) return;
      if (busy) {
        again = true;
        return;
      }
      busy = true;
      clearTimeout(timer);
      try {
        await syncPresets(presetSyncDeps);
      } catch {
        // offline or refused: the list stays pending, and the next try is soon
        if (!stopped) schedule(RETRY_MS);
      } finally {
        busy = false;
        if (again && !stopped) {
          again = false;
          void run();
        }
      }
    };
    // The stored list is read from the device asynchronously: the owner and the pending
    // flag are only known once it is in.
    const begin = () => {
      if (stopped) return;
      useFuelPresets.getState().adoptOwner(uid);
      void run();
    };
    const hydration = useFuelPresets.persist;
    const unsubscribeHydration = hydration.hasHydrated()
      ? (begin(), () => undefined)
      : hydration.onFinishHydration(begin);
    const unsubscribe = useFuelPresets.subscribe((s, prev) => {
      // a save or remove here (a merge made by the sync itself runs while `busy`)
      if (!busy && s.pending && (s.presets !== prev.presets || s.removed !== prev.removed))
        schedule(SEND_AFTER_MS);
    });
    const foreground = AppState.addEventListener('change', state => {
      if (state === 'active') void run();
    });
    const online = () => void run();
    if (Platform.OS === 'web') window.addEventListener('online', online);
    return () => {
      stopped = true;
      clearTimeout(timer);
      unsubscribe();
      unsubscribeHydration();
      foreground.remove();
      if (Platform.OS === 'web') window.removeEventListener('online', online);
    };
  }, [uid]);
}
