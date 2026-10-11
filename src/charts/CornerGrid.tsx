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
  const {color} = useTheme();
  const gap = 2;
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
          {r.cells.map((d, i) => {
            const c = d == null ? null : cornerCell(d);
            const open = corners[i] === openCorner;
            return (
              <Pressable
                key={corners[i]}
                onPress={() => onPressCorner(corners[i])}
                style={[
                  styles.cell,
                  {
                    width: cellW,
                    marginLeft: gap,
                    backgroundColor: c?.bg ?? color.surfaceRaised,
                    borderColor: open ? color.text : 'transparent',
                  },
                ]}>
                <Text
                  variant='dataSmall'
                  style={{color: c?.fg ?? color.textFaint}}>
                  {d == null ? '—' : formatCornerGap(d)}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ))}
    </View>
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
