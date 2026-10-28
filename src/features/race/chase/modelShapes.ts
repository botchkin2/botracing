// The per-model shape data (ticket 59, pit-wall thread 124): one block per class, one entry per model, each a few numbers
// from pit-wall design/car-shapes/reference-table.md (dimensions with their sources, the one cue it reads by). The
// blocks are separate so two builders never edit the same lines (steward #8123): GT3 is wrench's, Hyper and LMP2 are
// circuit's. An entry's place in its block is its colour (carPaint): models 0-5 take colours 0-5, a seventh repeats
// colour 0, so order the models so two that share a colour differ in body.
//
// STYLISED, NOT TO SCALE: the numbers only exaggerate what the cue says, inside the class footprint's width.

import type {TailLight} from './carShapes';
import type {ModelParams} from './modelParams';

export interface ModelEntry {
  /** Names the shape for the kit's cache. */
  key: string;
  /** Matched against the field's lower-cased `vehicle` string, inside the car's own class block only. */
  match: RegExp;
  /** A real `vehicle` string from his results files; the tests build every entry from it. */
  example: string;
  params: ModelParams;
  /** Light lines on the tail face: extra segments of the body edges, never a new draw. */
  tailLights?: TailLight[];
}

// ---- GT3 ----
// Lengths and wheelbases are the table's grade A/B figures; where the table says "not found", the class value stays
// (the field is left out). The class hull is front-engined: the cabin at x -0.1, the nose to 2.33.
export const GT3_MODELS: ModelEntry[] = [
  {
    // rear engine: the cabin far forward, one fastback line over a long heavy tail, the wing on two swan-neck pylons
    key: 'porsche-911',
    match: /911/,
    example: 'Porsche 911 GT3 R LMGT3',
    params: {
      lengthM: 4.62,
      wheelbaseM: 2.5,
      noseLen: -0.35,
      cabinX: 0.85,
      cabinTop: 0.05,
      roofDrop: 0.42,
      deckH: 0.2,
      tailOver: 0.2,
      wingKind: 'pylons',
      wingH: -0.29,
      tailW: -0.16,
      tailTopW: -0.14,
      tailRound: 0.8,
      wingSpan: 0.95,
    },
    // one straight full-width bar, high under the deck lid (scout #8286, real rear photos)
    tailLights: [
      [
        [-0.8, 0.6],
        [0.8, 0.6],
      ],
    ],
  },
  {
    // front engine: the tallest, longest boxy cabin of the GT3s with a flat roof and a short stubby tail, the wing on one
    // central pylon (scout's rear/top cue); the huge upright kidney nose is the second cue
    key: 'bmw-m4',
    match: /\bm4\b/,
    example: 'BMW M4 LMGT3',
    params: {
      lengthM: 4.85,
      wheelbaseM: 2.917,
      noseH: 0.08,
      noseW: 0.1,
      cabinTop: 0.2,
      cabinLen: 1.25,
      cabinX: -0.05,
      roofDrop: 0,
      deckH: 0.03,
      tailOver: -0.2,
      wingKind: 'pylon',
      wingH: -0.02,
      tailW: 0,
      tailTopW: 0,
      wingSpan: 1.05,
    },
    // three thin stacked horizontal strips at each upper corner, wrapping slightly round it; no L (scout #8286)
    tailLights: [
      [
        [-0.84, 0.66],
        [-0.42, 0.66],
      ],
      [
        [0.84, 0.66],
        [0.42, 0.66],
      ],
      [
        [-0.86, 0.6],
        [-0.42, 0.6],
      ],
      [
        [0.86, 0.6],
        [0.42, 0.6],
      ],
      [
        [-0.84, 0.54],
        [-0.42, 0.54],
      ],
      [
        [0.84, 0.54],
        [0.42, 0.54],
      ],
    ],
  },
  {
    // front engine, no race-car dimensions published: a long hood, the cabin set far back under a fastback that ends in a
    // short, high, squared-off tail; a wide flat low nose is the second cue
    key: 'ford-mustang',
    match: /mustang/,
    example: 'Ford Mustang LMGT3',
    params: {
      noseLen: 0.5,
      noseH: -0.06,
      noseW: 0.1,
      cabinX: -0.9,
      roofDrop: 0.34,
      deckH: 0.18,
      tailOver: -0.15,
      wingKind: 'stalks',
      wingH: -0.11,
      tailW: 0.14,
      tailTopW: 0.16,
      wingSpan: 1.05,
    },
    // three vertical bars per side at the upper corners (the Mustang tri-bar; telemetry named it from these alone)
    tailLights: [
      [
        [-0.84, 0.42],
        [-0.84, 0.66],
      ],
      [
        [-0.72, 0.42],
        [-0.72, 0.66],
      ],
      [
        [-0.6, 0.42],
        [-0.6, 0.66],
      ],
      [
        [0.6, 0.42],
        [0.6, 0.66],
      ],
      [
        [0.72, 0.42],
        [0.72, 0.66],
      ],
      [
        [0.84, 0.42],
        [0.84, 0.66],
      ],
    ],
  },
  {
    // mid engine, cab-forward: a short sharp nose, the cabin at the front axle, a long rear deck with big haunches
    key: 'corvette-z06',
    match: /corvette|z06/,
    example: 'Chevrolet Corvette Z06 LMGT3.R',
    params: {
      lengthM: 4.63,
      wheelbaseM: 2.722,
      noseLen: -0.45,
      noseH: -0.07,
      cabinX: 1,
      deckH: 0.03,
      wingKind: 'stalks',
      bulges: [{x: -1.35, len: 1.3, z: 0.74, w: 0.3, h: 0.2}],
      wingH: 0.16,
      tailW: 0.14,
      tailTopW: 0.16,
      wingSpan: 1.15,
    },
    // two stacked angular wedges per side, pointing outward at the upper corners (scout #8286)
    tailLights: [
      [
        [-0.5, 0.66],
        [-0.84, 0.6],
        [-0.5, 0.55],
        [-0.5, 0.66],
      ],
      [
        [0.5, 0.66],
        [0.84, 0.6],
        [0.5, 0.55],
        [0.5, 0.66],
      ],
      [
        [-0.5, 0.5],
        [-0.84, 0.44],
        [-0.5, 0.39],
        [-0.5, 0.5],
      ],
      [
        [0.5, 0.5],
        [0.84, 0.44],
        [0.5, 0.39],
        [0.5, 0.5],
      ],
    ],
  },
  {
    // mid engine: a bubble canopy tapering to the tail behind a short nose, the wing mounted very high
    key: 'mclaren-720s',
    match: /720s|mclaren/,
    example: 'McLaren 720S LMGT3 Evo',
    params: {
      lengthM: 4.66,
      wheelbaseM: 2.67,
      noseLen: -0.3,
      cabinX: 0.7,
      cabinW: 0.8,
      cabinLen: 0.9,
      roofDrop: 0.28,
      wingKind: 'stalks',
      wingH: 0.34,
      deckH: 0.03,
      tailW: -0.16,
      tailTopW: -0.14,
      wingSpan: 0.85,
    },
    // thin blades high at each corner, swept upward toward the outside (scout #8286)
    tailLights: [
      [
        [-0.5, 0.56],
        [-0.84, 0.68],
      ],
      [
        [0.5, 0.56],
        [0.84, 0.68],
      ],
    ],
  },
  {
    // front engine: an upright notchback cabin set back behind a long hood, a flat vertical tall tail under a wing on two
    // thin, wide-spaced stalks (scout's rear/top cue); the big spindle grille on a tall nose is the second cue
    key: 'lexus-rc-f',
    match: /\brc ?f\b|lexus/,
    example: 'Lexus RCF LMGT3',
    params: {
      lengthM: 4.845,
      wheelbaseM: 2.73,
      noseLen: 0.2,
      noseH: 0.1,
      cabinX: -0.55,
      cabinTop: 0.12,
      cabinLen: 0.85,
      roofDrop: 0,
      deckH: 0.18,
      tailOver: -0.25,
      wingKind: 'wide',
      wingH: -0.11,
      tailW: 0,
      tailTopW: 0,
      wingSpan: 1.15,
    },
    // an L at each corner: a vertical outer stroke and a horizontal inner arm (scout #8286)
    tailLights: [
      [
        [-0.82, 0.68],
        [-0.82, 0.44],
        [-0.52, 0.44],
      ],
      [
        [0.82, 0.68],
        [0.82, 0.44],
        [0.52, 0.44],
      ],
    ],
  },
  {
    // mid/rear engine: a short nose, the cabin forward, then a long, low, flat deck ending in a tall wing
    key: 'ferrari-296',
    match: /296/,
    example: 'Ferrari 296 LMGT3 Evo',
    params: {
      wheelbaseM: 2.66,
      noseLen: -0.35,
      cabinX: 0.8,
      deckH: -0.12,
      tailOver: 0.1,
      wingKind: 'stalks',
      wingH: 0.25,
      tailW: 0,
      tailTopW: 0,
      wingSpan: 0.95,
    },
    // a mid-height bar with short up-turned tips (scout #8286)
    tailLights: [
      [
        [-0.84, 0.5],
        [-0.76, 0.38],
        [0.76, 0.38],
        [0.84, 0.5],
      ],
    ],
  },
  {
    // front-mid engine: the longest hood on the grid, the cabin furthest back and low
    key: 'mercedes-amg',
    match: /mercedes|amg/,
    example: 'Mercedes-AMG LMGT3',
    params: {
      lengthM: 4.746,
      noseLen: 0.6,
      cabinX: -1,
      cabinTop: -0.05,
      wingKind: 'stalks',
      deckH: 0.03,
      wingH: -0.19,
      tailW: 0,
      tailTopW: 0,
      wingSpan: 0.85,
    },
    // thin, narrow horizontal slivers low at the outer corners (scout #8286)
    tailLights: [
      [
        [-0.84, 0.3],
        [-0.6, 0.3],
      ],
      [
        [0.84, 0.3],
        [0.6, 0.3],
      ],
    ],
  },
  {
    // front-mid engine: a very wide flat-topped tail carrying the widest wing on the grid, the cabin set back
    key: 'aston-vantage',
    match: /vantage|aston/,
    example: 'Aston Martin Vantage AMR LMGT3',
    params: {
      lengthM: 4.616,
      wheelbaseM: 2.705,
      noseW: 0.08,
      cabinX: -0.65,
      deckH: 0.03,
      wingKind: 'stalks',
      wingSpan: 1.25,
      wingH: -0.02,
      tailW: 0,
      tailTopW: 0,
      endPlate: {h: 0.2, sweep: 0.12},
    },
    // one full-width blade that drops at both ends (scout #8286)
    tailLights: [
      [
        [-0.82, 0.46],
        [-0.7, 0.54],
        [0, 0.58],
        [0.7, 0.54],
        [0.82, 0.46],
      ],
    ],
  },
  {
    // mid engine: a low wedge, the lowest nose and roof of the GT3s
    key: 'lamborghini-huracan',
    match: /hurac|lamborghini/,
    example: 'Lamborghini Huracan LMGT3 Evo2',
    params: {
      lengthM: 4.551,
      wheelbaseM: 2.648,
      noseLen: -0.1,
      noseH: -0.12,
      noseW: 0.1,
      cabinX: 0.6,
      cabinTop: -0.14,
      deckH: -0.12,
      wingKind: 'stalks',
      wingH: -0.1,
      tailW: -0.16,
      tailTopW: -0.14,
      wingSpan: 0.85,
    },
    // a Y at each corner: a horizontal line that forks at its inner end (scout #8286)
    tailLights: [
      [
        [-0.84, 0.5],
        [-0.55, 0.5],
      ],
      [
        [0.84, 0.5],
        [0.55, 0.5],
      ],
      [
        [-0.55, 0.5],
        [-0.42, 0.58],
      ],
      [
        [0.55, 0.5],
        [0.42, 0.58],
      ],
      [
        [-0.55, 0.5],
        [-0.42, 0.42],
      ],
      [
        [0.55, 0.5],
        [0.42, 0.42],
      ],
    ],
  },
];

