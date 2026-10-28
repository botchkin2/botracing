// The per-model shape data (ticket 59, pit-wall thread 124): one block per class, one entry per model, each a few numbers
// from pit-wall design/car-shapes/reference-table.md (dimensions with their sources, the one cue it reads by). The
// blocks are separate so two builders never edit the same lines (steward #8123): GT3 is wrench's, Hyper and LMP2 are
// circuit's. An entry's place in its block is its colour (carPaint): models 0-5 take colours 0-5, a seventh repeats
// colour 0, so order the models so two that share a colour differ in body.
//
// STYLISED, NOT TO SCALE: the numbers only exaggerate what the cue says, inside the class footprint's width.

import type {ModelParams} from './modelParams';

export interface ModelEntry {
  /** Names the shape for the kit's cache. */
  key: string;
  /** Matched against the field's lower-cased `vehicle` string, inside the car's own class block only. */
  match: RegExp;
  /** A real `vehicle` string from his results files; the tests build every entry from it. */
  example: string;
  params: ModelParams;
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
      deckH: 0.1,
      tailOver: 0.2,
      wingKind: 'pylons',
      wingH: -0.06,
    },
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
      deckH: 0.06,
      tailOver: -0.2,
      wingKind: 'pylon',
    },
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
      deckH: 0.1,
      tailOver: -0.15,
      wingKind: 'stalks',
    },
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
      deckH: 0.06,
      wingKind: 'stalks',
      bulges: [{x: -1.35, len: 1.3, z: 0.74, w: 0.3, h: 0.2}],
    },
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
      wingH: 0.35,
    },
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
      deckH: 0.16,
      tailOver: -0.25,
      wingKind: 'wide',
      wingH: 0.08,
    },
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
      deckH: -0.1,
      tailOver: 0.1,
      wingKind: 'stalks',
      wingH: 0.22,
    },
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
    },
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
      deckH: 0.14,
      wingKind: 'stalks',
      wingSpan: 1.25,
      wingH: 0.05,
    },
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
      deckH: -0.04,
      wingKind: 'stalks',
    },
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
    // LMH, grade B figures: bulbous high front fenders and a high wing carried on two tall pillars
    key: 'ferrari-499p',
    match: /499p/,
    example: 'Ferrari 499P',
    params: {
      lengthM: 5.1,
      wheelbaseM: 3.15,
      wingKind: 'pylons',
      wingH: 0.2,
      bulges: [{x: 1.3, len: 1.2, z: 0.78, w: 0.34, h: 0.18}],
    },
  },
  {
    // LMH, the 2024 car (one string in his files): the smoothest rounded body, a low wing close to the deck
    key: 'peugeot-9x8',
    match: /9x8/,
    example: 'Peugeot 9x8',
    params: {
      lengthM: 4.995,
      wheelbaseM: 3.045,
      noseH: -0.06,
      cabinTop: 0.05,
      roofDrop: 0.12,
      deckH: -0.04,
      wingKind: 'low',
      wingH: 0.05,
      wingSpan: 1.1,
    },
  },
  {
    // LMH: tall front fender crests around a low central nose, tall and short for a Hyper (1,150 high on 4,900)
    key: 'toyota-gr010',
    match: /tr010|gr010/,
    example: 'Toyota TR010',
    params: {
      lengthM: 4.9,
      wheelbaseM: 3.15,
      noseH: -0.06,
      cabinTop: 0.07,
      bulges: [{x: 1.4, len: 1.0, z: 0.78, w: 0.3, h: 0.26}],
    },
  },
  {
    // LMH: the narrowest canopy between wide vented front fenders (tunnels), a cut-away low tail with the wheels exposed,
    // one tall fin carrying a high wing. No race-car length or wheelbase is published: the class values stand
    key: 'aston-valkyrie',
    match: /valkyrie/,
    example: 'Aston Martin Valkyrie LMH',
    params: {
      cabinW: 0.72,
      cabinLen: 0.9,
      deckH: -0.08,
      tailOver: -0.25,
      finH: 1.5,
      wingKind: 'pylon',
      wingH: 0.2,
      bulges: [{x: 1.2, len: 1.4, z: 0.82, w: 0.36, h: 0.16}],
    },
  },
  {
    // LMDh: an angular, flat-roofed body with a narrow canopy and long nose between broad low scoops; the faceted edges
    // are the cue and need hull stations the class hull does not have (not built here), so this one reads by its
    // proportions. Height is the LMDh cap, 1,060, not Wikipedia's 1,170 (steward #8135)
    key: 'lamborghini-sc63',
    match: /sc63|lamborghini/,
    example: 'Lamborghini SC63',
    params: {
      lengthM: 5.1,
      wheelbaseM: 3.148,
      noseLen: 0.12,
      cabinW: 0.8,
      cabinLen: 0.9,
      roofDrop: 0,
      bulges: [{x: 1.1, len: 1.3, z: 0.72, w: 0.26, h: 0.08}],
    },
  },
  {
    // LMDh: a tall, blunt, upright nose between upright fender crests, the cabin set back; blades on the front and rear fenders
    key: 'cadillac-v-series-r',
    match: /cadillac|v-series/,
    example: 'Cadillac V-Series.R',
    params: {
      lengthM: 4.99,
      wheelbaseM: 3.148,
      noseH: 0.1,
      noseLen: -0.1,
      cabinX: -0.2,
      bulges: [
        {x: 1.3, len: 0.9, z: 0.8, w: 0.22, h: 0.22},
        {x: -1.6, len: 0.9, z: 0.82, w: 0.22, h: 0.2},
      ],
    },
  },
  {
    // LMDh: a wide, tall kidney nose between separate front fender pods; the wing between unusually tall end plates joined
    // to a long dorsal fin
    key: 'bmw-m-hybrid-v8',
    match: /m hybrid/,
    example: 'BMW M Hybrid V8',
    params: {
      lengthM: 4.99,
      wheelbaseM: 3.148,
      noseH: 0.08,
      noseW: 0.12,
      finH: 1.3,
      wingKind: 'wide',
      wingH: 0.12,
      bulges: [{x: 1.3, len: 1.0, z: 0.8, w: 0.3, h: 0.18}],
    },
  },
  {
    // LMDh: a rounded, wide, low front (the 956/962 soft shapes) and the wing held up on tall pylons beside a tall fin
    key: 'porsche-963',
    match: /963/,
    example: 'Porsche 963',
    params: {
      lengthM: 5.1,
      wheelbaseM: 3.148,
      noseW: 0.12,
      noseH: -0.06,
      finH: 1.35,
      wingKind: 'pylons',
      wingH: 0.1,
    },
  },
  {
    // LMDh (Oreca chassis): the broadest flat nose running straight into tall fender crests, the tallest square wing end plates
    key: 'genesis-gmr-001',
    match: /gmr-?001|genesis/,
    example: 'Genesis GMR-001',
    params: {
      lengthM: 5,
      wheelbaseM: 3.15,
      noseW: 0.16,
      noseLen: 0.15,
      finH: 1.4,
      wingKind: 'wide',
      wingH: 0.25,
      wingSpan: 1.1,
      bulges: [{x: 1.2, len: 1.2, z: 0.78, w: 0.3, h: 0.2}],
    },
  },
  {
    // LMDh: tall rounded front fender crests around a small bubble canopy with a roof intake, a long flat fin
    key: 'alpine-a424',
    match: /a424|alpine/,
    example: 'Alpine A424',
    params: {
      lengthM: 5,
      wheelbaseM: 3.148,
      cabinW: 0.85,
      cabinLen: 0.8,
      cabinTop: 0.05,
      finH: 1.5,
      bulges: [{x: 1.3, len: 1.0, z: 0.78, w: 0.3, h: 0.22}],
    },
  },
];

// ---- LMP2 ----
// circuit's block: the Oreca 07.
export const LMP2_MODELS: ModelEntry[] = [];

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
