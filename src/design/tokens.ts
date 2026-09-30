// Design tokens from docs/design_handoff_lap_analysis/README.md.
// oklch values are pre-converted to sRGB hex; oklch() below is only for the
// continuous corner-grid scale.

export type Scheme = 'dark' | 'light';

const dark = {
  bg: '#0d0f12',
  surface: '#101317',
  surfaceRaised: '#15181c',
  surfaceDetail: '#171a1f',
  surfaceOverlay: '#1b1f23',
  line: '#15181c',
  lineStrong: '#2e343a',
  lineHeader: '#21252b',
  grid: '#1d2125',
  text: '#e4e7ea',
  textSecondary: '#aeb4ba',
  textMuted: '#8a929b',
  textFaint: '#5b636b',
  accent: '#fea92f',
  accentInk: '#fea92f',
  accentTint: 'rgba(254,169,47,0.13)',
  best: '#b37bff',
  faster: '#65e287',
  slower: '#ed4a49',
  median: '#3a4148',
  band: 'rgba(230,232,234,0.07)',
  track: '#262b31',
  // Handoff v2 W1: the road inside OSM edges, and the edges (Track mode).
  trackFill: '#1a1d22',
  trackEdge: '#343a42',
  // Outline stretches the driven line does not use (Daytona's oval, infield
  // loops): quieter than the road fill, still visible on the map surface.
  outlineFaded: '#171a1e',
  // Handoff v2 M1b: Follow mode's thin road edges.
  followEdge: '#4d555d',
  // Handoff v2 M1a: section boundary ticks, S labels, corner and PIT labels.
  sectionTick: '#8a929b',
  mapLabel: '#aeb4ba',
  mapCornerLabel: '#5b636b',
  barNeutral: '#5d646d',
  scrim: 'rgba(0,0,0,0.55)',
  // Handoff v2 M5: the uploader's "connected" dot. Its own token, not
  // `faster`, which means a signed gain.
  statusConnected: '#65e287',
  // Round 3 R4c StatusBanner dots and Skeleton fill (tokens/colors.css).
  // idle is the neutral dot: a failed load is never amber or red.
  statusIdle: '#5b636b',
  statusWaiting: '#fea92f',
  gridNeutral: '#1b1f24',
  // Round 3 R1f: other cars only (dots, radar blocks, class bars), never a
  // line or a number. From oklch(0.62 0.20 25), (0.66 0.14 250), (0.73 0.16 48).
  // Round 3 R2: the radar drawn over the race map (rgba(13,15,18,.9)).
  radarInset: 'rgba(13,15,18,0.9)',
  // The radar over a Compare chart on the phone: the plot shows through
  // (Botkin, pit-wall thread 41 #1178: about 40 %).
  radarOverlay: 'rgba(13,15,18,0.4)',
  classHypercar: '#e64343',
  classLmp2: '#4697e4',
  classGt3: '#f68443',
  // Desktop chrome and rail (handoff "Desktop", D1).
  chrome: '#0b0d10',
  tabActive: '#1b1f24',
};

export type ColorTokens = typeof dark;

const light: ColorTokens = {
  ...dark,
  bg: '#f4f5f6',
  surface: '#ffffff',
  surfaceRaised: '#eceef0',
  surfaceDetail: '#eceef0',
  surfaceOverlay: '#ffffff',
  line: '#e3e5e8',
  lineStrong: '#c9cdd1',
  lineHeader: '#c9cdd1',
  grid: '#eceef0',
  text: '#111316',
  textSecondary: '#4a5057',
  textMuted: '#4a5057',
  textFaint: '#737a82',
  accentInk: '#c26f00',
  accentTint: 'rgba(254,169,47,0.18)',
  best: '#7d40c8',
  faster: '#25984d',
  slower: '#b00a1d',
  median: '#c9cdd1',
  band: 'rgba(17,19,22,0.07)',
  track: '#d5d9dd',
  trackFill: '#eef0f2',
  trackEdge: '#b9bec3',
  outlineFaded: '#e3e5e8',
  // Not in the handoff for light; the Track edge is the nearest (feedback log).
  followEdge: '#b9bec3',
  sectionTick: '#737a82',
  mapLabel: '#4a5057',
  mapCornerLabel: '#9aa0a6',
  barNeutral: '#b9bec3',
  chrome: '#eceef0',
  tabActive: '#ffffff',
};

