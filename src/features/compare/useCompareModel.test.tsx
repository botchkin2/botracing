import {describe, expect, it, jest} from '@jest/globals';
import {act, create} from 'react-test-renderer';

import {type RawTrace, resampleTrace} from '@/src/analysis/resample';
// Adapters are internal to data/; tests reach them to build real shapes.
import {toLaps, toSessionDetail} from '@/src/data/sessions/adapters';

import * as model from './model';
import {type CompareResult, useCompareModel} from './useCompareModel';

// The set (laps, basis, lines, tables) must be built once per selection and
// kept while the cursor moves (pit-wall thread 1 #3245, rake #3252). The data
// hooks are replaced with stable answers, as React Query gives between
// renders, and the screen's selection is rebuilt on every render, as a URL
// re-parse does, so only the hook's own keys can hold the set.

const LENGTH_M = 1000;

function lap(seed: number): RawTrace {
  const n = 400;
  const pct = Array.from({length: n}, (_, i) => i / (n - 1));
  const wave = (a: number, b: number) =>
    pct.map(p => a + b * Math.sin(2 * Math.PI * 3 * p + seed));
  return {
    lapDistPct: pct,
    speedKph: wave(150, 50),
    throttlePct: wave(60, 40),
    brakePct: wave(20, 20),
    steeringPct: wave(0, 20),
    gear: wave(4, 2).map(Math.round),
    lat: pct.map(p => 60 + Math.sin(2 * Math.PI * p) / 500),
    lon: pct.map(p => Math.cos(2 * Math.PI * p) / 250),
  };
}

const mockIDS = ['a', 'b', 'c', 'd'];
const LAPS = toLaps(
  mockIDS.map((id, i) => ({
    id,
    lapNumber: i + 1,
    lapTime: 60 + i * 0.2,
    comparable: true,
    reasons: [],
    corners: [],
  })),
);
const mockGRIDS = mockIDS.map((_, i) => resampleTrace(lap(i), LENGTH_M, 5));
const query = <T,>(data: T) => ({
  data,
  isPending: false,
  isError: false,
  error: null,
  refetch: () => Promise.resolve(),
});
const mockSESSION = query(
  toSessionDetail({
    id: 's1',
    sim: 'lmu',
    track: {name: 'Test Ring', variant: 'Test Ring'},
    car: {name: 'GT3'},
    sessionType: 'Race',
    startedAt: '2026-10-01T00:00:00Z',
    bestLapId: 'a',
    medianLapTime: 60,
    stints: [],
  }),
);
const mockLAPS_Q = query(LAPS);
const mockBAND = query({lengthM: LENGTH_M, stepM: 5});
const mockNONE = query(null);
const mockNO_FOREIGN_LAPS = {laps: [], pending: false};
const mockNO_FOREIGN_DETAILS = {details: [], pending: false};
const mockTraceLoads = new Map<string, unknown>();

jest.mock('@/src/data/sessions', () => {
  const actual = jest.requireActual<object>('@/src/data/sessions');
  return {
    ...actual,
    useSession: () => mockSESSION,
    useSessionLaps: () => mockLAPS_Q,
    useSessionBand: () => mockBAND,
    useSessionMap: () => mockNONE,
    useSessionSurface: () => mockNONE,
    useSessionsLaps: () => mockNO_FOREIGN_LAPS,
    useSessionsDetail: () => mockNO_FOREIGN_DETAILS,
  };
});

jest.mock('@/src/data/traces', () => ({
  // One stable answer per set of ids, as the query cache gives.
  useLapTraceLoad: (ids: string[]) => {
    const key = ids.join(',');
    if (!mockTraceLoads.has(key))
      mockTraceLoads.set(key, {
        traces: ids.map(id => mockGRIDS[mockIDS.indexOf(id)]),
        load: {kind: 'done'},
        retry: () => {},
      });
    return mockTraceLoads.get(key);
  },
}));

const CHARTS: model.ChannelId[][] = [['timeDiff'], ['speed']];
const WINDOW: model.ChartWindow = {mode: 'time', size: null};

describe('useCompareModel', () => {
  it('builds the set once while the cursor moves 20 times', () => {
    const builds = jest.spyOn(model, 'buildCompareSet');
    let out: CompareResult | null = null;
    function Probe({cursorM}: {cursorM: number}) {
      // A fresh selection and laps array every render, as a URL re-parse gives.
      out = useCompareModel(
        's1',
        {laps: [...mockIDS], ref: null, hl: null, corner: null, cursorM},
        CHARTS,
        WINDOW,
      );
      return null;
    }
    let root!: ReturnType<typeof create>;
    act(() => {
      root = create(<Probe cursorM={0} />);
    });
    const afterOpen = builds.mock.calls.length;
    const distances: string[] = [];
    for (let k = 1; k <= 20; k++) {
      act(() => root.update(<Probe cursorM={k * 37} />));
      const r = out as CompareResult | null;
      if (r?.state === 'ready') distances.push(r.model.position.distance);
    }
    expect(afterOpen).toBe(1);
    expect(builds.mock.calls.length - afterOpen).toBe(0);
    // And the cursor did move the model on every step.
    expect(new Set(distances).size).toBe(20);
    builds.mockRestore();
  });
});
