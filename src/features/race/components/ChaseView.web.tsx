import {createElement, useEffect, useMemo, useRef, useState} from 'react';
import {createPortal} from 'react-dom';
import {StyleSheet, View} from 'react-native';
import Svg, {Circle, G, Line, Path} from 'react-native-svg';

import {type ChaseRoad, gradeAt, heightAt} from '@/src/analysis/chaseRoad';
import {radius, space, useTheme} from '@/src/design';
import {Pressable, Segment, Text} from '@/src/ui';

import {type ChaseCar, type ChaseInputs} from './chaseTypes';

// The 3D chase view (prototype). The engine is a plain module loaded at run time
// from /follow-cam/ with three.js, so three.js stays out of the app bundle; the
// proper path is the `three` dependency and a lazy import (pit wall thread 83).
export const chaseAvailable = true;

type Engine = {
  setRoad: (road: ChaseRoad) => void;
  setInputs: (ribbon: ChaseInputs['ribbon'] | null) => void;
  update: (state: Record<string, unknown>) => void;
  setCam: (mode: number) => void;
  debug?: () => unknown;
  dispose: () => void;
};
// A dynamic import by URL: Metro must not try to bundle it.
const load = new Function('u', 'return import(u)') as (u: string) => Promise<any>;

const CAMS = [
  {value: '1', label: 'Chase'},
  {value: '2', label: 'High'},
  {value: '3', label: 'Hood'},
  {value: '4', label: 'TV'},
  {value: '5', label: 'Heli'},
] as const;

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
  clockLabel: string;
  onToggle: () => void;
  onPressCar: (index: number) => void;
};
type CamValue = '1' | '2' | '3' | '4' | '5';

