// iRacing archives written before the samples had their types given
// (iracing.mjs samplesCsvToParquet): a channel DuckDB's CSV sniffer guessed as
// whole numbers was rounded, e.g. tyre wear 98.51 stored as 99 (pit-wall
// thread 1 #4842, #4851). Once per uploaded session whose recordings are still
// on the PC, the samples are written again; a file the old types would have
// rounded (writeArchive's `rounded`) goes up in place of the stored one when
// their bytes differ, and the session then reads stale, so the next open
// analyses it from the repaired archive. Recorded in state.archiveRepair and
// saved per session, so a stopped run resumes and nothing is sent twice.
import {mkdirSync, rmSync} from 'node:fs';
import {resolve} from 'node:path';

export const ARCHIVE_REPAIR = 1;

/** Returns how many sessions were repaired. */
export async function repairArchives({
  sessions,
  state,
  store,
  writeArchive,
  dir,
  save,
  sim,
  ownerId,
  log = () => {},
}) {
  state.archiveRepair ??= {};
  mkdirSync(dir, {recursive: true});
  let repaired = 0;
  for (const s of sessions) {
    if (!state.sessions[s.id] || state.archiveRepair[s.id] === ARCHIVE_REPAIR)
      continue;
    try {
      if (await repairOne(s, {store, writeArchive, dir, sim, ownerId}))
        repaired++;
    } catch (error) {
      // Not recorded: the next sync tries this session again. Never stops
      // the sync around it.
      const why = String(error.message || error).split('\n')[0];
      log(`archive repair ${s.id}: ${why}`);
      continue;
    }
    state.archiveRepair[s.id] = ARCHIVE_REPAIR;
    save();
  }
  return repaired;
}

async function repairOne(s, {store, writeArchive, dir, sim, ownerId}) {
  let changed = false;
  for (const f of s.files) {
    const samples = resolve(dir, `${f.id}.samples.parquet`);
    const events = resolve(dir, `${f.id}.events.parquet`);
    try {
      const {rounded} = writeArchive(f.path, f.info, samples, events);
      // Nothing the old guessed types rounded: the stored file is right.
      if (rounded.length === 0) continue;
      // The path every upload writes (sync.mjs build); analysis on open
      // reads it under the owner's folder (analyzeStored.mjs archivePath).
      const dest = `archive/${sim}/${s.id}/${f.id}/samples.parquet`;
      // Sent only when the stored bytes differ, but stale either way: a run
      // that put the file and then failed before marking it leaves the same
      // bytes behind, and the session must still be analysed again.
      await store.replaceArchiveFile(dest, samples);
      changed = true;
    } finally {
      rmSync(samples, {force: true});
      rmSync(events, {force: true});
    }
  }
  if (changed) await store.markStale(s.id, ownerId);
  return changed;
}
