import assert from 'node:assert/strict';
import {existsSync, readdirSync, readFileSync, statSync} from 'node:fs';
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
  assert.match(renderPlan(plan).join(' | '), /display only: no session is re-analysed \(the stamp stays at rev 3\); 46 session\(s\)/);
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

// The claim the rule rests on, as a test: no module an analysis can reach reads a track's elevation or bank. The scan
// follows the static imports (and import() calls) of the analysis entry points through tools/, functions/src and src/
// (including src/analysis), so a later analysis import of a road or bank module goes red.
const root = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..');
const ENTRY_POINTS = [
  'tools/sessions/analyze.mjs',
  'tools/sessions/analyzeFromArchive.mjs',
  'tools/sessions/analyzeStored.mjs',
  'tools/sessions/buildSession.mjs',
  'tools/sessions/sync.mjs',
  'functions/src/engine.ts',
  'functions/src/liveAnalyze.ts',
  'functions/src/analyzeCore.ts',
  'functions/src/analyzeApi.ts',
  ...readdirSync(join(root, 'tools/uploader'))
    .filter(f => f.endsWith('.mjs') && !/\.test\./.test(f))
    .map(f => `tools/uploader/${f}`),
];
const EXTENSIONS = ['', '.ts', '.tsx', '.mjs', '.js', '/index.ts', '/index.mjs', '/index.js'];
const IMPORT = /(?:\bfrom\s*|\bimport\s*\(?\s*)['"]([^'"]+)['"]/g;

function resolveImport(from, spec) {
  const base = spec.startsWith('@/') ? join(root, spec.slice(2)) : spec.startsWith('.') ? join(from, '..', spec) : null;
  if (!base) return null;
  for (const ext of EXTENSIONS) {
    const file = base + ext;
    if (existsSync(file) && statSync(file).isFile()) return file;
  }
  return null;
}

function closureOf(entries) {
  const seen = new Set();
  const queue = entries.map(e => join(root, e));
  while (queue.length) {
    const file = queue.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    const text = readFileSync(file, 'utf8');
    for (const [, spec] of text.matchAll(IMPORT)) {
      const next = resolveImport(file, spec);
      if (next) queue.push(next);
    }
  }
  return [...seen];
}

const withoutComments = text => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
const READS = /\.(elevation|bank)\b|\[['"](elevation|bank)['"]\]|\{[^{}]*\b(elevation|bank)\b[^{}]*\}\s*=[^=]/;
const ROAD_MODULES = /(^|\/)(bank|elevation|chaseRoad\w*|worldRoad|chasePose)\.(ts|mjs)$/;

test('no module an analysis can reach reads a track elevation or bank, or is a road module', () => {
  const files = closureOf(ENTRY_POINTS).map(f => f.slice(root.length + 1).split('\\').join('/'));
  assert.ok(files.length > 80, `the scan followed the imports (${files.length} files)`);
  assert.ok(files.includes('src/analysis/cornerBoundaries.ts'), 'it reaches src/analysis through the imports');
  const hits = [];
  for (const file of files) {
    if (ROAD_MODULES.test(file)) hits.push(`${file}: a road module is in the analysis closure`);
    // trackMapCore builds the app's map payload, which carries both fields on purpose
    if (file === 'functions/src/trackMapCore.ts') continue;
    const code = withoutComments(readFileSync(join(root, file), 'utf8'));
    for (const [i, line] of code.split('\n').entries()) if (READS.test(line)) hits.push(`${file}:${i + 1}: ${line.trim()}`);
  }
  assert.deepEqual(hits, []);
});

test('the guard catches a read: a module that reads .bank, a destructuring of elevation, and a road module', () => {
  assert.ok(READS.test('const x = track.bank;'));
  assert.ok(READS.test("const y = track['elevation'];"));
  assert.ok(READS.test('const {corners, elevation} = track;'));
  assert.ok(!READS.test('const corners = track.corners;'));
  assert.ok(ROAD_MODULES.test('src/analysis/bank.ts'));
  assert.ok(ROAD_MODULES.test('src/analysis/worldRoad.ts'));
  assert.ok(!ROAD_MODULES.test('src/analysis/cornerBoundaries.ts'));
});
