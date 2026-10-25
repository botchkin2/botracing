import {monoCharWidth, type} from '@/src/design';

const HEAD_CHAR_W = monoCharWidth(type.tableHeader);

/**
 * The phone table's column heads for cells `cellW` wide: the section names as
 * written when they all fit, else each section's first corner alone ("T2–4" is
 * "2", "T10A–T12" is "10A"; "S/F" is "SF"), the way a track map numbers a turn.
 */
export function compactHeads(heads: string[], cellW: number): string[] {
  const fits = (h: string) => [...h].length * HEAD_CHAR_W <= cellW + 2;
  if (heads.every(fits)) return heads;
  return heads.map(h => {
    const first = h.split(/[–-]/)[0];
    return first.replace(/^T(?=\d)/, '').replace('/', '');
  });
}
