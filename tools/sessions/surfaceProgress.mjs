// The one place the surface fold's progress line is defined. surface.mjs prints
// it, syncOutput.mjs reads it, and the watcher's trigger asks syncOutput:
// three files that must agree on the format (steward, pit-wall thread 44 #1499).
//
// Plain JavaScript, no imports.

/** "surface 7/13 tracks": 7 tracks finished of the 13 that have a length. */
export const surfaceProgressLine = (done, total) =>
  `surface ${done}/${total} tracks`;

const LINE = /^surface (\d+)\/(\d+) tracks$/;

/** {done, total} for a progress line, null for any other line. */
export function readSurfaceProgress(line) {
  const m = line.match(LINE);
  return m ? {done: +m[1], total: +m[2]} : null;
}
