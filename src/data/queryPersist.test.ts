import {afterEach, describe, expect, it, jest} from '@jest/globals';
import {QueryClient} from '@tanstack/react-query';

import {
  forgetQueryPersist,
  isPersisted,
  loadSnapshot,
  type KeyValueStore,
  MAX_AGE_MS,
  PERSIST_VERSION,
  restoreSnapshot,
  snapshotOf,
  startQueryPersist,
} from './queryPersist';

const MAP = ['tracks', 'lmu-test_ring', 'map'] as const;
const SURFACE = ['tracks', 'lmu-test_ring', 'surface'] as const;
const PLAN = ['sessions', 'plan', 'lmu', 'lmu-test_ring', '911 GT3 R'] as const;
const LAPS = ['sessions', 'laps', 's1'] as const;
const NOW = 1_800_000_000_000;

// No garbage-collection timers: they would keep jest alive after the run.
const newClient = () =>
  new QueryClient({defaultOptions: {queries: {gcTime: Infinity}}});

function filled(): QueryClient {
  const c = newClient();
  c.setQueryData(MAP, {corners: [1, 2]});
  c.setQueryData(SURFACE, {bins: 3});
  c.setQueryData(PLAN, {items: [{id: 's1'}]});
  c.setQueryData(LAPS, [{id: 'lap'}]);
  return c;
}

function memoryStore(): KeyValueStore & {data: Map<string, string>} {
  const data = new Map<string, string>();
  return {
    data,
    getItem: async k => data.get(k) ?? null,
    setItem: async (k, v) => {
      data.set(k, v);
    },
    removeItem: async k => {
      data.delete(k);
    },
  };
}

describe('which queries a reopen keeps', () => {
  it('a layout map, its surface and the Plan, never laps or traces', () => {
    expect(isPersisted(MAP)).toBe(true);
    expect(isPersisted(SURFACE)).toBe(true);
    expect(isPersisted(PLAN)).toBe(true);
    expect(isPersisted(LAPS)).toBe(false);
    expect(isPersisted(['sessions', 'detail', 's1'])).toBe(false);
    expect(isPersisted(['traces', 'x'])).toBe(false);
  });
});

describe('snapshot and restore', () => {
  it('puts back only the kept queries, for the same person', () => {
    const raw = snapshotOf(filled(), 'u1', NOW);
    const next = newClient();
    expect(restoreSnapshot(next, raw, 'u1', NOW + 1000)).toBe(true);
    expect(next.getQueryData(MAP)).toEqual({corners: [1, 2]});
    expect(next.getQueryData(SURFACE)).toEqual({bins: 3});
    expect(next.getQueryData(PLAN)).toEqual({items: [{id: 's1'}]});
    expect(next.getQueryData(LAPS)).toBeUndefined();
  });

  it("drops another person's, an old version's, a stale or a broken snapshot", () => {
    const raw = snapshotOf(filled(), 'u1', NOW);
    const fresh = () => newClient();
    expect(restoreSnapshot(fresh(), raw, 'u2', NOW)).toBe(false);
    const old = JSON.stringify({...JSON.parse(raw), v: PERSIST_VERSION - 1});
    expect(restoreSnapshot(fresh(), old, 'u1', NOW)).toBe(false);
    expect(restoreSnapshot(fresh(), raw, 'u1', NOW + MAX_AGE_MS + 1)).toBe(false);
    expect(restoreSnapshot(fresh(), '{not json', 'u1', NOW)).toBe(false);
    expect(restoreSnapshot(fresh(), null, 'u1', NOW)).toBe(false);
  });

  it('never replaces newer data already in the cache', () => {
    const raw = snapshotOf(filled(), 'u1', NOW);
    const next = newClient();
    next.setQueryData(MAP, {corners: [9]}, {updatedAt: Date.now() + 60_000});
    restoreSnapshot(next, raw, 'u1', NOW);
    expect(next.getQueryData(MAP)).toEqual({corners: [9]});
  });
});

describe('kept while signed in', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('restores at start, writes a kept query a moment after it changes, and forgets on request', async () => {
    const store = memoryStore();
    await store.setItem('query-cache', snapshotOf(filled(), 'u1', NOW));
    const client = newClient();
    const raw = await loadSnapshot(store);
    jest.useFakeTimers();
    // Back in the cache at once, before any screen could fetch.
    const stop = startQueryPersist(client, store, 'u1', raw, () => NOW);
    expect(client.getQueryData(MAP)).toEqual({corners: [1, 2]});

    store.data.clear();
    client.setQueryData(LAPS, [{id: 'not kept'}]);
    jest.advanceTimersByTime(5_000);
    expect(store.data.size).toBe(0);

    client.setQueryData(SURFACE, {bins: 4});
    jest.advanceTimersByTime(5_000);
    await Promise.resolve();
    const saved = JSON.parse(store.data.get('query-cache') ?? '{}');
    expect(saved.uid).toBe('u1');
    expect(JSON.stringify(saved.state)).toContain('"bins":4');
    expect(JSON.stringify(saved.state)).not.toContain('not kept');

    stop();
    await forgetQueryPersist(store);
    expect(store.data.size).toBe(0);
  });
});
