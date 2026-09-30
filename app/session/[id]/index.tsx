import {useLocalSearchParams, useRouter} from 'expo-router';
import {useMemo} from 'react';
import {StyleSheet, View} from 'react-native';

import {ContentInset, size, useLayout} from '@/src/design';
import {parseSelection, sessionHref} from '@/src/nav/routes';
import {SessionsRail} from '@/src/ui';

import {
  type Selection,
  SessionScreen,
} from '@/src/features/session/SessionScreen';
import {PitPlanHalf} from '@/src/features/plan/components/PitPlanHalf';
import {PooledUseCard} from '@/src/features/plan/components/PooledUseCard';
import {useSessionsModel} from '@/src/features/sessions/model';

// The URL owns the selection: ?laps=ref,a,b&hl=lapId (docs/ARCHITECTURE.md).
export default function SessionRoute() {
  const params = useLocalSearchParams<{
    id: string;
    laps?: string;
    hl?: string;
  }>();
  const router = useRouter();
  const {isWide} = useLayout();
  const {laps, hl} = params;
  const selection = useMemo<Selection>(() => {
    const sel = parseSelection({laps, hl});
    return {laps: sel.laps, hl: sel.hl};
  }, [laps, hl]);
  const screen = (
    <SessionScreen
      sessionId={params.id}
      selection={selection}
      // Another feature's card, composed here: features do not import each other.
      renderPlanHalf={(card, facts) => (
        <PitPlanHalf card={card} facts={facts} />
      )}
      renderPooledUse={(planKey, width) => (
        <PooledUseCard planKey={planKey} sessionId={params.id} width={width} />
      )}
      onSelectionChange={next =>
        router.setParams({
          laps: next.laps.length ? next.laps.join(',') : undefined,
          hl: next.hl ?? undefined,
        })
      }
    />
  );
  if (!isWide) return screen;
  return (
    <View style={styles.row}>
      <Rail
        activeId={params.id}
        // Lap ids belong to one session, so the selection does not carry over.
        onSelect={id => router.replace(sessionHref(id))}
      />
      <View style={styles.flex}>
        <ContentInset width={size.railWidth}>{screen}</ContentInset>
      </View>
    </View>
  );
}

/** Desktop (≥1280) sessions rail, fed from the Sessions model. */
function Rail({
  activeId,
  onSelect,
}: {
  activeId: string;
  onSelect: (id: string) => void;
}) {
  const model = useSessionsModel();
  const status =
    model.state === 'loading'
      ? 'Loading sessions…'
      : model.state === 'error'
      ? `Couldn’t load sessions: ${model.message}`
      : model.state === 'empty'
      ? 'No sessions yet'
      : undefined;
  return (
    <SessionsRail
      days={model.state === 'ready' ? model.days : []}
      activeId={activeId}
      onSelect={onSelect}
      status={status}
    />
  );
}

const styles = StyleSheet.create({
  row: {flex: 1, flexDirection: 'row'},
  flex: {flex: 1},
});