// ---- Hyper ----
// The Hyper rows of the reference table (circuit's block). The class hull is 5.0 m long on a 3.05 m wheelbase, the cabin
// forward, a tall fin and a wing on stalks. Every LMDh car runs the 3,148 mm wheelbase, the LMH cars their own where one is
// published. Where the table says "not found" the class value stays. Isotta, Glickenhaus and Vanwall keep the class hull.
//
// ORDER IS COLOUR: an entry's place here is its colour (index % 6), and the order keeps every model the colour it had as a
// family member (LMH cars 0-3, then SC63, then the LMDh cars from 5), so a car does not change colour with this change.
// Cars that share a colour (499P/BMW, 9X8/963, TR010/Genesis, Valkyrie/Alpine) differ in body.
export const HYPER_MODELS: ModelEntry[] = [
  {
    // LMH, grade B figures: huge bulbous front fenders and a very high wing on two tall pillars
    key: 'ferrari-499p',
    match: /499p/,
    example: 'Ferrari 499P',
    params: {
      endPlate: {h: 0.35, sweep: 0},
      tailW: 0.04,
      tailTopW: 0.08,
      lengthM: 5.1,
      wheelbaseM: 3.15,
      noseH: -0.08,
      wingKind: 'wide',
      wingH: 0.3,
      wingSpan: 1.1,
      bulges: [{x: 1.25, len: 1.7, z: 0.74, w: 0.42, h: 0.34}],
    },
    // a bar with a V dipping into the centre
    tailLights: [
      [
        [-0.8, 0.5],
        [-0.12, 0.5],
        [0, 0.28],
        [0.12, 0.5],
        [0.8, 0.5],
      ],
    ],
  },
  {
    // LMH, the 2024 car (one string in his files): the smoothest rounded teardrop, the tallest roof and a low wide wing
    // lying on the deck
    key: 'peugeot-9x8',
    match: /9x8/,
    example: 'Peugeot 9x8',
    params: {
      tailRound: 1,
      tailW: -0.12,
      tailTopW: -0.2,
      lengthM: 4.995,
      wheelbaseM: 3.045,
      noseH: -0.12,
      cabinTop: 0.2,
      cabinLen: 1.15,
      roofDrop: 0.3,
      deckH: -0.06,
      wingKind: 'low',
      wingH: 0.05,
      wingSpan: 1.25,
      finH: 0.6,
    },
    // three diagonal slashes across the tail (the claws)
    tailLights: [
      [
        [-0.6, 0.2],
        [-0.34, 0.5],
      ],
      [
        [-0.13, 0.2],
        [0.13, 0.5],
      ],
      [
        [0.34, 0.2],
        [0.6, 0.5],
      ],
    ],
  },
  {
    // LMH: tall front fender crests either side of a low central nose, tall and short for a Hyper (1,150 high on 4,900)
    key: 'toyota-gr010',
    match: /tr010|gr010/,
    example: 'Toyota TR010',
    params: {
      fenderW: 0.12,
      wingKind: 'pylon',
      wingH: 0.3,
      tailTopW: -0.1,
      lengthM: 4.9,
      wheelbaseM: 3.15,
      noseH: -0.14,
      cabinTop: 0.12,
      bulges: [{x: 1.45, len: 1.2, z: 0.76, w: 0.36, h: 0.46}],
    },
    // a thin bar with a break in the centre, an upright tick at each end
    tailLights: [
      [
        [-0.8, 0.5],
        [-0.8, 0.38],
        [-0.1, 0.38],
      ],
      [
        [0.8, 0.5],
        [0.8, 0.38],
        [0.1, 0.38],
      ],
    ],
  },
  {
    // LMH: the narrowest canopy between wide vented front fenders (tunnels), a cut-away low tail with the wheels exposed,
    // one tall fin carrying a high wing. No race-car length or wheelbase is published: the class values stand
    key: 'aston-valkyrie',
    match: /valkyrie/,
    example: 'Aston Martin Valkyrie LMH',
    params: {
      tailCut: 1,
      tailW: -0.2,
      tailTopW: -0.25,
      cabinW: 0.6,
      cabinLen: 0.75,
      cabinTop: -0.04,
      deckH: -0.14,
      tailOver: -0.4,
      finH: 2,
      wingKind: 'pylon',
      wingH: 0.4,
      bulges: [{x: 1.15, len: 1.6, z: 0.84, w: 0.44, h: 0.3}],
    },
    // one high central light
    tailLights: [
      [
        [-0.2, 0.5],
        [0.2, 0.5],
      ],
    ],
  },
  {
    // LMDh: an angular, flat-roofed body with a narrow canopy and a long pointed nose between broad low scoops; the faceted
    // edges are the cue and need hull stations the class hull does not have (not built here), so this one reads by its
    // proportions. Height is the LMDh cap, 1,060, not Wikipedia's 1,170 (steward #8135)
    key: 'lamborghini-sc63',
    match: /sc63|lamborghini/,
    example: 'Lamborghini SC63',
    params: {
      tailW: 0.05,
      tailTopW: -0.3,
      lengthM: 5.1,
      wheelbaseM: 3.148,
      noseLen: 0.3,
      noseH: -0.1,
      cabinW: 0.68,
      cabinLen: 0.85,
      cabinTop: -0.1,
      roofDrop: 0,
      finH: 0.5,
      bulges: [{x: 1.0, len: 1.5, z: 0.7, w: 0.3, h: 0.1}],
    },
    // a Y at each rear corner
    tailLights: [
      [
        [-0.72, 0.52],
        [-0.58, 0.36],
        [-0.44, 0.52],
      ],
      [
        [-0.58, 0.36],
        [-0.58, 0.2],
      ],
      [
        [0.72, 0.52],
        [0.58, 0.36],
        [0.44, 0.52],
      ],
      [
        [0.58, 0.36],
        [0.58, 0.2],
      ],
    ],
  },
  {
    // LMDh: a tall, blunt, upright nose between upright fender crests, the cabin set far back; blades on the front and rear
    // fenders
    key: 'cadillac-v-series-r',
    match: /cadillac|v-series/,
    example: 'Cadillac V-Series.R',
    params: {
      tailW: 0.06,
      tailTopW: 0.12,
      lengthM: 4.99,
      wheelbaseM: 3.148,
      noseH: 0.2,
      noseLen: -0.3,
      cabinX: -0.45,
      bulges: [
        {x: 1.3, len: 1, z: 0.8, w: 0.2, h: 0.34},
        {x: -1.5, len: 1.1, z: 0.82, w: 0.2, h: 0.32},
      ],
    },
    // vertical blades down the rear corners of the tail
    tailLights: [
      [
        [-0.78, 0.18],
        [-0.78, 0.52],
      ],
      [
        [0.78, 0.18],
        [0.78, 0.52],
      ],
    ],
  },
  {
    // LMDh: a wide, tall kidney nose between separate front fender pods; the wing between very tall end plates joined to a
    // long dorsal fin
    key: 'bmw-m-hybrid-v8',
    match: /m hybrid/,
    example: 'BMW M Hybrid V8',
    params: {
      tailW: -0.1,
      tailTopW: -0.12,
      lengthM: 4.99,
      wheelbaseM: 3.148,
      noseH: 0.14,
      noseW: 0.2,
      noseLen: -0.1,
      finH: 1.7,
      wingKind: 'pylons',
      wingH: 0.45,
      wingSpan: 1.05,
      bulges: [{x: 1.3, len: 1.1, z: 0.82, w: 0.3, h: 0.2}],
    },
    // slim L-shapes at the rear corners
    tailLights: [
      [
        [-0.5, 0.3],
        [-0.72, 0.3],
        [-0.72, 0.52],
      ],
      [
        [0.5, 0.3],
        [0.72, 0.3],
        [0.72, 0.52],
      ],
    ],
  },
  {
    // LMDh: a rounded, wide, low front (the 956/962 soft shapes) and the wing held up on tall pylons beside a tall fin
    key: 'porsche-963',
    match: /963/,
    example: 'Porsche 963',
    params: {
      tailRound: 0.6,
      lengthM: 5.1,
      wheelbaseM: 3.148,
      noseW: 0.2,
      noseH: -0.1,
      noseLen: 0.1,
      cabinTop: 0.04,
      finH: 1.7,
      wingKind: 'pylons',
      wingH: 0.25,
    },
    // the full-width light bar across the tail
    tailLights: [
      [
        [-0.82, 0.44],
        [0.82, 0.44],
      ],
    ],
  },
  {
    // LMDh (Oreca chassis): the broadest flat nose running straight into tall fender crests, the tallest square wing end
    // plates
    key: 'genesis-gmr-001',
    match: /gmr-?001|genesis/,
    example: 'Genesis GMR-001',
    params: {
      endPlate: {h: 0.4, sweep: 0},
      lengthM: 5,
      wheelbaseM: 3.15,
      noseW: 0.2,
      noseLen: 0.3,
      noseH: -0.04,
      finH: 1.6,
      wingKind: 'wide',
      wingH: 0.25,
      wingSpan: 1.2,
      bulges: [{x: 1.15, len: 1.4, z: 0.76, w: 0.32, h: 0.36}],
    },
    // two horizontal lines stacked well apart across the tail (the "two-line" lights)
    tailLights: [
      [
        [-0.8, 0.56],
        [0.8, 0.56],
      ],
      [
        [-0.8, 0.3],
        [0.8, 0.3],
      ],
    ],
  },
  {
    // LMDh: tall rounded front fender crests around a small bubble canopy with a roof intake, a long flat fin
    key: 'alpine-a424',
    match: /a424|alpine/,
    example: 'Alpine A424',
    params: {
      endPlate: {h: 0.2, sweep: 0.15},
      lengthM: 5,
      wheelbaseM: 3.148,
      cabinW: 0.78,
      cabinLen: 0.65,
      cabinTop: 0.2,
      cabinX: 0.1,
      finH: 1.9,
      bulges: [{x: 1.3, len: 1.2, z: 0.76, w: 0.34, h: 0.36}],
    },
    // an "A" chevron across the tail, doubled so it reads as a band
    tailLights: [
      [
        [-0.62, 0.3],
        [0, 0.52],
        [0.62, 0.3],
      ],
      [
        [-0.62, 0.22],
        [0, 0.44],
        [0.62, 0.22],
      ],
      // a short bar under the fin
      [
        [-0.12, 0.58],
        [0.12, 0.58],
      ],
    ],
  },
];

