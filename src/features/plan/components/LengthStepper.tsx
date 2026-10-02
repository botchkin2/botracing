import {StyleSheet, View} from 'react-native';

import {size, space} from '@/src/design';
import {Chip, NumberField, Segment} from '@/src/ui';

const KINDS = [
  {value: 'min', label: 'Minutes'},
  {value: 'laps', label: 'Laps'},
] as const;

/** One tap of - or +: 5 minutes, or a lap. */
export const LENGTH_STEP = {min: 5, laps: 1} as const;

/**
 * The race length (D6a, 07a): Minutes | Laps, and the value between a - and a
 * + (44 pt). The value is still typed text, so a half-typed number is not
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
      <Segment options={KINDS} value={kind} onChange={onKind} />
      <View style={styles.stepper}>
        <Chip label='−' minWidth={size.hit} onPress={() => onStep(-step)} />
        <NumberField
          label={kind === 'min' ? 'Minutes' : 'Laps'}
          value={text}
          onChange={onText}
        />
        <Chip label='+' minWidth={size.hit} onPress={() => onStep(step)} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {flexDirection: 'row', alignItems: 'flex-end', gap: space.lg},
  stepper: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: space.sm,
  },
});
