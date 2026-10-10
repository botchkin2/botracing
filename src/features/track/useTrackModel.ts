import {useMemo} from 'react';

import {
  useSessionMap,
  useSessions,
  useSessionSurface,
} from '@/src/data/sessions';
import {useLapTraceLoad} from '@/src/data/traces';
import {layoutsOf, trackInfo} from '@/src/data/tracks';

import {type Combo, planCombos} from '../plan/model';

import {buildTrackModel, referenceSession, type TrackModel} from './model';
import {type MapPart, mapLoadOf} from './mapLoad';

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
      /** The outline is still on its way (the map and the surface). */
      mapLoading: boolean;
      /** Parts of the map that failed to load; the page says so. */
      mapFailed: MapPart[];
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
  const surface = useSessionSurface(ref?.id ?? '');
  const lengthM = map.data?.lengthM ?? 0;
  const lap = useLapTraceLoad(ref?.bestLapId ? [ref.bestLapId] : [], {
    lengthM,
    stepM: GRID_STEP_M,
  });
  const refTrace = lap.traces[0];
  // The lap cannot load until the map has its length.
  const lapWaits =
    (lap.load.kind === 'idle' || lap.load.kind === 'loading') &&
    (map.data?.lengthM ?? 0) > 0;

  return useMemo<TrackScreenState>(() => {
    if (sessions.isError && !info) {
      return {kind: 'error', message: 'Could not load this track.'};
    }
    if (sessions.isPending) return {kind: 'loading'};
    const mapState = mapLoadOf({
      hasRef: ref != null,
      hasOutline: (map.data?.outline.length ?? 0) > 0,
      map: {pending: map.isPending, failed: map.isError},
      surface: {pending: surface.isPending, failed: surface.isError},
      trace: {
        pending: lapWaits,
        failed: lap.load.kind === 'failed',
      },
    });
    return {
      kind: 'ready',
      refSessionId: ref?.id ?? null,
      plans: planCombos(sessions.data?.items ?? []),
      // The road is held back until the surface settles, like the map itself.
      mapLoading: mapState.loading,
      mapFailed: mapState.failed,
      attribution: map.data?.attribution ?? null,
      model: buildTrackModel({
        trackId,
        info,
        layouts: layoutsOf(trackId),
        sessions: sessions.data?.items ?? [],
        map: map.data ?? null,
        surface: surface.data ?? null,
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
    surface.data,
    map.isPending,
    map.isError,
    surface.isError,
    lap.load,
    refTrace,
    selectedCorner,
  ]);
}