export const colors: Record<Scheme, ColorTokens> = {dark, light};

/** Fixed lap order: ref, then lap.1..lap.5. */
export const lapColors: Record<Scheme, readonly string[]> = {
  dark: ['#f2f4f6', '#59a0f9', '#f476b7', '#55cec0', '#ece36d', '#87d7f7'],
  light: ['#111316', '#0267c7', '#c32e85', '#008479', '#ad9907', '#3292b3'],
};
/** Tinted mode (7–19 laps), hue cycle 255, 350, 185, 105, 225. */
const lapTints: Record<Scheme, readonly string[]> = {
  dark: ['#87a7d0', '#c793ab', '#70b3aa', '#aba874', '#73aec6'],
  light: ['#6e88aa', '#a3788b', '#5b928b', '#8b895e', '#5d8ea2'],
};
const lapMuted: Record<Scheme, string> = {dark: '#5d646d', light: '#b9bec3'};

export type LapMode = 'individual' | 'tinted' | 'grey';
export const lapMode = (count: number): LapMode =>
  count <= 6 ? 'individual' : count < 20 ? 'tinted' : 'grey';

export type LapStroke = {
  color: string;
  width: number;
  opacity: number;
  key: boolean;
};

export const stroke = {
  ref: 2.3,
  selected: 1.5,
  tinted: 1.2,
  grey: 1,
  cursor: 1,
  mark: 1,
} as const;
export const dash = {
  pit: '2 2',
  mark: '3 2',
  overlay2: '5 3',
  overlay3: '1.5 2.5',
} as const;

/**
 * Stroke for the lap at `index` in the selection (0 = reference).
 * In tinted/grey modes only the reference and the highlighted lap are key laps.
 */
export function lapStroke(
  scheme: Scheme,
  index: number,
  count: number,
  highlighted: boolean,
): LapStroke {
  const mode = lapMode(count);
  if (index === 0)
    return {
      color: lapColors[scheme][0],
      width: stroke.ref,
      opacity: 1,
      key: true,
    };
  if (mode === 'individual') {
    return {
      color: lapColors[scheme][index],
      width: highlighted ? stroke.ref : stroke.selected,
      opacity: 1,
      key: true,
    };
  }
  if (highlighted)
    return {
      color: lapColors[scheme][1],
      width: stroke.ref,
      opacity: 1,
      key: true,
    };
  if (mode === 'tinted') {
    const tint = lapTints[scheme][(index - 1) % lapTints[scheme].length];
    return {color: tint, width: stroke.tinted, opacity: 0.55, key: false};
  }
  return {
    color: lapMuted[scheme],
    width: stroke.grey,
    opacity: scheme === 'dark' ? 0.45 : 1,
    key: false,
  };
}

export const fonts = {
  sans: 'IBMPlexSansCondensed_400Regular',
  sansMedium: 'IBMPlexSansCondensed_500Medium',
  sansBold: 'IBMPlexSansCondensed_600SemiBold',
  mono: 'IBMPlexMono_400Regular',
  monoMedium: 'IBMPlexMono_500Medium',
  monoBold: 'IBMPlexMono_600SemiBold',
} as const;

const tabular = {fontVariant: ['tabular-nums' as const]};

