// The page side of the Android app's WebView 3D (embedBridge.ts): the app's race clock arrives as validated messages and
// is applied to this page's clock; the page answers once, when its first frame is drawn. Only inside the WebView
// (`embed=3d` and `window.ReactNativeWebView`); in any other browser this does nothing.

import {useEffect} from 'react';

import {parseClockMessage, READY_MESSAGE} from './embedBridge';
import {type RaceTimer} from './useRaceClock';

type NativeBridge = {postMessage: (message: string) => void};
const bridge = (): NativeBridge | null => {
  if (typeof window === 'undefined') return null;
  const b = (window as unknown as {ReactNativeWebView?: NativeBridge}).ReactNativeWebView;
  return b && typeof b.postMessage === 'function' ? b : null;
};

/** True inside the app's WebView. */
export const inAppWebView = (): boolean => bridge() !== null;

/** Tell the app the 3D's first frame is drawn (the only message the page sends). */
export function postReady(): void {
  bridge()?.postMessage(READY_MESSAGE);
}

export function useEmbedClock(clock: RaceTimer, endS: number, enabled: boolean): void {
  const {setTimeS, setPlaying, setRate} = clock;
  useEffect(() => {
    if (!enabled || typeof window === 'undefined' || !inAppWebView()) return;
    const onMessage = (event: Event) => {
      const msg = parseClockMessage((event as MessageEvent).data, endS);
      if (!msg) return;
      setTimeS(msg.timeS);
      setPlaying(msg.playing);
      setRate(msg.rate);
    };
    // Android delivers the app's messages to the document, iOS to the window.
    window.addEventListener('message', onMessage);
    document.addEventListener('message', onMessage);
    return () => {
      window.removeEventListener('message', onMessage);
      document.removeEventListener('message', onMessage);
    };
  }, [enabled, endS, setTimeS, setPlaying, setRate]);
}
