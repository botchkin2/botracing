// Reads a JSON state file that a power cut may have left unreadable (ticket 86,
// pit-wall thread 142). The last good copy is `<path>.bak` (replaceFile.mjs
// `backup`). An unreadable file is never deleted: it is kept as
// `<path>.corrupt-<time>`, so nothing a person might still read is lost.
import {copyFileSync, existsSync, readFileSync, renameSync} from 'node:fs';

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
 * 'backup' (the file was unreadable and the .bak was used, the file restored
 * from it) or 'unreadable' (neither could be read: value is null, the caller
 * starts fresh). `keptAs` is where an unreadable file went. `now` is a seam.
 */
export function readStateFile(path, {now = () => new Date()} = {}) {
  if (!existsSync(path)) return {value: null, source: 'missing', keptAs: null};
  const read = readJson(path);
  if (read) return {value: read.value, source: 'file', keptAs: null};
  const keptAs = `${path}.corrupt-${stamp(now())}`;
  renameSync(path, keptAs);
  const backup = readJson(`${path}.bak`);
  if (backup) {
    // The file is back before anything else reads it, so a restart before the
    // next save does not find it missing and start fresh.
    copyFileSync(`${path}.bak`, path);
    return {value: backup.value, source: 'backup', keptAs};
  }
  return {value: null, source: 'unreadable', keptAs};
}
