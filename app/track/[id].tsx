import {useLocalSearchParams, useRouter} from 'expo-router';

import {TrackScreen} from '@/src/features/track/TrackScreen';
import {parseSelection} from '@/src/nav/routes';

// The URL owns the selection: /track/[id]?c=9 is corner 9 selected.
export default function TrackRoute() {
  const params = useLocalSearchParams<{id: string; c?: string}>();
  const router = useRouter();
  const {corner} = parseSelection({c: params.c});
  return (
    <TrackScreen
      key={params.id}
      trackId={params.id}
      selectedCorner={corner}
      onSelectCorner={n =>
        router.setParams({c: n == null ? undefined : String(n)})
      }
    />
  );
}
