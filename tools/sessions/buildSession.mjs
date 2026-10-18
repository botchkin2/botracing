// One game-file session, archived and analysed: sync.mjs's build, kept here
// so the parity gate (tools/golden/parity.mjs) runs the same code. `ctx` is
// what sync.mjs reads from its command line.
import {mkdirSync, statSync} from 'node:fs';
import {resolve} from 'node:path';
import {analyzeFromArchive} from './analyzeFromArchive.mjs';
import {fieldFor} from './field.mjs';
import {capturesRead} from './captureMarker.mjs';
import {ibtCrossings, liveLapCheck} from './irCapture.mjs';
import {irFieldFor} from './irField.mjs';
import {driversOfYaml} from './irClasses.mjs';
import {openIbt} from './ibt.mjs';
import {damageFor} from './playerDamage.mjs';
import {raceLengthFor} from './raceLength.mjs';
import {captureExtract} from './captureExtract.mjs';
import {onlineFor} from './gameMode.mjs';
import {resultsForSpan} from './lmuResults.mjs';
import {resultsInput} from './resultsInput.mjs';

export function makeBuilder({
  adapter,
  work,
  ownerId,
  catalogOnly,
  captureRoot,
  log,
  // The game's results folder; the parity gate points it at a fixture.
  resultsFolder = undefined,
}) {
  // Every car's class in an iRacing session, from its .ibt (irClasses.mjs);
  // none when the file can't be read.
  function ibtDriversOf(path) {
    try {
      const ibt = openIbt(path);
      try {
        return driversOfYaml(ibt.yaml);
      } finally {
        ibt.close();
      }
    } catch {
      return [];
    }
  }

  // Which online event a session and each of its recordings were part of.
  function eventsOf(s, eventWindows) {
    const recordings = s.files.map(f => ({
      id: f.id,
      event: adapter.eventFor(eventWindows, f.info.recordedAt),
    }));
    const event = recordings.find(r => r.event)?.event ?? null;
    const ids = new Set(recordings.map(r => r.event?.eventId).filter(Boolean));
    // One session spanning two events means the grouping or a window is wrong.
    if (ids.size > 1)
      log(`  warning: ${s.id} spans events ${[...ids].join(', ')}`);
    return {
      session: {
        id: s.id,
        series: event?.series ?? null,
        eventId: event?.eventId ?? null,
      },
      recordings,
    };
  }

  // The session's track and wall-clock window, the key a capture joins on.
  function spanOf(s) {
    const first = s.files[0].info;
    const last = s.files[s.files.length - 1].info;
    return {
      tracks: [first.track, first.layout],
      startMs: Date.parse(first.recordedAt),
      endMs: Date.parse(last.recordedAt) + (last.endT - last.startT) * 1000,
    };
  }

  function build(
    s,
    trackMap,
    boundaries,
    eventWindows,
    {fresh = [], foldOnly = false} = {},
  ) {
    const dir = resolve(work, 'archive', s.id);
    mkdirSync(dir, {recursive: true});
    const first = s.files[0].info;
    const sim = first.sim;
    const files = [];
    const archived = [];
    const recordings = [];
    const joined = eventsOf(s, eventWindows);
    for (const [k, f] of s.files.entries()) {
      const samples = resolve(dir, `${f.id}.samples.parquet`);
      const events = resolve(dir, `${f.id}.events.parquet`);
      // An archive the fold pass of this very run just wrote is not written again.
      if (!fresh.includes(samples))
        adapter.writeArchive(f.path, f.info, samples, events);
      archived.push(samples);
      const prefix = `archive/${sim}/${s.id}/${f.id}`;
      files.push({local: samples, dest: `${prefix}/samples.parquet`});
      files.push({local: events, dest: `${prefix}/events.parquet`});
      const {_channels, _events, ...info} = f.info;
      recordings.push({
        ...info,
        // The online event this recording was part of, or null offline.
        event: joined.recordings[k].event,
        id: f.id,
        ownerId,
        sessionId: s.id,
        durationSec: Math.round((info.endT - info.startT) * 1000) / 1000,
        archive: {
          samples: `${prefix}/samples.parquet`,
          events: `${prefix}/events.parquet`,
          bytes: statSync(samples).size + statSync(events).size,
        },
      });
    }

    const span = spanOf(s);
    // iRacing: the tray's live capture against the .ibt of the same drive, lap
    // by lap. Only logged: a lap over 5 ms apart is the news (apex #2958).
    // Every capture this session read (field, damage, race length, the player
    // stream): once it is uploaded they are the tray's to prune.
    const capturesUsed = foldOnly ? [] : capturesRead(captureRoot, sim, span);
    const liveCheck =
      foldOnly || sim !== 'iracing'
        ? null
        : liveLapCheck(
            captureRoot,
            span,
            ibtCrossings(s.files.map(f => f.path)),
          );
    // The car's damage from the live capture, to tell a repair from a penalty
    // (pitVisit.mjs); null where the capture is gone.
    const damage = foldOnly ? null : damageFor(captureRoot, span);
    // How long the race is: {minutes}. LMU: from the capture, null where it is gone.
    // iRacing: from the .ibt's session info. Null for other sessions.
    const ibtDrivers =
      !foldOnly && sim === 'iracing' ? ibtDriversOf(s.files[0].path) : [];
    const raceLength =
      foldOnly || !/^r/i.test(first.sessionType)
        ? null
        : sim === 'iracing'
        ? first.raceLength ?? null
        : raceLengthFor(captureRoot, span);
    // The game's track-limit rulings for his laps, from the results file it
    // wrote when the session ended (lmuResults.mjs); LMU only, null with no file.
    // `resultsForSpan` answers {absent: why} with no file: the input is null.
    const results =
      foldOnly || sim !== 'lmu'
        ? null
        : resultsInput(
            resultsForSpan(
              span,
              first.driver,
              first.sessionType,
              resultsFolder,
            ),
          );
    // Online or offline, from the capture's game mode; null where it is gone.
    const online =
      foldOnly || sim !== 'lmu' ? null : onlineFor(captureRoot, span);
    const out = analyzeFromArchive({
      ownerId,
      sessionId: s.id,
      recordings: s.files.map(f => ({
        id: f.id,
        info: f.info,
        samplesPath: resolve(dir, `${f.id}.samples.parquet`),
        eventsPath: resolve(dir, `${f.id}.events.parquet`),
      })),
      trackMap,
      boundaries,
      catalogOnly,
      foldOnly,
      damage,
      raceLength,
      online,
      results,
      event: joined.session,
      // Every car in the session, when the recorder ran (field.mjs, irField.mjs).
      fieldFor: lite =>
        (sim === 'iracing' ? irFieldFor : fieldFor)(
          captureRoot,
          span,
          lite,
          ibtDrivers,
        ),
    });
    if (foldOnly) return {a: out.a, archived};
    return {
      ...out,
      recordings,
      // iRacing: every car's class from the .ibt, so a stored field from before
      // the field carried classes gets them (store.mjs, irClasses.relabelField).
      ibtDrivers,
      liveCheck,
      // The capture's damage and race length, kept in the store for analysis
      // on open once the capture is pruned (captureExtract.mjs).
      captureExtract: captureExtract({
        damage,
        raceLength: sim === 'lmu' ? raceLength : null,
        online,
      }),
      // The game's rulings, kept in the store for analysis on open
      // (resultsInput.mjs); null with no results file.
      resultsInput: results,
      capturesUsed,
      files,
    };
  }

  return {build, eventsOf, spanOf};
}
