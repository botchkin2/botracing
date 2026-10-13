// Simulation v2 generator (kingpin #4889). One driver = one stint; laps carry section times and truth labels.
export function rng(seed) {
  let s = seed >>> 0;
  const r = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
  r.gauss = () =>
    Math.sqrt(-2 * Math.log(r() + 1e-12)) * Math.cos(2 * Math.PI * r());
  r.expo = m => -m * Math.log(r() + 1e-12);
  return r;
}
export function makeDriver(r, {level, sections, base, laps}) {
  // section bases: random weights summing to base
  const w = Array.from({length: sections}, () => 0.5 + r());
  const wsum = w.reduce((a, b) => a + b, 0);
  const b = w.map(x => (base * x) / wsum);
  // fade: fuel burn-off (faster), then a tyre knee at a random lap, sometimes a cliff
  const fuel = 0.06 + 0.06 * r(),
    knee = Math.floor(laps * (0.4 + 0.5 * r())),
    cliff = r() < 0.25,
    slope = 0.1 + 0.2 * r(),
    jump = 1.5 + 2.5 * r();
  const fade = i =>
    -fuel * i + (i >= knee ? (cliff ? jump : slope * (i - knee)) : 0);
  // AR(1) rhythm shared across sections
  const rho = 0.3 + 0.4 * r();
  let rh = 0;
  const rhythmSd = 2 * level;
  // pace changes: runs of 3-6 laps at +1..3 % on every section (truth: keep)
  const pc = new Array(laps).fill(0);
  for (let i = 3; i < laps - 6; i++)
    if (r() < 0.03 && pc[i - 1] === 0) {
      const len = 3 + Math.floor(4 * r()),
        add = 0.01 + 0.02 * r();
      for (let k = 0; k < len; k++) pc[i + k] = add;
      i += len;
    }
  const out = [];
  for (let i = 0; i < laps; i++) {
    rh = rho * rh + Math.sqrt(1 - rho * rho) * r.gauss() * rhythmSd;
    const expected = b.map(x => x * (1 + pc[i]) + (fade(i) * x) / base);
    const noise = b.map(x => r.expo((level * x) / (base / sections)) + 0);
    const sec = expected.map((e, k) => e + (rh * b[k]) / base + noise[k]);
    let kind = pc[i] > 0 ? 'pacechange' : 'clean',
      size = 0;
    const u = r();
    if (u < 0.04) {
      const k = Math.floor(r() * sections);
      size = Math.exp(Math.log(0.3) + r() * (Math.log(10) - Math.log(0.3)));
      sec[k] += size;
      kind = 'mistake';
    } else if (u < 0.07) {
      const n = 2 + Math.floor(2 * r()),
        k0 = Math.floor(r() * (sections - n + 1));
      size = 0.3 + 1.7 * r();
      for (let k = 0; k < n; k++) sec[k0 + k] += size / n;
      kind = 'spread';
    }
    const total = sec.reduce((a, c) => a + c, 0);
    out.push({
      lapTime: total,
      cleanTime: total - (kind === 'mistake' || kind === 'spread' ? size : 0),
      sections: sec,
      kind,
      size,
      expected: expected.reduce((a, c) => a + c, 0),
    });
  }
  return {laps: out};
}
