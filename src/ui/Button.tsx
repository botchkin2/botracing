import {Pressable, StyleSheet, View} from 'react-native';

import {radius, size, space, useTheme} from '@/src/design';

import {hitFor} from './hitArea';
import {Text} from './Text';

export type ButtonKind = 'primary' | 'outline' | 'tertiary';

export function Button({
  label,
  kind = 'primary',
  onPress,
  disabled,
}: {
  label: string;
  kind?: ButtonKind;
  onPress: () => void;
  disabled?: boolean;
}) {
  const {color} = useTheme();
  const fill = kind === 'primary' ? color.accent : 'transparent';
  const border = kind === 'outline' ? color.lineStrong : fill;
  const slop =
    (size.hit - (kind === 'tertiary' ? size.chip : size.transport)) / 2;
  return (
    <Pressable
      accessibilityRole='button'
      onPress={onPress}
      disabled={disabled}
      {...hitFor(0, slop)}>
      {({pressed}) => (
        <View
          style={[
            styles.base,
            kind === 'tertiary' && styles.tertiary,
            {
              backgroundColor: fill,
              borderColor: border,
              opacity: disabled ? 0.4 : pressed ? 0.8 : 1,
            },
          ]}>
          <Text
            variant='bodyStrong'
            style={{
              color:
                kind === 'primary'
                  ? color.bg
                  : kind === 'tertiary'
                  ? color.accentInk
                  : color.text,
            }}>
            {label}
          </Text>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: size.transport,
    paddingHorizontal: space.lg,
    borderRadius: radius.sm,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tertiary: {minHeight: size.chip, paddingHorizontal: space.xs},
});
