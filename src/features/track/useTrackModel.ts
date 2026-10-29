import {useMemo} from 'react';

import {useTrackMap, useSessions, useTrackSurface} from '@/src/data/sessions';
import {useLapTraceLoad} from '@/src/data/traces';
import {layoutsOf, trackInfo} from '@/src/data/tracks';
import {queryState, readFailure} from '@/src/data/queryState';
import {formatOffline} from '@/src/design';
import {
  type Combo,
  PLAN_HISTORY_DAYS,
  planCombos,
} from '@/src/workspace/planCombo';

import {undrivenPlanKey} from '../plan/model';

import {buildTrackModel, referenceSession, type TrackModel} from './model';
import {type MapPart, mapLoadOf} from './mapLoad';

const GRID_STEP_M = 5;

export type TrackScreenState =
  | {kind: 'loading'}
  | {kind: 'error'; message: string}
  // No network and nothing kept to show (src/data/queryState.ts).
  | {kind: 'offline'}
  | {
      kind: 'ready';
      model: TrackModel;
      /** One per car driven on this layout, for the Plan block. */
      plans: Combo[];
      /** Never driven here: the Plan key for this track in his current car (M11), else null. */
      undrivenPlan: string | null;
      refSessionId: string | null;
      /** The outline is still on its way (the map and the surface). */
      mapLoading: boolean;
      /** Parts of the map that failed to load; the page says so. */
      mapFailed: MapPart[];
      /** "Offline · 00:41", or "Offline" for a map part never read; else null. */
      offlineText: string | null;
      /** OSM credit for the outline. */
      attribution: string | null;
    };

/** Gathers the Track page's inputs; the model does the rest. */
export function useTrackModel(
  trackId: string,
  selectedCorner: number | null,
): TrackScreenState {
  const info = trackInfo(trackId);
  // The stats window counts back from when the page opened.
  const now = useMemo(() => new Date(), []);
  const sessions = useSessions({trackId, ageDays: PLAN_HISTORY_DAYS});
  // Every track, for the car an undriven track's Plan opens with: only asked
  // once this track turns out to have no session of his.
  const undriven =
    sessions.data != null && planCombos(sessions.data.items).length === 0;
  const everywhere = useSessions({ageDays: PLAN_HISTORY_DAYS}, undriven);
  const ref = sessions.data ? referenceSession(sessions.data.items) : null;
  const map = useTrackMap(trackId);
  const surface = useTrackSurface(trackId);
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

  // What was read wins over a failed refetch (roadmap 6b).
  const sessionsRead = queryState([sessions]);
  const mapFail = readFailure(map);
  const surfaceFail = readFailure(surface);
  return useMemo<TrackScreenState>(() => {
    if (sessionsRead.kind === 'offline' && !info) return {kind: 'offline'};
    if (sessionsRead.kind === 'error' && !info) {
      return {kind: 'error', message: 'Could not load this track.'};
    }
    if (sessionsRead.kind === 'loading') return {kind: 'loading'};
    const mapState = mapLoadOf({
      hasRef: ref != null,
      hasOutline: (map.data?.outline.length ?? 0) > 0,
      map: {pending: map.isPending, failed: mapFail === 'error'},
      surface: {pending: surface.isPending, failed: surfaceFail === 'error'},
      trace: {
        pending: lapWaits,
        failed: lap.load.kind === 'failed',
      },
    });
    const plans = planCombos(sessions.data?.items ?? []);
    return {
      kind: 'ready',
      refSessionId: ref?.id ?? null,
      plans,
      undrivenPlan:
        plans.length === 0
          ? undrivenPlanKey(trackId, everywhere.data?.items ?? [])
          : null,
      // The road is held back until the surface settles, like the map itself.
      mapLoading: mapState.loading,
      mapFailed: mapState.failed,
      offlineText:
        formatOffline(
          sessionsRead.kind === 'ready' ? sessionsRead.offlineSince : null,
        ) ??
        (mapFail === 'offline' || surfaceFail === 'offline' ? 'Offline' : null),
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
        now,
      }),
    };
  }, [
    trackId,
    info,
    sessionsRead.kind,
    sessionsRead.kind === 'ready' ? sessionsRead.offlineSince : null,
    mapFail,
    surfaceFail,
    sessions.data,
    everywhere.data,
    ref,
    map.data,
    surface.data,
    map.isPending,
    lap.load,
    refTrace,
    selectedCorner,
    now,
  ]);
}
