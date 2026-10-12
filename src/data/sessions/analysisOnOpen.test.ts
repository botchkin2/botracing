import {beforeEach, expect, it, jest} from '@jest/globals';

import {
  analysing,
  analyzeOnce,
  POLL_FOR_MS,
  POLL_MS,
  resetAnalysisOnOpen,
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
