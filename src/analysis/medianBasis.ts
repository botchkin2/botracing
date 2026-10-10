import {type GridTrace, medianTrace} from './resample';

/**
 * The median trace of the laps whose traces are in: the basis Compare and
 * Corner measure against when no Ref lap is picked. Pure; the caller memoizes.
 */
export function medianBasisOf(
  laps: {id: string; timeS: number | null}[],
  traces: Map<string, GridTrace>,
): GridTrace | undefined {
  const loaded = laps.filter(l => traces.has(l.id));
  if (loaded.length === 0) return undefined;
  const times = loaded.map(l => l.timeS);
  return medianTrace(
    loaded.map(l => traces.get(l.id)!),
    times.every((t): t is number => t != null) ? times : undefined,
  );
}
