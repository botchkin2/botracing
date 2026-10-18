// The one place a session's capture extract is made from its capture
// (captureExtract.mjs): the live path on every lap (liveInputs.mjs) and the
// extract backlog for stored sessions (sync.mjs) both call it, so the damage,
// race length and online flag are decided once.
import {existsSync, readFileSync} from 'node:fs';
import {resolve} from 'node:path';

import {captureExtract} from './captureExtract.mjs';
import {onlineFor} from './gameMode.mjs';
import {sessionTypeOf} from './lmuCapture.mjs';
import {damageFor} from './playerDamage.mjs';
import {raceLengthFor} from './raceLength.mjs';

/**
 * The extract of the session `span` ({tracks, startMs, endMs}) covers, or null
 * when the capture gave nothing. `sim`, `sessionType`: the session's.
 */
export function captureExtractFor(captureRoot, span, {sim, sessionType}) {
  const lmu = sim === 'lmu';
  return captureExtract({
    damage: damageFor(captureRoot, span),
    raceLength:
      lmu && /^r/i.test(sessionType ?? '')
        ? raceLengthFor(captureRoot, span)
        : null,
    online: lmu ? onlineFor(captureRoot, span) : null,
  });
}

/**
 * The live-uploaded LMU sessions, one per sessionId in the live index, as
 * {id, sim, sessionType, span}. The span's track names come from the capture's
 * meta.json (the index keeps only the layout); a capture that is gone gives
 * the layout alone, which matches no capture and so yields no extract. An
 * entry from before the index kept the session type reads it from the
 * capture's session number: without it a race's length would go up as null.
 */
export function liveExtractSessions(liveIndex, captureRoot) {
  const out = new Map();
  for (const [key, e] of Object.entries(liveIndex ?? {})) {
    if (e.sim !== 'lmu') continue;
    const metaPath = resolve(captureRoot, key.split('#')[0], 'meta.json');
    let track = null;
    let sessionType = e.sessionType ?? '';
    try {
      if (existsSync(metaPath)) {
        const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
        track = meta.track ?? null;
        sessionType ||= sessionTypeOf(Number(meta.session)) ?? '';
      }
    } catch {
      // A capture being written: its extract waits for the next run.
    }
    const tracks = [track, e.layout].filter(Boolean);
    const seen = out.get(e.sessionId);
    if (!seen)
      out.set(e.sessionId, {
        id: e.sessionId,
        sim: e.sim,
        sessionType,
        span: {tracks, startMs: e.startMs, endMs: e.endMs},
      });
    else {
      seen.span.tracks = [...new Set([...seen.span.tracks, ...tracks])];
      seen.span.startMs = Math.min(seen.span.startMs, e.startMs);
      seen.span.endMs = Math.max(seen.span.endMs, e.endMs);
    }
  }
  return [...out.values()];
}
