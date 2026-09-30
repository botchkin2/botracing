import {useState} from 'react';
import {Pressable} from 'react-native';

import {space} from '@/src/design';
import {Text} from '@/src/ui';

/**
 * A row's "Ref": muted until the pointer is over it or it has focus, then
 * amber (apex, thread 43 #1297: about 40 amber labels down All laps drown the
 * one that matters). Touch has no hover, so on the phone it stays muted.
 */
export function RefAction({
  label,
  onPress,
}: {
  label: string;
  onPress: () => void;
}) {
  const [lit, setLit] = useState(false);
  return (
    <Pressable
      accessibilityRole='button'
      accessibilityLabel={label}
      hitSlop={space.sm}
      onHoverIn={() => setLit(true)}
      onHoverOut={() => setLit(false)}
      onFocus={() => setLit(true)}
      onBlur={() => setLit(false)}
      onPress={onPress}>
      <Text variant='dataSmall' tone={lit ? 'accentInk' : 'textFaint'}>
        Ref
      </Text>
    </Pressable>
  );
}
