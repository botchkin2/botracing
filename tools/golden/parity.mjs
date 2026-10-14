// The parity gate (docs/SESSION_PIPELINE.md): one drive, recorded by the
// capture and by the game, built through today's two real paths into memory,
// and every session and lap field compared.
//
//   capture path   syncLive (the tray's live upload) → analyzeStored (the cloud)
//   game-file path buildSession (sync.mjs's build) → store.upload
//
// Each difference is either on the reviewed allow-list (parityAllow.json, each
// entry with its reason) or the gate fails.
//
//   node tools/golden/parity.mjs <pair folder>     prints the differences
import {mkdtempSync, readdirSync, readFileSync, rmSync, statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {basename, dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

import {analyzeStored} from '../sessions/analyzeStored.mjs';
import {makeBuilder} from '../sessions/buildSession.mjs';
import * as lmu from '../sessions/lmu.mjs';
import {unpackState} from '../sessions/layoutBoundaries.mjs';
import {groupFiles} from '../sessions/sessionFiles.mjs';
import {checkSession} from '../sessions/manifest.mjs';
import {createStore} from '../sessions/store.mjs';
import {syncLive} from '../sessions/syncLive.mjs';
import {memoryStore, sessionOf} from './memoryStore.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const OWNER = 'parity-owner';
const NOW = '2026-10-14T00:00:00.000Z';

/**
 * A pair folder holds `capture/<name>/` (meta.json and the parquet chunks),
 * `game/<file>.duckdb`, and `catalog.json` ({track, boundaries}: the curated
 * docs both paths read).
 */
export async function buildPair(pairDir) {
  const catalog = JSON.parse(readFileSync(join(pairDir, 'catalog.json'), 'utf8'));
  const seed = {
    [`tracks/${catalog.track.id}`]: catalog.track,
    ...(catalog.boundaries
      ? {[`trackBoundaries/${catalog.track.id}`]: catalog.boundaries}
      : {}),
  };
  const captureRoot = join(pairDir, 'capture');
  const [captureName] = readdirSync(captureRoot)
    .filter(n => statSync(join(captureRoot, n)).isDirectory());
  const work = mkdtempSync(join(tmpdir(), 'parity-'));
  try {
    // The capture path.
    const liveStore = memoryStore(seed);
    await syncLive({
      captureDir: join(captureRoot, captureName),
      ownerId: OWNER,
      work: join(work, 'live'),
      store: createStore(liveStore),
      now: () => NOW,
    });
    const liveIds = [...liveStore.docs.keys()]
      .filter(k => k.startsWith('sessions/'))
      .map(k => k.slice(9));
    if (liveIds.length !== 1)
      throw new Error(`capture path made ${liveIds.length} sessions`);
    await analyzeStored({
      backend: liveStore,
      sessionId: liveIds[0],
      owner: OWNER,
      workDir: join(work, 'live-analysis'),
    });

    // The game-file path.
    const gameDir = join(pairDir, 'game');
    const files = readdirSync(gameDir)
      .filter(n => n.endsWith('.duckdb'))
      .map(n => {
        const path = resolve(gameDir, n);
        return {path, size: statSync(path).size, info: lmu.describe(path)};
      });
    const groups = groupFiles(files, OWNER);
    if (groups.length !== 1)
      throw new Error(`game files made ${groups.length} sessions`);
    const {build} = makeBuilder({
      adapter: lmu,
      work: join(work, 'game'),
      ownerId: OWNER,
      catalogOnly: true,
      captureRoot,
      log: () => {},
    });
    const gameStore = memoryStore(seed);
    const out = build(
      groups[0],
      catalog.track,
      catalog.boundaries ? unpackState(catalog.boundaries) : null,
      [],
    );
    await createStore(gameStore).upload(out);

    // The other cars the capture saw: its car list, less the player.
    const meta = JSON.parse(
      readFileSync(join(captureRoot, captureName, 'meta.json'), 'utf8'),
    );
    const otherCars = Math.max(0, Object.keys(meta.vehicleModels ?? {}).length - 1);
    return {
      capture: sessionOf(liveStore, liveIds[0]),
      game: sessionOf(gameStore, groups[0].id),
      otherCars,
      name: basename(pairDir),
    };
  } finally {
    rmSync(work, {recursive: true, force: true});
  }
}

// Every leaf that differs, as [path, capture value, game value]. Arrays of
// objects are compared index by index; numbers within 1e-9.
export function differences(a, b, path = '', out = []) {
  if (typeof a === 'number' && typeof b === 'number') {
    if (Math.abs(a - b) > 1e-9) out.push([path, a, b]);
    return out;
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    if (Array.isArray(a) !== Array.isArray(b)) {
      out.push([path, a, b]);
      return out;
    }
    if (Array.isArray(a) && a.length !== b.length) {
      out.push([`${path}.length`, a.length, b.length]);
      return out;
    }
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)]))
      differences(a[k], b[k], path ? `${path}.${k}` : k, out);
    return out;
  }
  if (JSON.stringify(a) !== JSON.stringify(b)) out.push([path, a, b]);
  return out;
}

