import {useLocalSearchParams, useRouter} from 'expo-router';
import {useMemo} from 'react';

import {
  CompareScreen,
  type CompareSelection,
} from '@/src/features/compare/CompareScreen';
import {parseSelection} from '@/src/nav/routes';
import {useLapSelection} from '@/src/features/session/useLapSelection';

// The URL owns the selection: ?laps=a,b,c&ref=&hl=&c=&t= (docs/ARCHITECTURE.md).
export default function CompareRoute() {
  const params = useLocalSearchParams<{
    id: string;
    laps?: string;
    ref?: string;
    hl?: string;
    c?: string;
    t?: string;
  }>();
  const router = useRouter();
  const {update} = useLapSelection();
  const {laps, ref, hl, c, t} = params;
  const selection = useMemo<CompareSelection>(() => {
    const sel = parseSelection({laps, ref, hl, c, t});
    return {...sel, cursorM: sel.cursorM ?? 0};
  }, [laps, ref, hl, c, t]);
  return (
    <CompareScreen
      sessionId={params.id}
      selection={selection}
      onSelectionChange={next =>
        update({
          laps: next.laps,
          ref: next.ref,
          hl: next.hl,
          corner: next.corner,
          cursorM: next.cursorM,
        })
      }
    />
  );
}
