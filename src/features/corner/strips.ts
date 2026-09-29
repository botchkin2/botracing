// Corner screen dot strips (handoff §4, pit-wall thread 27 #621/#622/#678):
// one measure across many laps. Each strip carries its scale (min and max
// labels, with the pedal resolution where known), a p10–90 band and median,
// and direction words in the axis's own order: position measures (brake,
// full throttle) run in track order, left = earlier on the lap; values run
// low to high. Nothing is flipped to put "better" on one side.

export type StripMeasure =
  | 'time'
  | 'brake'
  | 'minSpeed'
  | 'apexSpeed'
  | 'throttle';

/** One lap's inputs for the strips. */
export type StripLap = {
  lapId: string;
  label: string;
  /** Colour slot when the lap is on (0 = reference), else null. */
  onIndex: number | null;
  timeS: number | null;
  /** Metres before the apex. */
  brakeM: number | null;
  minSpeedKph: number | null;
  /** Min speed sat on the corner's edge: a boundary value, not the corner's. */
  minSpeedAtEdge: boolean;
  /** Full throttle at the search edge: flat through, not a real point. */
  throttleAtEdge: boolean;
  apexSpeedKph: number | null;
  /** Metres after the apex. */
  throttleM: number | null;
  brakeResM: number | null;
  throttleResM: number | null;
};

export type StripDot = {
  lapId: string;
  value: number;
  onIndex: number | null;
  /** A boundary value (min speed or full throttle at the edge): drawn grey. */
  flagged: boolean;
};

export type StripModel = {
  measure: StripMeasure;
  label: string;
  unit: string;
  min: number;
  max: number;
  minLabel: string;
  maxLabel: string;
  /** "±1.2 m": the median sample spacing, where it is recorded. */
  resolution: string | null;
  /** Values closer than this are the same point on the strip. */
  coincidentWithin: number;
  /** Left end = max (brake: more metres before the apex = earlier). */
  flipped: boolean;
  leftWord: string;
  rightWord: string;
  band: {p10: number; p50: number; p90: number} | null;
  summary: string;
  /** No lap has this measure here (a corner taken without braking). */
  empty: boolean;
  /** Shown under the title when most laps hit the boundary. */
  note: string | null;
  /** The on laps' values, for the line beside the title. */
  keyValues: {onIndex: number; text: string}[];
  dots: StripDot[];
};

// More than half the laps flagged: the min-speed strip shows the boundary,
// so show apex speed instead (pitlane, thread 27 #678).
const EDGE_SHARE_FOR_APEX = 0.5;

type Spec = {
  measure: StripMeasure;
  label: string;
  unit: string;
  value: (l: StripLap) => number | null;
  res: (l: StripLap) => number | null;
  flipped: boolean;
  leftWord: string;
  rightWord: string;
  fmt: (v: number) => string;
};

const whole = (v: number) => `${Math.round(v)}`;

const SPECS: Record<StripMeasure, Spec> = {
  time: {
    measure: 'time',
    label: 'Time in corner',
    unit: 's',
    value: l => l.timeS,
    res: () => null,
    flipped: false,
    leftWord: 'less',
    rightWord: 'more',
    fmt: v => v.toFixed(3),
  },
  brake: {
    measure: 'brake',
    label: 'Brake point',
    unit: 'm before apex',
    value: l => l.brakeM,
    res: l => l.brakeResM,
    flipped: true,
    leftWord: 'earlier',
    rightWord: 'later',
    fmt: whole,
  },
  minSpeed: {
    measure: 'minSpeed',
    label: 'Min speed',
    unit: 'km/h',
    value: l => l.minSpeedKph,
    res: () => null,
    flipped: false,
    leftWord: 'slower',
    rightWord: 'faster',
    fmt: whole,
  },
  apexSpeed: {
    measure: 'apexSpeed',
    label: 'Apex speed',
    unit: 'km/h',
    value: l => l.apexSpeedKph,
    res: () => null,
    flipped: false,
    leftWord: 'slower',
    rightWord: 'faster',
    fmt: whole,
  },
  throttle: {
    measure: 'throttle',
    label: 'Full throttle',
    unit: 'm after apex',
    value: l => l.throttleM,
    res: l => l.throttleResM,
    flipped: false,
    leftWord: 'earlier',
    rightWord: 'later',
    fmt: whole,
  },
};

export function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return NaN;
  const i = (sorted.length - 1) * q;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}

/** Which speed strip a corner gets: min speed, unless it is mostly an edge. */
export function speedMeasure(laps: StripLap[]): 'minSpeed' | 'apexSpeed' {
  const withMin = laps.filter(l => l.minSpeedKph != null);
  const edge = withMin.filter(l => l.minSpeedAtEdge).length;
  const hasApex = laps.some(l => l.apexSpeedKph != null);
  return hasApex &&
    withMin.length > 0 &&
    edge / withMin.length > EDGE_SHARE_FOR_APEX
    ? 'apexSpeed'
    : 'minSpeed';
}

export function buildStrips(laps: StripLap[]): StripModel[] {
  const measures: StripMeasure[] = [
    'time',
    'brake',
    speedMeasure(laps),
    'throttle',
  ];
  return measures.map(m => buildStrip(SPECS[m], laps));
}

function buildStrip(spec: Spec, laps: StripLap[]): StripModel {
  const dots: StripDot[] = [];
  for (const l of laps) {
    const v = spec.value(l);
    if (v == null) continue;
    dots.push({
      lapId: l.lapId,
      value: v,
      onIndex: l.onIndex,
      flagged:
        (spec.measure === 'minSpeed' && l.minSpeedAtEdge) ||
        (spec.measure === 'throttle' && l.throttleAtEdge),
    });
  }
  const vals = dots.map(d => d.value).sort((a, b) => a - b);
  const res = laps
    .map(spec.res)
    .filter((r): r is number => r != null)
    .sort((a, b) => a - b);
  const resM = res.length ? quantile(res, 0.5) : null;
  const min = vals[0] ?? 0;
  const max = vals[vals.length - 1] ?? 1;
  const band =
    vals.length >= 3
      ? {
          p10: quantile(vals, 0.1),
          p50: quantile(vals, 0.5),
          p90: quantile(vals, 0.9),
        }
      : null;
  const keyValues = laps
    .filter(l => l.onIndex != null && spec.value(l) != null)
    .sort((a, b) => (a.onIndex as number) - (b.onIndex as number))
    .map(l => ({
      onIndex: l.onIndex as number,
      text: `${l.label} ${spec.fmt(spec.value(l) as number)}`,
    }));
  return {
    measure: spec.measure,
    label: spec.label,
    unit: spec.unit,
    min,
    max,
    minLabel: spec.fmt(min),
    maxLabel: spec.fmt(max),
    resolution: resM == null ? null : `±${resM.toFixed(1)} m`,
    coincidentWithin: resM ?? 0,
    flipped: spec.flipped,
    leftWord: spec.leftWord,
    rightWord: spec.rightWord,
    band,
    summary: band
      ? `med ${spec.fmt(band.p50)} · p10–90 ${spec.fmt(band.p10)}–${spec.fmt(
          band.p90,
        )}`
      : '',
    keyValues,
    empty: dots.length === 0,
    note:
      spec.measure === 'throttle' &&
      dots.length > 0 &&
      dots.filter(d => d.flagged).length / dots.length > EDGE_SHARE_FOR_APEX
        ? 'Flat through this turn on most laps: their full-throttle point is where the search starts, not a real point.'
        : null,
    dots,
  };
}
