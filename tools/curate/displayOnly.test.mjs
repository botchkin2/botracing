import assert from 'node:assert/strict';
import {readdirSync, readFileSync} from 'node:fs';
import {join} from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {catalogStamp} from '../sessions/catalogStamp.mjs';
import {applyPlan} from './apply.mjs';
import {memoryCatalog} from './fixture.mjs';
import {DISPLAY_ONLY_KINDS, planBank, planElevation, planUndo, renderPlan} from './plan.mjs';

// Display-only fields (elevation, bank) must not send the sessions on a track back through analysis (pit wall thread
// 94 #6426). The stamp the sessions are compared with is built from `analysisRev`; `catalogRev` stays the history.

const corners = [{n: 1, startM: 100, endM: 300}];
const track = {mapVersion: 3, lengthM: 1000, corners, catalogRev: 3};
const bank = {stepM: 5, rollDeg: [0, 1, 2], source: 'capture'};
const elevation = {stepM: 10, heightM: [1, 2, 3], source: 'capture'};
const stampOf = (t, boundaries = {rev: 2, mapKey: 'k'}) => catalogStamp(t, boundaries);

test('a bank write moves catalogRev and the history but not the stamp', async () => {
  const catalog = memoryCatalog({tracks: {'lmu-x': track}, counts: {'lmu-x': 46}});
  const current = await catalog.readCatalog('lmu-x');
  const before = stampOf(current.track);
  const plan = planBank({trackId: 'lmu-x', current, built: {bank, refusals: [], stats: {}}, blast: {sessions: 46}});
  assert.equal(plan.analysisRev, 3);
  assert.match(renderPlan(plan).join('\n'), /display only: no session is re-analysed \(the stamp stays at rev 3\); 46 session\(s\)/);
  await applyPlan(catalog, plan, {reason: 'bank', by: 'x'});
  const after = (await catalog.readCatalog('lmu-x')).track;
  assert.equal(after.catalogRev, 4);
  assert.equal(after.analysisRev, 3);
  assert.deepEqual(after.bank, bank);
  assert.equal(stampOf(after), before, 'no session is stale');
});

test('a second display-only write keeps the same stamp', async () => {
  const catalog = memoryCatalog({tracks: {'lmu-x': {...track, analysisRev: 3, catalogRev: 4, bank}}});
  const current = await catalog.readCatalog('lmu-x');
  const before = stampOf(current.track);
  const plan = planElevation({trackId: 'lmu-x', current, built: {elevation, refusals: [], stats: {}}, blast: null});
  assert.equal(plan.analysisRev, 3);
  await applyPlan(catalog, plan, {reason: 'height', by: 'x'});
  const after = (await catalog.readCatalog('lmu-x')).track;
  assert.equal(after.catalogRev, 5);
  assert.equal(stampOf(after), before);
});

test('an undo moves the stamp: it can restore a map an analysis reads', async () => {
  const catalog = memoryCatalog({tracks: {'lmu-x': track}});
  const first = planBank({trackId: 'lmu-x', current: await catalog.readCatalog('lmu-x'), built: {bank, refusals: [], stats: {}}, blast: null});
  await applyPlan(catalog, first, {reason: 'bank', by: 'x'});
  const current = await catalog.readCatalog('lmu-x');
  const undo = planUndo({trackId: 'lmu-x', current, history: await catalog.readHistory('lmu-x'), toRev: 3, blast: null});
  assert.equal(undo.analysisRev, 5);
  await applyPlan(catalog, undo, {reason: 'back', by: 'x'});
  const after = (await catalog.readCatalog('lmu-x')).track;
  assert.equal(after.catalogRev, 5);
  assert.equal(after.analysisRev, 5);
  assert.equal(after.bank, undefined, 'the bank is gone with the undo');
  assert.notEqual(stampOf(after), stampOf(current.track));
});

test('only elevation and bank are display-only', () => {
  assert.deepEqual(DISPLAY_ONLY_KINDS, ['elevation', 'bank']);
});

// The claim the rule rests on, as a test: no analysis source reads a track's elevation or bank.
test('no analysis source reads elevation or bank from a track', () => {
  const root = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..');
  const read = (dir, keep) =>
    readdirSync(join(root, dir))
      .filter(keep)
      .map(f => ({file: `${dir}/${f}`, text: readFileSync(join(root, dir, f), 'utf8')}));
  const sources = [
    ...read('tools/sessions', f => /\.m?js$/.test(f) && !/\.test\.|\.golden\./.test(f)),
    ...read('tools/uploader', f => /\.m?js$/.test(f) && !/\.test\./.test(f)),
    // trackMapCore.ts builds the app's map payload, which carries both fields on purpose
    ...read('functions/src', f => /\.ts$/.test(f) && f !== 'trackMapCore.ts'),
  ];
  assert.ok(sources.length > 20, 'the scan found the analysis sources');
  const hits = [];
  for (const {file, text} of sources) {
    for (const [i, line] of text.split('\n').entries()) {
      const code = line.replace(/\/\/.*$/, '');
      if (/\.(elevation|bank)\b|\[['"](elevation|bank)['"]\]/.test(code)) hits.push(`${file}:${i + 1}: ${line.trim()}`);
    }
  }
  assert.deepEqual(hits, []);
});
