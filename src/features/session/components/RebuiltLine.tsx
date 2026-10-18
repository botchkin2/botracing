import {useRouter} from 'expo-router';
import {useEffect, useState} from 'react';
import {View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';

import {hitBox, useTheme} from '@/src/design';
import {sessionHref} from '@/src/nav/routes';
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

/**
 * A link to a session a heal replaced (thread 74): it opens the rebuilt one at
 * once, and says so if that takes a moment or the user comes back.
 */
export function MovedLine({to}: {to: string}) {
  const router = useRouter();
  const {color} = useTheme();
  const insets = useSafeAreaInsets();
  useEffect(() => {
    router.replace(sessionHref(to));
  }, [router, to]);
  return (
    <View
      style={{
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: color.bg,
        paddingTop: insets.top,
      }}>
      <Pressable
        accessibilityRole='link'
        style={hitBox.link}
        onPress={() => router.replace(sessionHref(to))}>
        <Text tone='textMuted'>Moved to the rebuilt session</Text>
      </Pressable>
    </View>
  );
}
