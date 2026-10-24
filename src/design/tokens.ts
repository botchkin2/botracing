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
  // The off-track mark (Race lanes and map, D52): its own token, not `slower`,
  // which means a signed loss.
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
  // A session's classes by pace, fastest first (src/analysis/fieldClasses.ts):
  // always shown with the class label beside them.
  class1: '#e64343',
  class2: '#4697e4',
  class3: '#f68443',
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

/** Fixed lap order: ref, then lap.1..lap.6 (six individual laps without a Ref lap). */
export const lapColors: Record<Scheme, readonly string[]> = {
  dark: [
    '#f2f4f6',
    '#59a0f9',
    '#f476b7',
    '#55cec0',
    '#ece36d',
    '#87d7f7',
    '#f5a15a',
  ],
  light: [
    '#111316',
    '#0267c7',
    '#c32e85',
    '#008479',
    '#ad9907',
    '#3292b3',
    '#c46a12',
  ],
};
/** Hue in degrees of a #rrggbb colour. */
export function hueOf(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  if (d === 0) return 0;
  let h: number;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return (h * 60 + 360) % 360;
}

/** The app's one-meaning colours (best, faster, slower, accent). A lap hue must not read as one of them. */
export const RESERVED_HUE_GAP = 15;
export function reservedHues(scheme: Scheme): number[] {
  const c = colors[scheme];
  return [c.accent, c.best, c.faster, c.slower].map(hueOf);
}
const hueDistance = (a: number, b: number) => {
  const d = Math.abs(a - b) % 360;
  return Math.min(d, 360 - d);
};

/**
 * The colour of one lap by its colour slot (0 = the reference, then in lap
 * order): the palette first, then generated hues past it. Golden-angle steps
 * give each further slot a hue no earlier slot has, so no two laps on screen
 * share a colour (pit-wall #342). A generated hue never lands within
 * RESERVED_HUE_GAP degrees of a reserved one (slower red, faster green, best
 * purple, accent orange, off-track red), so a lap line never reads as one of those.
 */
export function lapColor(scheme: Scheme, index: number): string {
  const palette = lapColors[scheme];
  if (index < palette.length) return palette[index];
  // The k-th allowed golden-angle hue: each slot takes the next hue that is
  // not reserved, so the generated hues stay distinct.
  const reserved = reservedHues(scheme);
  const allowed = (h: number) =>
    reserved.every(r => hueDistance(h, r) >= RESERVED_HUE_GAP);
  const want = index - palette.length;
  let found = -1;
  let hue = 20;
  for (let m = 0; found < want; m++) {
    hue = (20 + m * 137.508) % 360;
    if (allowed(hue)) found++;
  }
  return scheme === 'dark'
    ? `hsl(${hue.toFixed(1)}, 70%, 68%)`
    : `hsl(${hue.toFixed(1)}, 60%, 42%)`;
}

const lapMuted: Record<Scheme, string> = {dark: '#5d646d', light: '#b9bec3'};

/**
 * The one lap-count threshold. Up to this many laps each lap has its own row
 * (Compare's grid, Corner's default set); above it the rows fold into the
 * median. Every ticked lap is drawn at any count, in its own colour.
 */
export const INDIVIDUAL_MAX_LAPS = 6;
export type LapMode = 'individual' | 'several';
export const lapMode = (count: number): LapMode =>
  count <= INDIVIDUAL_MAX_LAPS ? 'individual' : 'several';

