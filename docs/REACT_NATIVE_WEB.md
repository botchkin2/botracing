# React Native Web

The phone build is often the web one, so web differences are product bugs, not edge cases.

- **Taps:** react-native-web ignores `hitSlop`. Every tappable is `Pressable` from `@/src/ui` (ESLint refuses react-native's): it adds the slop on web, clamped so it never covers another tappable's drawn box, and a pressed look. A control in a scroller, or between tight rows, needs a real 44 pt box (`docs/CODE_STANDARDS.md` section 5).
- **Chart text:** inside the svg through `ChartLabel` (`src/charts/README.md`); ESLint refuses react-native-svg `Text`, `TSpan` and `TextPath` elsewhere.
- **Shadows:** `shadow*` style props do not draw on web; use `boxShadow` where a shadow matters.
- **Widths:** `useLayout()` reads `useWindowDimensions`, which follows the window's `resize`. The browser pane fires none after a size change: reload before measuring (`docs/TESTING.md`).
- **Platform code:** `Platform.OS === 'web'` inside the shared component, not a forked file per platform.
