import {useLocalSearchParams, useRouter} from 'expo-router';
import {useMemo} from 'react';

import {parseSelection} from '@/src/nav/routes';

import {
  type Selection,
  SessionScreen,
} from '@/src/features/session/SessionScreen';

// The URL owns the selection: ?laps=ref,a,b&hl=lapId (docs/ARCHITECTURE.md).
export default function SessionRoute() {
  const params = useLocalSearchParams<{
    id: string;
    laps?: string;
    hl?: string;
  }>();
  const router = useRouter();
  const selection = useMemo<Selection>(() => {
    const {laps, hl} = parseSelection(params);
    return {laps, hl};
  }, [params]);
  return (
    <SessionScreen
      sessionId={params.id}
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