/** The allow-list: [{path (regex over the generic path), why, tol?}]. */
export function loadAllow(file = join(here, 'parityAllow.json')) {
  return JSON.parse(readFileSync(file, 'utf8')).map(e => ({
    ...e,
    re: new RegExp(`^${e.path}$`),
  }));
}

// lap.12.corners.3.brakeAtM → laps.#.corners.#.brakeAtM: one rule per field.
const generic = path => path.replace(/\.\d+(?=\.|$)/g, '.#');

// `tol` bounds numbers; `tolS` bounds two times by seconds. No bound: any value.
function withinTolerance(rule, a, b) {
  if (rule.tolS != null) {
    const [x, y] = [Date.parse(a), Date.parse(b)];
    return Number.isFinite(x) && Number.isFinite(y) && Math.abs(x - y) <= rule.tolS * 1000;
  }
  if (rule.tol == null) return true;
  return typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) <= rule.tol;
}

/**
 * The differences the allow-list does not explain, with what it did allow.
 * An entry with `pair` applies to that pair only; `when: "untimed"` to laps the
 * game did not time.
 */
export function judge({capture, game, name: pairName}, allow = loadAllow()) {
  const all = [
    ...differences(capture.session, game.session).map(([p, a, b]) => [
      `session.${p}`,
      a,
      b,
    ]),
  ];
  // A lap path also has its role, so a rule can say "the last lap" or "an
  // untimed lap" instead of a lap number of one pair.
  const lastNumber = Math.max(-1, ...capture.laps.map(l => l.lapNumber));
  const lapRole = new Map();
  const byNumber = new Map(game.laps.map(l => [l.lapNumber, l]));
  for (const lap of capture.laps) {
    const other = byNumber.get(lap.lapNumber);
    const role = {last: lap.lapNumber === lastNumber, untimed: lap.timed === false};
    if (!other) all.push([`laps.${lap.lapNumber}`, 'present', 'missing']);
    else
      for (const [p, a, b] of differences(lap, other)) {
        const path = `laps.${lap.lapNumber}.${p}`;
        lapRole.set(path, role);
        all.push([path, a, b]);
      }
    byNumber.delete(lap.lapNumber);
  }
  for (const n of byNumber.keys()) all.push([`laps.${n}`, 'missing', 'present']);

  const failures = [];
  const allowed = new Map();
  for (const [path, a, b] of all) {
    const g = generic(path);
    const role = lapRole.get(path) ?? {};
    const forms = [g, path, role.last ? g.replace(/^laps\.#/, 'laps.last') : null];
    const rule = allow.find(
      e =>
        (e.pair == null || e.pair === pairName) &&
        (e.when !== 'untimed' || role.untimed) &&
        forms.some(f => f && e.re.test(f)) &&
        withinTolerance(e, a, b),
    );
    if (rule) allowed.set(rule.path, (allowed.get(rule.path) ?? 0) + 1);
    else failures.push({path, capture: a, game: b});
  }
  return {failures, allowed: Object.fromEntries(allowed), compared: all.length};
}

if (process.argv[1]?.endsWith('parity.mjs')) {
  const pair = await buildPair(process.argv[2]);
  const r = judge(pair);
  const show = v => {
    const s = JSON.stringify(v);
    return s === undefined ? 'undefined' : s.length > 80 ? `${s.slice(0, 77)}...` : s;
  };
  console.log(
    `capture: ${pair.capture.laps.length} laps, game file: ${pair.game.laps.length} laps (${basename(process.argv[2])})`,
  );
  for (const f of r.failures)
    console.log(`DIFF ${f.path}: capture ${show(f.capture)} | game ${show(f.game)}`);
  console.log(`allowed: ${JSON.stringify(r.allowed)}`);
  console.log(`${r.failures.length} unexplained difference(s)`);
  let missing = 0;
  for (const side of ['capture', 'game']) {
    const misses = checkSession(pair[side], {otherCars: pair.otherCars});
    missing += misses.length;
    console.log(`manifest, ${side} path: ${misses.length ? misses.join('; ') : 'complete'}`);
  }
  process.exitCode = r.failures.length || missing ? 1 : 0;
}
