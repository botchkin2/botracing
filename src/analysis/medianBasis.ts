import {type GridTrace, medianTrace} from './resample';

/**
 * The median trace of the laps whose traces are in: the basis Compare and
 * Corner measure against when no Ref lap is picked. Pure; the caller memoizes.
 *
 * `stretch` ends each lap's clock on its official lap time, right for whole
 * laps (Compare). A Corner slice is only a window of the lap: its clock ends
 * where the window does, so stretching it to the lap time would add a made-up
 * ramp of the lap's remaining seconds. Corner passes false.
 */
export function medianBasisOf(
  laps: {id: string; timeS: number | null}[],
  traces: Map<string, GridTrace>,
  stretch = true,
): GridTrace | undefined {
  const loaded = laps.filter(l => traces.has(l.id));
  if (loaded.length === 0) return undefined;
  const times = loaded.map(l => l.timeS);
  return medianTrace(
    loaded.map(l => traces.get(l.id)!),
    stretch && times.every((t): t is number => t != null) ? times : undefined,
  );
}
