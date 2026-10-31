// Write a file whole, never half: to a temp file, flushed to disk, renamed over
// the old one. The flush matters after a power cut: NTFS can persist the rename
// before the data, leaving a zero-length file (pit-wall thread 136 #8613, ticket
// 86; inferred, not seen). With `backup`, the file being replaced is first kept
// as `<path>.bak` when it parses as JSON, so a later unreadable file can recover
// from the last good one (stateFile.mjs).
// On Windows the rename fails with EPERM, EACCES or EBUSY while another
// process holds the old file open for a moment (a virus scanner, the tray
// reading it): a sync crashed on exactly that in the contract replay
// (contract/README.md, sync.mjs saveState). The lock is brief, so the rename
// is tried again for up to about a second before the error stands.

import {
  closeSync,
  existsSync,
  fsyncSync,
  openSync,
  readFileSync,
  renameSync,
  writeSync,
} from 'node:fs';

const LOCKED = new Set(['EPERM', 'EACCES', 'EBUSY']);
const TRIES = 40;
const WAIT_MS = 25;

const pause = ms =>
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/** The file's text when it exists and holds JSON, else null. */
function wholeText(path) {
  try {
    const text = readFileSync(path, 'utf8');
    JSON.parse(text);
    return text;
  } catch {
    return null;
  }
}

/** `rename`, tried again for about a second while the OS holds the file. */
export function renameWithRetry(from, to, {rename = renameSync, wait = pause} = {}) {
  for (let i = 1; ; i++) {
    try {
      rename(from, to);
      return;
    } catch (err) {
      if (!LOCKED.has(err?.code) || i >= TRIES) throw err;
      wait(WAIT_MS);
    }
  }
}

/**
 * Replaces `path` with `text`; `rename`, `wait` and `fsync` are test seams. The
 * `.bak` is written the same way (flushed, then renamed), so the cut it guards
 * against cannot tear it either; a backup that cannot be made never fails the
 * write.
 */
export function replaceFile(
  path,
  text,
  {rename = renameSync, wait = pause, fsync = fsyncSync, backup = false} = {},
) {
  const tmp = `${path}.tmp`;
  const fd = openSync(tmp, 'w');
  try {
    writeSync(fd, text);
    fsync(fd);
  } finally {
    closeSync(fd);
  }
  if (backup && existsSync(path)) {
    const current = wholeText(path);
    if (current !== null) {
      try {
        replaceFile(`${path}.bak`, current, {rename, wait, fsync});
      } catch {
        // The file being replaced is still whole; the write goes on.
      }
    }
  }
  renameWithRetry(tmp, path, {rename, wait});
}
