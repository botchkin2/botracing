// The phone Race page's ScrollView, steerable from the 3D inside its WebView (embedBridge.ts: the page forwards a
// vertical drag as a pan message; the app scrolls without animation, once a frame). Owner: RaceScreen's phone column.
// Reader: ChaseView on Android, which holds the 3D's WebView. Anywhere else the context does nothing.

import {createContext, useCallback, useRef, useState} from 'react';
import type {LayoutChangeEvent, NativeScrollEvent, NativeSyntheticEvent, ScrollView} from 'react-native';

import {createPageScroll} from './pageScroll';

/** Scrolls the page by a finger's vertical travel in px (down is positive). */
export const PageScrollContext = createContext<(fingerDy: number) => void>(() => {});

export function usePageScrollOwner() {
  const ref = useRef<ScrollView>(null);
  const [page] = useState(createPageScroll);
  const content = useRef(0);
  const view = useRef(0);
  const scrollBy = useCallback(
    (fingerDy: number) => {
      ref.current?.scrollTo({y: page.pan(fingerDy, Date.now()), animated: false});
    },
    [page],
  );
  return {
    scrollBy,
    scrollProps: {
      ref,
      scrollEventThrottle: 16,
      onScroll: (e: NativeSyntheticEvent<NativeScrollEvent>) => page.reported(e.nativeEvent.contentOffset.y, Date.now()),
      onContentSizeChange: (_w: number, h: number) => {
        content.current = h;
        page.size(h, view.current);
      },
      onLayout: (e: LayoutChangeEvent) => {
        view.current = e.nativeEvent.layout.height;
        page.size(content.current, view.current);
      },
    },
  };
}
