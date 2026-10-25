import {createElement, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState} from 'react';
import {createPortal} from 'react-dom';
import {StyleSheet, View} from 'react-native';

import {altitudeLabel, chaseHudNumbers, gearLabel, gradeLabel} from '@/src/analysis/chaseHud';
import type {ChaseRoad} from '@/src/analysis/chaseRoad';
import {radius, size, space, useTheme} from '@/src/design';
import {formatGap} from '@/src/design/format';
import {Pressable, Segment, Text} from '@/src/ui';

import {ChaseNearStrip} from '@/src/features/race/components/ChaseNearStrip';
import {ChaseTower} from '@/src/features/race/components/ChaseTower';
import {inAppWebView, postPan, postReady} from '@/src/features/race/useEmbedClock';
import {LiveDriverInputs} from '@/src/features/race/components/LiveDriverInputs';
import type {ChaseFrame, FrameSubscribe} from '@/src/features/race/chase/chaseInputsAt';
import {GEAR_UNKNOWN, tightNumberRows} from '@/src/features/race/chase/numbersRows';
import {type TowerCar, type TowerMode, type TowerRow, towerRows} from '@/src/features/race/chase/towerRows';
import type {ChaseCamMode, ChaseCar, ChaseEngine, ChaseGaps, ChaseInputs, ChaseSampler} from '@/src/features/race/chase/chaseTypes';

// The 3D chase view, drawn as an instrument. Web only: the engine and three.js load on first use (a lazy import), so
// they stay out of the main bundle and out of the native app. Everything on screen is the app's own tokens; nothing
// sits in the middle.
export const chaseAvailable = true;
/** The road is fitted and drawn here, in the page. */
export const chaseNeedsRoad = true;

const CAMS = [
  {value: '1', label: 'Chase'},
  {value: '2', label: 'High'},
  {value: '3', label: 'TV'},
  {value: '4', label: 'Heli'},
] as const;
type CamValue = '1' | '2' | '3' | '4';

/** Narrower than this is a phone: the layout stacks and the targets grow. */
const PHONE_MAX_W = 520;
/** Rows in the tower on a desktop; on a phone, the strip's cars (the followed car and its neighbours) and the open list's. */
const TOWER_ROWS = 9;
const STRIP_ROWS = 3;
const LIST_ROWS = 5;

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
  tower: TowerCar[];
  trackM: number;
  clockLabel: string;
  onToggle: () => void;
  onStep: (deltaS: number) => void;
  onCycleRate: () => void;
  onPressCar: (index: number) => void;
  /** The page is the Android app's WebView (embed=3d): full screen from the start, with no way out of it. */
  embedded?: boolean;
};

// Full screen is a portal to the page body: the view leaves the map's frame (and its stacking order). The engine and
// its canvas belong here, made once, and the canvas's host element moves between the two frames, so toggling full
// screen never makes a second WebGL context (a browser keeps only a handful). The camera choice is kept here too.
export function ChaseView(props: ChaseProps) {
  const [full, setFull] = useState(props.embedded === true);
  const [cam, setCam] = useState<CamValue>('1');
  const [free, setFree] = useState(false);
  const frames = useRef<((frame: ChaseFrame) => void) | null>(null);
  const subscribe = useCallback<FrameSubscribe>(listener => {
    frames.current = listener;
  }, []);
  const {failed, host, reset} = useChaseEngine(props, cam, setFree, frames);
  const surface = (
    <ChaseSurface {...props} full={full} setFull={setFull} cam={cam} setCam={setCam} host={host} failed={failed} free={free} onReset={reset} subscribe={subscribe} />
  );
  return full && typeof document !== 'undefined'
    ? createPortal(surface, document.body)
    : surface;
}

