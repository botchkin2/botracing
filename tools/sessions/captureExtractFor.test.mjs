// Run: node --test tools/sessions/captureExtractFor.test.mjs
import assert from 'node:assert/strict';
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {captureExtractFor, liveExtractSessions} from './captureExtractFor.mjs';

const T0 = Date.parse('2026-10-17T00:11:06Z');

// A capture folder as the recorder writes it (listCaptures needs only the
// meta and one field chunk to exist).
function capture(root, name, meta) {
  const dir = join(root, name);
  mkdirSync(dir);
  writeFileSync(join(dir, 'field-0001.parquet'), '');
  writeFileSync(
    join(dir, 'meta.json'),
    JSON.stringify({
      track: 'Algarve International Circuit',
      startUtc: new Date(T0).toISOString(),
      endUtc: new Date(T0 + 3_600_000).toISOString(),
      ...meta,
    }),
  );
}

function withRoot(fn) {
  const root = mkdtempSync(join(tmpdir(), 'extractfor-'));
  try {
    return fn(root);
  } finally {
    rmSync(root, {recursive: true, force: true});
  }
}

test('a stored live session: its extract carries the capture online flag, offline as false', () =>
  withRoot(root => {
    capture(root, 'algarve', {gameMode: 0, serverName: '-none-'});
    const index = {
      'algarve#0': {
        sessionId: 'b0ff',
        sim: 'lmu',
        layout: 'Algarve',
        sessionType: 'Practice',
        startMs: T0 + 60_000,
        endMs: T0 + 600_000,
      },
      'algarve#1': {
        sessionId: 'b0ff',
        sim: 'lmu',
        layout: 'Algarve',
        sessionType: 'Practice',
        startMs: T0 + 900_000,
        endMs: T0 + 1_200_000,
      },
      'ir#0': {sessionId: 'i', sim: 'iracing', layout: 'x'},
    };
    const [s, ...rest] = liveExtractSessions(index, root);
    assert.equal(rest.length, 0, 'one entry per session, LMU only');
    assert.equal(s.span.startMs, T0 + 60_000);
    assert.equal(s.span.endMs, T0 + 1_200_000);
    assert.equal(captureExtractFor(root, s.span, s).online, false);
  }));

test('an online capture reads true; no capture, no extract', () =>
  withRoot(root => {
    capture(root, 'silverstone', {
      track: 'Silverstone Grand Prix Circuit - ELMS',
      gameMode: 2,
    });
    const span = {
      tracks: ['Silverstone Grand Prix Circuit - ELMS'],
      startMs: T0 + 60_000,
      endMs: T0 + 600_000,
    };
    const s = {sim: 'lmu', sessionType: 'Race'};
    assert.equal(captureExtractFor(root, span, s).online, true);
    assert.equal(
      captureExtractFor(root, {...span, tracks: ['Elsewhere']}, s),
      null,
    );
    assert.equal(
      captureExtractFor(root, span, {sim: 'iracing', sessionType: 'Race'}),
      null,
    );
  }));

test('an index entry with no session type reads it from the capture, so a race keeps its length', () =>
  withRoot(root => {
    capture(root, 'race', {gameMode: 2, session: 10});
    const [s] = liveExtractSessions(
      {
        'race#0': {
          sessionId: 'r',
          sim: 'lmu',
          layout: 'Algarve',
          startMs: T0,
          endMs: T0 + 600_000,
        },
      },
      root,
    );
    assert.equal(s.sessionType, 'Race');
  }));
