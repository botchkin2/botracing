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
}: {
  label: string;
  value: string;
  onChange: (text: string) => void;
  unit?: string;
  placeholder?: string;
  decimal?: boolean;
}) {
  const {color} = useTheme();
  return (
    <View style={styles.field}>
      <Text variant='label' tone='textMuted'>
        {label}
      </Text>
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

const styles = StyleSheet.create({
  field: {gap: space.xs, flex: 1},
  box: {
    height: size.hit,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.md,
    borderWidth: 1,
    borderRadius: radius.sm,
  },
  input: {flex: 1, minWidth: 0, paddingVertical: 0},
});
