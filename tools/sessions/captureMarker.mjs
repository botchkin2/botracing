// "What this capture gave is in the store". After a sync uploads a session,
// every capture folder that session read (field, damage, race length, the
// player stream) gets <capture>/uploaded.json ({sessionId, uploadedUtc}). The
// tray's prune (desktop/src-tauri) deletes a capture that has the marker once
// it is old or over the size cap (pit-wall thread 1, apex #3003, #3007). One
// without it is one no uploaded session ever read (a menu or a replay that
// slipped through), which the prune may also delete once it is old.
import {existsSync, renameSync, writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {capturesFor, listCaptures} from './field.mjs';
import {iracingCapturesFor, listIracingCaptures} from './irCapture.mjs';

export const MARKER = 'uploaded.json';

/**
 * Marks the named captures under `root` as uploaded for `sessionId`. Returns
 * the names marked; a folder that is gone (pruned, moved) is skipped.
 */
export function markUploaded(root, names, sessionId, now = new Date()) {
  const marked = [];
  for (const name of names ?? []) {
    const dir = resolve(root, name);
    if (!existsSync(resolve(dir, 'meta.json'))) continue;
    const file = resolve(dir, MARKER);
    const tmp = `${file}.tmp`;
    writeFileSync(
      tmp,
      JSON.stringify({sessionId, uploadedUtc: now.toISOString()}),
    );
    renameSync(tmp, file);
    marked.push(name);
  }
  return marked;
}

/**
 * The names of the captures a session read: those of its sim whose track and
 * time overlap it. `span` is {tracks, startMs, endMs} as sync builds it.
 */
export function capturesRead(root, sim, span) {
  const found =
    sim === 'iracing'
      ? iracingCapturesFor(listIracingCaptures(root), {
          track: span.tracks[0],
          startMs: span.startMs,
          endMs: span.endMs,
        })
      : capturesFor(listCaptures(root), span);
  return found.map(c => c.name);
}
