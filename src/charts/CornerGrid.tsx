import {StyleSheet, View} from 'react-native';

import {
  cornerCell,
  formatCornerGap,
  radius,
  space,
  useTheme,
} from '@/src/design';
import {Pressable, Text} from '@/src/ui';

// Time per section (handoff §3 "time per corner"; our corners are grouped
// into sections, named by their turns): one row per lap, one cell per section, the
// difference to the reference in seconds on the fixed color scale.

export type CornerGridRow = {
  key: string;
  label: string;
  /** Row label color (the lap's color); undefined for summary rows. */
  color?: string;
  /** Seconds vs the reference per corner; null when unknown. */
  cells: (number | null)[];
};

const LABEL_W = 36;
const GAP = 2;
const CELL_H = 24;

export function CornerGrid({
  width,
  corners,
  heads,
  rows,
  openCorner,
  onPressCorner,
  onJumpSection,
}: {
  width: number;
  corners: number[];
  /** Each column's section name ("T2–5"). */
  heads: string[];
  rows: CornerGridRow[];
  openCorner: number | null;
  onPressCorner: (n: number) => void;
  /** One tap on a section's header moves playback to that section's start (D28). */
  onJumpSection: (n: number) => void;
}) {
  const gap = GAP;
  const cellW = (width - LABEL_W - gap * corners.length) / corners.length;
  return (
    <View style={{width, gap}}>
      <View style={styles.row}>
        <View style={{width: LABEL_W}} />
        {corners.map((n, i) => (
          <Pressable
            key={n}
            onPress={() => onJumpSection(n)}
            accessibilityRole='button'
            accessibilityLabel={`Jump to ${heads[i]}`}
            style={[styles.head, {width: cellW, marginLeft: gap}]}>
            <Text variant='tableHeader' tone='textMuted' asWritten>
              {heads[i]}
            </Text>
          </Pressable>
        ))}
      </View>
      {rows.map(r => (
        <View key={r.key} style={styles.row}>
          <Text
            variant='dataSmall'
            style={[styles.label, r.color ? {color: r.color} : null]}
            numberOfLines={1}>
            {r.label}
          </Text>
          <CornerCells
            cells={r.cells}
            cellW={cellW}
            openIndex={corners.indexOf(openCorner ?? -1)}
            onPress={i => onPressCorner(corners[i])}
          />
        </View>
      ))}
    </View>
  );
}

/**
 * One row of section cells: the difference to the reference in seconds on the
 * fixed color scale (design/tokens.ts cornerCell). `showValue` false draws the
 * color alone, for a cell too narrow for its number (the phone's lap table);
 * the row then names each cell for a screen reader instead. Without `onPress`
 * the cells are not tappable.
 */
export function CornerCells({
  cells,
  cellW,
  openIndex = -1,
  onPress,
  showValue = true,
  labels,
}: {
  cells: (number | null)[];
  cellW: number;
  /** The index of the cell drawn open (outlined); -1 for none. */
  openIndex?: number;
  onPress?: (index: number) => void;
  showValue?: boolean;
  /** Each cell's section, for its accessibility label. */
  labels?: string[];
}) {
  const {color} = useTheme();
  return (
    <>
      {cells.map((d, i) => {
        const c = d == null ? null : cornerCell(d);
        const text = d == null ? '—' : formatCornerGap(d);
        const style = [
          styles.cell,
          {
            width: cellW,
            marginLeft: GAP,
            backgroundColor: c?.bg ?? color.surfaceRaised,
            borderColor: i === openIndex ? color.text : 'transparent',
          },
        ];
        const body = showValue ? (
          <Text variant='dataSmall' style={{color: c?.fg ?? color.textFaint}}>
            {text}
          </Text>
        ) : null;
        return onPress ? (
          <Pressable key={i} onPress={() => onPress(i)} style={style}>
            {body}
          </Pressable>
        ) : (
          <View
            key={i}
            accessibilityLabel={labels ? `${labels[i]} ${text}` : undefined}
            style={style}>
            {body}
          </View>
        );
      })}
    </>
  );
}

const styles = StyleSheet.create({
  row: {flexDirection: 'row', alignItems: 'center'},
  head: {alignItems: 'center', paddingVertical: space.xxs},
  label: {width: LABEL_W},
  cell: {
    height: CELL_H,
    borderRadius: radius.xs,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