// Full screen is a portal to the page body: the view leaves the map's frame (and its stacking order),
// so the engine is made again there. The camera choice is kept here.
export function ChaseView(props: ChaseProps) {
  const [full, setFull] = useState(false);
  const [cam, setCam] = useState<CamValue>('1');
  const surface = <ChaseSurface {...props} full={full} setFull={setFull} cam={cam} setCam={setCam} />;
  return full && typeof document !== 'undefined' ? createPortal(surface, document.body) : surface;
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
  clockLabel,
  onToggle,
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
  }, [full, onToggle]);
  const host = useRef<HTMLDivElement | null>(null);
  const engine = useRef<Engine | null>(null);
  const pick = useRef(onPressCar);
  useEffect(() => {
    pick.current = onPressCar;
  });
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let dead = false;
    let made: Engine | null = null;
    (async () => {
      try {
        const [THREE, mod] = await Promise.all([
          load('/follow-cam/three.module.min.js'),
          load('/follow-cam/chase.js'),
        ]);
        if (dead || !host.current) return;
        made = (await mod.mountChase(host.current, THREE, {
          onPick: (i: number) => pick.current(i),
        })) as Engine;
        if (dead) {
          made.dispose();
          return;
        }
        engine.current = made;
        (window as unknown as {__chase?: Engine}).__chase = made; // for checks in the pane
        made.setRoad(road);
        made.setCam(Number(cam));
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
    engine.current?.update({
      cars,
      focus,
      playing,
      rate,
      inputIdx: inputs?.now?.idx ?? -1,
    });
  }, [cars, focus, playing, rate, inputs]);
  useEffect(() => {
    engine.current?.setCam(Number(cam));
  }, [cam]);

  const me = useMemo(
    () => cars.find(c => c.index === focus) ?? cars.find(c => c.player) ?? null,
    [cars, focus],
  );
  const mine = me?.player === true;
  const now = mine ? inputs?.now ?? null : null;
  const frac = me && road.lengthM > 0 ? me.lapDistM / road.lengthM : 0;
  const grade = road.elev && me ? gradeAt(road.elev, frac, road.lengthM) * 100 : null;
  const alt = road.elev && me ? heightAt(road.elev, frac) - Math.min(...road.elev) : null;
  const narrow = (full ? (typeof window === 'undefined' ? width : window.innerWidth) : width) < 480;

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
      </View>
      <View style={styles.tools}>
        {full ? (
          <Pressable accessibilityLabel={playing ? 'Pause' : 'Play'} onPress={onToggle} style={[styles.tool, {borderColor: color.lineStrong, backgroundColor: color.surfaceOverlay}]}>
            <Text variant='dataStrong'>{playing ? '❚❚' : '▶'}</Text>
            <Text variant='dataSmall' tone='textMuted'>{clockLabel}</Text>
          </Pressable>
        ) : null}
        <Pressable
          accessibilityLabel={full ? 'Close full screen' : 'Full screen'}
          onPress={() => setFull(!full)}
          style={[styles.tool, {borderColor: color.lineStrong, backgroundColor: color.surfaceOverlay}]}>
          <Text variant='dataStrong'>{full ? '×' : '⤢'}</Text>
        </Pressable>
      </View>
      {me ? (
        <View
          pointerEvents='none'
          style={[
            styles.dash,
            narrow && {right: undefined, left: space.sm, bottom: space.sm + 36},
            {backgroundColor: color.surfaceOverlay, borderColor: color.lineStrong},
          ]}>
          {now ? (
            <View style={styles.gear}>
              <Text variant='display' tone='accentInk'>
                {now.gear <= 0 ? (now.gear < 0 ? 'R' : 'N') : String(now.gear)}
              </Text>
            </View>
          ) : null}
          <View>
            <View style={styles.row}>
              <Text variant='display'>{`${Math.round(now ? now.speedKph : me.speedKmh)}`}</Text>
              <Text variant='dataSmall' tone='textMuted'>
                km/h
              </Text>
            </View>
            {grade !== null ? (
              <View style={styles.row}>
                <Text
                  variant='dataSmall'
                  tone={grade > 2.5 ? 'accentInk' : grade < -2.5 ? 'textSecondary' : 'textMuted'}>
                  {`${grade > 0 ? '+' : ''}${grade.toFixed(1)}%`}
                </Text>
                {alt !== null ? (
                  <Text variant='dataSmall' tone='textMuted'>{`${Math.round(alt)} m`}</Text>
                ) : null}
              </View>
            ) : null}
          </View>
          {now ? (
            <>
              <View style={styles.pedals}>
                <Pedal value={now.brakePct} fill={color.slower} track={color.median} />
                <Pedal value={now.throttlePct} fill={color.faster} track={color.median} />
              </View>
              <Wheel pct={now.steeringPct} ink={color.text} mark={color.accent} ring={color.lineStrong} />
            </>
          ) : null}
          {road.elev && me ? (
            <Elevation
              elev={road.elev}
              frac={frac}
              lengthM={road.lengthM}
              line={color.textSecondary}
              up={color.accent}
              down={color.class2}
              dot={color.text}
              wide={!narrow}
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
    <Svg width={44} height={44} viewBox='-26 -26 52 52'>
      <Circle r={20} fill='none' stroke={ring} strokeWidth={3.5} />
      <G rotation={deg}>
        <Path d='M-20 0H20M0 0V20' stroke={ink} strokeWidth={3.5} strokeLinecap='round' />
        <Path d='M-5 -20h10' stroke={mark} strokeWidth={4} strokeLinecap='round' />
      </G>
    </Svg>
  );
}

// The road's height 100 m behind and 500 m ahead of the car, coloured by grade, the car a dot.
function Elevation({
  elev,
  frac,
  lengthM,
  line,
  up,
  down,
  dot,
  wide,
}: {
  elev: number[];
  frac: number;
  lengthM: number;
  line: string;
  up: string;
  down: string;
  dot: string;
  wide: boolean;
}) {
  const W = wide ? 190 : 120;
  const H = 40;
  const n = 60;
  const span = BEHIND_M + AHEAD_M;
  const zs: number[] = [];
  for (let i = 0; i <= n; i++) zs.push(heightAt(elev, frac - BEHIND_M / lengthM + (span / lengthM) * (i / n)));
  const lo = Math.min(...zs);
  const hi = Math.max(...zs);
  const range = Math.max(hi - lo, 10);
  const mid = (hi + lo) / 2;
  const y = (z: number) => H - 4 - ((z - (mid - range / 2)) / range) * (H - 8);
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
        strokeWidth={2}
        strokeLinecap='round'
      />,
    );
  }
  const cx = (BEHIND_M / span) * W;
  return (
    <Svg width={W} height={H}>
      {segs}
      <Circle cx={cx} cy={y(zs[Math.round((BEHIND_M / span) * n)])} r={3.5} fill={dot} />
    </Svg>
  );
}

const styles = StyleSheet.create({
  center: {...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center'},
  cams: {position: 'absolute', left: space.sm, bottom: space.sm},
  tools: {position: 'absolute', right: space.sm, top: space.sm + 0, flexDirection: 'row', gap: space.xs, alignItems: 'center'},
  tool: {flexDirection: 'row', alignItems: 'center', gap: space.xs, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: space.sm, minHeight: 32},
  dash: {
    position: 'absolute',
    right: space.sm,
    bottom: space.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: space.sm,
    paddingVertical: space.xs,
    maxWidth: '96%',
  },
  gear: {minWidth: 22, alignItems: 'center'},
  row: {flexDirection: 'row', alignItems: 'baseline', gap: space.xs},
  pedals: {flexDirection: 'row', gap: 4, height: 40},
  pedal: {width: 10, borderRadius: 3, overflow: 'hidden'},
  pedalFill: {position: 'absolute', left: 0, right: 0, bottom: 0},
});
