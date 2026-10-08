import assert from 'node:assert/strict';
import {mkdirSync, mkdtempSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {ADMIN_ONLY, closure, scan, sha256, verified, withoutComments} from './stage-resources.mjs';

test('words in comments are not imports', () => {
  const src = `// import x from './nope'\n/* import('./also-nope') */\nimport a from './real.mjs'; // from 'trailing'\nconst u = 'https://example.com/x';`;
  assert.deepEqual(scan(src).imports, ['./real.mjs']);
  assert.ok(withoutComments(src).includes('https://example.com/x'));
});

test('type-only imports are erased, inline type imports are not', () => {
  const src = `import type {A} from './types';\nimport {type B, c} from './values.ts';\nexport type {D} from './more';\nimport './effects.mjs';`;
  assert.deepEqual(scan(src).imports, ['./values.ts', './effects.mjs']);
});

test('a dynamic import or a Worker the scan cannot follow is reported', () => {
  const ok = `await import('./store.mjs');\nnew Worker(new URL(import.meta.url), {argv: []});\nnew Worker('./w.mjs');`;
  const a = scan(ok);
  assert.deepEqual(a.imports, ['./store.mjs']);
  assert.deepEqual(a.workers, ['./w.mjs']);
  assert.deepEqual(a.unfollowable, []);
  const bad = `await import(name);\nnew Worker(path.join(here, 'w.mjs'));`;
  assert.equal(scan(bad).unfollowable.length, 2);
});

test('closure follows imports, workers and dynamic imports, and names what is missing', () => {
  const root = mkdtempSync(join(tmpdir(), 'stage-'));
  mkdirSync(join(root, 'a'), {recursive: true});
  writeFileSync(join(root, 'a/main.mjs'), `import './dep.mjs';\nawait import('../b/late.mjs');\nnew Worker('./w.mjs');\nimport x from 'left-pad';\nimport './gone.mjs';`);
  writeFileSync(join(root, 'a/dep.mjs'), `import fs from 'node:fs';`);
  mkdirSync(join(root, 'b'));
  writeFileSync(join(root, 'b/late.mjs'), '');
  writeFileSync(join(root, 'a/w.mjs'), '');
  const c = closure(root, ['a/main.mjs']);
  assert.deepEqual(c.files, ['a/dep.mjs', 'a/main.mjs', 'a/w.mjs', 'b/late.mjs']);
  assert.deepEqual(c.bare, ['left-pad']);
  assert.deepEqual(c.missing, ['a/gone.mjs']);
});

test('a binary that does not match its pin fails the build', () => {
  const dir = mkdtempSync(join(tmpdir(), 'stage-'));
  const file = join(dir, 'thing.exe');
  writeFileSync(file, 'real bytes');
  assert.ok(verified(file, sha256(Buffer.from('real bytes')), 'thing'));
  assert.throws(() => verified(file, sha256(Buffer.from('other')), 'thing'), /expected the pinned/);
});

test('the real uploader closure is complete and needs no npm package', () => {
  const c = closure();
  assert.deepEqual(c.missing, []);
  assert.deepEqual(c.bare, []);
  assert.deepEqual(c.unfollowable, []);
  for (const must of ['tools/uploader/watch.mjs', 'tools/sessions/sync.mjs', 'tools/sessions/duck.mjs', 'tools/sessions/storeClient.mjs', 'src/analysis/resample.ts']) {
    assert.ok(c.files.includes(must), `${must} should ship`);
  }
  // Nothing of the test suite or the other tools goes into the installer.
  assert.ok(c.files.every(f => !f.includes('.test.') && !f.includes('fixtures')));
});

test('a require() of a package is an import, and createRequire itself is not', () => {
  const src = [
    "import {createRequire} from 'node:module';",
    'const require = createRequire(import.meta.url);',
    "const a = require('firebase-admin');",
    "const b = require('./local.cjs');",
  ].join('\n');
  assert.deepEqual(scan(src).imports, ['node:module', 'firebase-admin', './local.cjs']);
  assert.deepEqual(scan(src).unfollowable, []);
  assert.deepEqual(scan('const x = require(name);').unfollowable, ['require(name)']);
});

test('the one allowed package require is named, with a reason, and nothing else is', () => {
  assert.deepEqual([...ADMIN_ONLY.keys()], ['tools/sessions/store.mjs']);
  assert.ok(ADMIN_ONLY.get('tools/sessions/store.mjs').why.length > 20);
  const root = mkdtempSync(join(tmpdir(), 'stage-'));
  mkdirSync(join(root, 'tools/sessions'), {recursive: true});
  writeFileSync(join(root, 'tools/sessions/store.mjs'), "const a = require('firebase-admin');");
  writeFileSync(join(root, 'tools/sessions/other.mjs'), "const a = require('firebase-admin');");
  assert.deepEqual(closure(root, ['tools/sessions/store.mjs']).bare, [], 'allowed in store.mjs');
  assert.deepEqual(closure(root, ['tools/sessions/other.mjs']).bare, ['firebase-admin'], 'not allowed anywhere else');
});
