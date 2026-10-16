// sync.mjs --live <captureDir> (pit-wall thread 66): one capture's finished
// laps up as archive parts while the sim runs (LMU: lmuCapture.mjs, iRacing:
// irLiveCapture.mjs, picked by the capture's meta.json sim). No analysis here: the session doc
// says what the list shows and reads stale, and the first open analyses it in
// the cloud. The watcher runs this at idle priority each time the recorder puts
// a lap on disk (status.json lastLapAt).
//
// Each realtime stretch of the capture is a recording, grouped into sessions
// the way game files are (sessionFiles.mjs), so ids are stable as laps arrive.
// A part is written once (a finished lap never changes) and sent once (md5).
import {existsSync, mkdirSync, readFileSync} from 'node:fs';
import {basename, join, resolve} from 'node:path';
import * as irLiveCapture from './irLiveCapture.mjs';
import * as lmuCapture from './lmuCapture.mjs';
import {liveInputs} from './liveInputs.mjs';
import {groupFiles} from './sessionFiles.mjs';
import {
  liveRecordingDoc,
  liveSessionDoc,
  partName,
  readLiveIndex,
  writeLiveIndex,
} from './liveSession.mjs';

const captureAdapters = {lmu: lmuCapture, iracing: irLiveCapture};

/**
 * The capture's sim and adapter, from its meta.json: the iRacing recorder
 * writes sim 'iracing'; the LMU recorder's meta.json names no sim.
 */
export function captureAdapterFor(captureDir) {
  const meta = JSON.parse(readFileSync(join(captureDir, 'meta.json'), 'utf8'));
  const sim = meta.sim ?? 'lmu';
  const adapter = captureAdapters[sim];
  if (!adapter)
    throw new Error(
      `${basename(captureDir)}: no live adapter for sim "${sim}"`,
    );
  return {sim, adapter};
}

/**
 * @param {object} input
 * @param {string} input.captureDir
 * @param {string} input.ownerId
 * @param {string} input.work            sync.mjs's work folder
 * @param {{uploadLive: Function}} input.store
 * @param {{describeCapture: Function, writeCaptureArchive: Function}} [input.capture]
 *   the capture's adapter (default: by its meta.json sim, captureAdapterFor)
 * @param {() => string} [input.now]
 * @param {(line: string) => void} [input.log]
 */
export async function syncLive({
  captureDir,
  ownerId,
  work,
  store,
  capture = captureAdapterFor(captureDir).adapter,
  now = () => new Date().toISOString(),
  log = () => {},
  makeInputs = liveInputs,
}) {
  const {stretches} = capture.describeCapture(captureDir);
  const files = stretches
    .filter(s => s.laps.length > 0)
    .map(s => ({
      path: captureDir,
      info: {...s.info, source: s.key},
      laps: s.laps,
      span: {startMs: s.startMs, endMs: s.endMs},
    }));
  if (files.length === 0) {
    log(`live: no finished lap in ${basename(captureDir)}`);
    return {sessions: 0};
  }
  let sessions = 0;
  for (const session of groupFiles(files, ownerId)) {
    const dir = resolve(work, 'live', session.id);
    mkdirSync(dir, {recursive: true});
    const recordings = [];
    const upload = [];
    const samplesOf = [];
    for (const f of session.files) {
      const samplePaths = [];
      const sim = f.info.sim;
      f.laps.forEach((lap, i) => {
        const n = partName(i);
        const samples = resolve(dir, `${f.id}.samples.${n}.parquet`);
        const events = resolve(dir, `${f.id}.events.${n}.parquet`);
        // A finished lap never changes: its part is written once.
        if (!existsSync(samples) || !existsSync(events))
          capture.writeCaptureArchive(captureDir, f.info, lap, samples, events);
        const prefix = `archive/${sim}/${session.id}/${f.id}`;
        samplePaths.push(samples);
        upload.push({local: samples, dest: `${prefix}/samples.${n}.parquet`});
        upload.push({local: events, dest: `${prefix}/events.${n}.parquet`});
      });
      recordings.push({id: f.id, info: f.info, parts: f.laps});
      samplesOf.push({samplePaths});
    }
    // The field and the capture extract, from the same capture (liveInputs.mjs):
    // live sessions are skipped by the game-file sync that used to make them.
    // Never at the cost of the lap: a field that cannot be made this time is
    // a log line, and the next lap tries again.
    let inputs;
    try {
      inputs = makeInputs({
        captureDir,
        ownerId,
        sessionId: session.id,
        files: session.files,
        recordings: samplesOf,
      });
    } catch (e) {
      inputs = {
        field: null,
        fieldText: null,
        fieldReason: e.message,
        extract: null,
      };
    }
    if (!inputs.field)
      log(`live: ${session.id} field: none (${inputs.fieldReason})`);
    const out = {
      session: liveSessionDoc({
        ownerId,
        sessionId: session.id,
        recordings,
        nowIso: now(),
      }),
      recordings: recordings.map(recording =>
        liveRecordingDoc({ownerId, sessionId: session.id, recording}),
      ),
      files: upload,
      field: inputs.field,
      fieldText: inputs.fieldText,
      captureExtract: inputs.extract,
      resultsInput: inputs.resultsInput,
    };
    log(`live: ${session.id} ${out.session.lapCount} laps`);
    await store.uploadLive(out, {log});
    // Only once it is stored: the game-file sync then skips what it covers.
    mkdirSync(resolve(work, 'live'), {recursive: true});
    const index = readLiveIndex(work);
    for (const f of session.files)
      index[f.info.source] = {
        sessionId: session.id,
        sim: f.info.sim,
        layout: f.info.layout,
        // The results backlog looks for the game's file by these.
        driver: f.info.driver,
        sessionType: f.info.sessionType,
        ...f.span,
      };
    writeLiveIndex(work, index);
    sessions++;
  }
  return {sessions};
}
