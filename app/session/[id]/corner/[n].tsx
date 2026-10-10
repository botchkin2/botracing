import {useLocalSearchParams, useRouter} from 'expo-router';
import {useMemo} from 'react';

import {
  CornerScreen,
  type CornerSelection,
} from '@/src/features/corner/CornerScreen';
import {parseSelection} from '@/src/nav/routes';
import {useLapSelection} from '@/src/features/session/useLapSelection';

// The URL owns the selection: /session/[id]/corner/[n]?laps=ref,a,b&hl=
export default function CornerRoute() {
  const params = useLocalSearchParams<{
    id: string;
    n: string;
    laps?: string;
    ref?: string;
    hl?: string;
    all?: string;
  }>();
  const router = useRouter();
  const {update} = useLapSelection();
  const {laps, ref, hl} = params;
  const selection = useMemo<CornerSelection>(() => {
    const sel = parseSelection({laps, ref, hl});
    return {laps: sel.laps, ref: sel.ref, hl: sel.hl};
  }, [laps, ref, hl]);
  return (
    <CornerScreen
      key={`${params.n}${params.all ? '-all' : ''}`}
      sessionId={params.id}
      corner={Number(params.n)}
      whole={params.all === '1'}
      selection={selection}
      onSelectionChange={next => update({laps: next.laps, hl: next.hl})}
    />
  );
}
