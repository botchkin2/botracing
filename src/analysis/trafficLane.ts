// What the Compare traffic lane draws for one lap (round 7, 2C/2D): where a
// car was within 1 s ahead, and where faster-class cars and passes were, in
// Compare's own distance frame. The uploader stores them in the field's lap
// distance (tools/sessions/fieldTags.mjs); this scales them by the map length
// over the field's lap length, lap fraction times map length, the same step
// the corner slices take (setup, pit-wall thread 44 #1634).
//
// Plain TypeScript with erasable syntax only, no imports: Node can run it.

export interface LaneInput {
  /** Runs with a car within 1 s ahead. */
  aheadSpans: {fromM: number; toM: number; s: number}[];
  /** Faster-class cars that went from behind to ahead: where, on the player's lap. */
  overtakes: {atM: number}[];
  /** Own-class passes: where, and whether the player made them. */
  passMarks: {atM: number; made: boolean}[];
  /** The field's lap length; null before it was stored. */
  fieldLapM: number | null;
}

export interface LaneRow {
  /** Spans in Compare's frame, from before to to, clipped to the lap. */
  ahead: [number, number][];
  ticks: {m: number; kind: 'blue' | 'pass'}[];
}

/** Null when the lap has no lap length to scale by (analysed before it was stored). */
export function laneRowOf(
  traffic: LaneInput | null,
  mapLengthM: number,
): LaneRow | null {
  if (!traffic || !traffic.fieldLapM || mapLengthM <= 0) return null;
  const k = mapLengthM / traffic.fieldLapM;
  const clip = (m: number) => Math.min(mapLengthM, Math.max(0, m * k));
  const ahead: [number, number][] = [];
  for (const {fromM: from, toM: to} of traffic.aheadSpans) {
    // A span wholly before the line (the race-start roll) or after the lap is
    // not on this lap's axis.
    if (to <= 0 || from >= traffic.fieldLapM) continue;
    ahead.push([clip(from), clip(to)]);
  }
  const ticks: LaneRow['ticks'] = [
    ...traffic.overtakes.map(o => ({m: clip(o.atM), kind: 'blue' as const})),
    ...traffic.passMarks.map(p => ({m: clip(p.atM), kind: 'pass' as const})),
  ].sort((a, b) => a.m - b.m);
  return {ahead, ticks};
}
