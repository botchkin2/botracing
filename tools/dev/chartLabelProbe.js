// Chart label probe for a live slot's pane (docs/LAYOUT.md, src/charts/README.md).
// One expression: paste it into the pane's javascript tool (or keep it in
// window.name and `eval(window.name)` after each navigation).
//
// Per visible svg with text: its labels, any label whose box crosses the svg's
// edge (`outside`, every chart svg clips there), and `gridline`: each label that
// marks a line (a y tick) with its box centre's offset from that line in px (0
// = on it). Also text views laid over a clipped chart wrapper.
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
    // On its gridline: a label that marks a line (ChartLabel lineY, written as
    // data-line-y) against that line: its box centre's offset from it.
    const grid = [...s.querySelectorAll('text[data-line-y]')].map(t => {
      const r = t.getBoundingClientRect();
      const cy = (r.top + r.bottom) / 2 - b.top;
      return t.textContent + ' ' + r1(cy - Number(t.getAttribute('data-line-y')));
    });
    out.svgs.push({
      i,
      size: r1(b.width) + 'x' + r1(b.height),
      labels: labels.map(l => l.text).join(' | '),
      gridline: grid.join(' | '),
    });
    labels
      .filter(l => l.off)
      .forEach(l =>
        out.outside.push(
          'svg' + i + ' "' + l.text + '" l' + l.l + ' t' + l.t + ' r' + l.r + ' b' + l.b,
        ),
      );
  });
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
        if (off) out.overlays.push('"' + e.textContent + '" OUTSIDE');
      });
  });
  return JSON.stringify(out);
})();
