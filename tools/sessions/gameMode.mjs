// Whether an LMU session was online, from the capture's meta.json `gameMode`
// (the scoring info's mGameMode at open: 0 solo, 1 server, 2 client, 3 both;
// InternalsPlugin.hpp lists 1-3, solo is 0, pit-wall thread 76 #5740). The
// game's own .duckdb does not say, and a missing eventId does not mean offline:
// the trace-log join also fails when the log has aged out.
import {capturesFor, listCaptures} from './field.mjs';

/** true online, false offline, null when the mode says neither. */
export function onlineOfMode(mode) {
  if (mode === 0) return false;
  if (mode === 1 || mode === 2 || mode === 3) return true;
  return null;
}

/**
 * The session's flag from the captures covering it: null with no capture, an
 * unreadable mode, or captures that disagree (never a guess).
 */
export function onlineFor(captureRoot, session) {
  const flags = new Set(
    capturesFor(listCaptures(captureRoot), session).map(c =>
      onlineOfMode(c.meta.gameMode),
    ),
  );
  return flags.size === 1 ? [...flags][0] : null;
}
