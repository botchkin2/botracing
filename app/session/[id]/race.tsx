import {useLocalSearchParams, useRouter} from 'expo-router';
import {useMemo} from 'react';

import {RaceScreen} from '@/src/features/race/RaceScreen';
import {type RaceSelection} from '@/src/features/race/selectionClock';
import {parseSelection} from '@/src/nav/routes';

// Race playback: every car on the track, on the same clock as Compare. The URL
// owns the selection (docs/ARCHITECTURE.md): Race opens on its cursor and,
// once the clock has rested, writes the cursor back.
export default function RaceRoute() {
  const params = useLocalSearchParams<{
    id: string;
    laps?: string;
    hl?: string;
    c?: string;
    t?: string;
  }>();
  const router = useRouter();
  const {laps, hl, c, t} = params;
  const selection = useMemo<RaceSelection>(() => {
    const sel = parseSelection({laps, hl, c, t});
    return {
      laps: sel.laps,
      hl: sel.hl,
      cursorM: t ? sel.cursorM : null,
    };
  }, [laps, hl, c, t]);
  return (
    <RaceScreen
      sessionId={params.id}
      selection={selection}
      onSelectionChange={patch =>
        router.setParams({hl: patch.hl ?? undefined, t: String(patch.cursorM)})
      }
    />
  );
}
