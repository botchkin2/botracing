// Chart label probe for a live slot's pane (docs/LAYOUT.md, src/charts/labelBox.ts).
// One expression: paste it into the pane's javascript tool (or keep it in
// window.name and `eval(window.name)` after each navigation).
//
// For every visible svg with text, it returns the svg's page box and each
// label's text with its box relative to the svg, and lists every label whose
// box crosses an svg edge (every chart svg clips at its edges, so those are
// cut on screen), and text views laid over a clipped chart wrapper.
// Tolerance 0.5 px for sub-pixel layout.
(() => {
  const TOL = 0.5;
  const r1 = v => Math.round(v * 10) / 10;
  const svgs = [...document.querySelectorAll('svg')].filter(s => {
    const r = s.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && s.querySelector('text');
  });
  const out = {
    w: innerWidth,
    hscroll: document.documentElement.scrollWidth > innerWidth,
    svgs: [],
    outside: [],
  };
  svgs.forEach((s, i) => {
    const b = s.getBoundingClientRect();
    const labels = [...s.querySelectorAll('text')]
      .filter(t => t.textContent.trim() !== '')
      .map(t => {
        const r = t.getBoundingClientRect();
        const box = {
          l: r1(r.left - b.left),
          t: r1(r.top - b.top),
          r: r1(r.right - b.left),
          b: r1(r.bottom - b.top),
        };
        const off =
          box.l < -TOL ||
          box.t < -TOL ||
          box.r > b.width + TOL ||
          box.b > b.height + TOL;
        return {text: t.textContent, ...box, off};
      });
    out.svgs.push({
      i,
      at: `${r1(b.left)},${r1(b.top)}`,
      size: `${r1(b.width)}x${r1(b.height)}`,
      labels: labels.map(l => l.text).join(' | '),
    });
    labels
      .filter(l => l.off)
      .forEach(l =>
        out.outside.push(
          `svg${i} ${r1(b.width)}x${r1(b.height)} "${l.text}" l${l.l} t${l.t} r${l.r} b${l.b}`,
        ),
      );
  });
  // Text views laid over a chart (a wrapper with overflow hidden around an
  // svg, like Track's trend bars): each leaf's box against the wrapper.
  out.overlays = [];
  [...document.querySelectorAll('svg')].forEach(s => {
    const p = s.parentElement;
    if (!p || !/(hidden|clip)/.test(getComputedStyle(p).overflow)) return;
    const b = p.getBoundingClientRect();
    if (b.width === 0) return;
    [...p.querySelectorAll('div')]
      .filter(e => e.children.length === 0 && e.textContent.trim() !== '')
      .forEach(e => {
        const r = e.getBoundingClientRect();
        const off =
          r.left < b.left - TOL ||
          r.top < b.top - TOL ||
          r.right > b.right + TOL ||
          r.bottom > b.bottom + TOL;
        out.overlays.push(
          `${r1(b.width)}x${r1(b.height)} "${e.textContent}" l${r1(r.left - b.left)} t${r1(r.top - b.top)} r${r1(r.right - b.left)} b${r1(r.bottom - b.top)}${off ? ' OUTSIDE' : ''}`,
        );
      });
  });
  return JSON.stringify(out);
})();
