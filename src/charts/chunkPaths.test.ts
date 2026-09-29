import {describe, expect, it} from '@jest/globals';

import {buildChunk, type ChunkFrame, chunkPath, chunksIn} from './chunkPaths';

// Deterministic noise: pedal-like steps and spikes, so the monotone
// overshoot fix fires often.
function noise(n: number, seed = 7): number[] {
  let s = seed;
  const out: number[] = [];
  let v = 50;
  for (let i = 0; i < n; i++) {
    s = (s * 16807) % 2147483647;
    const r = s / 2147483647;
    v = r < 0.1 ? r * 1000 : r > 0.95 ? 0 : v + (r - 0.5) * 20;
    out.push(v);
  }
  return out;
}

// 1000 m, samples every ~0.37 m (100 Hz at ~130 km/h), grid every 5 m.
const samples = {
  distanceM: Array.from({length: 2700}, (_, i) => i * 0.37),
  values: noise(2700),
};
const values = noise(201, 3);

const frame = (
  chunkPx: number,
  extra: Partial<ChunkFrame> = {},
): ChunkFrame => ({
  key: `t${chunkPx}`,
  uOfM: m => m,
  uOfIndex: i => i * 5,
  stepM: 5,
  sx: 1.5,
  y: v => 100 - v,
  chunkPx,
  mPerPx: 1 / 1.5,
  ...extra,
});

// Path commands after each move: the drawn segments, in order.
const segments = (d: string) =>
  d
    .split(/(?=[MCLHV])/)
    .filter(c => c && c[0] !== 'M')
    .join('');

const inChunks = (src: Parameters<typeof buildChunk>[0], chunkPx: number) => {
  const total = 1000 * 1.5;
  let out = '';
  for (let k = 0; k * chunkPx <= total; k++)
    out += segments(buildChunk(src, frame(chunkPx), k));
  return out;
};

describe('buildChunk', () => {
  it('recorded samples: chunks join into exactly the whole line', () => {
    const src = {values: [], samples};
    const whole = segments(buildChunk(src, frame(1e9), 0));
    expect(whole.length).toBeGreaterThan(0);
    expect(inChunks(src, 375)).toBe(whole);
    expect(inChunks(src, 100)).toBe(whole);
  });

  it('grid values: chunks join into exactly the whole line', () => {
    const src = {values};
    expect(inChunks(src, 375)).toBe(segments(buildChunk(src, frame(1e9), 0)));
  });

  it('steps: chunks join into exactly the whole line', () => {
    const src = {values: [], samples, stepped: true};
    const whole = segments(buildChunk(src, frame(1e9), 0));
    expect(whole).toMatch(/^H/);
    expect(inChunks(src, 375)).toBe(whole);
  });

  it('a chunk past the lap is empty', () => {
    expect(buildChunk({values: [], samples}, frame(375), 10)).toBe('');
  });
});

describe('chunksIn', () => {
  it('adds the chunk to the left, whose last segment reaches in', () => {
    expect(chunksIn(400, 775, 375)).toEqual([0, 1, 2]);
    expect(chunksIn(0, 375, 375)).toEqual([-1, 0, 1]);
  });
});

describe('chunkPath', () => {
  it('builds a chunk once per source and frame', () => {
    const src = {values: [], samples};
    const f = frame(375, {key: 'cache'});
    const a = chunkPath(src, f, 1);
    // A frame with the same key but a different mapping would draw
    // differently; getting the first string back proves the cache hit.
    const b = chunkPath(src, {...f, y: v => v}, 1);
    expect(b).toBe(a);
    expect(chunkPath(src, {...f, key: 'other', y: v => v}, 1)).not.toBe(a);
  });
});
