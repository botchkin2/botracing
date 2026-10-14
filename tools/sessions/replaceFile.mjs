// Write a file whole, never half: to a temp file, renamed over the old one.
// On Windows the rename fails with EPERM, EACCES or EBUSY while another
// process holds the old file open for a moment (a virus scanner, the tray
// reading it): a sync crashed on exactly that in the contract replay
// (contract/README.md, sync.mjs saveState). The lock is brief, so the rename
// is tried again for up to about a second before the error stands.

import {renameSync, writeFileSync} from 'node:fs';

const LOCKED = new Set(['EPERM', 'EACCES', 'EBUSY']);
const TRIES = 40;
const WAIT_MS = 25;

const pause = ms =>
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/** Replaces `path` with `text`; `rename` and `wait` are test seams. */
export function replaceFile(
  path,
  text,
  {rename = renameSync, wait = pause} = {},
) {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, text);
  for (let i = 1; ; i++) {
    try {
      rename(tmp, path);
      return;
    } catch (err) {
      if (!LOCKED.has(err?.code) || i >= TRIES) throw err;
      wait(WAIT_MS);
    }
  }
}
