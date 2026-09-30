// Dev tool: where a track's measured road and its OpenStreetMap roads disagree
// (pit-wall thread 44, E). Not app code and not run by the uploader.
//
// For each track with a surface artifact it places the measured road and the
// OSM ways the way the app does (src/data/sessions/mapPlace.ts: surface in game
// metres -> georef -> map metres, then dropOsmInsideSurface), then lists what
// the app still draws from OSM next to it and any jump or gap in the measured
// path. One SVG per track shows the same (measured road teal, OSM kept red,
// OSM faded amber, pit lane grey), so a leftover fake road is visible without
// the app.
//
//   node tools/sessions/surfaceAudit.mjs [--api BASE] [--out DIR] [--track ID]
import {mkdirSync, writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {
  applyGeoref,
  canDrawOnRealMap,
  fromLocalMetres,
  LMU_FAKE_ORIGIN,
  toLocalMetres,
} from '../../src/analysis/geo.ts';
import {
  dropOsmInsideSurface,
  FADE_REACH_M,
  surfaceGeometry,
} from '../../src/analysis/trackSurface.ts';

const arg = name => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : null;
};
const API = arg('api') ?? 'https://botracing-61.web.app/api/lmu';
const OUT = resolve(arg('out') ?? 'surface-audit');
const ONLY = arg('track');
// A kept OSM stretch shorter than this is fit noise, not a road.
const MIN_LEFTOVER_M = 20;
// A step between neighbouring centre bins past this many bin lengths is a jump.
const JUMP_BINS = 2.5;

async function get(path) {
  const r = await fetch(`${API}${path}`);
  return r.ok ? r.json() : null;
}

const lengthM = pts => {
  let s = 0;
  for (let i = 1; i < pts.length; i++) {
    s += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  }
  return s;
};

function nearest(p, runs) {
  let best = Infinity;
  for (const run of runs) {
    for (const c of run.centre) {
      best = Math.min(best, Math.hypot(p.x - c.x, p.y - c.y));
    }
  }
  return best;
}

async function audit(trackId, sessionId) {
  const [surface, map] = await Promise.all([
    get(`/sessions/${sessionId}/surface`),
    get(`/sessions/${sessionId}/map`),
  ]);
  if (!surface) return {trackId, note: 'no surface artifact (404)'};
  if (!map) return {trackId, note: 'no map'};
  const georef = canDrawOnRealMap(map.quality, map.georef) ? map.georef : null;
  const origin = georef
    ? {lat: georef.originLat, lon: georef.originLon}
    : LMU_FAKE_ORIGIN;
  const place = pts => {
    const ll = pts.map(p => fromLocalMetres(p, LMU_FAKE_ORIGIN));
    return (georef ? applyGeoref(ll, georef) : ll).map(p =>
      toLocalMetres(p, origin),
    );
  };
  const g = surfaceGeometry(surface);
  const runs = g.runs.map(run => ({
    ...run,
    centre: place(run.centre),
    fromM: 0,
  }));
  const placed = {...g, runs};

  const features = map.outline?.features ?? [];
  const ways = [];
  const pit = [];
  for (const f of features) {
    if (f.geometry?.type !== 'LineString') continue;
    const pts = f.geometry.coordinates.map(([lon, lat]) =>
      toLocalMetres({lat, lon}, origin),
    );
    if (f.properties?.kind === 'pit') pit.push(pts);
    else {
      ways.push({
        id: f.properties?.osmId,
        name: f.properties?.name ?? '(unnamed)',
        kind: f.properties?.kind ?? 'unknown',
        points: pts,
      });
    }
  }
  const split = georef ? dropOsmInsideSurface(ways, placed) : [];
  const nameOf = new Map(ways.map(w => [w.id, w.name]));

  const leftovers = [];
  for (const w of split) {
    for (const stretch of w.kept) {
      const len = lengthM(stretch);
      if (len < MIN_LEFTOVER_M) continue;
      const d = Math.min(...stretch.map(p => nearest(p, runs)));
      leftovers.push({
        way: w.id,
        name: nameOf.get(w.id),
        kind: w.kind,
        lengthM: Math.round(len),
        nearestToRoadM: Math.round(d),
      });
    }
  }
  const faded = split.reduce(
    (s, w) => s + w.faded.reduce((a, st) => a + lengthM(st), 0),
    0,
  );

  const binM = surface.stepM;
  const jumps = [];
  for (const run of runs) {
    for (let i = 1; i < run.centre.length; i++) {
      const d = Math.hypot(
        run.centre[i].x - run.centre[i - 1].x,
        run.centre[i].y - run.centre[i - 1].y,
      );
      if (d > binM * JUMP_BINS) jumps.push({atBin: i, stepM: Math.round(d)});
    }
  }

  const summary = {
    trackId,
    sessions: surface.sessions.length,
    real: georef != null,
    runs: runs.length,
    closed: runs.length === 1 && runs[0].closed,
    halfWidthM: g.halfWidthM == null ? null : +g.halfWidthM.toFixed(1),
    leftovers: leftovers.sort((a, b) => a.nearestToRoadM - b.nearestToRoadM),
    fadedM: Math.round(faded),
    jumps,
  };
  mkdirSync(OUT, {recursive: true});
  writeFileSync(
    resolve(OUT, `${trackId}.svg`),
    svg(runs, split, pit, g.halfWidthM ?? 6),
  );
  return summary;
}

function svg(runs, split, pit, half) {
  const all = [
    ...runs.flatMap(r => r.centre),
    ...split.flatMap(w => [...w.kept, ...w.faded].flat()),
  ];
  const xs = all.map(p => p.x);
  const ys = all.map(p => p.y);
  const x0 = Math.min(...xs) - 50;
  const y0 = Math.min(...ys) - 50;
  const w = Math.max(...xs) + 50 - x0;
  const h = Math.max(...ys) + 50 - y0;
  const path = pts =>
    pts
      .map(
        (p, i) => `${i ? 'L' : 'M'}${(p.x - x0).toFixed(1)} ${(h - (p.y - y0)).toFixed(1)}`,
      )
      .join('');
  const line = (lines, stroke, width, dash = '') =>
    lines
      .map(
        l =>
          `<path d="${path(l)}" fill="none" stroke="${stroke}" stroke-width="${width}" stroke-linejoin="round"${dash}/>`,
      )
      .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w.toFixed(0)} ${h.toFixed(0)}" width="1400" style="background:#0d0f14">
${line(pit, '#666', 3)}
${line(split.flatMap(w => w.faded), '#c98a1a', 3)}
${line(split.flatMap(w => w.kept), '#e0483e', 3)}
${line(runs.map(r => r.centre), '#2fb5a8', half * 2)}
</svg>`;
}

const sessions = await get('/sessions?age=365');
const byTrack = new Map();
for (const s of sessions?.items ?? []) {
  if (!byTrack.has(s.trackId)) byTrack.set(s.trackId, s.id);
}
for (const [trackId, sessionId] of byTrack) {
  if (ONLY && trackId !== ONLY) continue;
  console.log(JSON.stringify(await audit(trackId, sessionId)));
}
console.log(`faded stretches are within ${FADE_REACH_M} m of the road; SVGs in ${OUT}`);
