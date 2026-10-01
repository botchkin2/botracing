import {StyleSheet, View} from 'react-native';
import Svg, {Line, Rect} from 'react-native-svg';

import {dash, radius, space, stroke, useTheme} from '@/src/design';
import {Text} from '@/src/ui';

import {WEAR_BAR_MAX_PCT, type WheelCell} from '../tireCard';

const BAR_H = 36;
const BAR_GAP = 2;
const GRID_GAP = space.md;

/**
 * The car seen from above, front at the top: FL FR over RL RR (round 7 1A).
 * Each cell is one wheel's wear left, the % lost on each green lap as bars
 * with a dashed median, and its hot pressure. Wheels are told apart by place,
 * never by colour; a wheel with no pressure reading is outlined and drops out
 * of its numbers (1C c).
 */
export function TireGrid({
  cells,
  width,
  showBars,
}: {
  cells: WheelCell[];
  /** The width the grid may use, in points. */
  width: number;
  /** False for a stint too short for a trend: the cell keeps its number only. */
  showBars: boolean;
}) {
  const cellW = Math.floor((width - GRID_GAP) / 2);
  return (
    <View style={[styles.grid, {width, gap: GRID_GAP}]}>
      {cells.map(c => (
        <TireCell key={c.wheel} cell={c} width={cellW} showBars={showBars} />
      ))}
    </View>
  );
}

function TireCell({
  cell,
  width,
  showBars,
}: {
  cell: WheelCell;
  width: number;
  showBars: boolean;
}) {
  const {color} = useTheme();
  const inner = width - 2 * space.md - 2;
  const n = cell.lossPct.length;
  const barW = n > 0 ? Math.max(1, (inner - (n - 1) * BAR_GAP) / n) : 0;
  const scale = (v: number) =>
    (Math.min(Math.max(v, 0), WEAR_BAR_MAX_PCT) / WEAR_BAR_MAX_PCT) * BAR_H;
  const flat = cell.flat;
  return (
    <View
      accessible
      accessibilityLabel={cellLabel(cell)}
      style={[
        styles.cell,
        {
          width,
          borderColor: flat ? color.textSecondary : color.line,
          backgroundColor: color.surface,
        },
      ]}>
      <View style={styles.head}>
        <Text variant='label' tone='textMuted'>
          {cell.wheel}
        </Text>
        <Text variant='dataSmall' tone='textMuted'>
          {cell.medianLossPct != null
            ? `${cell.medianLossPct.toFixed(2)} %/lap`
            : ''}
        </Text>
      </View>
      <Text variant='dataStrong' style={styles.big}>
        {flat ? '0 kPa' : pct(cell.leftPct)}
      </Text>
      {flat ? (
        <Text variant='dataSmall' tone='textMuted'>
          {`from ${flat.fromLap} · last valid ${
            flat.lastValidLap ?? '—'
          }, ${pct(flat.lastValidPct)}`}
        </Text>
      ) : (
        <Text variant='dataSmall' tone='textMuted'>
          {cell.hotKpa != null
            ? `hot ${Math.round(cell.hotKpa)} kPa`
            : 'wear left'}
        </Text>
      )}
      {showBars && n > 0 ? (
        <Svg width={inner} height={BAR_H} style={styles.bars}>
          {cell.lossPct.map((v, i) => (
            <Rect
              key={i}
              x={i * (barW + BAR_GAP)}
              y={BAR_H - scale(v)}
              width={barW}
              height={scale(v)}
              fill={color.textFaint}
            />
          ))}
          {cell.medianLossPct != null ? (
            <Line
              x1={0}
              x2={inner}
              y1={BAR_H - scale(cell.medianLossPct)}
              y2={BAR_H - scale(cell.medianLossPct)}
              stroke={color.textSecondary}
              strokeWidth={stroke.mark}
              strokeDasharray={dash.mark}
            />
          ) : null}
        </Svg>
      ) : null}
    </View>
  );
}

const pct = (v: number | null) => (v == null ? '—' : `${v.toFixed(1)} %`);

function cellLabel(c: WheelCell): string {
  if (c.flat) {
    return `${c.wheel} pressure reads nothing from ${
      c.flat.fromLap
    }; last valid wear ${pct(c.flat.lastValidPct)}`;
  }
  return `${c.wheel} wear left ${pct(c.leftPct)}${
    c.hotKpa != null ? `, hot pressure ${Math.round(c.hotKpa)} kPa` : ''
  }`;
}

const styles = StyleSheet.create({
  grid: {flexDirection: 'row', flexWrap: 'wrap'},
  cell: {
    borderWidth: 1,
    borderRadius: radius.md,
    padding: space.md,
    gap: space.xxs,
  },
  head: {flexDirection: 'row', justifyContent: 'space-between'},
  big: {fontSize: 18, lineHeight: 24},
  bars: {marginTop: space.sm},
});
