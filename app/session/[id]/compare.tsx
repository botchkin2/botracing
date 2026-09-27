import {useLocalSearchParams, useRouter} from 'expo-router';
import {useMemo} from 'react';

import {
  CompareScreen,
  type CompareSelection,
} from '@/src/features/compare/CompareScreen';

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
  const selection = useMemo<CompareSelection>(
    () => ({
      laps: params.laps ? params.laps.split(',').filter(Boolean) : [],
      hl: params.hl || null,
      corner: params.c ? Number(params.c) : null,
      cursorM: params.t ? Number(params.t) : 0,
    }),
    [params.laps, params.hl, params.c, params.t],
  );
  return (
    <CompareScreen
      sessionId={params.id}
      selection={selection}
      onSelectionChange={next =>
        router.setParams({
          laps: next.laps.join(','),
          hl: next.hl ?? undefined,
          c: next.corner == null ? undefined : String(next.corner),
        })
      }
    />
  );
}
