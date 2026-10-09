import assert from 'node:assert/strict';
import path from 'node:path';
import {test} from 'node:test';

import {parseSlot, resolveSlot, SLOTS_FILE} from './liveSlots.mjs';

const root = path.resolve('/repo');
const wt = path.join(root, '.claude', 'worktrees', 'seat-task');
const cliOf = dir => path.join(dir, 'node_modules', 'expo', 'bin', 'cli');

// A fake file system: files by path, and the set of paths that exist.
const fsOf = (files = {}, exists = []) => ({
  read: f => files[f] ?? null,
  exists: p => exists.includes(p),
});
const claim = obj => ({[path.join(root, SLOTS_FILE)]: JSON.stringify(obj)});

test('parseSlot takes 1 to 6 only', () => {
  assert.equal(parseSlot('1'), 1);
  assert.equal(parseSlot('6'), 6);
  for (const bad of ['0', '7', 'x', '1.5', undefined])
    assert.ok(parseSlot(bad) instanceof Error);
});

test('an unclaimed slot serves the main checkout', () => {
  const r = resolveSlot({root, slot: 2, fs: fsOf({}, [root, cliOf(root)])});
  assert.deepEqual(r, {dir: root, cli: cliOf(root), claimed: false, port: 19102});
});

test('a claimed slot serves the worktree, on its own port', () => {
  const r = resolveSlot({
    root,
    slot: 1,
    fs: fsOf(claim({1: wt}), [wt, cliOf(wt)]),
  });
  assert.equal(r.dir, wt);
  assert.equal(r.claimed, true);
  assert.equal(r.port, 19101);
});

test("another slot's claim does not move this one", () => {
  const r = resolveSlot({
    root,
    slot: 3,
    fs: fsOf(claim({1: wt}), [root, cliOf(root)]),
  });
  assert.equal(r.dir, root);
});

test('a missing worktree, a stranger folder and bad JSON are named errors', () => {
  const missing = resolveSlot({root, slot: 1, fs: fsOf(claim({1: wt}), [])});
  assert.match(missing.message, /does not exist/);
  const stranger = path.resolve('/elsewhere');
  const out = resolveSlot({
    root,
    slot: 1,
    fs: fsOf(claim({1: stranger}), [stranger]),
  });
  assert.match(out.message, /not the main checkout/);
  const bad = resolveSlot({
    root,
    slot: 1,
    fs: fsOf({[path.join(root, SLOTS_FILE)]: '{nope'}, [root]),
  });
  assert.match(bad.message, /not valid JSON/);
  const arr = resolveSlot({root, slot: 1, fs: fsOf(claim([1]), [root])});
  assert.match(arr.message, /must be an object/);
});

test('a worktree without node_modules says so and installs nothing', () => {
  const r = resolveSlot({root, slot: 1, fs: fsOf(claim({1: wt}), [wt])});
  assert.match(r.message, /no node_modules/);
  assert.match(r.message, /nothing is installed/);
});

test('a path outside .claude/worktrees that merely starts with it is refused', () => {
  const sneaky = path.join(root, '.claude', 'worktrees-evil');
  const r = resolveSlot({
    root,
    slot: 1,
    fs: fsOf(claim({1: sneaky}), [sneaky, cliOf(sneaky)]),
  });
  assert.match(r.message, /not the main checkout/);
});

test('a worktree with no install uses the main checkout packages when the lockfile matches', () => {
  const lock = '{"lockfileVersion":3}';
  const files = {
    [path.join(root, SLOTS_FILE)]: JSON.stringify({1: wt}),
    [path.join(wt, 'package-lock.json')]: lock,
    [path.join(root, 'package-lock.json')]: lock,
  };
  const r = resolveSlot({root, slot: 1, fs: fsOf(files, [wt, cliOf(root)])});
  assert.equal(r.dir, wt);
  assert.equal(r.cli, cliOf(root));
});

test('a worktree whose lockfile differs from main keeps the npm ci error', () => {
  const files = {
    [path.join(root, SLOTS_FILE)]: JSON.stringify({1: wt}),
    [path.join(wt, 'package-lock.json')]: '{"a":1}',
    [path.join(root, 'package-lock.json')]: '{"a":2}',
  };
  const r = resolveSlot({root, slot: 1, fs: fsOf(files, [wt, cliOf(root)])});
  assert.ok(r instanceof Error);
  assert.match(r.message, /package-lock\.json differs/);
});

test('the main checkout with no install still gets the npm ci error', () => {
  const r = resolveSlot({root, slot: 2, fs: fsOf({}, [root])});
  assert.ok(r instanceof Error);
  assert.match(r.message, /Run npm ci/);
});
