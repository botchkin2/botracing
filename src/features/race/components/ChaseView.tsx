import {useLocalSearchParams} from 'expo-router';
import {useCallback, useEffect, useState} from 'react';
import {StyleSheet, View} from 'react-native';
import {WebView} from 'react-native-webview';

import {type ChaseRoad} from '@/src/analysis/chaseRoad';
import {fetchHandoffToken} from '@/src/data/handoff';
import {radius, space, useTheme} from '@/src/design';
import {Pressable, Text} from '@/src/ui';

import {type TowerCar} from '@/src/features/race/chase/towerRows';
import {type ChaseCar, type ChaseGaps, type ChaseInputs, type ChaseSampler} from '@/src/features/race/chase/chaseTypes';

import {allowsNavigation, EMBED_ORIGIN, embedUrl} from '../embed3d';

/**
 * The 3D chase draws with WebGL, in a page: on the phone it is the web page itself, in a WebView inside the app
 * (the race page with `embed=3d`), signed in as the same person by a one-time custom token (embed3d.ts). The cars and
 * the road are the page's own, so none of the props below are used: the page loads its own data.
 */
export const chaseAvailable = true;
/** The road is fitted by the page in the WebView, not here. */
export const chaseNeedsRoad = false;

type State = {kind: 'loading'} | {kind: 'ready'; url: string} | {kind: 'failed'};

export function ChaseView({width, height}: {
  width: number;
  height: number;
  road: ChaseRoad | null;
  cars: ChaseCar[];
  sample: ChaseSampler;
  timeS: number;
  focus: number | null;
  playing: boolean;
  rate: number;
  inputs: ChaseInputs | null;
  gaps: ChaseGaps | null;
  tower: TowerCar[];
  trackM: number;
  clockLabel: string;
  onToggle: () => void;
  onStep: (deltaS: number) => void;
  onCycleRate: () => void;
  onPressCar: (index: number) => void;
  embedded?: boolean;
}) {
  const {color} = useTheme();
  const params = useLocalSearchParams<{id: string; laps?: string; ref?: string; hl?: string; c?: string; t?: string}>();
  const [state, setState] = useState<State>({kind: 'loading'});
  const [attempt, setAttempt] = useState(0);
  const {id, laps, ref, hl, c, t} = params;
  useEffect(() => {
    let dead = false;
    fetchHandoffToken().then(
      token => {
        if (!dead) setState({kind: 'ready', url: embedUrl(EMBED_ORIGIN, id, {laps, ref, hl, c, t}, token)});
      },
      () => {
        if (!dead) setState({kind: 'failed'});
      },
    );
    return () => {
      dead = true;
    };
    // The address is made once per opening (and per retry): the page keeps its own clock after that.
  }, [attempt]);
  const retry = useCallback(() => {
    setState({kind: 'loading'});
    setAttempt(a => a + 1);
  }, []);
  const refuse = useCallback((request: {url: string}) => allowsNavigation(EMBED_ORIGIN, request.url), []);
  return (
    <View style={{width, height, backgroundColor: color.bg}}>
      {state.kind === 'ready' ? (
        <WebView
          source={{uri: state.url}}
          originWhitelist={[EMBED_ORIGIN]}
          onShouldStartLoadWithRequest={refuse}
          onError={() => setState({kind: 'failed'})}
          onHttpError={() => setState({kind: 'failed'})}
          javaScriptEnabled
          domStorageEnabled
          setSupportMultipleWindows={false}
          incognito
          style={{backgroundColor: color.bg}}
        />
      ) : (
        <View style={styles.center}>
          {state.kind === 'failed' ? <Text tone='textMuted'>3D unavailable</Text> : null}
          {state.kind === 'failed' ? (
            <Pressable
              accessibilityLabel='Try 3D again'
              onPress={retry}
              style={[styles.retry, {borderColor: color.lineStrong, backgroundColor: color.surface}]}>
              <Text variant='dataSmall'>Retry</Text>
            </Pressable>
          ) : null}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  center: {...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center', gap: space.sm},
  retry: {borderWidth: 1, borderRadius: radius.sm, paddingHorizontal: space.md, minHeight: 44, justifyContent: 'center'},
});
