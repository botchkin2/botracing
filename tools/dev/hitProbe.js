// Hit probe for a live slot's pane (docs/LAYOUT.md, docs/CODE_STANDARDS.md
// section 5): one async expression. For every tappable on the page it samples
// a grid of points inside the control's drawn box and asks the browser which
// tappable receives a tap there (elementFromPoint). A control whose drawn box
// is partly taken by another is a failure: slop and padding must grow toward
// empty space only. Paste it into the pane's javascript tool and read `pass`
// and `stolen`; run it at 375 and 1440 on Compare, Session and Plan.
//
//   stolen: [{control, takenBy, points, of}]   empty when pass is true
//   short:  controls under 44 pt (phone) or 24 pt (desktop) in drawn box AND
//           in what a tap reaches (the slop box counts, a neighbour's does not)
(async () => {
  const TAPPABLE =
    '[role=button],[role=tab],[role=link],[role=checkbox],[role=switch],[role=radio],button,a[href],[data-focusable=true]';
  const label = e =>
    ((e.getAttribute('aria-label') || e.innerText || e.tagName) + '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 32);
  const all = [...document.querySelectorAll(TAPPABLE)];
  const stolen = [];
  const short = [];
  const phone = innerWidth <= 500;
  let controls = 0;
  for (const el of all) {
    const r0 = el.getBoundingClientRect();
    if (r0.width < 2 || r0.height < 2) continue;
    el.scrollIntoView({block: 'center', inline: 'nearest'});
    await new Promise(r => setTimeout(r, 40));
    const r = el.getBoundingClientRect();
    if (
      r.bottom < 0 ||
      r.top > innerHeight ||
      r.right < 0 ||
      r.left > innerWidth
    )
      continue;
    controls++;
    const takers = {};
    let n = 0;
    for (let i = 0; i < 5; i++)
      for (let j = 0; j < 4; j++) {
        const x = r.left + 1 + ((r.width - 2) * (i + 0.5)) / 5;
        const y = r.top + 1 + ((r.height - 2) * (j + 0.5)) / 4;
        if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) continue;
        n++;
        const hit = document.elementFromPoint(x, y);
        const owner = hit && hit.closest(TAPPABLE);
        if (
          owner &&
          owner !== el &&
          !el.contains(owner) &&
          !owner.contains(el)
        ) {
          const k = label(owner);
          takers[k] = (takers[k] || 0) + 1;
        }
      }
    for (const [k, c] of Object.entries(takers))
      stolen.push({control: label(el), takenBy: k, points: c, of: n});
    // What a tap reaches: grow from the centre until another tappable answers.
    const own = (dx, dy) => {
      const hit = document.elementFromPoint(
        r.left + r.width / 2 + dx,
        r.top + r.height / 2 + dy,
      );
      const o = hit && hit.closest(TAPPABLE);
      return !!o && (o === el || el.contains(o));
    };
    let w = 0;
    let h = 0;
    for (let d = 0; d <= 30; d++) {
      if (own(d, 0) && own(-d, 0)) w = d * 2;
      if (own(0, d) && own(0, -d)) h = d * 2;
    }
    const want = phone ? 44 : 24;
    if (
      Math.max(w, Math.round(r.width)) < want ||
      Math.max(h, Math.round(r.height)) < want
    )
      short.push({
        control: label(el),
        box: Math.round(r.width) + 'x' + Math.round(r.height),
        reach: w + 'x' + h,
      });
  }
  return JSON.stringify({
    w: innerWidth,
    url: location.pathname,
    controls,
    pass: stolen.length === 0,
    stolen: stolen.slice(0, 30),
    short: short.slice(0, 30),
  });
})();
