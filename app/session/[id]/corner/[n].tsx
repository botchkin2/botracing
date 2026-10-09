import {useLocalSearchParams, useRouter} from 'expo-router';
import {useMemo} from 'react';

import {
  CornerScreen,
  type CornerSelection,
} from '@/src/features/corner/CornerScreen';
import {parseSelection} from '@/src/nav/routes';

// The URL owns the selection: /session/[id]/corner/[n]?laps=ref,a,b&hl=
export default function CornerRoute() {
  const params = useLocalSearchParams<{
    id: string;
    n: string;
    laps?: string;
    ref?: string;
    hl?: string;
  }>();
  const router = useRouter();
  const {laps, ref, hl} = params;
  const selection = useMemo<CornerSelection>(() => {
    const sel = parseSelection({laps, ref, hl});
    return {laps: sel.laps, ref: sel.ref, hl: sel.hl};
  }, [laps, ref, hl]);
  return (
    <CornerScreen
      key={params.n}
      sessionId={params.id}
      corner={Number(params.n)}
      selection={selection}
      onSelectionChange={next =>
        router.setParams({
          laps: next.laps.length ? next.laps.join(',') : undefined,
          hl: next.hl ?? undefined,
        })
      }
    />
  );
}
