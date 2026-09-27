import {Text as RNText, type TextProps} from 'react-native';

import {type ColorTokens, type as typeScale, useTheme} from '@/src/design';

export type TextVariant = keyof typeof typeScale;
type TextTone =
  | Extract<keyof ColorTokens, `text${string}`>
  | 'accentInk'
  | 'best'
  | 'faster'
  | 'slower';

/** All text in the new screens goes through this: one type token, one color token. */
export function Text({
  variant = 'body',
  tone = 'text',
  style,
  ...rest
}: TextProps & {variant?: TextVariant; tone?: TextTone}) {
  const {color} = useTheme();
  return (
    <RNText
      {...rest}
      style={[typeScale[variant], {color: color[tone]}, style]}
    />
  );
}
