// Rewrites the golden set's expected numbers from the pinned slices, and says
// what moved. The slices come from the cache or the bucket (fetch.mjs), or
// from `.golden/` where make.mjs just made them. A changed number is not
// committed alone: a stub entry is appended to CHANGES.md and the gate
// (gate.mjs) fails until someone writes the reason.
//
//   node tools/golden/update.mjs [name ...]
import {existsSync, readFileSync, writeFileSync, appendFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

import {ensureFixtures, intact} from './fetch.mjs';
import {analyzeGolden, diffSummary, summaryOf} from './golden.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(readFileSync(resolve(here, 'manifest.json'), 'utf8'));

/** The directory of `name`'s slice: the one make.mjs left, else the cache/bucket. */
export function sliceDir(name) {
  const made = resolve(here, '.golden', name);
  if (existsSync(made) && intact(made, manifest.fixtures[name] ?? {})) return {dir: made};
  return ensureFixtures(name, manifest);
}

const names = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(manifest.sessions);
const today = new Date().toISOString().slice(0, 10);
for (const name of names) {
  const got = sliceDir(name);
  if (got.skip) {
    console.error(`${name}: ${got.skip}`);
    process.exitCode = 1;
    continue;
  }
  const path = resolve(here, 'expected', `${name}.json`);
  const before = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null;
  const after = summaryOf(analyzeGolden(got.dir));
  const lines = diffSummary(before, after);
  if (before && lines.length === 0) {
    console.log(`${name}: unchanged`);
    continue;
  }
  writeFileSync(path, `${JSON.stringify(after, null, 1)}\n`);
  appendFileSync(
    resolve(here, 'CHANGES.md'),
    `\n## ${today} ${name}\nWhy: TODO\nChanged:\n${(before ? lines : ['(new session)']).map(l => `- ${l}`).join('\n')}\n`,
  );
  console.log(`${name}: ${before ? `${lines.length} difference(s)` : 'new'}; CHANGES.md has a stub to explain`);
}
