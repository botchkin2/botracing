import {useLocalSearchParams, useRouter} from 'expo-router';
import {useMemo} from 'react';

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
  const selection = useMemo<Selection>(
    () => ({
      laps: params.laps ? params.laps.split(',').filter(Boolean) : [],
      hl: params.hl || null,
    }),
    [params.laps, params.hl],
  );
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