export const type = {
  display: {fontFamily: fonts.sansBold, fontSize: 24, lineHeight: 26},
  title: {fontFamily: fonts.sansBold, fontSize: 16, lineHeight: 20},
  body: {fontFamily: fonts.sans, fontSize: 14, lineHeight: 20},
  bodyStrong: {fontFamily: fonts.sansBold, fontSize: 14, lineHeight: 20},
  explainer: {fontFamily: fonts.sans, fontSize: 11.5, lineHeight: 15},
  label: {
    fontFamily: fonts.monoBold,
    fontSize: 10.5,
    letterSpacing: 0.84,
    textTransform: 'uppercase' as const,
  },
  data: {fontFamily: fonts.mono, fontSize: 12, ...tabular},
  dataStrong: {fontFamily: fonts.monoMedium, fontSize: 12, ...tabular},
  dataSmall: {fontFamily: fonts.mono, fontSize: 11, ...tabular},
  tableHeader: {
    fontFamily: fonts.monoMedium,
    fontSize: 9.5,
    letterSpacing: 0.475,
    textTransform: 'uppercase' as const,
  },
  axis: {fontFamily: fonts.monoMedium, fontSize: 9.5, ...tabular},
  // Track page (Track page handoff): the layout name and the fact values.
  pageTitle: {fontFamily: fonts.sansBold, fontSize: 22, lineHeight: 25},
  factValue: {fontFamily: fonts.monoMedium, fontSize: 15, ...tabular},
  // Map attribution, 9 pt (handoff v2 M1).
  attribution: {fontFamily: fonts.sans, fontSize: 9},
} as const;

export const space = {
  xxs: 2,
  xs: 4,
  sm: 6,
  md: 8,
  lg: 12,
  xl: 16,
  xxl: 24,
  xxxl: 32,
} as const;
export const radius = {xs: 2, sm: 3, md: 6, sheet: 10} as const;
/**
 * Real 44 pt boxes for text links and small icons. `hitSlop` alone is not
 * enough: react-native-web ignores it, and the phone build is often the web
 * one (375 pt budget pass, thread 27).
 */
export const hitBox = {
  link: {minHeight: 44, justifyContent: 'center'},
  icon: {
    minHeight: 44,
    minWidth: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
} as const;

export const size = {
  screenWidth: 390,
  gutter: 16,
  contentWidth: 358,
  lapRow: 32,
  sessionRow: 54,
  chip: 28,
  transport: 40,
  hit: 44,
  checkbox: 16,
  // The "?" that opens a chart's how-to-read lines (thread 33 #1119).
  helpMark: 20,
  gridCell: 24,
  desktopBreakpoint: 900,
  wideBreakpoint: 1280,
  maxContent: 1200,
  // Desktop workspace (handoff "Desktop", D1): 48 pt chrome, 280 | centre | 340.
  chromeBar: 48,
  railWidth: 280,
  sidePanelWidth: 340,
  railBadge: 20,
  railBar: 3,
  logo: 18,
  // D1 right column: distribution strip and stint-vs-stint diverging bars.
  distLabel: 62,
  distStrip: 236,
  distRow: 30,
  divergeHalf: 84,
  divergeRow: 21,
  // Track page (Track page handoff T1 and 05): map heights, the desktop
  // columns 780 | 300 | 360, corner rows, the trend strip.
  trackMapPhone: 262,
  trackMapDesk: 600,
  trackColMap: 780,
  trackColCorners: 300,
  trackColHistory: 360,
  cornerRowDesk: 30,
  trendHeight: 70,
} as const;
export const chartHeight = {
  compare: {
    timeDiff: 62,
    speed: 104,
    throttle: 50,
    brake: 50,
    steering: 56,
    gear: 44,
  },
  corner: {speed: 96, brake: 52, throttle: 52},
  oneChart: 330,
  overlayExtra: 14,
} as const;

// --- corner time grid scale -------------------------------------------------

function oklchHex(L: number, C: number, H: number): string {
  const h = (H * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const rgb = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  return (
    '#' +
    rgb
      .map(x => {
        const c = Math.min(1, Math.max(0, x));
        const g = c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
        return Math.round(g * 255)
          .toString(16)
          .padStart(2, '0');
      })
      .join('')
  );
}

/** Opaque cell colors for a corner-time difference vs the reference, in seconds. */
export function cornerCell(d: number): {bg: string; fg: string} {
  const abs = Math.abs(d);
  if (abs < 0.1) return {bg: '#1b1f24', fg: '#9aa1a9'};
  const t = Math.min(1, (abs - 0.1) / 0.2);
  return d > 0
    ? {bg: oklchHex(0.4 + 0.12 * t, 0.1 + 0.1 * t, 25), fg: '#f2f4f6'}
    : {bg: oklchHex(0.62 + 0.2 * t, 0.1 + 0.07 * t, 150), fg: '#0d0f12'};
}
