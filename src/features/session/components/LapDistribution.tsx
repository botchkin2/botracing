import {Pressable, StyleSheet, View} from 'react-native';
import Svg, {Circle, Line, Text as SvgText} from 'react-native-svg';

import {radius, size, space, type as typeScale, useTheme} from '@/src/design';
import {Text} from '@/src/ui';

import {type DistributionModel} from '../desktopModel';

const DOT_R = 3.5;
const KEY_DOT_R = 4.5;
const AXIS_H = 14;
// A click target around each dot. The dots are drawn in the Svg and the targets
// sit over it as views: react-native-svg's web build puts responder props on a
// shape that has onPress, which React DOM reports as unknown handlers.
const HIT = 16;
// Keeps the end dots and labels inside the strip.
const PAD_X = 8;

/**
 * Desktop (≥1280) lap-time distribution from the handoff D1: a row per stint,
 * a dot per comparable lap, the stint median as a tick. Selected laps use
 * their lap color, the best lap is purple, the highlighted lap is ringed.
 */
export function LapDistribution({
  model,
  colorOf,
  onPressLap,
}: {
  model: DistributionModel;
  colorOf: (selIndex: number) => string;
  onPressLap: (lapId: string) => void;
}) {
  const {color} = useTheme();
  const w = size.distStrip;
  const h = model.rows.length * size.distRow;
  const xOf = (x01: number) => PAD_X + x01 * (w - PAD_X * 2);
  const yOf = (row: number) => row * size.distRow + size.distRow / 2;
  const axis = {...typeScale.axis, fontSize: 9.5};
  return (
    <View>
      <Text variant='label'>Lap-time distribution</Text>
      <View style={styles.grid}>
        <View style={{width: size.distLabel, height: h}}>
          {model.rows.map((r, i) => (
            <Text
              key={r.n}
              variant='body'
              tone='textSecondary'
              style={[
                styles.rowLabel,
                {top: yOf(i) - size.distRow / 2, height: size.distRow},
              ]}>
              {r.label}
            </Text>
          ))}
        </View>
        <View>
          <View style={{width: w, height: h}}>
            <Svg
              width={w}
              height={h}
              style={{backgroundColor: color.surface, borderRadius: radius.xs}}>
              {model.rows.map((r, i) =>
                r.median01 == null ? null : (
                  <Line
                    key={r.n}
                    x1={xOf(r.median01)}
                    x2={xOf(r.median01)}
                    y1={yOf(i) - size.distRow / 2 + 5}
                    y2={yOf(i) + size.distRow / 2 - 5}
                    stroke={color.text}
                    strokeWidth={1.5}
                  />
                ),
              )}
              {model.dots.map(d => {
                const key = d.selIndex != null || d.best || d.highlighted;
                return (
                  <Circle
                    key={d.lapId}
                    cx={xOf(d.x01)}
                    cy={yOf(d.row)}
                    r={key ? KEY_DOT_R : DOT_R}
                    fill={
                      d.selIndex != null
                        ? colorOf(d.selIndex)
                        : d.best
                        ? color.best
                        : color.barNeutral
                    }
                    stroke={d.highlighted ? color.accent : 'none'}
                    strokeWidth={1.5}
                  />
                );
              })}
            </Svg>
            {model.dots.map(d => (
              <Pressable
                key={`hit-${d.lapId}`}
                accessibilityRole='button'
                accessibilityLabel='Highlight this lap'
                onPress={() => onPressLap(d.lapId)}
                style={[
                  styles.hit,
                  {left: xOf(d.x01) - HIT / 2, top: yOf(d.row) - HIT / 2},
                ]}
              />
            ))}
          </View>
          <Svg width={w} height={AXIS_H}>
            {model.axis.map((a, i) => (
              <SvgText
                key={i}
                x={xOf(a.x01)}
                y={11}
                textAnchor={i === 0 ? 'start' : i === 2 ? 'end' : 'middle'}
                fill={color.textFaint}
                fontFamily={axis.fontFamily}
                fontSize={axis.fontSize}>
                {a.label}
              </SvgText>
            ))}
          </Svg>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  hit: {position: 'absolute', width: HIT, height: HIT},
  grid: {flexDirection: 'row', gap: space.sm, marginTop: space.md},
  rowLabel: {
    position: 'absolute',
    left: 0,
    textAlignVertical: 'center',
    lineHeight: size.distRow,
  },
});
