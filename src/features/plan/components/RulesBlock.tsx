import {type ComponentProps, useState} from 'react';
import {StyleSheet, View} from 'react-native';

import {space} from '@/src/design';
import {Chip, Text} from '@/src/ui';

import {type RulesCell} from '../model';

import {RulesSheet} from './RulesSheet';

type SheetProps = Omit<
  ComponentProps<typeof RulesSheet>,
  'visible' | 'onClose'
>;

/**
 * The event rules (D6a): the rule set's chip, and under it the numbers the
 * plan is worked with, in a grid. The chip opens the Rules sheet.
 */
export function RulesBlock({
  cells,
  sheet,
  eventText,
  compact = false,
}: {
  /** The numbers the plan is worked with, finished (`rulesCells`). */
  cells: RulesCell[];
  sheet: SheetProps;
  /** The event the plan is for ("week of 09-29 · 100 L"), the chip's label when no rule set is picked. */
  eventText: string | null;
  /** The chip and its sheet alone, to sit among other chips (the phone). */
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const chip = (
    <Chip
      label={
        'Rules: ' +
        (sheet.preset ? sheet.preset.name : eventText ?? 'No limits') +
        ' ▾'
      }
      onPress={() => setOpen(true)}
    />
  );
  if (compact)
    return (
      <>
        {chip}
        <RulesSheet {...sheet} visible={open} onClose={() => setOpen(false)} />
      </>
    );
  return (
    <View style={styles.box}>
      <View style={styles.chips}>{chip}</View>
      {cells.length > 0 ? (
        <View style={styles.grid}>
          {cells.map(c => (
            <View key={c.label} style={styles.cell}>
              <Text variant='tableHeader' tone='textMuted'>
                {c.label}
              </Text>
              <Text variant='dataStrong'>{c.value}</Text>
            </View>
          ))}
        </View>
      ) : null}
      <RulesSheet {...sheet} visible={open} onClose={() => setOpen(false)} />
    </View>
  );
}

const styles = StyleSheet.create({
  box: {gap: space.md},
  chips: {flexDirection: 'row', flexWrap: 'wrap', columnGap: space.sm},
  grid: {flexDirection: 'row', flexWrap: 'wrap', rowGap: space.md},
  cell: {width: '50%', gap: space.xxs},
});
