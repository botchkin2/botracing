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
//
// One scroller drives at a time. The ones it moves report their own, lagging
// offsets back, and on a fling those reports would pull it back (a rubber
// band): while a scroller drives, the others' reports are ignored. It drives
// from the first touch of a drag until its momentum ends, or, where the
// platform sends no such events (a wheel or a trackpad on web), until it has
// been quiet for DRIVE_QUIET_MS.

/** Without a begin/end event: how long a driver is quiet before another may drive. */
export const DRIVE_QUIET_MS = 150;

export type LinkedScroll = {
  /** Called by a scroller on mount; returns what to call on unmount. */
  register: (view: ScrollView) => () => void;
  /** A finger went down on this scroller: it drives from now on. */
  begin: (source: ScrollView) => void;
  /** This scroller's momentum ended: nobody drives. */
  end: (source: ScrollView) => void;
  /** Called by a scroller when it reports an offset. */
  moved: (source: ScrollView, x: number) => void;
};

/** One shared offset; keep the instance for as long as the table lives. */
export function useLinkedScroll(): LinkedScroll {
  const views = useRef(new Set<ScrollView>());
  const x = useRef(0);
  const driver = useRef<ScrollView | null>(null);
  const quiet = useRef<ReturnType<typeof setTimeout> | null>(null);
  return useMemo(() => {
    const release = () => {
      if (quiet.current) clearTimeout(quiet.current);
      quiet.current = null;
      driver.current = null;
    };
    const hold = (source: ScrollView) => {
      driver.current = source;
      if (quiet.current) clearTimeout(quiet.current);
      quiet.current = setTimeout(release, DRIVE_QUIET_MS);
    };
    return {
      register: view => {
        views.current.add(view);
        if (x.current !== 0) view.scrollTo({x: x.current, animated: false});
        return () => {
          views.current.delete(view);
          if (driver.current === view) release();
        };
      },
      begin: source => {
        driver.current = source;
        // A drag that never moves must not hold the drive for ever.
        hold(source);
      },
      end: source => {
        if (driver.current === source) release();
      },
      moved: (source, nx) => {
        if (driver.current && driver.current !== source) return;
        hold(source);
        // The scrollTo calls below report back: ignore an echo of the same offset.
        if (Math.abs(nx - x.current) < 0.5) return;
        x.current = nx;
        for (const v of views.current)
          if (v !== source) v.scrollTo({x: nx, animated: false});
      },
    };
  }, []);
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
      onScrollBeginDrag={() => ref.current && link.begin(ref.current)}
      onMomentumScrollEnd={() => ref.current && link.end(ref.current)}
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
