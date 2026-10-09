import {type ReactNode, useState} from 'react';
import {Pressable, StyleSheet, View} from 'react-native';

import {size, space, useTheme} from '@/src/design';

import {Text} from './Text';

/**
 * A section that opens on a tap and starts closed: one 44 pt line with what is
 * inside (the title, then a one-line summary of the numbers), so a long page
 * keeps its place while the detail stays one tap away. Nothing is stored; it
 * opens closed each time, like the "?" panels.
 */
export function FoldedSection({
  title,
  summary,
  children,
  defaultOpen = false,
}: {
  title: string;
  /** One line of what is in it; null shows only the title. */
  summary: string | null;
  children: ReactNode;
  /** Starts open when true; closed by default. */
  defaultOpen?: boolean;
}) {
  const {color} = useTheme();
  const [open, setOpen] = useState(defaultOpen);
  return (
    <View>
      <Pressable
        accessibilityRole='button'
        accessibilityState={{expanded: open}}
        accessibilityLabel={`${title}${summary ? `, ${summary}` : ''}`}
        onPress={() => setOpen(o => !o)}
        style={[styles.head, {borderColor: color.line}]}>
        <Text variant='label'>{title}</Text>
        <Text
          variant='dataSmall'
          tone='textMuted'
          numberOfLines={1}
          style={styles.summary}>
          {summary ?? ''}
        </Text>
        <Text variant='dataSmall' tone='accentInk'>
          {open ? '▴' : '▾'}
        </Text>
      </Pressable>
      {open ? <View style={styles.body}>{children}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: size.hit,
    borderTopWidth: 1,
  },
  summary: {flex: 1},
  body: {paddingBottom: space.lg},
});
