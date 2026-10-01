// Run: node --test tools/sessions/surfaceProgress.test.mjs
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readSurfaceProgress, surfaceProgressLine} from './surfaceProgress.mjs';
import {isProgressLine} from '../uploader/syncOutput.mjs';

test('what is printed is what is read', () => {
  assert.equal(surfaceProgressLine(7, 13), 'surface 7/13 tracks');
  assert.deepEqual(readSurfaceProgress(surfaceProgressLine(7, 13)), {
    done: 7,
    total: 13,
  });
  assert.deepEqual(readSurfaceProgress(surfaceProgressLine(0, 1)), {
    done: 0,
    total: 1,
  });
});

test('other lines are not progress', () => {
  for (const line of [
    'surface: not updated: boom',
    'surface 7/13 tracks done',
    ' surface 7/13 tracks',
    'lmu-sebring: +51 sessions, +226 laps, 51 sessions in all',
    'done 2, failed 0, unchanged 0',
  ]) {
    assert.equal(readSurfaceProgress(line), null, line);
  }
});

test('the watcher beats on the count, a session block and a fold step, nothing else', () => {
  assert.equal(isProgressLine('to do 368'), true);
  assert.equal(
    isProgressLine(
      'aaaaaaaaaaaaaaaa 2026-09-28T20:00 Race  Road Atlanta | 911',
    ),
    true,
  );
  assert.equal(isProgressLine(surfaceProgressLine(3, 13)), true);
  assert.equal(isProgressLine('  22 laps, 20 comparable, best 80.1'), false);
  assert.equal(isProgressLine('done 2, failed 0, unchanged 0'), false);
  assert.equal(isProgressLine('surface: not updated: boom'), false);
});
