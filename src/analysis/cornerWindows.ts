// How far around an apex the Corner screen draws, in metres. Plain TypeScript
// with erasable syntax only: the uploader's slice files (tools/sessions/
// cornerSlices.mjs) take the wider of these as their own window, so a screen
// can never ask for track the slice does not hold.
//
// Changing any of these changes what the uploader writes: the slices carry
// their own `windowM`, and a changed window needs a bump of the corner block's
// version (`blockVersions.cornerBoundaries` in tools/sessions/analyze.mjs; the
// slice format stays 1), then a resync before the screen can use the wider
// window.

// Zoomed traces: 250 m before the apex to 150 m after (handoff section 4).
export const ZOOM_BEFORE_M = 250;
export const ZOOM_AFTER_M = 150;

// Braking map: 350 m before the apex to 200 m after (handoff D3).
export const MAP_BEFORE_M = 350;
export const MAP_AFTER_M = 200;

// A corner's own window (pit-wall thread 45, src/analysis/cornerBoundaries.ts)
// can be wider than these. The zoomed traces then run to the window's edges
// plus this pad, so the delta from the boundary and the lines reach them; the
// slice file holds at least as much (tools/sessions/cornerSlices.mjs).
export const WINDOW_PAD_M = 50;
// ...but never more than this far past the zoom window above, so a long
// window (Daytona's T10) does not make a slice of kilometres.
export const WINDOW_EXTRA_M = 300;

/**
 * The zoomed charts' window for a corner: 250 m before its apex to 150 m
 * after, widened to its own window and a pad where that is wider, by at most
 * WINDOW_EXTRA_M each side. `own` is in the same frame as the apex (the
 * window's distances, see `inWindowFrame` in features/corner/stretch.ts);
 * null where the corner has no window of its own.
 */
export function zoomWindowFor(
  apexM: number,
  own: {fromM: number; toM: number} | null,
): [number, number] {
  const from = apexM - ZOOM_BEFORE_M;
  const to = apexM + ZOOM_AFTER_M;
  if (!own) return [from, to];
  return [
    Math.max(from - WINDOW_EXTRA_M, Math.min(from, own.fromM - WINDOW_PAD_M)),
    Math.min(to + WINDOW_EXTRA_M, Math.max(to, own.toM + WINDOW_PAD_M)),
  ];
}
