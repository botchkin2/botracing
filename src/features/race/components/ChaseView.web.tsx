import {createElement, useEffect, useLayoutEffect, useMemo, useRef, useState} from 'react';
import {createPortal} from 'react-dom';
import {StyleSheet, View} from 'react-native';
import Svg, {Circle, G, Path} from 'react-native-svg';

import {altitudeLabel, chaseHudNumbers, elevationWindow, type ElevationWindow, gearLabel, gradeLabel} from '@/src/analysis/chaseHud';
import type {ChaseRoad} from '@/src/analysis/chaseRoad';
import {radius, space, useTheme} from '@/src/design';
import {formatGap} from '@/src/design/format';
import {Pressable, Segment, Text} from '@/src/ui';

import type {ChaseCamMode, ChaseCar, ChaseEngine, ChaseGaps, ChaseInputs, ChaseSampler} from '@/src/features/race/chase/chaseTypes';

// The 3D chase view, drawn as an instrument. Web only: the engine and three.js load on first use (a lazy import), so
// they stay out of the main bundle and out of the native app. Everything on screen is the app's own tokens; nothing
// sits in the middle.
export const chaseAvailable = true;

const CAMS = [
  {value: '1', label: 'Chase'},
  {value: '2', label: 'High'},
  {value: '3', label: 'TV'},
  {value: '4', label: 'Heli'},
] as const;
type CamValue = '1' | '2' | '3' | '4';

const BEHIND_M = 100;
const AHEAD_M = 500;

type ChaseProps = {
  width: number;
  height: number;
  road: ChaseRoad;
  cars: ChaseCar[];
  sample: ChaseSampler;
  timeS: number;
  focus: number | null;
  playing: boolean;
  rate: number;
  inputs: ChaseInputs | null;
  gaps: ChaseGaps | null;
  clockLabel: string;
  onToggle: () => void;
  onStep: (deltaS: number) => void;
  onCycleRate: () => void;
  onPressCar: (index: number) => void;
};

// Full screen is a portal to the page body: the view leaves the map's frame (and its stacking order). The engine and
// its canvas belong here, made once, and the canvas's host element moves between the two frames, so toggling full
// screen never makes a second WebGL context (a browser keeps only a handful). The camera choice is kept here too.
export function ChaseView(props: ChaseProps) {
  const [full, setFull] = useState(false);
  const [cam, setCam] = useState<CamValue>('1');
  const {failed, host} = useChaseEngine(props, cam);
  const surface = (
    <ChaseSurface {...props} full={full} setFull={setFull} cam={cam} setCam={setCam} host={host} failed={failed} />
  );
  return full && typeof document !== 'undefined'
    ? createPortal(surface, document.body)
    : surface;
}

/** The engine, made once for the life of the view, and the element its canvas lives in. */
function useChaseEngine(
  {road, sample, timeS, focus, playing, rate, inputs, onPressCar}: ChaseProps,
  cam: CamValue,
): {failed: string | null; host: HTMLDivElement} {
  const {color} = useTheme();
  const [host] = useState(() => {
    const el = document.createElement('div');
    el.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%';
    return el;
  });
  const engine = useRef<ChaseEngine | null>(null);
  const pick = useRef(onPressCar);
  useEffect(() => {
    pick.current = onPressCar;
  });
  // Why the engine did not start: a lazy chunk a deploy has replaced (a long-open window, the tray's), or no WebGL.
  const [failed, setFailed] = useState<string | null>(null);
  const theme = useMemo(
    () => ({
      bg: color.bg,
      fill: color.trackFill,
      edge: color.followEdge,
      edgeFaint: color.trackEdge,
      grid: color.grid,
      text: color.text,
      muted: color.textMuted,
      line: color.lineStrong,
      accent: color.accent,
      good: color.faster,
      bad: color.slower,
    }),
    [color],
  );
  useEffect(() => {
    let dead = false;
    let made: ChaseEngine | null = null;
    (async () => {
      try {
        const {mountChase} = await import('../chase/chaseEngine');
        if (dead) return;
        made = mountChase(host, {onPick: (i: number) => pick.current(i), theme});
        engine.current = made;
        made.setRoad(road);
        made.setCam(Number(cam) as ChaseCamMode);
        made.setInputs(inputs?.ribbon ?? null);
        made.update({sample, timeS, focus, playing, rate, inputIdx: inputs?.now?.idx ?? -1});
      } catch (e) {
        console.warn('3D chase did not start', e);
        if (!dead) setFailed(e instanceof Error && e.message ? e.message : 'unknown error');
      }
    })();
    return () => {
      dead = true;
      engine.current = null;
      made?.dispose();
    };
    // The engine is made once; the road, cars and inputs reach it below.
  }, []);
  useEffect(() => {
    engine.current?.setRoad(road);
    engine.current?.setInputs(inputs?.ribbon ?? null);
    // A new road redraws the inputs on it.
  }, [road]);
  const ribbon = inputs?.ribbon ?? null;
  useEffect(() => {
    engine.current?.setInputs(ribbon);
  }, [ribbon]);
  useEffect(() => {
    engine.current?.update({sample, timeS, focus, playing, rate, inputIdx: inputs?.now?.idx ?? -1});
  }, [sample, timeS, focus, playing, rate, inputs]);
  useEffect(() => {
    engine.current?.setCam(Number(cam) as ChaseCamMode);
  }, [cam]);
  return {failed, host};
}

