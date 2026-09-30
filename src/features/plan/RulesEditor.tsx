import {useState} from 'react';
import {StyleSheet, TextInput, View} from 'react-native';

import {radius, size, space, type as typeScale, useTheme} from '@/src/design';
import {type FuelPreset} from '@/src/state/fuelPresets';
import {Button, Checkbox, NumberField, Text} from '@/src/ui';

import {parseNumber} from './model';

/** Fields of a preset being written; text, so half-typed numbers survive. */
type Draft = {
  name: string;
  fuel: string;
  ve: string;
  ratio: string;
  stops: string;
  formationLap: boolean;
};

function draftOf(preset: FuelPreset | null): Draft {
  return {
    name: preset?.name ?? '',
    fuel: preset?.fuelL != null ? String(preset.fuelL) : '',
    ve: String(preset?.vePct ?? 100),
    ratio: preset?.veRatio != null ? String(preset.veRatio) : '',
    stops: String(preset?.mandatoryStops ?? 0),
    formationLap: preset?.formationLap ?? true,
  };
}

/**
 * The rules of one event: a name, max fuel, VE at the start, mandatory stops
 * and the formation lap. The race length sits on the screen above, because it
 * is what he changes race to race. Blank max fuel means "the fill limit of my
 * last session there".
 */
export function RulesEditor({
  preset,
  lastFillLimitL,
  lastVeRatio,
  onSave,
  onCancel,
}: {
  /** The preset being edited, or null for a new one. */
  preset: FuelPreset | null;
  lastFillLimitL: number | null;
  /** Litres per 1 % VE measured in the last session there. */
  lastVeRatio: number | null;
  onSave: (
    fields: Pick<
      FuelPreset,
      'name' | 'fuelL' | 'vePct' | 'veRatio' | 'mandatoryStops' | 'formationLap'
    >,
  ) => void;
  onCancel: () => void;
}) {
  const {color} = useTheme();
  const [draft, setDraft] = useState(() => draftOf(preset));
  const fuel = draft.fuel.trim() === '' ? null : parseNumber(draft.fuel);
  const ve = parseNumber(draft.ve);
  const ratio = draft.ratio.trim() === '' ? null : parseNumber(draft.ratio);
  const stops = draft.stops.trim() === '' ? 0 : Number(draft.stops);
  const valid =
    draft.name.trim() !== '' &&
    (draft.fuel.trim() === '' || fuel != null) &&
    ve != null &&
    ve <= 100 &&
    (draft.ratio.trim() === '' || ratio != null) &&
    Number.isInteger(stops) &&
    stops >= 0;
  return (
    <View
      style={[
        styles.box,
        {backgroundColor: color.surfaceRaised, borderColor: color.lineStrong},
      ]}>
      <View style={styles.field}>
        <Text variant='label' tone='textMuted'>
          Name
        </Text>
        <TextInput
          accessibilityLabel='Name'
          value={draft.name}
          onChangeText={name => setDraft(d => ({...d, name}))}
          placeholder='Endurance 75 % fuel'
          placeholderTextColor={color.textFaint}
          style={[
            typeScale.body,
            styles.name,
            {
              color: color.text,
              backgroundColor: color.surface,
              borderColor: color.lineStrong,
            },
          ]}
        />
      </View>
      <View style={styles.row}>
        <NumberField
          label='Max fuel'
          unit='L'
          decimal
          value={draft.fuel}
          placeholder={
            lastFillLimitL != null ? `${lastFillLimitL}` : 'fill limit'
          }
          onChange={fuelText => setDraft(d => ({...d, fuel: fuelText}))}
        />
        <NumberField
          label='VE at start'
          unit='%'
          decimal
          value={draft.ve}
          onChange={veText => setDraft(d => ({...d, ve: veText}))}
        />
      </View>
      <View style={styles.row}>
        <NumberField
          label='L per 1 % VE'
          unit='L'
          decimal
          value={draft.ratio}
          placeholder={
            lastVeRatio != null ? lastVeRatio.toFixed(3) : 'measured'
          }
          onChange={ratioText => setDraft(d => ({...d, ratio: ratioText}))}
        />
        <View style={styles.field} />
      </View>
      <View style={styles.row}>
        <NumberField
          label='Mandatory stops'
          value={draft.stops}
          onChange={stopsText => setDraft(d => ({...d, stops: stopsText}))}
        />
        <View style={[styles.field, styles.check]}>
          <Text variant='label' tone='textMuted'>
            Formation lap
          </Text>
          <View style={styles.checkRow}>
            <Checkbox
              label='Formation lap'
              checked={draft.formationLap}
              onToggle={() =>
                setDraft(d => ({...d, formationLap: !d.formationLap}))
              }
            />
            <Text variant='body' tone='textSecondary'>
              burns a lap of fuel and VE
            </Text>
          </View>
        </View>
      </View>
      <View style={styles.actions}>
        <Button label='Cancel' kind='outline' onPress={onCancel} />
        <Button
          label='Save preset'
          disabled={!valid}
          onPress={() =>
            onSave({
              name: draft.name.trim(),
              fuelL: fuel,
              vePct: ve ?? 100,
              veRatio: ratio,
              mandatoryStops: stops,
              formationLap: draft.formationLap,
            })
          }
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    gap: space.lg,
    padding: space.lg,
    borderWidth: 1,
    borderRadius: radius.md,
  },
  field: {gap: space.xs},
  row: {flexDirection: 'row', gap: space.lg},
  name: {
    height: size.hit,
    paddingHorizontal: space.md,
    borderWidth: 1,
    borderRadius: radius.sm,
  },
  check: {flex: 1},
  checkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: size.hit,
  },
  actions: {flexDirection: 'row', justifyContent: 'flex-end', gap: space.md},
});
