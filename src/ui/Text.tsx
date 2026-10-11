import {Text as RNText, StyleSheet, type TextProps} from 'react-native';

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
  asWritten = false,
  style,
  ...rest
}: TextProps & {
  variant?: TextVariant;
  tone?: TextTone;
  /**
   * Keep the text's own case in an uppercase variant (label, tableHeader): a
   * name is one spelling on every screen ("T10a–T12", never "T10A–T12").
   */
  asWritten?: boolean;
}) {
  const {color} = useTheme();
  return (
    <RNText
      {...rest}
      style={[
        typeScale[variant],
        {color: color[tone]},
        asWritten && styles.asWritten,
        style,
      ]}
    />
  );
}

const styles = StyleSheet.create({asWritten: {textTransform: 'none'}});
