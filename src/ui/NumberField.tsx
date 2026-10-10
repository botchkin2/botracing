import {StyleSheet, TextInput, View} from 'react-native';

import {radius, size, space, type as typeScale, useTheme} from '@/src/design';

import {Text} from './Text';

/**
 * A labelled number box, 44 pt tall, mono digits. It holds text so a half-typed
 * "7." is not rewritten; the caller parses it. `unit` sits at the right.
 */
export function NumberField({
  label,
  value,
  onChange,
  unit,
  placeholder,
  decimal,
  showLabel = true,
}: {
  label: string;
  value: string;
  onChange: (text: string) => void;
  unit?: string;
  placeholder?: string;
  decimal?: boolean;
  /** False when a heading above a row of controls names the field; the label is still spoken. */
  showLabel?: boolean;
}) {
  const {color} = useTheme();
  return (
    <View style={styles.field}>
      {showLabel ? (
        <Text variant='label' tone='textMuted'>
          {label}
        </Text>
      ) : null}
      <View
        style={[
          styles.box,
          {backgroundColor: color.surface, borderColor: color.lineStrong},
        ]}>
        <TextInput
          accessibilityLabel={label}
          value={value}
          onChangeText={onChange}
          placeholder={placeholder}
          placeholderTextColor={color.textFaint}
          inputMode={decimal ? 'decimal' : 'numeric'}
          style={[typeScale.data, styles.input, {color: color.text}]}
        />
        {unit ? (
          <Text variant='dataSmall' tone='textMuted'>
            {unit}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

// The box's border, drawn inside its 44 pt; the input's negative margin takes it
// back so the input is the full 44 and a tap at the box's top edge focuses it.
const BORDER_W = 1;

const styles = StyleSheet.create({
  field: {gap: space.xs, flex: 1},
  box: {
    height: size.hit,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.md,
    borderWidth: BORDER_W,
    borderRadius: radius.sm,
  },
  // Fills the 44 pt box, so a tap anywhere in it focuses the field.
  input: {
    flex: 1,
    minWidth: 0,
    alignSelf: 'stretch',
    marginVertical: -BORDER_W,
    paddingVertical: 0,
  },
});
