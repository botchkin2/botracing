import {useLocalSearchParams, useRouter} from 'expo-router';
import {useMemo} from 'react';

import {parseSelection} from '@/src/nav/routes';
import {replace, toggle} from '@/src/state/lapSelection';

// The shared lap selection of one session: the URL's `laps` (ticked laps, in
// tap order) and `ref` (the Ref lap, Ref mode only). Laps, Compare and Corner
// read and write it through this hook, so a tap means the same everywhere.
// `router.setParams` leaves every other URL field (hl, c, t) as it is.
export function useLapSelection(): {
  laps: string[];
  ref: string | null;
  /** Toggle one lap: add it when unticked, remove it when ticked. */
  tap: (lapId: string) => void;
  /** Replace the selection with a stint (a drag over the strip). */
  drag: (stint: string[]) => void;
  /** Untick every lap. */
  clear: () => void;
} {
  const params = useLocalSearchParams<{laps?: string; ref?: string}>();
  const router = useRouter();
  const sel = useMemo(
    () => parseSelection({laps: params.laps, ref: params.ref}),
    [params.laps, params.ref],
  );
  const write = (laps: string[]) =>
    router.setParams({laps: laps.length ? laps.join(',') : undefined});
  return {
    laps: sel.laps,
    ref: sel.ref,
    tap: lapId => write(toggle(sel.laps, lapId)),
    drag: stint => write(replace(stint)),
    clear: () => write([]),
  };
}
