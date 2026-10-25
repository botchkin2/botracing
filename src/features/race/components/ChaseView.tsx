import {useLocalSearchParams} from 'expo-router';
import {useCallback, useContext, useEffect, useRef, useState} from 'react';
import {StyleSheet, View} from 'react-native';
import {WebView, type WebViewMessageEvent} from 'react-native-webview';

import {type ChaseRoad} from '@/src/analysis/chaseRoad';
import {fetchHandoffToken} from '@/src/data/handoff';
import {radius, space, useTheme} from '@/src/design';
import {Pressable, Skeleton, Text} from '@/src/ui';

import {type TowerCar} from '@/src/features/race/chase/towerRows';
import {type ChaseCar, type ChaseGaps, type ChaseInputs, type ChaseSampler} from '@/src/features/race/chase/chaseTypes';

import {type RaceRate} from '../clock';
import {allowsNavigation, EMBED_ORIGIN, embedUrl} from '../embed3d';
import {clockMessage, clockNeedsSending, isReadyMessage, parsePanMessage, type SentClock} from '../embedBridge';
import {PageScrollContext} from '../usePageScroll';

/** The app resends its clock this often, whatever else happens (the page runs its own between messages). */
const RESYNC_MS = 1000;
/** A page that has not drawn a frame by now is not coming: the cover gives way to Retry. A cold first open (sign-in, the field, the road) took up to ~35 s on the emulator, so a phone gets much longer than that. */
const READY_TIMEOUT_MS = 120_000;

/**
 * The 3D chase draws with WebGL, in a page: on the phone it is the web page itself, in a WebView inside the app
 * (the race page with `embed=3d`), signed in as the same person by a one-time custom token (embed3d.ts). The cars and
 * the road are the page's own, so none of the props below are used: the page loads its own data.
 */
export const chaseAvailable = true;
/** The road is fitted by the page in the WebView, not here. */
export const chaseNeedsRoad = false;

type State = {kind: 'loading'} | {kind: 'ready'; url: string} | {kind: 'failed'};

export function ChaseView({width, height, timeS, playing, rate}: {
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
  // The app's clock is the clock: it tells the page, one way, and the page says only that it has drawn (embedBridge.ts).
  const web = useRef<WebView>(null);
  const [ready, setReady] = useState(false);
  const sent = useRef<SentClock | null>(null);
  const latest = useRef({timeS, playing, rate});
  useEffect(() => {
    latest.current = {timeS, playing, rate};
  });
  const post = useCallback(() => {
    const now: SentClock = {...latest.current, rate: latest.current.rate as RaceRate, atMs: Date.now()};
    sent.current = now;
    web.current?.postMessage(clockMessage(now.timeS, now.playing, now.rate));
  }, []);
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
    // The address is made once per opening (and per retry).
  }, [attempt]);
  // the first state when the page says it is drawn, a change the page cannot follow on its own, and once a second
  useEffect(() => {
    if (!ready) return;
    const now: SentClock = {timeS, playing, rate: rate as RaceRate, atMs: Date.now()};
    if (clockNeedsSending(sent.current, now)) post();
  }, [ready, timeS, playing, rate, post]);
  useEffect(() => {
    if (!ready) return;
    post();
    // Paused (or kept hidden), the page holds its moment: nothing drifts, so nothing is sent to wake it.
    if (!playing) return;
    const timer = setInterval(post, RESYNC_MS);
    return () => clearInterval(timer);
  }, [ready, playing, post]);
  useEffect(() => {
    if (state.kind !== 'ready' || ready) return;
    const timer = setTimeout(() => setState({kind: 'failed'}), READY_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [state.kind, ready]);
  // a vertical drag in the 3D is the page's: the web page forwards it and the app scrolls its own page by it
  const scrollPageBy = useContext(PageScrollContext);
  const onMessage = useCallback(
    (event: WebViewMessageEvent) => {
      const data = event.nativeEvent.data;
      if (isReadyMessage(data)) {
        setReady(true);
        return;
      }
      const pan = parsePanMessage(data);
      if (pan) scrollPageBy(pan.dy);
    },
    [scrollPageBy],
  );
  const retry = useCallback(() => {
    setState({kind: 'loading'});
    setReady(false);
    sent.current = null;
    setAttempt(a => a + 1);
  }, []);
  const refuse = useCallback((request: {url: string}) => allowsNavigation(EMBED_ORIGIN, request.url), []);
  return (
    <View style={{width, height, backgroundColor: color.bg}}>
      {state.kind === 'ready' ? (
        <WebView
          ref={web}
          source={{uri: state.url}}
          onMessage={onMessage}
          originWhitelist={[EMBED_ORIGIN]}
          onShouldStartLoadWithRequest={refuse}
          onError={() => setState({kind: 'failed'})}
          onHttpError={() => setState({kind: 'failed'})}
          javaScriptEnabled
         
          domStorageEnabled
          setSupportMultipleWindows={false}
          // Android: the WebView takes every touch whole, so the 3D page tells a camera drag from a page scroll and
          // forwards the latter (embedBridge.ts); the page's ScrollView would take any vertical move, and a diagonal
          // camera drag with it.
          nestedScrollEnabled
          incognito
          style={{backgroundColor: color.bg}}
        />
      ) : null}
      {(state.kind === 'ready' && !ready) || state.kind === 'loading' ? (
        <View pointerEvents='none' style={[StyleSheet.absoluteFill, {backgroundColor: color.bg}]}>
          <Skeleton height={height} />
        </View>
      ) : null}
      {state.kind !== 'ready' ? (
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
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  center: {...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center', gap: space.sm},
  retry: {borderWidth: 1, borderRadius: radius.sm, paddingHorizontal: space.md, minHeight: 44, justifyContent: 'center'},
});