export type LapStroke = {
  color: string;
  width: number;
  opacity: number;
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

/** Opacity of the laps not highlighted while one is (tap a lap to pick it out). */
export const DIMMED_OPACITY = 0.25;

/**
 * Stroke for the lap at `index` in the selection (0 = reference, negative =
 * the median basis, neutral). Every ticked lap is drawn in its own colour, at
 * any count; the reference and the highlighted lap are the thicker strokes.
 * While a lap is highlighted (`dimOthers`), the rest fade so that lap stands
 * out; the reference and the median basis stay as they are.
 */
export function lapStroke(
  scheme: Scheme,
  index: number,
  highlighted: boolean,
  dimOthers = false,
): LapStroke {
  if (index < 0)
    return {
      color: lapMuted[scheme],
      width: stroke.selected,
      opacity: 1,
    };
  if (index === 0)
    return {
      color: lapColors[scheme][0],
      width: stroke.ref,
      opacity: 1,
    };
  return {
    color: lapColor(scheme, index),
    width: highlighted ? stroke.ref : stroke.selected,
    opacity: dimOthers && !highlighted ? DIMMED_OPACITY : 1,
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

/** IBM Plex Mono's advance width, in em: the one figure every text-width estimate uses. */
export const MONO_ADVANCE_EM = 0.6;

/**
 * Advance width of one monospace character in a type token: 0.6 em for IBM
 * Plex Mono, plus its letter spacing. Use it to size a column to its text.
 */
export function monoCharWidth(token: {
  fontSize: number;
  letterSpacing?: number;
}): number {
  return token.fontSize * MONO_ADVANCE_EM + (token.letterSpacing ?? 0);
}

export const type = {
  display: {fontFamily: fonts.sansBold, fontSize: 24, lineHeight: 26},
  title: {fontFamily: fonts.sansBold, fontSize: 16, lineHeight: 20},
  body: {fontFamily: fonts.sans, fontSize: 14, lineHeight: 20},
  bodyStrong: {fontFamily: fonts.sansBold, fontSize: 14, lineHeight: 20},
  label: {
    fontFamily: fonts.monoBold,
    fontSize: 10.5,
    letterSpacing: 0.84,
    textTransform: 'uppercase' as const,
  },
  data: {fontFamily: fonts.mono, fontSize: 12, ...tabular},
  dataStrong: {fontFamily: fonts.monoMedium, fontSize: 12, ...tabular},
  // The two numbers a session opens with (phone head): best and median.
  dataHero: {
    fontFamily: fonts.monoMedium,
    fontSize: 24,
    lineHeight: 28,
    ...tabular,
  },
  dataSmall: {fontFamily: fonts.mono, fontSize: 11, ...tabular},
  tableHeader: {
    fontFamily: fonts.monoMedium,
    fontSize: 9.5,
    letterSpacing: 0.475,
    textTransform: 'uppercase' as const,
  },
  axis: {fontFamily: fonts.monoMedium, fontSize: 9.5, ...tabular},
  // Tick and tag text inside a chart's svg (dense axes: Compare, Corner, Laps,
  // Race lanes), a half point under axis.
  tick: {fontFamily: fonts.monoMedium, fontSize: 9, ...tabular},
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
/** A control that is on screen but cannot be used (Button, map zoom, last Compare chip). */
export const disabledOpacity = 0.4;
/** What every tappable looks like while a finger is on it (src/ui/Pressable.tsx). */
export const pressedOpacity = 0.6;
/** A lone × is a real box this big, at least: a mouse needs one too. */
export const closeBox = 24;
// Scatter dots: this session's laps, and earlier sessions' laps beside them.
export const dotOpacity = {current: 0.7, earlier: 0.3} as const;

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
  // The Session screen's spread rows: head column, percent column, bar height.
  spreadHead: 56,
  spreadPct: 44,
  spreadBar: 6,
  // The brake ledger's strip (a dot per lap, a tick at the median): height, dot, tick width.
  brakeStrip: 16,
  brakeDot: 6,
  brakeTick: 2,
  // The Plan's Race timeline (round 6, section 2): lane label column, lane height, gap, axis row.
  timelineLabel: 72,
  timelineLane: 26,
  timelineGap: 8,
  timelineAxis: 18,
  // The Plan screen's columns (round 6 section 2, round 7 3C, D6a): the phone
  // column's cap, the desktop setup column, the results column's cap (the
  // 840 pt card of 3C), the use and lap time rail at the wide breakpoint, and
  // the page's widest.
  planColumn: 640,
  planSetup: 280,
  planResults: 840,
  planRail: 340,
  planPage: 1680,
  // The Plan's pit-stop slider: the track's drawn height, and the handle's width.
  sliderTrack: 14,
  sliderHandle: 4,
  sessionRow: 54,
  chip: 28,
  transport: 40,
  hit: 44,
  // The 3D view's driver inputs (wheel and pedals): the wheel's diameter, a pedal's width, on a desktop and on a phone.
  chaseWheel: 120,
  chaseWheelTight: 60,
  chasePedalW: 16,
  chasePedalWTight: 10,
  // The 3D view's timing tower: its width.
  chaseTower: 200,
  // On a phone the 3D view's top is the map's mode row (a 32 pt control with its 8 pt margins, drawn over the page by the
  // app), then the Near strip, then the canvas: nothing floats over the cars.
  chaseControlsH: 48,
  // The numbers column on a phone's bottom right: its width.
  chaseNumbersTight: 128,
  // Phone bottom bar (round 4 nav frame, item 8): 52 pt, as drawn.
  bottomBar: 52,
  // The same bar on a phone turned on its side, where 375 pt of height is all there is.
  bottomBarLandscape: 36,
  checkbox: 16,
  // The "?" that opens a chart's how-to-read lines (thread 33 #1119).
  helpMark: 20,
  gridCell: 24,
  // The one fixed line under Corner's full-throttle strip (round 5, item 7).
  stripNote: 24,
  // Sheet (Edit charts, Rules): bottom sheet top margin on the phone, side sheet width on desktop.
  sheetTop: 120,
  sheetSideWidth: 380,
  desktopBreakpoint: 900,
  wideBreakpoint: 1280,
  // A window shorter than this and wider than tall is a phone on its side
  // (812x375, 932x430); tablets and desktops start well above it.
  landscapePhoneMaxHeight: 500,
  // ...and narrower than this: the widest phones in landscape are ~960 pt, so a
  // short desktop browser window (1440x480) stays desktop.
  landscapePhoneMaxWidth: 1000,
  maxContent: 1200,
  // Desktop workspace (handoff "Desktop", D1): 44 pt chrome, 280 | centre | 340.
  chromeBar: 44,
  // The open-session box and its × (round 6 frame 1).
  chromeBox: 34,
  chromeClose: 28,
  railWidth: 280,
  // Session's right column: the Pit stops card fits three columns at 400 (round 5, item 8).
  railBadge: 20,
  railBar: 3,
  logo: 18,
  // Desktop Sessions table (apex, thread 44 #1898): fixed column widths, the
  // header row, the badge column and the widest the table grows. Text columns
  // share what is left. Body rows use `lapRow`.
  sessionsTable: {
    date: 128,
    session: 152,
    class: 72,
    result: 232,
    laps: 56,
    time: 92,
    badge: 24,
    head: 36,
    maxWidth: 1500,
  },
  divergeHalf: 84,
  divergeRow: 21,
  // Track page (Track page handoff T1 and 05): map heights, the desktop
  // columns 780 | 300 | 360, corner rows, the trend strip.
  // The Track page's height line (thread 86): its box, the metres axis, the pad.
  elevationProfile: 120,
  elevationAxis: 44,
  elevationPad: 8,
  trackMapPhone: 262,
  trackMapDesk: 600,
  trackColMap: 780,
  trackColCorners: 300,
  trackColHistory: 360,
  cornerRowDesk: 30,
  trendHeight: 70,
  // Pit stops card (round 5 item 3): the pinned key column, a stop column at
  // three or more stops, the bar height, and the row heights the key column
  // and the stop columns share so they line up across the sideways scroll.
  pitKey: 64,
  pitCol: 118,
  pitBar: 6,
  pitHeadRow: 44,
  pitRow: 52,
  pitBarRow: 60,
  pitTyreRow: 118,
  // Compare's traffic lane (round 7, 2C): one row per lap, the empty-state line.
  trafficLaneRow: 14,
  trafficLaneEmpty: 44,
  pitPlanKey: 56,
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

// --- heat strips (pit-wall thread 73, row 1f) ---------------------------------

/**
 * One sequential ramp for a meter on a fixed physical scale: dark slate at the
 * low end to pale cyan at the high end, t in 0..1. A single hue on purpose:
 * red and green already mean slower and faster, and a temperature is neither.
 * The strip's legend prints the numbers each end stands for.
 */
export function heatCell(t: number): string {
  const x = Math.min(1, Math.max(0, t));
  return oklchHex(0.3 + 0.58 * x, 0.025 + 0.09 * x, 230);
}
