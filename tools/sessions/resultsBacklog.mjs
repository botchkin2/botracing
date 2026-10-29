// A stored session whose game results the store does not hold yet: the input
// goes up on its own and the session is marked stale, so the next open analyses
// it again with the game's rulings (thread 70, design #5521 point 8, #5662).
// Two kinds: a session uploaded before results were kept, and a session whose
// results file did not exist yet at its last upload (the game writes the file
// when the session ends, so a live session's last run, or a game-file sync
// minutes before the file, finds none).
//
// state.resultsInputs[id]: {v} (the version of the input that is up, with the
// session itself or on its own), {v: 1, gone: true} (a v1 input is up and the
// game no longer has its file: nothing to add), or {none: true, atMs, run} (no
// file for it). A session with no file is looked for again every run until
// RETRY_WINDOW_MS after it ended, then once per tray start (`run`), because the
// file can land later than any window and is on the PC for weeks.
//
// The strings 'sent' and 'with-session' are what a tray before v2 wrote: a v1
// input (strikes only). They are looked at once more, so the drivers go up
// (ticket 20); the file may be gone by now, and then the session keeps its v1
// ({v: 1, gone: true}, never looked for again).
//
// An iRacing session has no results file: its input is the class bests of the
// .ibt's own qualifying results (irResults.mjs; thread 123, ticket 61 item 4),
// read from the stored session's file. It has its own state key,
// state.iracingResultsInputs[id] = {rev, sent}, so the LMU entries above never
// fire for it and its rev (IRACING_INPUT_REV, bumped when the producer changes)
// never fires an LMU one. The file is on disk and does not change, so there is
// no retry window: one look per rev, whether it held a qualifying result or not.
import {existsSync, readFileSync} from 'node:fs';
import {resolve} from 'node:path';

import {sessionTypeOf} from './lmuCapture.mjs';
import {RESULTS_INPUT_VERSION, resultsInput} from './resultsInput.mjs';

export const RETRY_WINDOW_MS = 30 * 60_000;

/** The version of the iRacing producer whose input is up; a later rev sends again. */
export const IRACING_INPUT_REV = 1;

const wantsIracingLook = entry => !(entry?.rev >= IRACING_INPUT_REV);

const wantsLook = (entry, endMs, nowMs, run) => {
  if (!entry || typeof entry === 'string') return true;
  if (entry.gone) return false;
  if (!entry.none) return !(entry.v >= RESULTS_INPUT_VERSION);
  return nowMs - endMs <= RETRY_WINDOW_MS || entry.run !== run;
};

/**
 * The stored sessions to look for an input for. LMU: uploaded game-file
 * sessions, and live-uploaded ones (one per sessionId in the live index; an
 * entry from before the index kept the driver and session type reads them from
 * the capture's meta.json), to look for a results file. iRacing: uploaded
 * game-file sessions, `sim: 'iracing'` with the .ibt's `file`.
 *
 * @returns {({sim?: 'lmu', id: string, driver: string, sessionType: string, span: {startMs: number, endMs: number}} | {sim: 'iracing', id: string, file: string, span: {startMs: number, endMs: number}})[]}
 */
export function backlogCandidates({
  sessions,
  state,
  spanOf,
  liveIndex,
  captureRoot,
}) {
  const out = [];
  for (const s of sessions) {
    const first = s.files[0].info;
    if (!state.sessions[s.id]) continue;
    if (first.sim === 'iracing') {
      out.push({
        sim: 'iracing',
        id: s.id,
        file: s.files[0].path,
        span: spanOf(s),
      });
      continue;
    }
    // The game's results file is LMU's.
    if (first.sim !== 'lmu') continue;
    out.push({
      id: s.id,
      driver: first.driver,
      sessionType: first.sessionType,
      span: spanOf(s),
    });
  }
  const live = new Map();
  for (const [key, e] of Object.entries(liveIndex ?? {})) {
    if (e.sim !== 'lmu') continue;
    const meta = e.driver != null ? null : metaOf(captureRoot, key);
    const c = live.get(e.sessionId);
    const driver = e.driver ?? meta?.driver ?? '';
    const sessionType = e.sessionType ?? meta?.sessionType ?? '';
    if (!c)
      live.set(e.sessionId, {
        id: e.sessionId,
        driver,
        sessionType,
        span: {startMs: e.startMs, endMs: e.endMs},
      });
    else
      c.span = {
        startMs: Math.min(c.span.startMs, e.startMs),
        endMs: Math.max(c.span.endMs, e.endMs),
      };
  }
  for (const c of live.values())
    if (!out.some(o => o.id === c.id)) out.push(c);
  return out;
}

