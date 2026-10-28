/** @jest-environment jsdom */
import {describe, expect, it} from '@jest/globals';

import {createCarLabels, declutterLabels, type LabelCandidate} from './carLabels';

const theme = {
  bg: '#000000', fill: '#222222', edge: '#555555', edgeFaint: '#333333', grid: '#111111',
  text: '#ffffff', muted: '#888888', line: '#444444', accent: '#fea92f', good: '#00ff00', bad: '#ff0000', classes: [],
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

describe('label declutter', () => {
  const c = (key: number, x: number, y: number, distM: number, text = '8'): LabelCandidate => ({key, x, y, text, distM});
  it('keeps every label that has room', () => {
    const shown = declutterLabels([c(1, 100, 100, 10), c(2, 200, 100, 20), c(3, 100, 160, 30)]);
    expect([...shown].sort()).toEqual([1, 2, 3]);
  });
  it('when two sit on top of each other the nearer car keeps its number', () => {
    const shown = declutterLabels([c(8, 300, 200, 40), c(10, 305, 204, 25)]);
    expect([...shown]).toEqual([10]);
  });
  it('a pack: only as many labels as fit, nearest first, and the same cars every frame', () => {
    const pack = [1, 2, 3, 4, 5, 6].map(i => c(i, 300 + i * 3, 200 - i * 2, i * 10));
    const a = [...declutterLabels(pack)];
    const b = [...declutterLabels([...pack].reverse())];
    expect(a).toEqual(b);
    expect(a[0]).toBe(1);
    expect(a.length).toBeLessThan(pack.length);
  });
  it('a label that only touches a kept one by its gap is dropped, one a little further away is kept', () => {
    // a one-character label is 6.6 + 12 = 18.6 px wide, 17 px tall
    expect([...declutterLabels([c(1, 100, 100, 1), c(2, 118, 100, 2)])]).toEqual([1]); // 18 px apart: inside the box and its gap
    expect([...declutterLabels([c(1, 100, 100, 1), c(2, 125, 100, 2)])].sort()).toEqual([1, 2]); // 25 px apart: clear
  });
  it('equal distances break by key, so nothing flickers', () => {
    expect([...declutterLabels([c(7, 50, 50, 10), c(3, 50, 50, 10)])]).toEqual([3]);
    expect([...declutterLabels([c(3, 50, 50, 10), c(7, 50, 50, 10)])]).toEqual([3]);
  });
  it('no labels is no labels', () => {
    expect(declutterLabels([]).size).toBe(0);
  });
});