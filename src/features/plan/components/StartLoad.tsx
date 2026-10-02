import {StyleSheet, View} from 'react-native';

import {space} from '@/src/design';
import {Chip, NumberField, Text} from '@/src/ui';

import {type StartChip} from '../model';

/**
 * What the car starts with (Botkin's race, thread 44 #1901): the VE and the
 * fuel of the first load, blank for a full one. The last race's start is a
 * one-tap chip beside the input, never a prefill (parc #1902). The first
 * stint, the stops, the windows and the Pit plan all read these.
 */
export function StartLoad({
  hasVe,
  veText,
  fuelText,
  full,
  chips,
  onVe,
  onFuel,
}: {
  hasVe: boolean;
  veText: string;
  fuelText: string;
  /** The full load, shown as the blank's placeholder. */
  full: {fuelL: number; vePct: number};
  chips: {ve: StartChip | null; fuel: StartChip | null};
  onVe: (text: string) => void;
  onFuel: (text: string) => void;
}) {
  return (
    <View style={styles.box}>
      <View style={styles.fields}>
        {hasVe ? (
          <NumberField
            label='Start VE'
            value={veText}
            onChange={onVe}
            unit='%'
            placeholder={String(full.vePct)}
          />
        ) : null}
        <NumberField
          label='Start fuel'
          value={fuelText}
          onChange={onFuel}
          unit='L'
          decimal
          placeholder={String(full.fuelL)}
        />
      </View>
      <View style={styles.chips}>
        {chips.ve ? (
          <Chip label={chips.ve.label} onPress={() => onVe(chips.ve!.text)} />
        ) : null}
        {chips.fuel ? (
          <Chip
            label={chips.fuel.label}
            onPress={() => onFuel(chips.fuel!.text)}
          />
        ) : null}
      </View>
      {veText !== '' || fuelText !== '' ? (
        <Text variant='dataSmall' tone='textMuted'>
          A start under the full load: the first stint, the stops and the
          windows use it. Blank is a full load.
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: {gap: space.md},
  fields: {flexDirection: 'row', gap: space.lg},
  // Row gap 2 x the chips' 8 pt vertical hit growth, so wrapped rows never overlap.
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    columnGap: space.sm,
    rowGap: space.xl,
  },
});
