// Map label placement: keep labels in priority order and drop any that
// would overlap one already kept. Boxes are centred on each label's point.
//
// Plain TypeScript with erasable syntax only, no imports: Node runs it as is.

export interface LabelBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Indices of the labels kept, in input (priority) order. */
export function keepClear(labels: LabelBox[], gap = 1): number[] {
  const kept: number[] = [];
  for (let i = 0; i < labels.length; i++) {
    const a = labels[i];
    const hit = kept.some(j => {
      const b = labels[j];
      return (
        Math.abs(a.x - b.x) * 2 < a.width + b.width + 2 * gap &&
        Math.abs(a.y - b.y) * 2 < a.height + b.height + 2 * gap
      );
    });
    if (!hit) kept.push(i);
  }
  return kept;
}
