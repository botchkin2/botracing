// The two producers of `SegmentTimes` (src/analysis/segments.ts): our turn
// sections, cut from the layout's corner windows, and the game's sectors,
// whose times every lap carries. The Settings toggle picks one in
// `segmentTimesFor`; nothing downstream knows which it got.
import {
  type Segment,
  type SectionMode,
  type SegmentLap,
  type SegmentTimes,
  turnRangeLabel,
} from '@/src/analysis/segments';

import type {
  Lap,
  LapTraffic,
  MapCorner,
  MapSection,
  TrackMapData,
} from './adapters';
import {frameOf, isCurrent, windowTimesOf} from './windowOptimum';

const START_LABEL = 'S/F';

/** "T4" or "T2–5": the corners a section holds, by the same names the Corner screen uses. */
function sectionLabel(s: MapSection): string {
  const name = (c: MapCorner) => c.official ?? `T${c.n}`;
  return turnRangeLabel((s.parts.length ? s.parts : [s]).map(name));
}

/**
 * Per segment: false where a car was within 1 s ahead or the lap was in a
 * tow. The spans are in the field's lap distance; segments are in the map's
 * frame, so the spans are scaled by the ratio of the two lap lengths. Without
 * a traffic block or the field's lap length nothing can be told, so nothing is
 * left out.
 */
export function aloneIn(
  traffic: LapTraffic | null,
  mapLengthM: number,
  segments: Segment[],
): boolean[] | undefined {
  if (!traffic || !traffic.fieldLapM || traffic.fieldLapM <= 0)
    return undefined;
  const k = mapLengthM / traffic.fieldLapM;
  const spans = [...traffic.aheadSpans, ...traffic.draftSpans];
  return segments.map(seg => {
    const range = seg.range;
    if (!range) return true;
    return !spans.some(
      sp => sp.fromM * k < range.toM && sp.toM * k > range.fromM,
    );
  });
}

/** One segment per corner window, in lap order; null before the track has windows or when no lap was cut at them. */
export function turnSegmentTimes(
  laps: Lap[],
  map: TrackMapData,
): SegmentTimes | null {
  const frame = frameOf(map);
  if (!frame) return null;
  const sections = new Map(map.sections.map(s => [s.n, s]));
  const segments: Segment[] = frame.boundaries.windows.map(w => {
    const section = w.section == null ? undefined : sections.get(w.section);
    return {
      label:
        w.kind === 'start-straight' || !section
          ? START_LABEL
          : sectionLabel(section),
      range: {fromM: w.fromM, toM: w.toM},
    };
  });
  const out: SegmentLap[] = [];
  for (const lap of laps) {
    if (!isCurrent(lap, frame.boundaries)) continue;
    out.push({
      id: lap.id,
      stint: lap.stint,
      comparable: lap.comparable,
      timesS: windowTimesOf(lap, frame),
      alone: aloneIn(lap.traffic, map.lengthM, segments),
    });
  }
  return out.length > 0 ? {segments, laps: out} : null;
}

/** S1, S2, S3 from the game's own sector times; null when no lap has them. */
export function sectorSegmentTimes(laps: Lap[]): SegmentTimes | null {
  const count = Math.max(0, ...laps.map(l => l.sectorsS.length));
  if (count === 0) return null;
  const out: SegmentLap[] = laps.map(l => ({
    id: l.id,
    stint: l.stint,
    comparable: l.comparable,
    timesS: Array.from({length: count}, (_, i) => l.sectorsS[i] ?? null),
  }));
  return {
    segments: Array.from({length: count}, (_, i) => ({
      label: `S${i + 1}`,
      range: null,
    })),
    laps: out,
  };
}

/**
 * The segments the Settings toggle asks for. Turns need the layout's corner
 * windows, which a track has only after its sessions are resynced; until then
 * the game's sectors stand in, and their S1–S3 labels say so.
 */
export function segmentTimesFor(
  mode: SectionMode,
  laps: Lap[],
  map: TrackMapData | null,
): SegmentTimes | null {
  if (mode === 'turns' && map) {
    const turns = turnSegmentTimes(laps, map);
    if (turns) return turns;
  }
  return sectorSegmentTimes(laps);
}