function ChaseSurface({
  width,
  height,
  road,
  cars,
  focus,
  playing,
  rate,
  inputs,
  gaps,
  clockLabel,
  onToggle,
  onStep,
  onCycleRate,
  onPressCar,
  full,
  setFull,
  cam,
  setCam,
  host,
  failed,
}: ChaseProps & {
  full: boolean;
  setFull: (f: boolean) => void;
  cam: CamValue;
  setCam: (c: CamValue) => void;
  host: HTMLDivElement;
  failed: string | null;
}) {
  const {color} = useTheme();
  // Full screen: its own play toggle (Space) and a way out (Esc).
  useEffect(() => {
    if (!full) return;
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setFull(false);
      else if (e.key === ' ') {
        e.preventDefault();
        onToggle();
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [full, onToggle, setFull]);
  // the engine's canvas moves into whichever frame is showing
  const slot = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    slot.current?.appendChild(host);
    return () => host.remove();
  }, [host]);
  const me = useMemo(
    () => cars.find(c => c.index === focus) ?? cars.find(c => c.player) ?? null,
    [cars, focus],
  );
  const now = me?.player === true ? inputs?.now ?? null : null;
  const {gradePct: grade, altM: alt} = chaseHudNumbers(road, me?.lapDistM ?? null);
  const hasHeight = road.elev !== null;
  const profile = useMemo(
    () => (me && Number.isFinite(me.lapDistM) ? elevationWindow(road, me.lapDistM, BEHIND_M, AHEAD_M, 48) : null),
    [road, me],
  );
  const roomy = (full ? (typeof window === 'undefined' ? width : window.innerWidth) : width) >= 760;

  return (
    <View
      style={
        full
          ? ({position: 'fixed', left: 0, top: 0, right: 0, bottom: 0, zIndex: 1000, backgroundColor: color.bg} as object)
          : {width, height, backgroundColor: color.bg}
      }>
      {createElement('div', {
        ref: slot,
        style: {position: 'absolute', left: 0, top: 0, width: '100%', height: '100%'},
      })}
      {failed !== null ? (
        <View style={styles.center}>
          <Text tone='textMuted'>3D unavailable</Text>
          <Pressable
            accessibilityLabel='Reload the page'
            onPress={() => window.location.reload()}
            style={[styles.tool, {borderColor: color.lineStrong, backgroundColor: color.surface}]}>
            <Text variant='dataSmall'>Reload</Text>
          </Pressable>
        </View>
      ) : null}
      <View style={styles.cams}>
        <Segment options={CAMS} value={cam} onChange={setCam} />
        {full ? (
          <Pressable
            accessibilityLabel={playing ? 'Pause' : 'Play'}
            onPress={onToggle}
            style={[styles.tool, {borderColor: color.lineStrong, backgroundColor: color.surface}]}>
            <Text variant='dataStrong'>{playing ? '❚❚' : '▶'}</Text>
            <Text variant='dataSmall' tone='textMuted'>
              {clockLabel}
            </Text>
          </Pressable>
        ) : null}
        {full ? (
          <>
            {[-30, 30].map(d => (
              <Pressable
                key={d}
                accessibilityLabel={`${d > 0 ? 'Forward' : 'Back'} 30 seconds`}
                onPress={() => onStep(d)}
                style={[styles.tool, {borderColor: color.lineStrong, backgroundColor: color.surface}]}>
                <Text variant='dataSmall'>{d > 0 ? '+30 s' : '−30 s'}</Text>
              </Pressable>
            ))}
            <Pressable
              accessibilityLabel='Playback rate, tap for the next'
              onPress={onCycleRate}
              style={[styles.tool, {borderColor: color.lineStrong, backgroundColor: color.surface}]}>
              <Text variant='dataSmall'>{`${rate}×`}</Text>
            </Pressable>
          </>
        ) : null}
        <Pressable
          accessibilityLabel={full ? 'Close full screen' : 'Full screen'}
          onPress={() => setFull(!full)}
          style={[styles.tool, {borderColor: color.lineStrong, backgroundColor: color.surface}]}>
          <Text variant='dataStrong'>{full ? '×' : '⤢'}</Text>
        </Pressable>
      </View>
      {me ? (
        <View
          pointerEvents='none'
          style={[styles.strip, {backgroundColor: color.surface, borderColor: color.lineStrong}]}>
          {gaps ? (
            <View style={styles.cell}>
              <Text variant='dataStrong'>{`${gaps.classTag} P${gaps.classPlace}`}</Text>
              <Text variant='dataSmall' tone='textMuted'>{`▲ ${gaps.aheadS === null ? '–' : formatGap(-gaps.aheadS, 1)}`}</Text>
              <Text variant='dataSmall' tone='textMuted'>{`▼ ${gaps.behindS === null ? '–' : formatGap(gaps.behindS, 1)}`}</Text>
            </View>
          ) : null}
          {now ? (
            <Text variant='dataStrong'>
              {gearLabel(now.gear)}
            </Text>
          ) : null}
          <View style={styles.cell}>
            <Text variant='dataStrong'>{`${Math.round(now ? now.speedKph : me.speedKmh)}`}</Text>
            <Text variant='dataSmall' tone='textMuted'>
              km/h
            </Text>
          </View>
          {now ? (
            <>
              <View style={styles.pedals}>
                <Pedal value={now.brakePct} fill={color.slower} track={color.median} />
                <Pedal value={now.throttlePct} fill={color.faster} track={color.median} />
              </View>
              {roomy ? <Wheel pct={now.steeringPct} ink={color.text} mark={color.accent} ring={color.lineStrong} /> : null}
            </>
          ) : null}
          {hasHeight && grade !== null ? (
            <View style={styles.cell}>
              <Text variant='dataSmall' tone='textMuted'>
                {gradeLabel(grade)}
              </Text>
              {alt !== null ? (
                <Text variant='dataSmall' tone='textMuted'>{altitudeLabel(alt)}</Text>
              ) : null}
            </View>
          ) : null}
          {roomy && profile ? <Elevation win={profile} line={color.textMuted} dot={color.accent} /> : null}
        </View>
      ) : null}
    </View>
  );
}

