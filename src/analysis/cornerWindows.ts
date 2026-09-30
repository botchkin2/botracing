// How far around an apex the Corner screen draws, in metres. Plain TypeScript
// with erasable syntax only: the uploader's slice files (tools/sessions/
// cornerSlices.mjs) take the wider of these as their own window, so a screen
// can never ask for track the slice does not hold.

// Zoomed traces: 250 m before the apex to 150 m after (handoff section 4).
export const ZOOM_BEFORE_M = 250;
export const ZOOM_AFTER_M = 150;

// Braking map: 350 m before the apex to 200 m after (handoff D3).
export const MAP_BEFORE_M = 350;
export const MAP_AFTER_M = 200;
