import {beforeEach, expect, it, jest} from '@jest/globals';

import {apiFetchAt} from '../http';

import {
  analysing,
  analysisFailed,
  analyzeDeps,
  analyzeOnce,
  POLL_FOR_MS,
  POLL_MS,
  resetAnalysisOnOpen,
  retryAnalysis,
  type AnalyzeDeps,
} from './analysisOnOpen';

jest.mock('../http', () => ({
  analyzeUrl: (id: string) => `/api/analyze/${id}`,
  apiFetchAt: jest.fn(),
}));
jest.mock('./client', () => ({fetchSession: jest.fn()}));

function deps(over: Partial<AnalyzeDeps> = {}) {
  let clock = 0;
  const calls: string[] = [];
  const d: AnalyzeDeps = {
    post: async () => (calls.push('post'), {status: 200}),
    isStale: async () => (calls.push('read'), false),
    refetch: async () => void calls.push('refetch'),
    wait: async ms => void (clock += ms),
    now: () => clock,
    ...over,
  };
  return {d, calls};
}

beforeEach(() => {
  resetAnalysisOnOpen();
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

it('analyses once and refetches; a second open in the same run does nothing', async () => {
  const {d, calls} = deps();
  expect(await analyzeOnce('s1', d)).toBe(true);
  expect(await analyzeOnce('s1', d)).toBe(false);
  expect(calls).toEqual(['post', 'refetch']);
});

it('while another open runs it (202), reads the session until it is fresh', async () => {
  let reads = 0;
  const {d, calls} = deps({
    post: async () => (calls.push('post'), {status: 202}),
    isStale: async () => (calls.push('read'), ++reads < 3),
  });
  expect(await analyzeOnce('s1', d)).toBe(true);
  expect(calls).toEqual(['post', 'read', 'read', 'read', 'refetch']);
});

it('stops reading after POLL_FOR_MS and refetches what is there', async () => {
  const {d, calls} = deps({
    post: async () => (calls.push('post'), {status: 202}),
    isStale: async () => (calls.push('read'), true),
  });
  await analyzeOnce('s1', d);
  expect(calls.filter(c => c === 'read')).toHaveLength(POLL_FOR_MS / POLL_MS);
  expect(calls.at(-1)).toBe('refetch');
});

it('a failure keeps the stored session: no refetch, no retry this run', async () => {
  const {d, calls} = deps({
    post: async () => (calls.push('post'), {status: 500}),
  });
  expect(await analyzeOnce('s1', d)).toBe(false);
  expect(await analyzeOnce('s1', d)).toBe(false);
  expect(calls).toEqual(['post']);
});

it('counts the sessions in flight for the working line', async () => {
  let release!: () => void;
  const {d} = deps({
    post: () =>
      new Promise(resolve => (release = () => resolve({status: 200}))),
  });
  const seen: number[] = [];
  const off = analysing.subscribe(() => seen.push(analysing.count()));
  const run = analyzeOnce('s1', d);
  expect(analysing.count()).toBe(1);
  release();
  await run;
  off();
  expect(analysing.count()).toBe(0);
  expect(seen).toEqual([1, 0]);
});

it('a 200 counts as done only with the JSON answer of the function, not a web page', async () => {
  const fetchAt = apiFetchAt as unknown as jest.Mock<
    (url: string) => Promise<{status: number; json: () => Promise<unknown>}>
  >;
  const post = analyzeDeps({} as never).post;
  fetchAt.mockResolvedValueOnce({
    status: 200,
    json: () => Promise.reject(new Error('not JSON: <!DOCTYPE html>')),
  });
  expect(await post('s1')).toEqual({status: 502});
  fetchAt.mockResolvedValueOnce({
    status: 200,
    json: async () => ({state: 'done', laps: 21}),
  });
  expect(await post('s1')).toEqual({status: 200});
  fetchAt.mockResolvedValueOnce({
    status: 202,
    json: async () => ({state: 'running'}),
  });
  expect(await post('s1')).toEqual({status: 202});
});

it('a live session runs again for each new lap, once per lap count', async () => {
  const {d, calls} = deps();
  expect(await analyzeOnce('s1', d, 's1#3')).toBe(true);
  expect(await analyzeOnce('s1', d, 's1#3')).toBe(false);
  expect(await analyzeOnce('s1', d, 's1#4')).toBe(true);
  expect(calls.filter(c => c === 'post')).toHaveLength(2);
});

it('never two runs of one session at once, whatever the key', async () => {
  let release: () => void = () => {};
  const {d, calls} = deps({
    post: () => {
      calls.push('post');
      return new Promise(r => (release = () => r({status: 200})));
    },
  });
  const first = analyzeOnce('s1', d, 's1#3');
  expect(await analyzeOnce('s1', d, 's1#4')).toBe(false);
  release();
  expect(await first).toBe(true);
  expect(calls.filter(c => c === 'post')).toHaveLength(1);
});

it('a live lap that lands while an analysis runs is analysed once that one has finished', async () => {
  let release: () => void = () => {};
  const {d, calls} = deps({
    post: async () => {
      calls.push('post');
      await new Promise<void>(resolve => (release = resolve));
      return {status: 200};
    },
  });
  const first = analyzeOnce('s1', d, 's1#3');
  // The next lap's key while the first runs: refused, and not consumed.
  expect(await analyzeOnce('s1', d, 's1#4')).toBe(false);
  release();
  expect(await first).toBe(true);
  // The screen asks again when the session is read again (useSession dataUpdatedAt).
  const again = analyzeOnce('s1', d, 's1#4');
  release();
  expect(await again).toBe(true);
  // Polls of the same lap count ask many times: once only.
  expect(await analyzeOnce('s1', d, 's1#4')).toBe(false);
  expect(calls.filter(c => c === 'post')).toHaveLength(2);
});

// Ticket 87: a run that did not finish is on screen, with a Retry.
it('a run that answers badly or throws marks the session failed; a good run clears it', async () => {
  const bad = deps({post: async () => ({status: 500})});
  expect(await analyzeOnce('s1', bad.d)).toBe(false);
  expect(analysisFailed.has('s1')).toBe(true);
  const thrown = deps({
    post: async () => {
      throw new Error('no answer');
    },
  });
  expect(await analyzeOnce('s2', thrown.d)).toBe(false);
  expect(analysisFailed.has('s2')).toBe(true);
  expect(analysisFailed.has('s3')).toBe(false);
  const good = deps();
  expect(await retryAnalysis('s1', good.d)).toBe(true);
  expect(analysisFailed.has('s1')).toBe(false);
  expect(good.calls).toEqual(['post', 'refetch']);
});

it('Retry runs again after a failure although this run already started it', async () => {
  const bad = deps({post: async () => ({status: 502})});
  await analyzeOnce('s1', bad.d);
  expect(await analyzeOnce('s1', deps().d)).toBe(false);
  expect(await retryAnalysis('s1', deps().d)).toBe(true);
});
