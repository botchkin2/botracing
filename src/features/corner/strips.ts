// Corner screen dot strips (handoff §4, pit-wall thread 27 #621/#622/#678):
// one measure across many laps. Each strip carries its scale (an axis in 1-2-5
// steps with units on its ticks, D45; the pedal resolution where known), a
// p10–90 band and median,
// and direction words in the axis's own order: position measures (brake,
// full throttle) run in track order, left = earlier on the lap; values run
// low to high. Nothing is flipped to put "better" on one side.
import {fitScale, type Scale} from '@/src/charts/scale';
import {withUnit} from '@/src/charts/tickFormat';
import {quantile} from '@/src/analysis/setStats';
import {formatWhole} from '@/src/design';

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
  /** Already at full throttle at the slowest sample: no point (throttleM is null). */
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
  /** A boundary value (min speed at the edge): drawn grey. */
  flagged: boolean;
};

export type StripModel = {
  measure: StripMeasure;
  label: string;
  unit: string;
  /**
   * The strip's axis (D45): the values' range rounded out to 1-2-5 steps, each
   * tick labelled with its unit ("120 m", "4.20 s", "180 km/h"), so the spread
   * of the dots can be read against a scale.
   */
  scale: Scale;
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
  /** Beside the title: "full throttle by the slowest point: 30 laps", the laps left off. */
  flatNote: string | null;
  dots: StripDot[];
};

// More than half the laps flagged: the min-speed strip shows the boundary,
// so show apex speed instead (pitlane, thread 27 #678).
const EDGE_SHARE_FOR_APEX = 0.5;

type Spec = {
  measure: StripMeasure;
  label: string;
  unit: string;
  /** The unit on each axis tick: the short form of `unit`. */
  tickUnit: string;
  value: (l: StripLap) => number | null;
  res: (l: StripLap) => number | null;
  flipped: boolean;
  leftWord: string;
  rightWord: string;
  fmt: (v: number) => string;
};

const whole = formatWhole;

// Ticks on a phone-wide strip: five keeps "120 m" labels apart at 343 pt.
const STRIP_MAX_TICKS = 5;

const SPECS: Record<StripMeasure, Spec> = {
  time: {
    measure: 'time',
    label: 'Time in corner',
    unit: 's',
    tickUnit: 's',
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
    tickUnit: 'm',
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
    tickUnit: 'km/h',
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
    tickUnit: 'km/h',
    value: l => l.apexSpeedKph,
    res: () => null,
    flipped: false,
    leftWord: 'slower',
    rightWord: 'faster',
    fmt: whole,
  },
  throttle: {
    measure: 'throttle',
    label: 'Full pedal',
    unit: 'm after apex',
    tickUnit: 'm',
    value: l => l.throttleM,
    res: l => l.throttleResM,
    flipped: false,
    leftWord: 'earlier',
    rightWord: 'later',
    fmt: whole,
  },
};

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
      flagged: spec.measure === 'minSpeed' && l.minSpeedAtEdge,
    });
  }
  // Laps already at full throttle at the slowest sample have no point on the
  // full-throttle strip; they are left off it and counted.
  const isFlat = (l: StripLap) =>
    spec.measure === 'throttle' && l.throttleAtEdge;
  const flatLaps = laps.filter(isFlat).length;
  const vals = dots.map(d => d.value).sort((a, b) => a - b);
  const res = laps
    .map(spec.res)
    .filter((r): r is number => r != null)
    .sort((a, b) => a - b);
  const resM = res.length ? quantile(res, 0.5) : null;
  const band =
    vals.length >= 3
      ? {
          p10: quantile(vals, 0.1),
          p50: quantile(vals, 0.5),
          p90: quantile(vals, 0.9),
        }
      : null;
  const flat = flatLaps;
  return {
    measure: spec.measure,
    label: spec.label,
    unit: spec.unit,
    scale: fitScale(vals, {
      symmetric: false,
      maxTicks: STRIP_MAX_TICKS,
      format: withUnit(spec.tickUnit),
    }),
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
    empty: dots.length === 0,
    flatNote:
      flat > 0
        ? `Full pedal by the slowest point: ${flat} of ${laps.length} ${
            laps.length === 1 ? 'lap' : 'laps'
          }`
        : null,
    dots,
  };
}
