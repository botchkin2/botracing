// "This capture's field is in the store": after a sync uploads a session, each
// capture folder whose field went with it gets <capture>/uploaded.json
// ({sessionId, uploadedUtc}). The tray's prune (desktop/src-tauri) deletes a
// capture only when this marker exists (pit-wall thread 1, apex #3003); a
// capture without one is never deleted, so a session that did not upload keeps
// its capture.
import {existsSync, renameSync, writeFileSync} from 'node:fs';
import {resolve} from 'node:path';

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
