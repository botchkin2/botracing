import {useRef, useState} from 'react';
import {StyleSheet, View} from 'react-native';
import Svg, {Rect} from 'react-native-svg';

import {WHEELS} from '@/src/analysis/tyres';
import {heatCell, space, useTheme} from '@/src/design';
import {Pressable, Text} from '@/src/ui';

import {
  defaultColumn,
  type HeatStrip,
  readoutText,
  scalePosition,
} from '../heatStrips';

const ROW_H = 14;
const ROW_GAP = 2;
const LABEL_W = 24;
const STINT_GAP = 4;
const MARK_H = 4;
const LEGEND_STEPS = 24;

/**
 * Tyre heat: a strip per meter, FL FR RL RR in the Tires card's order down the
 * side and a lap per column, stints set apart and the best lap marked. The
 * colour is a fixed physical scale (the legend prints its ends) so strips of
 * two sessions compare. Tap a column to read its four values: nothing depends
 * on hover. No bands and no words about why.
 */
export function HeatStrips({
  strips,
  width,
}: {
  strips: HeatStrip[];
  /** The width the card may use, in points. */
  width: number;
}) {
  return (
    <View style={styles.block}>
      {strips.map(strip => (
        <Strip key={strip.meter.key} strip={strip} width={width} />
      ))}
    </View>
  );
}

function Strip({strip, width}: {strip: HeatStrip; width: number}) {
  const {color} = useTheme();
  // undefined: no tap yet, so the readout is on the best lap; null: cleared.
  const [tapped, setTapped] = useState<number | null | undefined>(undefined);
  const picked = tapped === undefined ? defaultColumn(strip) : tapped;
  const plotRef = useRef<View>(null);
  const {meter, columns, stintStarts} = strip;
  // Zero before the card has measured itself: nothing to draw yet.
  const plotW = Math.max(0, width - LABEL_W);
  if (plotW === 0) return null;
  const cellW = Math.max(
    3,
    (plotW - stintStarts.length * STINT_GAP) / columns.length,
  );
  const xOf = (i: number) =>
    i * cellW + stintStarts.filter(s => s <= i).length * STINT_GAP;
  // The column under a tap, from the tap's x inside the strip.
  const columnAt = (x: number) => {
    let hit = 0;
    for (let i = 0; i < columns.length; i++) if (x >= xOf(i)) hit = i;
    return hit;
  };
  const plotH = WHEELS.length * (ROW_H + ROW_GAP) - ROW_GAP;
  const bestAt = columns.findIndex(c => c.best);
  return (
    <View style={styles.strip}>
      <Text variant='label'>{meter.title}</Text>
      <View style={styles.plot}>
        <View style={{width: LABEL_W}}>
          {WHEELS.map(w => (
            <Text
              key={w}
              variant='dataSmall'
              tone='textMuted'
              style={{height: ROW_H + ROW_GAP}}>
              {w}
            </Text>
          ))}
        </View>
        <Pressable
          accessibilityLabel={`${meter.title}: tap a lap`}
          ref={plotRef}
          onPress={e => {
            // pageX, not locationX: the target of the tap is a rect inside the strip.
            const pageX = e.nativeEvent.pageX;
            plotRef.current?.measure((_x, _y, _w, _h, left) => {
              const i = columnAt(pageX - left);
              setTapped(t => {
                const shown = t === undefined ? defaultColumn(strip) : t;
                return i === shown ? null : i;
              });
            });
          }}>
          <Svg width={plotW} height={plotH + MARK_H + 2}>
            {columns.map((c, i) =>
              WHEELS.map((w, r) => {
                const t = scalePosition(meter, c.values[w]);
                return (
                  <Rect
                    key={`${c.lapId}${w}`}
                    x={xOf(i)}
                    y={r * (ROW_H + ROW_GAP)}
                    width={Math.max(1, cellW - 1)}
                    height={ROW_H}
                    fill={t == null ? color.line : heatCell(t)}
                  />
                );
              }),
            )}
            {bestAt >= 0 ? (
              <Rect
                x={xOf(bestAt)}
                y={plotH + 2}
                width={Math.max(1, cellW - 1)}
                height={MARK_H}
                fill={color.best}
              />
            ) : null}
            {picked != null ? (
              <Rect
                x={xOf(picked)}
                y={0}
                width={Math.max(1, cellW - 1)}
                height={plotH}
                fill='none'
                stroke={color.text}
                strokeWidth={1}
              />
            ) : null}
          </Svg>
        </Pressable>
      </View>
      <Legend meter={strip} width={width} />
      <Text variant='dataSmall' tone='textSecondary'>
        {picked != null ? readoutText(strip, columns[picked]) : ' '}
      </Text>
    </View>
  );
}

function Legend({meter: strip, width}: {meter: HeatStrip; width: number}) {
  const {meter} = strip;
  const barW = Math.min(160, width - LABEL_W);
  return (
    <View style={styles.legend}>
      <Text variant='dataSmall' tone='textMuted'>
        {`${meter.min} ${meter.unit}`}
      </Text>
      <Svg width={barW} height={8}>
        {Array.from({length: LEGEND_STEPS}, (_, i) => (
          <Rect
            key={i}
            x={(i * barW) / LEGEND_STEPS}
            y={0}
            width={barW / LEGEND_STEPS + 0.5}
            height={8}
            fill={heatCell(i / (LEGEND_STEPS - 1))}
          />
        ))}
      </Svg>
      <Text variant='dataSmall' tone='textMuted'>
        {`${meter.max} ${meter.unit}`}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  block: {gap: space.lg},
  strip: {gap: space.xs},
  plot: {flexDirection: 'row', alignItems: 'flex-start'},
  legend: {flexDirection: 'row', alignItems: 'center', gap: space.sm},
});
