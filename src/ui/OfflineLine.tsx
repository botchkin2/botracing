import {Text} from './Text';

/**
 * "Offline · 00:41" in a screen's head while it shows data a failed refetch
 * could not renew (src/data/queryState.ts, roadmap 6b). Nothing when current.
 */
export function OfflineLine({text}: {text: string | null}) {
  if (!text) return null;
  return (
    <Text variant='dataSmall' tone='textMuted' accessibilityRole='text'>
      {text}
    </Text>
  );
}
