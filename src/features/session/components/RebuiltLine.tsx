import {useState} from 'react';

import {hitBox} from '@/src/design';
import {Pressable, Text} from '@/src/ui';

/**
 * The one line a healed session carries (thread 74, plank #5674): it was
 * rebuilt from the game file. A tap opens when and which stretches.
 */
export function RebuiltLine({
  rebuilt,
}: {
  rebuilt: {line: string; detail: string};
}) {
  const [open, setOpen] = useState(false);
  return (
    <Pressable
      accessibilityRole='button'
      accessibilityState={{expanded: open}}
      accessibilityLabel={rebuilt.line}
      style={hitBox.link}
      onPress={() => setOpen(!open)}>
      <Text variant='dataSmall' tone='textMuted'>
        {open ? `${rebuilt.line} · ${rebuilt.detail}` : rebuilt.line}
      </Text>
    </Pressable>
  );
}
