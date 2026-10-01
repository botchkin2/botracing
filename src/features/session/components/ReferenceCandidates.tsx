import {useState} from 'react';
import {StyleSheet, View} from 'react-native';

import {type Lap, type SessionDetail} from '@/src/data/sessions';
import {space} from '@/src/design';
import {Button, Text} from '@/src/ui';

import {candidateLine, matchText} from '../referenceCandidates';
import {useReferenceCandidates} from '../useReferenceCandidates';

/**
 * Other laps that could be this lap's reference, from this session and the
 * other sessions at the same track and car: the numbers and what each matches
 * (src/analysis/referenceLap.ts). Fetched when asked for.
 */
export function ReferenceCandidates({
  session,
  laps,
  lap,
}: {
  session: SessionDetail;
  laps: Lap[];
  lap: Lap;
}) {
  const [asked, setAsked] = useState(false);
  const state = useReferenceCandidates(session, laps, lap, asked);
  if (state.kind === 'idle')
    return (
      <View style={styles.action}>
        <Button
          label='Reference candidates'
          kind='outline'
          onPress={() => setAsked(true)}
        />
      </View>
    );
  return (
    <View style={styles.block}>
      <Text variant='label' tone='textMuted'>
        Reference candidates
      </Text>
      {state.kind === 'loading' && (
        <Text variant='dataSmall' tone='textMuted'>
          Reading other sessions at this track…
        </Text>
      )}
      {state.kind === 'failed' && (
        <Text variant='dataSmall' tone='textMuted'>
          Could not read the other sessions.
        </Text>
      )}
      {state.kind === 'ready' && state.candidates.length === 0 && (
        <Text variant='dataSmall' tone='textMuted'>
          No whole timed lap to compare with.
        </Text>
      )}
      {state.kind === 'ready' &&
        state.candidates.map(c => (
          <View key={c.lapId}>
            <Text variant='dataSmall'>{candidateLine(c)}</Text>
            <Text variant='dataSmall' tone='textMuted'>
              {matchText(c.match)}
            </Text>
          </View>
        ))}
      {state.kind === 'ready' && (
        <Text variant='explainer' tone='textMuted'>
          {`Ranked on car, session type, load (fuel within 10 L, else Virtual Energy within 10 points), tyres kept, clean air; then the fastest. ${
            state.sessions
          } other session${
            state.sessions === 1 ? '' : 's'
          } at this track and car.`}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  block: {gap: space.xs, marginTop: space.sm},
  action: {alignSelf: 'flex-start', marginTop: space.sm},
});
