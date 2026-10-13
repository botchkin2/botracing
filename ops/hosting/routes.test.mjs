// Which Cloud Function answers each /api path (firebase.json rewrites, first match wins).
// The read API is `dataApi` at /api/{sessions,laps,tracks,plan,uploaders}; the old
// /api/lmu/** route stays a rewrite to the same function until every installed
// client has been updated (roadmap: delete it, then the rewrite). The write and
// release functions keep their own paths: a broad /api/** rewrite would swallow them.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';

const config = JSON.parse(readFileSync(new URL('../../firebase.json', import.meta.url), 'utf8'));
const rewrites = config.hosting.rewrites;

// Firebase Hosting globs: ** crosses slashes, * does not.
const SPECIAL = /[.+?^${}()|[\]\\]/g;
const globToRegExp = glob =>
  new RegExp(
    '^' +
      glob
        .replace(SPECIAL, '\\$&')
        .replace(/\*\*/g, '\u0000')
        .replace(/\*/g, '[^/]*')
        .replace(/\u0000/g, '.*') +
      '$',
  );

const functionFor = path =>
  rewrites.find(r => r.function && globToRegExp(r.source).test(path))?.function.functionId ?? null;

test('the read API paths go to dataApi', () => {
  for (const path of [
    '/api/sessions',
    '/api/sessions/0123456789abcdef',
    '/api/sessions/0123456789abcdef/laps',
    '/api/sessions/0123456789abcdef/field/0123456789ab',
    '/api/laps/abc/csv',
    '/api/tracks/t1/map',
    '/api/plan',
    '/api/uploaders',
  ])
    assert.equal(functionFor(path), 'dataApi', path);
});

test('the old /api/lmu paths still answer, by the old function, for clients not updated yet', () => {
  for (const path of ['/api/lmu/sessions', '/api/lmu/sessions/0123456789abcdef/laps', '/api/lmu/plan'])
    assert.equal(functionFor(path), 'lmuApi', path);
});

test('the other functions keep their own paths', () => {
  assert.equal(functionFor('/api/upload/me'), 'uploadApi');
  assert.equal(functionFor('/api/upload/docs/write'), 'uploadApi');
  assert.equal(functionFor('/api/tray/latest'), 'trayApi');
  assert.equal(functionFor('/api/analyze/0123456789abcdef'), 'analyzeApi');
  assert.equal(functionFor('/api/android/latest'), 'androidApi');
});

test('only the /api/lmu route names the old function', () => {
  const old = rewrites.filter(r => r.function?.functionId === 'lmuApi').map(r => r.source);
  assert.deepEqual(old, ['/api/lmu/**']);
});
