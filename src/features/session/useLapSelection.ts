import {useLocalSearchParams, useRouter} from 'expo-router';
import {useMemo} from 'react';

import {type LapSelectionParams, parseSelection} from '@/src/nav/routes';
import {replace, toggle} from '@/src/state/lapSelection';

// The shared lap selection of one session, read and written through the URL
// (nav/routes.ts owns the params). Laps, Compare and Corner all use this hook,
// so a tap means the same everywhere. `update` writes only the fields given:
// the rest of the URL is left as it is.
export function useLapSelection(): {
  laps: string[];
  ref: string | null;
  hl: string | null;
  corner: number | null;
  cursorM: number | null;
  /** Toggle one lap: add it when unticked, remove it when ticked. */
  tap: (lapId: string) => void;
  /** Replace the selection with a stint (a drag over the strip). */
  drag: (stint: string[]) => void;
  /** Write the fields given; a null or empty field is removed from the URL. */
  update: (patch: Partial<LapSelectionParams>) => void;
} {
  const params = useLocalSearchParams<{
    laps?: string;
    ref?: string;
    hl?: string;
    c?: string;
    t?: string;
  }>();
  const router = useRouter();
  const sel = useMemo(
    () => parseSelection(params),
    [params.laps, params.ref, params.hl, params.c, params.t],
  );
  const update = (patch: Partial<LapSelectionParams>) => {
    const out: Record<string, string | undefined> = {};
    if (patch.laps !== undefined)
      out.laps = patch.laps.length ? patch.laps.join(',') : undefined;
    if (patch.ref !== undefined) out.ref = patch.ref ?? undefined;
    if (patch.hl !== undefined) out.hl = patch.hl ?? undefined;
    if (patch.corner !== undefined)
      out.c = patch.corner == null ? undefined : String(patch.corner);
    if (patch.cursorM !== undefined)
      out.t =
        patch.cursorM == null ? undefined : String(Math.round(patch.cursorM));
    router.setParams(out);
  };
  return {
    laps: sel.laps,
    ref: sel.ref,
    hl: sel.hl,
    corner: sel.corner,
    cursorM: sel.cursorM,
    tap: lapId => update({laps: toggle(sel.laps, lapId)}),
    drag: stint => update({laps: replace(stint)}),
    update,
  };
}
