import {StyleSheet, View} from 'react-native';

import {size, space} from '@/src/design';
import {Chip, NumberField, Segment} from '@/src/ui';

const KINDS = [
  {value: 'min', label: 'Minutes'},
  {value: 'laps', label: 'Laps'},
] as const;

// The stepper keeps this much before the switch wraps under it (- + 44 pt each and a four-digit field).
const STEPPER_BASIS = 220;

/** One tap of - or +: 5 minutes, or a lap. */
export const LENGTH_STEP = {min: 5, laps: 1} as const;

/**
 * The race length (D6a, 07a): the value between a - and a + (44 pt), then
 * Minutes | Laps behind it, since the length is nearly always in minutes. The value is still typed text, so a half-typed number is not
 * rewritten; the caller parses it.
 */
export function LengthStepper({
  kind,
  text,
  onKind,
  onText,
  onStep,
}: {
  kind: 'min' | 'laps';
  text: string;
  onKind: (kind: 'min' | 'laps') => void;
  onText: (text: string) => void;
  /** The change asked for, in the kind's unit: -5 or +5 minutes, -1 or +1 lap. */
  onStep: (delta: number) => void;
}) {
  const step = LENGTH_STEP[kind];
  return (
    <View style={styles.row}>
      <View style={styles.stepper}>
        <Chip label='−' minWidth={size.hit} onPress={() => onStep(-step)} />
        <NumberField
          label={kind === 'min' ? 'Minutes' : 'Laps'}
          showLabel={false}
          value={text}
          onChange={onText}
        />
        <Chip label='+' minWidth={size.hit} onPress={() => onStep(step)} />
      </View>
      <Segment options={KINDS} value={kind} onChange={onKind} />
    </View>
  );
}

const styles = StyleSheet.create({
  // Wraps: on a phone the Minutes | Laps switch drops under the field.
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: space.lg,
  },
  stepper: {
    flexGrow: 1,
    flexBasis: STEPPER_BASIS,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
});
