import {Text} from './Text';

/** The one-line "what this shows" under every chart and table label. Copy is verbatim from the handoff. */
export function Explainer({children}: {children: string}) {
  return (
    <Text variant='explainer' tone='textMuted'>
      {children}
    </Text>
  );
}
