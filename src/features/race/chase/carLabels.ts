// Class position over the nearest cars: mono, flat, in the app's tokens. One small element per car, positioned in
// screen pixels by the engine each frame; a label is shown only for a car that is drawn and in view.

import {clamp} from '@/src/analysis/chaseMath';
import type {ChaseTheme} from '@/src/features/race/chase/chaseTypes';

const FADE_START = 1.5;
const FADE_M = 100;
const MIN_OPACITY = 0.45;
const BOX_ALPHA = 0.88;

/** A label's box in screen pixels, as the element draws it: 11 px mono, 5 px side padding, a border. */
const CHAR_W = 6.6;
const PAD_W = 12;
const BOX_H = 17;
/** Space kept between two labels that are both shown. */
const GAP_PX = 2;

export interface LabelCandidate {
  key: number;
  /** Where the label's bottom centre sits, screen pixels. */
  x: number;
  y: number;
  text: string;
  /** Metres from the followed car: the nearer one keeps its label when two overlap. */
  distM: number;
}

/**
 * The labels to show when some would sit on top of each other (a grid, a pack): nearest first, a label is dropped when its
 * box overlaps one already kept. Pure and deterministic (ties by key), so a car's label does not flicker between frames.
 */
export function declutterLabels(items: LabelCandidate[]): Set<number> {
  const kept: {l: number; r: number; t: number; b: number}[] = [];
  const shown = new Set<number>();
  for (const c of [...items].sort((a, b) => a.distM - b.distM || a.key - b.key)) {
    const w = c.text.length * CHAR_W + PAD_W;
    const box = {l: c.x - w / 2 - GAP_PX, r: c.x + w / 2 + GAP_PX, t: c.y - BOX_H - GAP_PX, b: c.y + GAP_PX};
    if (kept.some(k => box.l < k.r && box.r > k.l && box.t < k.b && box.b > k.t)) continue;
    kept.push(box);
    shown.add(c.key);
  }
  return shown;
}

export interface CarLabels {
  /** Show car `key`'s label at screen pixel (x, y), or hide it with null. `distM` fades the far ones. */
  place(key: number, text: string, color: string, at: {x: number; y: number} | null, distM: number): void;
  drop(key: number): void;
  keys(): number[];
  dispose(): void;
}

export function createCarLabels(container: HTMLElement, T: ChaseTheme): CarLabels {
  const layer = document.createElement('div');
  layer.style.cssText = 'position:absolute;inset:0;pointer-events:none;overflow:hidden';
  container.appendChild(layer);
  const els = new Map<number, HTMLDivElement>();
  // what each element shows now: a style or text write that changes nothing is still a DOM mutation (and, for the text, a
  // new node) every frame for every labelled car
  const shown = new Map<number, {text: string; color: string; transform: string; opacity: string; on: boolean}>();
  const make = () => {
    const e = document.createElement('div');
    e.style.cssText =
      `position:absolute;left:0;top:0;padding:0 5px;border-radius:2px;background:rgba(13,15,18,${BOX_ALPHA});` +
      `border:1px solid ${T.line};font:500 11px "IBM Plex Mono",Consolas,monospace;color:${T.text};` +
      'white-space:nowrap;display:none;will-change:transform';
    layer.appendChild(e);
    return e;
  };
  return {
    place(key, text, color, at, distM) {
      let e = els.get(key);
      if (!e) {
        e = make();
        els.set(key, e);
      }
      const was = shown.get(key) ?? {text: '', color: '', transform: '', opacity: '', on: false};
      shown.set(key, was);
      if (!at) {
        if (was.on) e.style.display = 'none';
        was.on = false;
        return;
      }
      if (!was.on) e.style.display = 'block';
      was.on = true;
      if (was.text !== text) e.textContent = was.text = text;
      if (was.color !== color) e.style.borderColor = was.color = color;
      const transform = `translate(${at.x.toFixed(0)}px,${at.y.toFixed(0)}px) translate(-50%,-100%)`;
      if (was.transform !== transform) e.style.transform = was.transform = transform;
      const opacity = String(clamp(FADE_START - distM / FADE_M, MIN_OPACITY, 1));
      if (was.opacity !== opacity) e.style.opacity = was.opacity = opacity;
    },
    drop(key) {
      els.get(key)?.remove();
      els.delete(key);
      shown.delete(key);
    },
    keys: () => [...els.keys()],
    dispose() {
      layer.remove();
      els.clear();
      shown.clear();
    },
  };
}
