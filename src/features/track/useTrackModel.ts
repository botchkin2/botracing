import {useMemo} from 'react';

import {useSessionMap, useSessions} from '@/src/data/sessions';
import {useLapTraces} from '@/src/data/traces';
import {layoutsOf, trackInfo} from '@/src/data/tracks';

import {type Combo, planCombos} from '../plan/model';

import {buildTrackModel, referenceSession, type TrackModel} from './model';

// Every session ever driven here, not the Sessions list's recent window.
const ALL_TIME_DAYS = 3650;
const GRID_STEP_M = 5;

export type TrackScreenState =
  | {kind: 'loading'}
  | {kind: 'error'; message: string}
  | {
      kind: 'ready';
      model: TrackModel;
      /** One per car driven on this layout, for the Plan block. */
      plans: Combo[];
      refSessionId: string | null;
      /** The map is still on its way (its session, map or best lap). */
      mapLoading: boolean;
      /** OSM credit for the outline. */
      attribution: string | null;
    };

/** Gathers the Track page's inputs; the model does the rest. */
export function useTrackModel(
  trackId: string,
  selectedCorner: number | null,
): TrackScreenState {
  const info = trackInfo(trackId);
  const sessions = useSessions({trackId, ageDays: ALL_TIME_DAYS});
  const ref = sessions.data ? referenceSession(sessions.data.items) : null;
  const map = useSessionMap(ref?.id ?? '');
  const lengthM = map.data?.lengthM ?? 0;
  const [refTrace] = useLapTraces(ref?.bestLapId ? [ref.bestLapId] : [], {
    lengthM,
    stepM: GRID_STEP_M,
  });

  return useMemo<TrackScreenState>(() => {
    if (sessions.isError && !info) {
      return {kind: 'error', message: 'Could not load this track.'};
    }
    if (sessions.isPending) return {kind: 'loading'};
    return {
      kind: 'ready',
      refSessionId: ref?.id ?? null,
      plans: planCombos(sessions.data?.items ?? []),
      mapLoading: ref != null && (map.isPending || refTrace == null),
      attribution: map.data?.attribution ?? null,
      model: buildTrackModel({
        trackId,
        info,
        layouts: layoutsOf(trackId),
        sessions: sessions.data?.items ?? [],
        map: map.data ?? null,
        refTrace: refTrace ?? null,
        selectedCorner,
      }),
    };
  }, [
    trackId,
    info,
    sessions.isError,
    sessions.isPending,
    sessions.data,
    ref,
    map.data,
    map.isPending,
    refTrace,
    selectedCorner,
  ]);
}