function Pedal({value, fill, track}: {value: number; fill: string; track: string}) {
  return (
    <View style={[styles.pedal, {backgroundColor: track}]}>
      <View
        style={[
          styles.pedalFill,
          {height: `${Math.max(0, Math.min(100, value))}%`, backgroundColor: fill},
        ]}
      />
    </View>
  );
}

// Steering wheel, rotated by the recorded steering (a full lock reads about 210 degrees).
function Wheel({pct, ink, mark, ring}: {pct: number; ink: string; mark: string; ring: string}) {
  const deg = Math.max(-100, Math.min(100, pct)) * 2.1;
  return (
    <Svg width={26} height={26} viewBox='-26 -26 52 52'>
      <Circle r={20} fill='none' stroke={ring} strokeWidth={3.5} />
      <G rotation={deg}>
        <Path d='M-20 0H20M0 0V20' stroke={ink} strokeWidth={3.5} strokeLinecap='round' />
        <Path d='M-5 -20h10' stroke={mark} strokeWidth={4} strokeLinecap='round' />
      </G>
    </Svg>
  );
}

// The curated height 100 m behind and 500 m ahead of the car, the car a dot.
function Elevation({win, line, dot}: {win: ElevationWindow; line: string; dot: string}) {
  const W = 150;
  const H = 26;
  const n = win.heights.length - 1;
  const y = (z: number) => H - 3 - ((z - win.baseM) / win.spanM) * (H - 6);
  const d = win.heights.map((z, i) => `${i ? 'L' : 'M'}${((i / n) * W).toFixed(1)} ${y(z).toFixed(1)}`).join('');
  return (
    <Svg width={W} height={H}>
      <Path d={d} stroke={line} strokeWidth={1.2} fill='none' />
      <Circle cx={(win.carIndex / n) * W} cy={y(win.heights[win.carIndex])} r={3} fill={dot} />
    </Svg>
  );
}

const styles = StyleSheet.create({
  center: {...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center', gap: space.sm},
  cams: {
    position: 'absolute',
    left: space.sm,
    bottom: space.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
  },
  tool: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingHorizontal: space.sm,
    minHeight: 28,
  },
  // One flat strip on the bottom edge: numerals in mono, nothing in the middle of the view.
  strip: {
    position: 'absolute',
    right: space.sm,
    bottom: space.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingHorizontal: space.sm,
    minHeight: 32,
    maxWidth: '62%',
  },
  cell: {flexDirection: 'row', alignItems: 'baseline', gap: space.xs},
  pedals: {flexDirection: 'row', gap: 3, height: 22},
  pedal: {width: 6, borderRadius: 1, overflow: 'hidden'},
  pedalFill: {position: 'absolute', left: 0, right: 0, bottom: 0},
});
