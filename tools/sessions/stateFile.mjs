// Reads a JSON state file that a power cut may have left unreadable (ticket 86,
// pit-wall thread 142). The last good copy is `<path>.bak` (replaceFile.mjs
// `backup`). An unreadable file is never deleted: it is kept as
// `<path>.corrupt-<time>`, so nothing a person might still read is lost.
import {copyFileSync, existsSync, readFileSync} from 'node:fs';

import {renameWithRetry} from './replaceFile.mjs';

const stamp = now => now.toISOString().replace(/[:.]/g, '-');

function readJson(path) {
  try {
    return {value: JSON.parse(readFileSync(path, 'utf8'))};
  } catch {
    return null;
  }
}

/**
 * {value, source, keptAs}: source is 'file' (read as is), 'missing' (no file),
 * 'backup' (the file was unreadable or gone and the .bak was used, the file
 * restored from it) or 'unreadable' (neither could be read: value is null, the
 * caller starts fresh). `keptAs` is where an unreadable file went. `now` is a
 * seam. A missing file with a whole .bak restores: a crash between the bad
 * file's move aside and the copy back, or a first write whose rename never
 * landed, leaves exactly that.
 */
export function readStateFile(path, {now = () => new Date()} = {}) {
  if (!existsSync(path)) {
    const backup = readJson(`${path}.bak`);
    if (!backup) return {value: null, source: 'missing', keptAs: null};
    copyFileSync(`${path}.bak`, path);
    return {value: backup.value, source: 'backup', keptAs: null};
  }
  const read = readJson(path);
  if (read) return {value: read.value, source: 'file', keptAs: null};
  const keptAs = `${path}.corrupt-${stamp(now())}`;
  renameWithRetry(path, keptAs);
  const backup = readJson(`${path}.bak`);
  if (backup) {
    // The file is back before anything else reads it, so a restart before the
    // next save does not find it missing and start fresh.
    copyFileSync(`${path}.bak`, path);
    return {value: backup.value, source: 'backup', keptAs};
  }
  return {value: null, source: 'unreadable', keptAs};
}
