import {useLocalSearchParams, useRouter} from 'expo-router';
import {useMemo} from 'react';

import {
  CompareScreen,
  type CompareSelection,
} from '@/src/features/compare/CompareScreen';
import {parseSelection} from '@/src/nav/routes';

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
        router.setParams({
          laps: next.laps.join(','),
          ref: next.ref ?? undefined,
          hl: next.hl ?? undefined,
          c: next.corner == null ? undefined : String(next.corner),
          t: String(Math.round(next.cursorM)),
        })
      }
    />
  );
}
