import {type ReactNode, useState} from 'react';
import {Pressable, StyleSheet, View} from 'react-native';

import {size, space, radius, useTheme} from '@/src/design';

import {hitFor} from './hitArea';
import {Text} from './Text';

/**
 * A "?" for a chart header and the 2–4 lines it opens under the chart.
 * `button` goes in the header, `panel` under it; tapping the "?" again
 * closes it. Nothing is stored: it opens closed every time, and there is no
 * hover, tour or first-open state (pit-wall thread 33 #1119). The lines say
 * what a mark is, how it is measured and what direction means, never what to
 * do (camber, #937).
 */
export function useHowToRead(
  subject: string,
  lines: readonly string[],
): {button: ReactNode; panel: ReactNode} {
  const [open, setOpen] = useState(false);
  return {
    button: (
      <HelpMark
        subject={subject}
        open={open}
        onPress={() => setOpen(o => !o)}
      />
    ),
    panel: open ? <HelpLines lines={lines} /> : null,
  };
}

function HelpMark({
  subject,
  open,
  onPress,
}: {
  subject: string;
  open: boolean;
  onPress: () => void;
}) {
  const {color} = useTheme();
  // A 20 pt mark inside a 44 pt target.
  const hit = hitFor(
    (size.hit - size.helpMark) / 2,
    (size.hit - size.helpMark) / 2,
  );
  return (
    <Pressable
      accessibilityRole='button'
      accessibilityLabel={`How to read ${subject}`}
      accessibilityState={{expanded: open}}
      onPress={onPress}
      hitSlop={hit.hitSlop}
      style={hit.style}>
      <View
        style={[
          styles.mark,
          {
            backgroundColor: open ? color.accentTint : undefined,
            borderColor: open ? color.accent : color.lineStrong,
          },
        ]}>
        <Text variant='dataSmall' tone={open ? 'accentInk' : 'textMuted'}>
          ?
        </Text>
      </View>
    </Pressable>
  );
}

function HelpLines({lines}: {lines: readonly string[]}) {
  const {color} = useTheme();
  return (
    <View
      style={[
        styles.panel,
        {backgroundColor: color.surfaceRaised, borderColor: color.line},
      ]}>
      {lines.map(line => (
        <Text key={line} variant='explainer' tone='textSecondary'>
          {line}
        </Text>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  mark: {
    width: size.helpMark,
    height: size.helpMark,
    borderRadius: size.helpMark / 2,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  panel: {
    gap: space.xs,
    padding: space.sm,
    borderWidth: 1,
    borderRadius: radius.md,
  },
});
