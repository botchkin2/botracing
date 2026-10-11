import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useRef,
} from 'react';
import {
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  ScrollView,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

// One horizontal scroll position for many scrollers. The phone's lap grid and
// lap table are built from rows, each with its own scroller; linked, a swipe on
// any row (or the head) moves every one of them, so the rows read as one table
// (Botkin, 2026-10-11, 2h a).

export type LinkedScroll = {
  /** Called by a scroller on mount; returns what to call on unmount. */
  register: (view: ScrollView) => () => void;
  /** Called by a scroller when the user moved it. */
  moved: (source: ScrollView, x: number) => void;
};

/** One shared offset; keep the instance for as long as the table lives. */
export function useLinkedScroll(): LinkedScroll {
  const views = useRef(new Set<ScrollView>());
  const x = useRef(0);
  return useMemo(
    () => ({
      register: view => {
        views.current.add(view);
        if (x.current !== 0) view.scrollTo({x: x.current, animated: false});
        return () => {
          views.current.delete(view);
        };
      },
      moved: (source, nx) => {
        // The scrollTo calls below report back: ignore an echo of the same offset.
        if (Math.abs(nx - x.current) < 0.5) return;
        x.current = nx;
        for (const v of views.current)
          if (v !== source) v.scrollTo({x: nx, animated: false});
      },
    }),
    [],
  );
}

export const LinkedScrollContext = createContext<LinkedScroll | null>(null);

/** A horizontal scroller that follows, and drives, the others on its link. */
export function LinkedHScroll({
  link,
  style,
  contentContainerStyle,
  children,
}: {
  link: LinkedScroll;
  style?: StyleProp<ViewStyle>;
  contentContainerStyle?: StyleProp<ViewStyle>;
  children: ReactNode;
}) {
  const ref = useRef<ScrollView>(null);
  useEffect(() => {
    const view = ref.current;
    return view ? link.register(view) : undefined;
  }, [link]);
  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (ref.current) link.moved(ref.current, e.nativeEvent.contentOffset.x);
  };
  return (
    <ScrollView
      ref={ref}
      horizontal
      showsHorizontalScrollIndicator={false}
      scrollEventThrottle={16}
      onScroll={onScroll}
      style={style}
      contentContainerStyle={contentContainerStyle}>
      {children}
    </ScrollView>
  );
}

/** The link the surrounding table shares, or null when its rows scroll alone. */
export function useTableLink(): LinkedScroll | null {
  return useContext(LinkedScrollContext);
}
