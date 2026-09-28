import {useLocalSearchParams, useRouter} from 'expo-router';
import {useMemo} from 'react';

import {
  CompareScreen,
  type CompareSelection,
} from '@/src/features/compare/CompareScreen';
import {parseSelection} from '@/src/nav/routes';

// The URL owns the selection: ?laps=ref,a,b&hl=&c=&t= (docs/ARCHITECTURE.md).
export default function CompareRoute() {
  const params = useLocalSearchParams<{
    id: string;
    laps?: string;
    hl?: string;
    c?: string;
    t?: string;
  }>();
  const router = useRouter();
  const {laps, hl, c, t} = params;
  const selection = useMemo<CompareSelection>(() => {
    const sel = parseSelection({laps, hl, c, t});
    return {...sel, cursorM: sel.cursorM ?? 0};
  }, [laps, hl, c, t]);
  return (
    <CompareScreen
      sessionId={params.id}
      selection={selection}
      onSelectionChange={next =>
        router.setParams({
          laps: next.laps.join(','),
          hl: next.hl ?? undefined,
          c: next.corner == null ? undefined : String(next.corner),
          t: String(Math.round(next.cursorM)),
        })
      }
    />
  );
}
