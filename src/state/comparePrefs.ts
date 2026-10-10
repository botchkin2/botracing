import AsyncStorage from '@react-native-async-storage/async-storage';
import {create} from 'zustand';
import {createJSONStorage, persist} from 'zustand/middleware';

import {
  DEFAULT_WINDOW,
  DISTANCE_STEPS_M,
  TIME_STEPS_S,
  type WindowMode,
} from '@/src/analysis/window';

// Compare preferences: how the user likes to look at laps, kept per user (not
// per session), so Compare opens the same way every time (handoff §3). The
// selection itself lives in the URL, never here.

export const CHANNEL_IDS = [
  'timeDiff',
  'speed',
  'throttle',
  'brake',
  'steering',
  'gear',
] as const;
export type ChannelId = (typeof CHANNEL_IDS)[number];

/** One chart = 1–3 channels overlaid on the same distance axis. */
export type ChartSet = ChannelId[][];

export const MAX_OVERLAY = 3;

export const PRESETS: {id: string; label: string; charts: ChartSet}[] = [
  {
    id: 'default',
    label: 'Default',
    charts: [
      ['timeDiff'],
      ['speed'],
      ['throttle', 'brake', 'steering'],
      ['gear'],
    ],
  },
  {
    id: 'pedals',
    label: 'Pedals',
    charts: [['timeDiff'], ['throttle', 'brake', 'steering']],
  },
  {id: 'braking', label: 'Braking', charts: [['speed', 'brake'], ['timeDiff']]},
  {id: 'separate', label: 'Separate', charts: CHANNEL_IDS.map(c => [c])},
];

export type CompareView = 'stack' | 'one';
/** Index into the mode's steps, or 'lap' for the whole lap. */
export type WindowStep = number | 'lap';
export const PLAY_RATES = [0.25, 0.5, 1, 2] as const;
export type PlayRate = (typeof PLAY_RATES)[number];

/** Compare map panel (handoff v2 M1). Satellite comes later. */
export type MapMode = 'follow' | 'track';

/**
 * The Follow map's visible span at each zoom step, in metres: the phone, Race
 * and desktop Compare all read 60 / 120 / 250 / 500 (round 5, item 6; they
 * were 0.6 / 1 / 1.7 times a base that differed by screen, camber #1304). The
 * saved zoom is an index into this, default 1 = 120 m.
 */
export const FOLLOW_SPANS_M = [60, 120, 250, 500] as const;
export type MapZoom = 0 | 1 | 2 | 3;

/** The desktop right column's width, points: the user drags it within this. */
export const RIGHT_W_MIN = 280;
export const RIGHT_W_MAX = 520;
export const RIGHT_W_DEFAULT = 360;
export const clampRightW = (w: number) =>
  Math.round(Math.min(RIGHT_W_MAX, Math.max(RIGHT_W_MIN, w)));

type ComparePrefs = {
  charts: ChartSet;
  view: CompareView;
  /** Chart shown in One chart view. */
  focused: number;
  mapShown: boolean;
  mapMode: MapMode;
  /** Index into FOLLOW_SPANS_M. */
  mapZoom: MapZoom;
  rightW: number;
  windowMode: WindowMode;
  windowStep: WindowStep;
  rate: PlayRate;
};

type Actions = {
  setCharts: (charts: ChartSet) => void;
  setView: (view: CompareView) => void;
  setFocused: (i: number) => void;
  setMapShown: (shown: boolean) => void;
  setMapMode: (mode: MapMode) => void;
  setMapZoom: (zoom: MapZoom) => void;
  setRightW: (width: number) => void;
  setWindowMode: (mode: WindowMode) => void;
  setWindowStep: (step: WindowStep) => void;
  setRate: (rate: PlayRate) => void;
};

// The phone opens on one chart, the pedals chart (round 3, pit-wall thread
// 27); desktop always stacks every chart, so `view` does not touch it.
const defaults: ComparePrefs = {
  charts: PRESETS[0].charts,
  view: 'one',
  focused: 2,
  mapShown: true,
  mapMode: 'follow',
  mapZoom: 1,
  rightW: RIGHT_W_DEFAULT,
  windowMode: 'time',
  windowStep: TIME_STEPS_S.indexOf(DEFAULT_WINDOW.time),
  rate: 1,
};

export const useComparePrefs = create<ComparePrefs & Actions>()(
  persist(
    set => ({
      ...defaults,
      setCharts: charts =>
        set(s => ({charts, focused: Math.min(s.focused, charts.length - 1)})),
      setView: view => set({view}),
      setFocused: focused => set({focused}),
      setMapShown: mapShown => set({mapShown}),
      setMapMode: mapMode => set({mapMode}),
      setMapZoom: mapZoom => set({mapZoom}),
      setRightW: width => set({rightW: clampRightW(width)}),
      // Switching mode resets to that mode's default size.
      setWindowMode: windowMode =>
        set({
          windowMode,
          windowStep:
            windowMode === 'time'
              ? TIME_STEPS_S.indexOf(DEFAULT_WINDOW.time)
              : DISTANCE_STEPS_M.indexOf(DEFAULT_WINDOW.distance),
        }),
      setWindowStep: windowStep => set({windowStep}),
      setRate: rate => set({rate}),
    }),
    {
      // v2: new default charts and view; older saved layouts are dropped.
      name: 'compare-prefs-v2',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: s => ({
        charts: s.charts,
        view: s.view,
        focused: s.focused,
        mapShown: s.mapShown,
        mapMode: s.mapMode,
        mapZoom: s.mapZoom,
        rightW: s.rightW,
        windowMode: s.windowMode,
        windowStep: s.windowStep,
        rate: s.rate,
      }),
    },
  ),
);

/** The window size in the mode's unit (s or m), or null for the whole lap. */
export function windowSize(mode: WindowMode, step: WindowStep): number | null {
  if (step === 'lap') return null;
  const steps = mode === 'time' ? TIME_STEPS_S : DISTANCE_STEPS_M;
  return steps[Math.max(0, Math.min(steps.length - 1, step))];
}

/** − / + on the window stepper: steps, then Lap at the top. */
export function stepWindow(
  mode: WindowMode,
  step: WindowStep,
  dir: -1 | 1,
): WindowStep {
  const n = (mode === 'time' ? TIME_STEPS_S : DISTANCE_STEPS_M).length;
  const i = step === 'lap' ? n : step;
  const next = Math.max(0, Math.min(n, i + dir));
  return next === n ? 'lap' : next;
}

// --- chart set edits (pure, for the editor) ----------------------------------

export function addChart(charts: ChartSet, channel: ChannelId): ChartSet {
  return [...charts, [channel]];
}

export function removeChart(charts: ChartSet, i: number): ChartSet {
  const next = charts.filter((_, j) => j !== i);
  return next.length ? next : [['speed']];
}

export function moveChart(charts: ChartSet, i: number, dir: -1 | 1): ChartSet {
  const j = i + dir;
  if (j < 0 || j >= charts.length) return charts;
  const next = [...charts];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}

/** Adds or removes a channel on one chart; the last channel removes the chart. */
export function toggleChannel(
  charts: ChartSet,
  i: number,
  channel: ChannelId,
): ChartSet {
  const chart = charts[i];
  if (!chart) return charts;
  if (chart.includes(channel)) {
    const rest = chart.filter(c => c !== channel);
    return rest.length
      ? charts.map((c, j) => (j === i ? rest : c))
      : removeChart(charts, i);
  }
  if (chart.length >= MAX_OVERLAY) return charts;
  return charts.map((c, j) => (j === i ? [...c, channel] : c));
}
