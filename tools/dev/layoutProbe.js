// Layout probe for a live slot's pane (docs/LAYOUT.md). It is one expression:
// paste it into the pane's javascript tool (or store it in window.name once and
// `eval(window.name)` after each navigation) and read the JSON it returns.
//
// Per page it reports: side scroll of the page, elements past the right edge
// that no horizontal scroller contains, containers clipped by overflow hidden,
// leaf elements below the fold with no vertical scroller above them, every
// vertical scroller's box against its content, chart svg sizes, and at 500 pt
// or less every control under 44 pt (hit slop is not visible to the DOM).
(() => {
  const W = innerWidth;
  const H = innerHeight;
  const vis = e => {
    const r = e.getBoundingClientRect();
    const cs = getComputedStyle(e);
    return (
      r.width > 0 &&
      r.height > 0 &&
      cs.visibility !== 'hidden' &&
      cs.display !== 'none'
    );
  };
  const all = [...document.querySelectorAll('body *')].filter(vis);
  const anc = (e, f) => {
    for (
      let p = e.parentElement;
      p && p !== document.body && p !== document.documentElement;
      p = p.parentElement
    )
      if (f(p, getComputedStyle(p))) return p;
    return null;
  };
  const ox = e =>
    anc(e, (p, c) => /(auto|scroll|hidden|clip)/.test(c.overflowX));
  const sy = e =>
    anc(
      e,
      (p, c) =>
        /(auto|scroll)/.test(c.overflowY) &&
        p.scrollHeight > p.clientHeight + 1,
    );
  const fixedUp = e => {
    for (let p = e; p && p !== document.body; p = p.parentElement)
      if (getComputedStyle(p).position === 'fixed') return true;
    return false;
  };
  const t = e =>
    ((e.getAttribute('aria-label') || e.innerText || e.tagName) + '')
      .replace(/\s+/g, ' ')
      .slice(0, 28);
  const out = {w: W, h: H, hscroll: document.documentElement.scrollWidth > W};
  out.pastRight = all
    .filter(e => e.getBoundingClientRect().right > W + 1 && !ox(e))
    .slice(0, 5)
    .map(e => t(e) + ' r' + Math.round(e.getBoundingClientRect().right));
  out.clipped = all
    .filter(e => {
      const c = getComputedStyle(e);
      return (
        /(hidden|clip)/.test(c.overflowY + c.overflowX) &&
        (e.scrollHeight > e.clientHeight + 3 ||
          e.scrollWidth > e.clientWidth + 3) &&
        e.clientHeight > 20
      );
    })
    .slice(0, 6)
    .map(
      e =>
        t(e) +
        ' ' +
        e.clientWidth +
        'x' +
        e.clientHeight +
        ' in ' +
        e.scrollWidth +
        'x' +
        e.scrollHeight,
    );
  out.belowFoldNoScroll = all.filter(
    e =>
      e.getBoundingClientRect().bottom > H + 1 &&
      !sy(e) &&
      !fixedUp(e) &&
      e.children.length === 0,
  ).length;
  // A scroller whose own bottom is past the window cannot show its last rows:
  // compare bottom with the window's height.
  out.vscrollers = [...document.querySelectorAll('body *')]
    .filter(
      e =>
        /(auto|scroll)/.test(getComputedStyle(e).overflowY) &&
        e.scrollHeight > e.clientHeight + 1,
    )
    .map(e => {
      const r = e.getBoundingClientRect();
      return (
        Math.round(r.x) +
        ',' +
        Math.round(r.y) +
        ' ' +
        e.clientWidth +
        'x' +
        e.clientHeight +
        '/' +
        e.scrollHeight +
        ' bottom ' +
        Math.round(r.bottom)
      );
    })
    .slice(0, 6);
  if (W <= 500)
    out.small = [
      ...document.querySelectorAll(
        'button,a,[role=button],[role=tab],[role=link],[role=checkbox],[role=switch],input',
      ),
    ]
      .filter(vis)
      .map(e => {
        const r = e.getBoundingClientRect();
        return [t(e), Math.round(r.width), Math.round(r.height)];
      })
      .filter(a => Math.min(a[1], a[2]) < 44)
      .slice(0, 12);
  out.svgs = [...document.querySelectorAll('svg')]
    .filter(vis)
    .map(
      e =>
        Math.round(e.getBoundingClientRect().width) +
        'x' +
        Math.round(e.getBoundingClientRect().height),
    )
    .filter(s => parseInt(s) > 150)
    .slice(0, 8);
  return JSON.stringify(out);
})();