function metaOf(captureRoot, key) {
  if (!captureRoot) return null;
  const path = resolve(captureRoot, key.split('#')[0], 'meta.json');
  if (!existsSync(path)) return null;
  try {
    const meta = JSON.parse(readFileSync(path, 'utf8'));
    return {
      driver: meta.playerName || '',
      sessionType: sessionTypeOf(Number(meta.session)),
    };
  } catch {
    return null;
  }
}

/**
 * Whether a looking run is worth starting now: some candidate wants a look.
 * The watcher asks this each tick without starting anything.
 */
export function backlogDue({candidates, state, nowMs, run}) {
  const kept = state.resultsInputs ?? {};
  const keptIr = state.iracingResultsInputs ?? {};
  return candidates.some(c =>
    c.sim === 'iracing'
      ? wantsIracingLook(keptIr[c.id])
      : wantsLook(kept[c.id], c.span.endMs, nowMs, run),
  );
}

/**
 * @param {object} p
 * @param {ReturnType<typeof backlogCandidates>} p.candidates
 * @param {{resultsInputs?: Record<string, unknown>}} p.state
 * @param {{putResultsInput: Function, markStale: Function}} p.store
 * @param {string} p.ownerId
 * @param {(span: object, driver: string, sessionType: string) => object} p.resultsForSpan
 * @param {(file: string) => object | null} [p.iracingResultsFromFile]  the .ibt's qualifying input, or null
 * @param {() => void} p.saveState
 * @param {(line: string) => void} p.log
 * @param {number} p.nowMs
 * @param {string} p.run  this tray start; a session with no file is looked at once per run
 */
export async function uploadResultsBacklog({
  candidates,
  state,
  store,
  ownerId,
  resultsForSpan,
  iracingResultsFromFile,
  saveState,
  log,
  nowMs,
  run,
}) {
  state.resultsInputs ??= {};
  state.iracingResultsInputs ??= {};
  let sent = 0;
  for (const c of candidates) {
    if (c.sim === 'iracing') {
      if (!iracingResultsFromFile || !wantsIracingLook(state.iracingResultsInputs[c.id]))
        continue;
      const input = iracingResultsFromFile(c.file);
      if (input) {
        await store.putResultsInput(ownerId, c.id, input);
        await store.markStale(c.id, ownerId);
        sent++;
      }
      state.iracingResultsInputs[c.id] = {
        rev: IRACING_INPUT_REV,
        sent: input != null,
      };
      saveState();
      continue;
    }
    if (!wantsLook(state.resultsInputs[c.id], c.span.endMs, nowMs, run))
      continue;
    const input = resultsInput(resultsForSpan(c.span, c.driver, c.sessionType));
    if (input) {
      await store.putResultsInput(ownerId, c.id, input);
      await store.markStale(c.id, ownerId);
      sent++;
    }
    // Saved per session, so a run stopped mid-backlog resumes where it was. A v1
    // input already up whose file is gone stays as it is, looked at for good.
    const had = state.resultsInputs[c.id];
    state.resultsInputs[c.id] = input
      ? {v: input.v}
      : typeof had === 'string'
        ? {v: 1, gone: true}
        : {none: true, atMs: nowMs, run};
    saveState();
  }
  if (sent) log(`game results kept for ${sent} stored session(s)`);
  return sent;
}
