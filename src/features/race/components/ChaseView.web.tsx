import {createElement, useEffect, useMemo, useRef, useState} from 'react';
import {createPortal} from 'react-dom';
import {StyleSheet, View} from 'react-native';
import Svg, {Circle, G, Line, Path} from 'react-native-svg';

import {type ChaseRoad, gradeAt, heightAt} from '@/src/analysis/chaseRoad';
import {radius, space, useTheme} from '@/src/design';
import {Pressable, Segment, Text} from '@/src/ui';

import type {ChaseCamMode, ChaseEngine} from '../chase/chaseTypes';
import {type ChaseCar, type ChaseGaps, type ChaseInputs} from './chaseTypes';

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

// Full screen is a portal to the page body: the view leaves the map's frame (and its stacking order),
// so the engine is made again there. The camera choice is kept here.
export function ChaseView(props: ChaseProps) {
  const [full, setFull] = useState(false);
  const [cam, setCam] = useState<CamValue>('1');
  const surface = (
    <ChaseSurface {...props} full={full} setFull={setFull} cam={cam} setCam={setCam} />
  );
  return full && typeof document !== 'undefined'
    ? createPortal(surface, document.body)
    : surface;
}

function fmtGap(v: number | null, sign: string) {
  return v == null ? '–' : `${sign}${v.toFixed(1)}`;
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
}: ChaseProps & {
  full: boolean;
  setFull: (f: boolean) => void;
  cam: CamValue;
  setCam: (c: CamValue) => void;
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
  const host = useRef<HTMLDivElement | null>(null);
  const engine = useRef<ChaseEngine | null>(null);
  const pick = useRef(onPressCar);
  useEffect(() => {
    pick.current = onPressCar;
  });
  const [failed, setFailed] = useState(false);
  const theme = useMemo(
    () => ({
      bg: color.bg,
      fill: color.trackFill,
      edge: color.followEdge,
      edgeFaint: color.trackEdge,
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
        if (dead || !host.current) return;
        made = mountChase(host.current, {onPick: (i: number) => pick.current(i), theme});
        if (dead) {
          made.dispose();
          return;
        }
        engine.current = made;
        made.setRoad(road);
        made.setCam(Number(cam) as ChaseCamMode);
        made.setInputs(inputs?.ribbon ?? null);
        made.update({cars, focus, playing, rate, inputIdx: inputs?.now?.idx ?? -1});
      } catch {
        if (!dead) setFailed(true);
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
    engine.current?.update({cars, focus, playing, rate, inputIdx: inputs?.now?.idx ?? -1});
  }, [cars, focus, playing, rate, inputs]);
  useEffect(() => {
    engine.current?.setCam(Number(cam) as ChaseCamMode);
  }, [cam]);

  const me = useMemo(
    () => cars.find(c => c.index === focus) ?? cars.find(c => c.player) ?? null,
    [cars, focus],
  );
  const now = me?.player === true ? inputs?.now ?? null : null;
  const frac = me && road.lengthM > 0 ? me.lapDistM / road.lengthM : 0;
  const hasHeight = road.elev !== null;
  const grade = road.elev && me ? gradeAt(road.elev, frac, road.lengthM) * 100 : null;
  const alt = road.elev && me ? heightAt(road.elev, frac) - Math.min(...road.elev) : null;
  const roomy = (full ? (typeof window === 'undefined' ? width : window.innerWidth) : width) >= 760;

  return (
    <View
      style={
        full
          ? ({position: 'fixed', left: 0, top: 0, right: 0, bottom: 0, zIndex: 1000, backgroundColor: color.bg} as object)
          : {width, height, backgroundColor: color.bg}
      }>
      {createElement('div', {
        ref: host,
        style: {position: 'absolute', left: 0, top: 0, width: '100%', height: '100%'},
      })}
      {failed ? (
        <View style={styles.center}>
          <Text tone='textMuted'>3D unavailable</Text>
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
              <Text variant='dataSmall' tone='textMuted'>{`▲ ${fmtGap(gaps.aheadS, '−')}`}</Text>
              <Text variant='dataSmall' tone='textMuted'>{`▼ ${fmtGap(gaps.behindS, '+')}`}</Text>
            </View>
          ) : null}
          {now ? (
            <Text variant='dataStrong' tone='accentInk'>
              {now.gear <= 0 ? (now.gear < 0 ? 'R' : 'N') : String(now.gear)}
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
              <Text variant='dataSmall' tone={grade > 2.5 ? 'accentInk' : 'textMuted'}>
                {`${grade > 0 ? '+' : ''}${grade.toFixed(1)}%`}
              </Text>
              {alt !== null ? (
                <Text variant='dataSmall' tone='textMuted'>{`${Math.round(alt)} m`}</Text>
              ) : null}
            </View>
          ) : null}
          {hasHeight && roomy && road.elev ? (
            <Elevation
              elev={road.elev}
              frac={frac}
              lengthM={road.lengthM}
              line={color.textMuted}
              up={color.accent}
              down={color.class2}
              dot={color.text}
            />
          ) : null}
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

// The measured height 100 m behind and 500 m ahead of the car, coloured by grade, the car a dot.
function Elevation({
  elev,
  frac,
  lengthM,
  line,
  up,
  down,
  dot,
}: {
  elev: number[];
  frac: number;
  lengthM: number;
  line: string;
  up: string;
  down: string;
  dot: string;
}) {
  const W = 150;
  const H = 26;
  const n = 48;
  const span = BEHIND_M + AHEAD_M;
  const zs: number[] = [];
  for (let i = 0; i <= n; i++) zs.push(heightAt(elev, frac - BEHIND_M / lengthM + (span / lengthM) * (i / n)));
  const lo = Math.min(...zs);
  const hi = Math.max(...zs);
  const range = Math.max(hi - lo, 10);
  const mid = (hi + lo) / 2;
  const y = (z: number) => H - 3 - ((z - (mid - range / 2)) / range) * (H - 6);
  const x = (i: number) => (i / n) * W;
  const segs = [];
  for (let i = 1; i <= n; i++) {
    const g = (zs[i] - zs[i - 1]) / (span / n);
    segs.push(
      <Line
        key={i}
        x1={x(i - 1)}
        y1={y(zs[i - 1])}
        x2={x(i)}
        y2={y(zs[i])}
        stroke={g > 0.03 ? up : g < -0.03 ? down : line}
        strokeWidth={1.6}
        strokeLinecap='round'
      />,
    );
  }
  return (
    <Svg width={W} height={H}>
      {segs}
      <Circle cx={(BEHIND_M / span) * W} cy={y(zs[Math.round((BEHIND_M / span) * n)])} r={3} fill={dot} />
    </Svg>
  );
}

const styles = StyleSheet.create({
  center: {...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center'},
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
