// The golden set: real sessions' slices through the real analysis, compared with
// the numbers a person agreed to (expected/<name>.json). A difference fails the
// test and prints which numbers moved; the way through is `node
// tools/golden/update.mjs` and a reason in CHANGES.md (gate.mjs).
//
// The slices are real laps and live in the private bucket, never in the repo. Where
// they cannot be fetched (a fork's pull request, a PC without gcloud) the session
// is skipped; CI sets GOLDEN_REQUIRED=1 so there a missing slice fails instead.
import assert from 'node:assert/strict';
import {existsSync, readFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';

import {ensureFixtures, intact} from './fetch.mjs';
import {analyzeGolden, diffSummary, summaryOf} from './golden.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(readFileSync(resolve(here, 'manifest.json'), 'utf8'));
const required = process.env.GOLDEN_REQUIRED === '1';

function sliceOf(name) {
  const made = resolve(here, '.golden', name);
  if (existsSync(made) && intact(made, manifest.fixtures[name] ?? {})) return {dir: made};
  return ensureFixtures(name, manifest);
}

for (const name of Object.keys(manifest.sessions)) {
  const why = manifest.sessions[name].why;
  test(`golden: ${name} (${why})`, t => {
    const got = sliceOf(name);
    if (got.skip) {
      assert.ok(!required, `GOLDEN_REQUIRED: ${got.skip}`);
      t.skip(got.skip);
      return;
    }
    const expected = JSON.parse(readFileSync(resolve(here, 'expected', `${name}.json`), 'utf8'));
    const actual = JSON.parse(JSON.stringify(summaryOf(analyzeGolden(got.dir))));
    const moved = diffSummary(expected, actual, 25);
    assert.equal(
      moved.length,
      0,
      `${name}: numbers moved. If that is meant, run node tools/golden/update.mjs and explain it in tools/golden/CHANGES.md:\n${moved.join('\n')}`,
    );
  });
}

test('every session in the manifest has pinned fixtures and expected numbers', () => {
  for (const name of Object.keys(manifest.sessions)) {
    assert.ok(manifest.fixtures[name], `${name} has no pinned fixtures`);
    assert.ok(existsSync(resolve(here, 'expected', `${name}.json`)), `${name} has no expected numbers`);
  }
});
