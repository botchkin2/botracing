import {type ComponentProps, useState} from 'react';
import {StyleSheet, View} from 'react-native';

import {type PlanRules} from '@/src/analysis/fuelPlan';
import {space} from '@/src/design';
import {Chip, Text} from '@/src/ui';

import {RulesSheet} from './RulesSheet';

type SheetProps = Omit<
  ComponentProps<typeof RulesSheet>,
  'visible' | 'onClose'
>;

/**
 * The event rules (D6a): the rule set's chip, and under it the numbers the
 * plan is worked with, in a grid. The chip opens the Rules sheet. The VE
 * numbers are left out for a car with no VE.
 */
export function RulesBlock({
  rules,
  hasVe,
  ratioPerPctL,
  sheet,
  compact = false,
}: {
  rules: PlanRules | null;
  hasVe: boolean;
  /** Litres one % of VE is worth; null without VE. */
  ratioPerPctL: number | null;
  sheet: SheetProps;
  /** The chip and its sheet alone, to sit among other chips (the phone). */
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const cells: {label: string; value: string}[] = rules
    ? [
        {label: 'Max fuel', value: `${rules.fuelL} L`},
        ...(hasVe ? [{label: 'Max VE', value: `${rules.vePct} %`}] : []),
        ...(hasVe && ratioPerPctL != null
          ? [{label: '1 % VE', value: `${ratioPerPctL.toFixed(2)} L`}]
          : []),
        {
          label: 'Mandatory',
          value: `${rules.mandatoryStops} ${
            rules.mandatoryStops === 1 ? 'stop' : 'stops'
          }`,
        },
        {label: 'Formation', value: rules.formationLap ? '1 lap' : 'none'},
      ]
    : [];
  const chip = (
    <Chip
      label={
        'Rules: ' + (sheet.preset ? sheet.preset.name : 'No limits') + ' ▾'
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