// ---- LMP2 ----
// The Oreca 07 (circuit's block): the one LMP2 chassis in his files, in LMP2 and LMP2_ELMS. The four LMP3 chassis (ADESS,
// Ginetta, Ligier, Duqueine) have no row and keep the class hull.
export const LMP2_MODELS: ModelEntry[] = [
  {
    // detached, rounded front fenders each ending in a lamp pod (the LMP2 face), the class fin, the wing on its stalks;
    // grade B figures (team and encyclopedia sites, no Oreca sheet)
    key: 'oreca-07',
    match: /oreca/,
    example: 'Oreca 07',
    params: {
      lengthM: 4.745,
      wheelbaseM: 3.005,
      wingKind: 'stalks',
      wingH: 0.08,
      bulges: [{x: 1.25, len: 1, z: 0.74, w: 0.3, h: 0.2}],
    },
  },
];

export const MODELS: Record<string, ModelEntry[]> = {
  GT3: GT3_MODELS,
  Hyper: HYPER_MODELS,
  LMP2: LMP2_MODELS,
};

/** The model entry of a field's `vehicle` string in a shape class, with its place in the block (its colour); null when none matches. */
export function modelOf(
  vehicle: string | null,
  shapeClass: string,
): {entry: ModelEntry; index: number} | null {
  const v = (vehicle ?? '').toLowerCase().trim();
  if (!v) return null;
  const block = MODELS[shapeClass] ?? [];
  const index = block.findIndex(m => m.match.test(v));
  return index >= 0 ? {entry: block[index], index} : null;
}
