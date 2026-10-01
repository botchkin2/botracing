import {useMemo} from 'react';

import {raceClock, type RaceClock} from '@/src/analysis/raceClock';
import {type OutlineUse} from '@/src/analysis/outlineUse';
import {type RacePrep, prepareRace} from '@/src/analysis/raceState';
import {worldMatches, worldMatchM} from '@/src/analysis/worldMatch';
import {useField} from '@/src/data/field';
import {
  mapPlacer,
  type MapPlacer,
  useSession,
  useSessionLaps,
  useSessionMap,
  useSessionSurface,
} from '@/src/data/sessions';
import {useLapTraces} from '@/src/data/traces';
import {shortTrackName} from '@/src/design';

const SESSION_TITLE = {R: 'Race', Q: 'Qualifying', P: 'Practice'} as const;
// Same 5 m grid as Compare, so the line and the laps agree.
const GRID_STEP_M = 5;
// Every 10th player sample is plenty for a median over a lap-long line.
const MATCH_STEP = 10;

/** A race ranks its cars; practice and qualifying show the road around the player instead. */
export type RaceMode = 'race' | 'field';

export type RaceData =
  | {kind: 'loading'}
  | {kind: 'error'; message: string}
  /** The session predates the recorder, or it was not joined. */
  | {kind: 'no-field'; title: string}
  | {kind: 'field-loading'; title: string}
  | {kind: 'field-error'; title: string; retry: () => void}
  | {
      kind: 'ready';
      title: string;
      mode: RaceMode;
      prep: RacePrep;
      /** The player's lap and distance at a race time, and back; shared with Compare. */
      clock: RaceClock;
      laps: {id: string; lapNumber: number | null}[];
      placer: MapPlacer;
      /** The reference lap in map metres: fits the view and is the band without an outline. */
      line: {x: number; y: number}[];
      /** The outline split by the reference lap; all used when there is no timed lap. */
      outlineUse: OutlineUse;
      /** False when the placed player is not on the placed line: cars are not drawn. */
      matches: boolean;
      /** Median metres from the player to the line, for the notice. */
      matchM: number | null;
      attribution: string | null;
      /** The measured road is still on its way: the map holds its place. */
      roadPending: boolean;
    };

/** Gathers the Race screen's inputs; `carsAt` and the model do the rest. */
export function useRaceData(sessionId: string): RaceData {
  const session = useSession(sessionId);
  const laps = useSessionLaps(sessionId);
  const map = useSessionMap(sessionId);
  const surface = useSessionSurface(sessionId);
  const detail = session.data;
  const hash = detail?.field?.hash ?? null;
  const field = useField(sessionId, hash);
  const lengthM = map.data?.lengthM ?? 0;
  const [refTrace] = useLapTraces(detail?.bestLapId ? [detail.bestLapId] : [], {
    lengthM,
    stepM: GRID_STEP_M,
  });
  const prep = useMemo(
    () => (field.data ? prepareRace(field.data) : null),
    [field.data],
  );
  const clock = useMemo(
    () => (field.data ? raceClock(field.data) : null),
    [field.data],
  );
  const placer = useMemo(
    () => mapPlacer(map.data ?? null, surface.data ?? null),
    [map.data, surface.data],
  );
  const noBestLap = detail != null && !detail.bestLapId;
  const line = useMemo(() => {
    if (refTrace && refTrace.lat.length > 2) {
      return placer.place(refTrace, 0, refTrace.lat.length - 1, 1);
    }
    // No timed lap to draw the track from: the player's own path will do.
    const player = field.data?.cars.find(c => c.player);
    if (!noBestLap || !player) return null;
    const pts = [];
    for (let u = 0; u < player.xM.length; u += MATCH_STEP) {
      if (!Number.isNaN(player.xM[u]))
        pts.push({x: player.xM[u], z: player.zM[u]});
    }
    return pts.length > 2 ? placer.placeWorld(pts) : null;
  }, [refTrace, placer, noBestLap, field.data]);
  const matchM = useMemo(() => {
    const player = field.data?.cars.find(c => c.player);
    if (!player || !line) return null;
    const pts = [];
    for (let u = 0; u < player.xM.length; u += MATCH_STEP) {
      if (!Number.isNaN(player.xM[u]))
        pts.push({x: player.xM[u], z: player.zM[u]});
    }
    return worldMatchM(placer.placeWorld(pts), line);
  }, [field.data, line, placer]);

  if (session.isPending) return {kind: 'loading'};
  if (!detail) return {kind: 'error', message: 'Could not load this session.'};
  const title = `${shortTrackName(detail.track)} · ${
    SESSION_TITLE[detail.sessionType]
  }`;
  if (hash === null) return {kind: 'no-field', title};
  if (field.isError) {
    return {kind: 'field-error', title, retry: () => void field.refetch()};
  }
  // Lap numbers are needed to open on Compare's cursor; a failed laps request
  // only means the clock opens at the start.
  if (!prep || !clock || !line || laps.isPending) {
    return {kind: 'field-loading', title};
  }
  return {
    kind: 'ready',
    title,
    mode: detail.sessionType === 'R' ? 'race' : 'field',
    prep,
    clock,
    laps: (laps.data ?? []).map(l => ({id: l.id, lapNumber: l.lapNumber})),
    placer,
    line,
    outlineUse: refTrace
      ? placer.outlineUse(refTrace)
      : {used: placer.outline, unused: []},
    matches: worldMatches(matchM),
    matchM,
    attribution: map.data?.attribution ?? null,
    roadPending: surface.isPending,
  };
}