/** The engine, made once for the life of the view, and the element its canvas lives in. */
function useChaseEngine(
  {road, sample, timeS, focus, playing, rate, inputs, onPressCar, embedded}: ChaseProps,
  cam: CamValue,
  onFree: (free: boolean) => void,
  frames: {current: ((frame: ChaseFrame) => void) | null},
): {failed: string | null; host: HTMLDivElement; reset: () => void} {
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
        made = mountChase(host, {onPick: (i: number) => pick.current(i), theme, onFree, onPan: embedded && inAppWebView() ? postPan : undefined, onFollowed: f => frames.current?.(f)});
        engine.current = made;
        made.setRoad(road);
        made.setCam(Number(cam) as ChaseCamMode);
        made.setInputs(inputs?.ribbon ?? null);
        made.update({sample, timeS, focus, playing, rate, inputIdx: inputs?.now?.idx ?? -1});
        // the app's WebView waits under a dark cover until this: two frames on, the first one is on the screen
        if (embedded) requestAnimationFrame(() => requestAnimationFrame(() => !dead && postReady()));
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
  return {failed, host, reset: () => engine.current?.resetCam()};
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
  tower: towerCars,
  trackM,
  clockLabel,
  onToggle,
  onStep,
  onCycleRate,
  onPressCar,
  embedded,
  full,
  setFull,
  cam,
  setCam,
  host,
  failed,
  free,
  onReset,
  subscribe,
}: ChaseProps & {
  full: boolean;
  setFull: (f: boolean) => void;
  cam: CamValue;
  setCam: (c: CamValue) => void;
  host: HTMLDivElement;
  failed: string | null;
  free: boolean;
  onReset: () => void;
  subscribe: FrameSubscribe;
}) {
  const {color} = useTheme();
  // Full screen: its own play toggle (Space) and a way out (Esc).
  useEffect(() => {
    if (!full) return;
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !embedded) setFull(false);
      else if (e.key === ' ') {
        e.preventDefault();
        onToggle();
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [full, embedded, onToggle, setFull]);
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
  const shownW = full ? (typeof window === 'undefined' ? width : window.innerWidth) : width;
  // A phone: the tools are 44 pt targets and the numbers strip sits above them, across the width.
  const tight = shownW < PHONE_MAX_W;
  const [towerShown, setTowerShown] = useState(true);
  const [listOpen, setListOpen] = useState(false);
  const [towerMode, setTowerMode] = useState<TowerMode>('order');
  const followed = focus ?? me?.index ?? null;
  // A desktop: the tower floats over the corner, folded by its button. A phone: a strip above the canvas, always there,
  // and a list that opens under it on a tap.
  const tower = useMemo<TowerRow[]>(
    () => (!tight && towerShown ? towerRows(towerCars, followed, towerMode, TOWER_ROWS, trackM) : []),
    [tight, towerShown, towerCars, followed, towerMode, trackM],
  );
  const strip = useMemo<TowerRow[]>(
    () => (tight ? towerRows(towerCars, followed, towerMode, STRIP_ROWS, trackM) : []),
    [tight, towerCars, followed, towerMode, trackM],
  );
  const list = useMemo<TowerRow[]>(
    () => (tight && listOpen ? towerRows(towerCars, followed, towerMode, LIST_ROWS, trackM) : []),
    [tight, listOpen, towerCars, followed, towerMode, trackM],
  );
  const pick = (i: number) => {
    if (i !== me?.index) onPressCar(i);
  };
  // A phone's 3D view top to bottom: the app's mode row (drawn over this page by the app, except in a full screen that
  // covers it), the strip, the canvas, the camera chips. Nothing else sits over the canvas but the HUD in its corners.
  const topInset = tight && (!full || embedded) ? size.chaseControlsH : 0;
  const canvasTop = tight ? topInset + size.hit + space.xs : 0;
  const bottomInset = space.sm + (full && !embedded ? 2 : 1) * (size.hit + space.xs);
  const canvasBottom = tight ? bottomInset : 0;
  const turned = free && (cam === '1' || cam === '2');
  const toolStyle = [styles.tool, tight && styles.toolTight, {borderColor: color.lineStrong, backgroundColor: color.surface}];

  return (
    <View
      style={
        full
          ? ({position: 'fixed', left: 0, top: 0, right: 0, bottom: 0, zIndex: 1000, backgroundColor: color.bg} as object)
          : {width, height, backgroundColor: color.bg}
      }>
      {createElement('div', {
        ref: slot,
        style: {position: 'absolute', left: 0, right: 0, top: canvasTop, bottom: canvasBottom},
      })}
      {failed !== null ? (
        <View style={styles.center}>
          <Text tone='textMuted'>3D unavailable</Text>
          <Pressable
            accessibilityLabel='Reload the page'
            onPress={() => window.location.reload()}
            style={toolStyle}>
            <Text variant='dataSmall'>Reload</Text>
          </Pressable>
        </View>
      ) : null}
      <View style={[styles.cams, tight && styles.camsTight]}>
        <Segment options={CAMS} value={cam} onChange={setCam} />
        {full && !embedded ? (
          <Pressable
            accessibilityLabel={playing ? 'Pause' : 'Play'}
            onPress={onToggle}
            style={toolStyle}>
            <Text variant='dataStrong'>{playing ? '❚❚' : '▶'}</Text>
            <Text variant='dataSmall' tone='textMuted'>
              {clockLabel}
            </Text>
          </Pressable>
        ) : null}
        {full && !embedded ? (
          <>
            {[-30, 30].map(d => (
              <Pressable
                key={d}
                accessibilityLabel={`${d > 0 ? 'Forward' : 'Back'} 30 seconds`}
                onPress={() => onStep(d)}
                style={toolStyle}>
                <Text variant='dataSmall'>{d > 0 ? '+30 s' : '−30 s'}</Text>
              </Pressable>
            ))}
            <Pressable
              accessibilityLabel='Playback rate, tap for the next'
              onPress={onCycleRate}
              style={toolStyle}>
              <Text variant='dataSmall'>{`${rate}×`}</Text>
            </Pressable>
          </>
        ) : null}
        {tight ? null : (
          <Pressable
            accessibilityLabel={towerShown ? 'Hide the tower' : 'Show the tower'}
            accessibilityState={{selected: towerShown}}
            onPress={() => setTowerShown(!towerShown)}
            style={toolStyle}>
            <Text variant='dataStrong'>☰</Text>
          </Pressable>
        )}
        {embedded ? null : (
          <Pressable
            accessibilityLabel={full ? 'Close full screen' : 'Full screen'}
            onPress={() => setFull(!full)}
            style={toolStyle}>
            <Text variant='dataStrong'>{full ? '×' : '⤢'}</Text>
          </Pressable>
        )}
      </View>
      {tower.length > 0 ? (
        <View style={styles.tower}>
          <ChaseTower rows={tower} mode={towerMode} onMode={setTowerMode} onPick={pick} tight={false} />
        </View>
      ) : null}
      {turned && !listOpen ? (
        // a drag keeps its angle until Reset, so a turned camera says so, in the accent colour, where the HUD does not reach
        <Pressable
          accessibilityLabel='Reset the camera to chase'
          onPress={onReset}
          style={[styles.turned, tight ? {top: canvasTop + space.xs, right: space.sm} : {left: space.sm, bottom: space.sm + size.hit + space.xs}, {borderColor: color.accent, backgroundColor: color.surface}]}>
          <Text variant='dataSmall' tone='accentInk'>Camera turned · Reset</Text>
        </Pressable>
      ) : null}
      {strip.length > 0 ? (
        <View style={[styles.strip, {top: topInset}]}>
          <ChaseNearStrip rows={strip} open={listOpen} onToggle={() => setListOpen(o => !o)} onPick={pick} />
        </View>
      ) : null}
      {list.length > 0 ? (
        // a tap anywhere else closes the list; it takes the touch, so the camera does not move
        <Pressable
          accessibilityLabel='Close the car list'
          onPress={() => setListOpen(false)}
          style={[styles.scrim, {top: canvasTop}]}
        />
      ) : null}
      {list.length > 0 ? (
        <View style={[styles.list, {top: canvasTop}]}>
          <ChaseTower
            rows={list}
            mode={towerMode}
            onMode={setTowerMode}
            onPick={i => {
              setListOpen(false);
              pick(i);
            }}
            tight
            fill
          />
        </View>
      ) : null}
      {me ? (
        <View
          pointerEvents='none'
          style={[styles.dock, tight && styles.dockTight, tight && {bottom: bottomInset + space.xs}]}>
          {now && inputs ? (
            <LiveDriverInputs now={now} trace={inputs.trace} subscribe={subscribe} tight={tight} />
          ) : null}
          <View style={[styles.numbers, tight && styles.numbersTight, {backgroundColor: color.surface, borderColor: color.lineStrong}]}>
          {tight
            ? tightNumberRows({
                place: gaps ? `${gaps.classTag} P${gaps.classPlace}` : null,
                gear: me.player === true ? (now ? gearLabel(now.gear) : GEAR_UNKNOWN) : null,
                speed: `${Math.round(now ? now.speedKph : me.speedKmh)}`,
              }).map((row, r) => (
                <View key={r} style={styles.cell}>
                  {row.map((cell, c) => (
                    <Text
                      key={c}
                      variant={cell.tone === 'strong' ? 'dataStrong' : 'dataSmall'}
                      tone={cell.tone === 'muted' ? 'textMuted' : undefined}
                      style={cell.minCh ? ({minWidth: `${cell.minCh}ch`, textAlign: 'right'} as object) : undefined}>
                      {cell.text}
                    </Text>
                  ))}
                </View>
              ))
            : null}
          {!tight && gaps ? (
            <View style={styles.cell}>
              <Text variant='dataStrong'>{`${gaps.classTag} P${gaps.classPlace}`}</Text>
              <View style={styles.cell}>
                <Text variant='dataSmall' tone='textMuted'>{`▲ ${gaps.aheadS === null ? '–' : formatGap(-gaps.aheadS, 1)}`}</Text>
                <Text variant='dataSmall' tone='textMuted'>{`▼ ${gaps.behindS === null ? '–' : formatGap(gaps.behindS, 1)}`}</Text>
              </View>
            </View>
          ) : null}
          {!tight && now ? (
            <Text variant='dataStrong'>
              {gearLabel(now.gear)}
            </Text>
          ) : null}
          {!tight ? (
            <View style={styles.cell}>
              <Text variant='dataStrong'>{`${Math.round(now ? now.speedKph : me.speedKmh)}`}</Text>
              <Text variant='dataSmall' tone='textMuted'>
                km/h
              </Text>
            </View>
          ) : null}
          {!tight && hasHeight && grade !== null ? (
            <View style={styles.cell}>
              <Text variant='dataSmall' tone='textMuted'>
                {gradeLabel(grade)}
              </Text>
              {alt !== null ? (
                <Text variant='dataSmall' tone='textMuted'>{altitudeLabel(alt)}</Text>
              ) : null}
            </View>
          ) : null}
          </View>
        </View>
      ) : null}
    </View>
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
  camsTight: {right: space.sm, flexWrap: 'wrap'},
  tool: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingHorizontal: space.sm,
    minHeight: 28,
  },
  toolTight: {minHeight: size.hit, minWidth: size.hit, justifyContent: 'center'},
  // One flat strip on the bottom edge: numerals in mono, nothing in the middle of the view.
  tower: {position: 'absolute', right: space.sm, top: space.sm},
  dock: {position: 'absolute', right: space.sm, bottom: space.sm, alignItems: 'flex-end', gap: space.xs, maxWidth: '62%'},
  // A phone: the inputs in the bottom left corner, the numbers in the bottom right, the middle left to the car.
  dockTight: {left: space.sm, maxWidth: '100%', flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between'},
  strip: {position: 'absolute', left: space.sm, right: space.sm},
  turned: {
    position: 'absolute',
    zIndex: 3,
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingHorizontal: space.sm,
    minHeight: size.hit,
    justifyContent: 'center',
  },
  scrim: {position: 'absolute', left: 0, right: 0, bottom: 0, zIndex: 1},
  list: {position: 'absolute', left: space.sm, right: space.sm, zIndex: 2},
  numbers: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingHorizontal: space.sm,
    minHeight: 32,
    justifyContent: 'space-between',
  },
  // Two rows (numbersRows.ts), as wide as the wider of them: the box's left edge stays clear of the car's rear.
  numbersTight: {marginLeft: 'auto', flexDirection: 'column', alignItems: 'flex-end', gap: 0, paddingVertical: space.xs},
  cell: {flexDirection: 'row', alignItems: 'baseline', gap: space.xs},
});
