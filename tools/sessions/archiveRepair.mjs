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
export async function repairArchives({sessions, state, store, writeArchive, dir, save, sim}) {
  state.archiveRepair ??= {};
  mkdirSync(dir, {recursive: true});
  let repaired = 0;
  for (const s of sessions) {
    if (!state.sessions[s.id] || state.archiveRepair[s.id] === ARCHIVE_REPAIR) continue;
    let changed = false;
    for (const f of s.files) {
      const samples = resolve(dir, `${f.id}.samples.parquet`);
      const events = resolve(dir, `${f.id}.events.parquet`);
      try {
        const {rounded} = writeArchive(f.path, f.info, samples, events);
        // Nothing the old guessed types rounded: the stored file is right.
        if (rounded.length === 0) continue;
        const doc = await store.getRecording(f.id);
        const dest =
          doc?.archive?.samples ?? `archive/${sim}/${s.id}/${f.id}/samples.parquet`;
        if (await store.replaceArchiveFile(dest, samples)) changed = true;
      } finally {
        rmSync(samples, {force: true});
        rmSync(events, {force: true});
      }
    }
    if (changed) {
      await store.markStale(s.id);
      repaired++;
    }
    state.archiveRepair[s.id] = ARCHIVE_REPAIR;
    save();
  }
  return repaired;
}
