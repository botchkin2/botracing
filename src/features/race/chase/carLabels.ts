// Class position over the nearest cars: mono, flat, in the app's tokens. One small element per car, positioned in
// screen pixels by the engine each frame; a label is shown only for a car that is drawn and in view.

import {clamp} from '../../../analysis/chaseMath';
import type {ChaseTheme} from './chaseTypes';

const FADE_START = 1.5;
const FADE_M = 100;
const MIN_OPACITY = 0.45;
const BOX_ALPHA = 0.88;

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
      if (!at) {
        e.style.display = 'none';
        return;
      }
      e.style.display = 'block';
      e.textContent = text;
      e.style.borderColor = color;
      e.style.transform = `translate(${at.x.toFixed(0)}px,${at.y.toFixed(0)}px) translate(-50%,-100%)`;
      e.style.opacity = String(clamp(FADE_START - distM / FADE_M, MIN_OPACITY, 1));
    },
    drop(key) {
      els.get(key)?.remove();
      els.delete(key);
    },
    keys: () => [...els.keys()],
    dispose() {
      layer.remove();
      els.clear();
    },
  };
}
