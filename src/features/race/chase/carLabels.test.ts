/** @jest-environment jsdom */
import {describe, expect, it} from '@jest/globals';

import {createCarLabels} from './carLabels';

const theme = {
  bg: '#000000', fill: '#222222', edge: '#555555', edgeFaint: '#333333', grid: '#111111',
  text: '#ffffff', muted: '#888888', line: '#444444', accent: '#fea92f', good: '#00ff00', bad: '#ff0000',
};

describe('car labels', () => {
  it('writes the DOM only when something changed: 60 frames of the same label are one write each', () => {
    const host = document.createElement('div');
    const labels = createCarLabels(host, theme);
    let mutations = 0;
    new MutationObserver(l => (mutations += l.length)).observe(host, {subtree: true, childList: true, attributes: true, characterData: true});
    labels.place(1, '5', '#ff8800', {x: 100, y: 50}, 20);
    return Promise.resolve().then(() => {
      const first = mutations;
      expect(first).toBeGreaterThan(0);
      for (let f = 0; f < 60; f++) labels.place(1, '5', '#ff8800', {x: 100, y: 50}, 20);
      return Promise.resolve().then(() => {
        expect(mutations).toBe(first);
        labels.place(1, '6', '#ff8800', {x: 100, y: 50}, 20);
        return Promise.resolve().then(() => {
          expect(mutations).toBeGreaterThan(first);
          expect(host.textContent).toBe('6');
        });
      });
    });
  });
  it('hides a label that has no place and shows it again', () => {
    const host = document.createElement('div');
    const labels = createCarLabels(host, theme);
    labels.place(1, '5', '#ff8800', {x: 1, y: 2}, 10);
    const el = host.firstElementChild!.firstElementChild as HTMLElement;
    expect(el.style.display).toBe('block');
    labels.place(1, '5', '#ff8800', null, 10);
    expect(el.style.display).toBe('none');
    labels.place(1, '5', '#ff8800', {x: 1, y: 2}, 10);
    expect(el.style.display).toBe('block');
  });
});
