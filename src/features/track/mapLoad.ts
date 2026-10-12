// What the Track map waits for, and what failed. The map draws from its
// outline and measured surface; the reference lap only adds its own layer. A
// lap still loading holds the page only while there is no outline to show.

export type MapPart =
  | 'the track map'
  | 'the measured surface'
  | 'the reference lap';

export type MapQuery = {pending: boolean; failed: boolean};

export type MapLoadInput = {
  hasRef: boolean;
  /** The map has an outline to draw without a lap. */
  hasOutline: boolean;
  map: MapQuery;
  surface: MapQuery;
  trace: MapQuery;
};

export type MapLoad = {
  /** The outline is still on its way. */
  loading: boolean;
  /** Parts that failed, in the order they matter to the map. */
  failed: MapPart[];
};

export function mapLoadOf(input: MapLoadInput): MapLoad {
  const failed: MapPart[] = [];
  if (input.map.failed) failed.push('the track map');
  if (input.surface.failed) failed.push('the measured surface');
  if (input.trace.failed) failed.push('the reference lap');
  return {
    loading:
      input.hasRef &&
      (input.map.pending ||
        input.surface.pending ||
        (input.trace.pending && !input.hasOutline)),
    failed,
  };
}

/** The one line that says what could not load. */
export function failedText(failed: MapPart[]): string {
  return `Could not load ${failed.join(' and ')}.`;
}
