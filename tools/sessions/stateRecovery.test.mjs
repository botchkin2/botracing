// Run: node --test tools/sessions/
// An unreadable state.json no longer crashes the sync (ticket 86, pit-wall
// thread 142): the real sync.mjs, on a folder of its own and an empty
// telemetry folder, so it touches nothing of anyone's.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

function listWith({state, backup}) {
  const root = mkdtempSync(join(tmpdir(), 'staterecover-'));
  const work = join(root, 'work');
  for (const d of ['work', 'telemetry', 'capture']) mkdirSync(join(root, d));
  if (state !== undefined) writeFileSync(join(work, 'state.json'), state);
  if (backup !== undefined) writeFileSync(join(work, 'state.json.bak'), backup);
  const run = spawnSync(
    process.execPath,
    [
      resolve(here, 'sync.mjs'),
      '--local',
      '--list',
      '--owner',
      'test-owner',
      '--work',
      work,
      '--folder',
      join(root, 'telemetry'),
      '--capture',
      join(root, 'capture'),
      '--first-window-days',
      '90',
    ],
    {encoding: 'utf8', timeout: 60_000},
  );
  return {work, run, out: `${run.stdout}${run.stderr}`};
}

const kept = work => readdirSync(work).filter(f => f.includes('.corrupt-'));

test('a zero-length state.json is restored from the .bak and the sync goes on', () => {
  const good = JSON.stringify({files: {}, sessions: {}, owners: {}, since: '2026-07-12'});
  const {work, run, out} = listWith({state: '', backup: good});
  assert.equal(run.status, 0, out);
  assert.match(out, /state\.json was unreadable; restored from state\.json\.bak/);
  assert.equal(kept(work).length, 1);
  assert.equal(readFileSync(join(work, 'state.json'), 'utf8'), good);
});

test('an unreadable state.json with no .bak starts the new-install window and says so, keeping the bad file', () => {
  const {work, run, out} = listWith({state: '{"since":"2026-07-1'});
  assert.equal(run.status, 0, out);
  assert.match(out, /state\.json unreadable: sessions since \d{4}-\d{2}-\d{2} are checked again/);
  const [file] = kept(work);
  assert.equal(readFileSync(join(work, file), 'utf8'), '{"since":"2026-07-1');
});

test('a whole state.json is read as before, with no recovery line', () => {
  const {work, run, out} = listWith({
    state: JSON.stringify({files: {}, sessions: {}, owners: {}, since: '2026-07-12'}),
  });
  assert.equal(run.status, 0, out);
  assert.doesNotMatch(out, /unreadable/);
  assert.equal(existsSync(join(work, 'state.json')), true);
  assert.equal(kept(work).length, 0);
});
