// The gear trace as it is drawn. LMU reports gear 0 for the instant between two
// gears on every shift: an in-between neutral, not a gear the car sat in. So
// the drawn trace holds the previous gear through those samples. The data is
// untouched; this is applied at draw time only. Leading neutrals (before the
// first gear) take the first gear that follows them.
export function drawnGear(gears: number[]): number[] {
  const out = [...gears];
  let held: number | null = null;
  for (let i = 0; i < out.length; i++) {
    if (out[i] !== 0 && Number.isFinite(out[i])) held = out[i];
    else if (held != null && Number.isFinite(out[i])) out[i] = held;
  }
  // Leading neutrals: no gear before them, so they take the first gear.
  const first = out.find(g => g !== 0 && Number.isFinite(g));
  if (first != null) {
    for (
      let i = 0;
      i < out.length && (out[i] === 0 || !Number.isFinite(out[i]));
      i++
    )
      if (out[i] === 0) out[i] = first;
      else break;
  }
  return out;
}
