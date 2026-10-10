import {useMemo} from 'react';

import {placeFieldOnLine} from '@/src/analysis/fieldOnLine';
import {SURFACE_STEP_M} from '@/src/analysis/trackSurface';
import {raceClock, type RaceClock} from '@/src/analysis/raceClock';
import {type OutlineUse} from '@/src/analysis/outlineUse';
import {
  type MeasuredEdges,
  type RacePrep,
  prepareRace,
} from '@/src/analysis/raceState';
import {measuredHalfWidths} from '@/src/analysis/trackSurface';
import {worldMatches, worldMatchM} from '@/src/analysis/worldMatch';
import {useField} from '@/src/data/field';
import {
  mapPlacer,
  type MapPlacer,
  useSession,
  useSessionBand,
  useSessionLaps,
  useTrackMap,
  useTrackSurface,
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
  const map = useTrackMap(session.data?.trackId);
  const surface = useTrackSurface(session.data?.trackId);
  const detail = session.data;
  const hash = detail?.field?.hash ?? null;
  const field = useField(sessionId, hash);
  const band = useSessionBand(sessionId);
  // A track with no map of its own (iRacing's) still has the lap's length.
  // (Its map document exists but holds no length: 0, not missing.)
  const lengthM = map.data?.lengthM || band.data?.lengthM || 0;
  const [refTrace] = useLapTraces(detail?.bestLapId ? [detail.bestLapId] : [], {
    lengthM,
    stepM: GRID_STEP_M,
  });
  const placer = useMemo(
    () => mapPlacer(map.data ?? null, surface.data ?? null),
    [map.data, surface.data],
  );
  const stored = field.data;
  const noBestLap = detail != null && !detail.bestLapId;
  // The best lap's path, in map metres: the racing line, not the centre path.
  const line = useMemo(() => {
    if (refTrace && refTrace.lat.length > 2) {
      return placer.place(refTrace, 0, refTrace.lat.length - 1, 1);
    }
    return null;
  }, [refTrace, placer]);
  // LMU's centre path is the measured road, in world metres (the surface's own
  // centres, the frame x/z is in), the line pathLateralM is measured from.
  const surfaceStepM = surface.data?.stepM ?? SURFACE_STEP_M;
  const centreWorld = useMemo(() => {
    const bins = surface.data?.bins;
    if (!bins || bins.length < 3) return null;
    const pts = bins.map(b => (b.n ? {x: b.sx / b.n, y: b.sy / b.n} : null));
    return pts.every(p => p !== null) ? pts : null;
  }, [surface.data]);
  // The best lap in world metres, the frame placed field cars are in: the same
  // points as `line`, before the map projection (placer.traceToWorld).
  const worldLine = useMemo(() => {
    if (refTrace && refTrace.lat.length > 2)
      return placer.traceToWorld(refTrace, 0, refTrace.lat.length - 1, 1);
    return null;
  }, [refTrace, placer]);
  // LMU: cars placed on the world centre path (placeFieldOnLine, world out),
  // else left as their x/z. iRacing: on the best lap's line, in map metres.
  const placed = useMemo(() => {
    if (!stored) return null;
    if (stored.hasPositions)
      return centreWorld
        ? placeFieldOnLine(stored, centreWorld, surfaceStepM, {lateral: true})
        : null;
    return worldLine
      ? placeFieldOnLine(stored, worldLine, GRID_STEP_M, {lateral: false})
      : null;
  }, [stored, centreWorld, surfaceStepM, worldLine]);
  const used = placed ?? (stored?.hasPositions ? stored : null);
  // Off the road is measured from the surface's edges, not a fixed 7.5 m.
  const edges = useMemo((): MeasuredEdges | null => {
    const sf = surface.data;
    const hw = sf ? measuredHalfWidths(sf) : null;
    return sf && hw ? {stepM: sf.stepM, lengthM: sf.lengthM, ...hw} : null;
  }, [surface.data]);
  const prep = useMemo(
    () => (used ? prepareRace(used, edges) : null),
    [used, edges],
  );
  const clock = useMemo(() => (used ? raceClock(used) : null), [used]);
  const matchM = useMemo(() => {
    // iRacing placed on the line: on it by construction.
    if (placed && !stored?.hasPositions) return 0;
    const player = field.data?.cars.find(c => c.player);
    if (!player || !line) return null;
    const pts = [];
    for (let u = 0; u < player.xM.length; u += MATCH_STEP) {
      if (!Number.isNaN(player.xM[u]))
        pts.push({x: player.xM[u], z: player.zM[u]});
    }
    return worldMatchM(placer.placeWorld(pts), line);
  }, [field.data, line, placer, placed]);

  if (session.isPending) return {kind: 'loading'};
  if (!detail) return {kind: 'error', message: 'Could not load this session.'};
  const title = `${shortTrackName(detail.track)} · ${
    SESSION_TITLE[detail.sessionType]
  }`;
  if (hash === null) return {kind: 'no-field', title};
  if (field.isError) {
    return {kind: 'field-error', title, retry: () => void field.refetch()};
  }
  // No positions and no line to put the cars on (no timed lap to draw it
  // from): there is nothing to draw them with.
  if (stored && !stored.hasPositions && !line && !refTrace && noBestLap)
    return {kind: 'no-field', title};
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
