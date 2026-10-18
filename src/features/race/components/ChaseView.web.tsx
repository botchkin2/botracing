import {createElement, useEffect, useMemo, useRef, useState} from 'react';
import {StyleSheet, View} from 'react-native';

import {type ChaseRoad, gradeAt, heightAt} from '@/src/analysis/chaseRoad';
import {radius, space, useTheme} from '@/src/design';
import {Segment, Text} from '@/src/ui';

import {type ChaseCar} from './chaseTypes';

// The 3D chase view (prototype). The engine is a plain module loaded at run time
// from /follow-cam/ with three.js, so three.js stays out of the app bundle; the
// proper path is the `three` dependency and a lazy import (pit wall thread 83).
export const chaseAvailable = true;

type Engine = {
  setRoad: (road: ChaseRoad) => void;
  update: (state: Record<string, unknown>) => void;
  setCam: (mode: number) => void;
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

export function ChaseView({
  width,
  height,
  road,
  cars,
  focus,
  playing,
  rate,
  onPressCar,
}: {
  width: number;
  height: number;
  road: ChaseRoad;
  cars: ChaseCar[];
  focus: number | null;
  playing: boolean;
  rate: number;
  onPressCar: (index: number) => void;
}) {
  const {color} = useTheme();
  const host = useRef<HTMLDivElement | null>(null);
  const engine = useRef<Engine | null>(null);
  const pick = useRef(onPressCar);
  useEffect(() => {
    pick.current = onPressCar;
  });
  const [cam, setCam] = useState<'1' | '2' | '3' | '4' | '5'>('1');
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
        made.setRoad(road);
        made.setCam(Number(cam));
        made.update({cars, focus, playing, rate});
      } catch {
        if (!dead) setFailed(true);
      }
    })();
    return () => {
      dead = true;
      engine.current = null;
      made?.dispose();
    };
    // The engine is made once; the road and the cars reach it below.
  }, []);
  useEffect(() => {
    engine.current?.setRoad(road);
  }, [road]);
  useEffect(() => {
    engine.current?.update({cars, focus, playing, rate});
  }, [cars, focus, playing, rate]);
  useEffect(() => {
    engine.current?.setCam(Number(cam));
  }, [cam]);

  // The followed car's own numbers, in app type: speed, and the road's height and grade under it.
  const me = useMemo(
    () => cars.find(c => c.index === focus) ?? cars.find(c => c.player) ?? null,
    [cars, focus],
  );
  const frac = me && road.lengthM > 0 ? me.lapDistM / road.lengthM : 0;
  const alt = road.elev && me ? heightAt(road.elev, frac) - Math.min(...road.elev) : null;
  const grade =
    road.elev && me ? gradeAt(road.elev, frac, road.lengthM) * 100 : null;

  return (
    <View style={{width, height, backgroundColor: color.bg}}>
      {createElement('div', {
        ref: host,
        style: {position: 'absolute', left: 0, top: 0, width, height},
      })}
      {failed ? (
        <View style={styles.center}>
          <Text tone='textMuted'>3D unavailable</Text>
        </View>
      ) : null}
      <View style={styles.cams}>
        <Segment options={CAMS} value={cam} onChange={setCam} />
      </View>
      {me ? (
        <View
          pointerEvents='none'
          style={[
            styles.hud,
            // Narrow: the numbers sit above the camera switch, not under it.
            width < 480 && {right: undefined, left: space.sm, bottom: space.sm + 36},
            {backgroundColor: color.surfaceOverlay, borderColor: color.lineStrong},
          ]}>
          <Text variant='dataStrong'>{`${Math.round(me.speedKmh)}`}</Text>
          <Text variant='dataSmall' tone='textMuted'>
            km/h
          </Text>
          {grade !== null ? (
            <Text variant='dataSmall' tone={grade > 2.5 ? 'accentInk' : grade < -2.5 ? 'textSecondary' : 'textMuted'}>
              {`${grade > 0 ? '+' : ''}${grade.toFixed(1)}%`}
            </Text>
          ) : null}
          {alt !== null ? (
            <Text variant='dataSmall' tone='textMuted'>{`${Math.round(alt)} m`}</Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  center: {...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center'},
  cams: {position: 'absolute', left: space.sm, bottom: space.sm},
  hud: {
    position: 'absolute',
    right: space.sm,
    bottom: space.sm,
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: space.xs,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: space.sm,
    paddingVertical: space.xs,
  },
});
