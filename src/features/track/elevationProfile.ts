// The Track page's height line (pit-wall thread 86): the track's curated height
// along the lap with each corner section's window shaded on it. Pure: the model
// holds metres, the geometry turns them into points for a given size.

import {fitScale, type Tick} from '@/src/charts/scale';
import {withUnit} from '@/src/charts/tickFormat';
import {type TrackMapData} from '@/src/data/sessions';

export type ElevationModel = {
  stepM: number;
  heightM: number[];
  lengthM: number;
  /** Each section's own window, metres from the line. */
  bands: {fromM: number; toM: number}[];
};

/** The profile for a track's stored map; null where no height is curated, so the page shows nothing. */
export function buildElevation(
  map: TrackMapData | null,
): ElevationModel | null {
  const e = map?.elevation;
  if (!map || !e || e.heightM.length < 2 || map.lengthM <= 0) return null;
  return {
    stepM: e.stepM,
    heightM: e.heightM,
    lengthM: map.lengthM,
    // A section runs from its entry to its exit; one over the line is cut in two.
    bands: map.sections.flatMap(s =>
      s.exitM >= s.entryM
        ? [{fromM: s.entryM, toM: s.exitM}]
        : [
            {fromM: s.entryM, toM: map.lengthM},
            {fromM: 0, toM: s.exitM},
          ],
    ),
  };
}

export type ElevationPlot = {
  /** SVG path of the height line. */
  path: string;
  bands: {x: number; width: number}[];
  ticks: (Tick & {y: number})[];
  /** The lap's two ends on the x axis. */
  endsM: [number, number];
  lo: number;
  hi: number;
};

/**
 * The line and bands for a plot box: x is lap distance across `plotW` from
 * `left`, y the height across `plotH` from `top` (a higher point is higher up),
 * on a fitted scale in 1-2-5 steps (src/charts/scale.ts).
 */
export function plotElevation(
  m: ElevationModel,
  box: {left: number; top: number; plotW: number; plotH: number},
): ElevationPlot {
  const scale = fitScale(m.heightM, {symmetric: false, format: withUnit('m')});
  const x = (d: number) => box.left + (d / m.lengthM) * box.plotW;
  const y = (h: number) =>
    box.top + ((scale.hi - h) / (scale.hi - scale.lo)) * box.plotH;
  const round = (v: number) => Math.round(v * 10) / 10;
  const path = m.heightM
    .map((h, i) => {
      const at = round(x(Math.min(i * m.stepM, m.lengthM)));
      return `${i === 0 ? 'M' : 'L'}${at} ${round(y(h))}`;
    })
    .join(' ');
  return {
    path,
    bands: m.bands.map(b => ({
      x: round(x(b.fromM)),
      width: round(x(b.toM) - x(b.fromM)),
    })),
    ticks: scale.ticks.map(t => ({...t, y: round(y(t.v))})),
    endsM: [0, m.lengthM],
    lo: scale.lo,
    hi: scale.hi,
  };
}
