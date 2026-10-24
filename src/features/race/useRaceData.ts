import {useCallback, useEffect, useMemo, useState} from 'react';

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
import {readFailure} from '@/src/data/queryState';
import {
  mapPlacer,
  type MapPlacer,
  useSession,
  useSessionBand,
  useSessionLaps,
  useTrackMap,
  useTrackSurface,
} from '@/src/data/sessions';
import {runSliced} from '@/src/analysis/steps';
import {useLapTraceLoad} from '@/src/data/traces';
import {shortTrackName} from '@/src/design';

import {type ChaseWorld, chaseWorldSteps, SLICE_BUDGET_MS, yieldToLoop} from './chaseWorld';
import {raceGate, raceScreenField} from './raceGate';

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
  | {kind: 'no-field'; title: string; why: string | null}
  /** No timed lap: no racing line to put the cars on. */
  | {kind: 'no-lap'; title: string}
  /** A best lap whose trace has no GPS or no length to grid on. */
  | {kind: 'no-line'; title: string}
  /** The best lap's trace failed to load. */
  | {kind: 'line-error'; title: string; retry: () => void}
  | {kind: 'field-loading'; title: string}
  | {kind: 'field-error'; title: string; retry: () => void; offline: boolean}
  | {
      kind: 'ready';
      title: string;
      /** One line when the field was kept and flagged. */
      note: string | null;
      mode: RaceMode;
      prep: RacePrep;
      /** The player's lap and distance at a race time, and back; shared with Compare. */
      clock: RaceClock;
      laps: {id: string; lapNumber: number | null; timeS: number | null}[];
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
      /**
       * What the 3D draws, made on first use: the road fitted from the field in the game's own world frame (analysis/worldRoad), and the
       * field's cars at their own recorded positions (not re-placed on the surface's line); null without positions.
       */
      chase: {
        /** The made world, null until the road is fitted (or when the field cannot give one). */
        world: () => ChaseWorld | null;
        /** The fit is running (3D asked for it, it has not returned): the map shows its placeholder. */
        building: boolean;
        /** Start the fit; the first call is the only one that does anything. */
        request: () => void;
      } | null;
    };

/** Gathers the Race screen's inputs; `carsAt` and the model do the rest. */
export function useRaceData(sessionId: string): RaceData {
  const session = useSession(sessionId);
  const laps = useSessionLaps(sessionId);
  const map = useTrackMap(session.data?.trackId);
  const surface = useTrackSurface(session.data?.trackId);
  const detail = session.data;
  const screenField = raceScreenField(detail);
  const hash = screenField.hash;
  const field = useField(sessionId, hash);
  const band = useSessionBand(sessionId);
  // A track with no map of its own (iRacing's) still has the lap's length.
  // (Its map document exists but holds no length: 0, not missing.)
  const lengthM = map.data?.lengthM || band.data?.lengthM || 0;
  const refLoad = useLapTraceLoad(detail?.bestLapId ? [detail.bestLapId] : [], {
    lengthM,
    stepM: GRID_STEP_M,
  });
  const [refTrace] = refLoad.traces;
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

  // The 3D's road is a second or two of work on a phone: fitted in time slices when the 3D is first asked for, kept for
  // the session. A new field, map or race drops a fit that is running and the road it made.
  const worldInput = useMemo(
    () =>
      stored?.hasPositions && prep
        ? {
            field: stored,
            lapM: prep.trackM,
            edges,
            elevation: map.data?.elevation ?? null,
            elevationLapM: map.data?.lengthM ?? 0,
            bank: map.data?.bank ?? null,
          }
        : null,
    [stored, prep, edges, map.data],
  );
  // asked for this race: another race starts unasked
  const [askedFor, setAskedFor] = useState<string | null>(null);
  const asked = askedFor === sessionId;
  const [made, setMade] = useState<{input: object; world: ChaseWorld | null} | null>(null);
  const request = useCallback(() => setAskedFor(sessionId), [sessionId]);
  useEffect(() => {
    if (!asked || !worldInput) return;
    let stale = false;
    runSliced(
      chaseWorldSteps(worldInput),
      {budgetMs: SLICE_BUDGET_MS, now: () => performance.now(), yieldToLoop},
      () => stale,
    )
      .then(world => {
        if (!stale && world !== undefined) setMade({input: worldInput, world});
      })
      .catch(e => {
        // no road: the map falls back to the track instead of a placeholder that never ends
        console.warn('3D road fit failed', e);
        if (!stale) setMade({input: worldInput, world: null});
      });
    return () => {
      stale = true;
    };
  }, [asked, worldInput]);
  const chase = useMemo(() => {
    if (!worldInput) return null;
    const ready = made !== null && made.input === worldInput;
    return {
      world: () => (ready ? made.world : null),
      building: asked && !ready,
      request,
    };
  }, [worldInput, made, asked, request]);
  const gate = raceGate({
    sessionPending: session.isPending,
    hasDetail: detail != null,
    hasField: hash !== null,
    // A field kept from a good read stays shown when its refetch fails (6b).
    fieldError: readFailure(field) !== null,
    hasBestLap: !noBestLap,
    line: line
      ? 'drawn'
      : refLoad.load.kind === 'failed'
      ? 'failed'
      : (refTrace && refTrace.lat.length <= 2) ||
        (!map.isPending && !band.isPending && lengthM === 0)
      ? 'missing'
      : 'pending',
    readyInputs: !!(prep && clock && !laps.isPending),
  });
  if (gate === 'loading') return {kind: 'loading'};
  if (!detail)
    return {
      kind: 'error',
      message:
        readFailure(session) === 'offline'
          ? 'Offline'
          : 'Could not load this session.',
    };
  const title = `${shortTrackName(detail.track)} · ${
    SESSION_TITLE[detail.sessionType]
  }`;
  if (gate === 'no-field')
    return {
      kind: 'no-field',
      title,
      why: screenField.why,
    };
  if (gate === 'field-error')
    return {
      kind: 'field-error',
      title,
      retry: () => void field.refetch(),
      offline: readFailure(field) === 'offline',
    };
  if (gate === 'no-lap') return {kind: 'no-lap', title};
  if (gate === 'no-line') return {kind: 'no-line', title};
  if (gate === 'line-error')
    return {kind: 'line-error', title, retry: refLoad.retry};
  // The gate is 'ready' only with these; the check is for the types. Lap
  // numbers are needed to open on Compare's cursor; a failed laps request only
  // means the clock opens at the start.
  if (gate !== 'ready' || !prep || !clock || !line)
    return {kind: 'field-loading', title};
  return {
    kind: 'ready',
    title,
    note: detail.field?.note ?? null,
    mode: detail.sessionType === 'R' ? 'race' : 'field',
    prep,
    clock,
    laps: (laps.data ?? []).map(l => ({
      id: l.id,
      lapNumber: l.lapNumber,
      timeS: l.timeS,
    })),
    placer,
    line,
    outlineUse: refTrace
      ? placer.outlineUse(refTrace)
      : {used: placer.outline, unused: []},
    matches: worldMatches(matchM),
    matchM,
    attribution: map.data?.attribution ?? null,
    roadPending: surface.isPending,
    chase,
  };
}
