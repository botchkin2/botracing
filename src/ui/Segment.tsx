import {Pressable, StyleSheet, View} from 'react-native';

import {radius, size, space, useTheme} from '@/src/design';

import {Text} from './Text';

/** Two or three mutually exclusive options, e.g. Stack / One chart. */
export function Segment<T extends string>({
  options,
  value,
  onChange,
}: {
  options: readonly {value: T; label: string}[];
  value: T;
  onChange: (value: T) => void;
}) {
  const {color} = useTheme();
  return (
    <View
      accessibilityRole='tablist'
      style={[styles.row, {borderColor: color.lineStrong}]}>
      {options.map(option => {
        const on = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole='tab'
            accessibilityState={{selected: on}}
            onPress={() => onChange(option.value)}
            hitSlop={{
              top: (size.hit - size.chip) / 2,
              bottom: (size.hit - size.chip) / 2,
            }}
            style={[styles.option, on && {backgroundColor: color.accentTint}]}>
            <Text variant='dataStrong' tone={on ? 'accentInk' : 'textMuted'}>
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    borderWidth: 1,
    borderRadius: radius.sm,
    overflow: 'hidden',
  },
  option: {
    height: size.chip,
    paddingHorizontal: space.md,
    justifyContent: 'center',
  },
});
