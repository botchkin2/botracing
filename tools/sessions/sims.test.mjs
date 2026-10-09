import assert from 'node:assert/strict';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {adapter, adapters, telemetryFolder} from './sims.mjs';

test('every adapter publishes sim, defaultFolder, isRecording, gameExe', () => {
  const ids = Object.keys(adapters);
  assert.deepEqual(ids, ['lmu', 'iracing']);
  for (const id of ids) {
    const a = adapter(id);
    assert.equal(a, adapters[id]);
    assert.equal(a.sim, id);
    assert.equal(typeof a.defaultFolder, 'string');
    assert.ok(a.defaultFolder.length > 0);
    assert.equal(typeof a.isRecording, 'function');
    assert.equal(typeof a.gameExe, 'string');
    assert.ok(a.gameExe.endsWith('.exe'));
  }
});

test('unknown sim throws', () => {
  assert.throws(() => adapter('acc'), /unknown sim "acc"/);
});

test('LMU recordings are duckdb; iRacing recordings are ibt', () => {
  assert.equal(adapter('lmu').isRecording('a.duckdb'), true);
  assert.equal(adapter('lmu').isRecording('a.ibt'), false);
  assert.equal(adapter('iracing').isRecording('a.ibt'), true);
  assert.equal(adapter('iracing').isRecording('a.IBT'), true);
  assert.equal(adapter('iracing').isRecording('a.duckdb'), false);
});

test('game exe names match the processes on this PC', () => {
  assert.equal(adapter('lmu').gameExe, 'Le Mans Ultimate.exe');
  assert.equal(adapter('iracing').gameExe, 'iRacingSim64DX11.exe');
});

test("iRacing's folder is this user's Documents, not a hard-coded name", () => {
  assert.equal(
    adapter('iracing').defaultFolder,
    join(homedir(), 'Documents', 'iRacing', 'telemetry'),
  );
});

test('LMU_TELEMETRY does not redirect an iRacing sync', () => {
  const env = {LMU_TELEMETRY: 'C:\\not-iracing'};
  assert.equal(telemetryFolder('lmu', env), 'C:\\not-iracing');
  assert.equal(telemetryFolder('iracing', env), adapter('iracing').defaultFolder);
});

