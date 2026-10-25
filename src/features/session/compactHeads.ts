import {shortSectionName} from '@/src/analysis/turnNames';
import {monoCharWidth, type} from '@/src/design';

const HEAD_CHAR_W = monoCharWidth(type.tableHeader);

/**
 * The phone table's column heads for cells `cellW` wide: the section names as
 * written when they all fit, else each section's shortest name
 * (`shortSectionName`).
 */
export function compactHeads(heads: string[], cellW: number): string[] {
  const fits = (h: string) => [...h].length * HEAD_CHAR_W <= cellW + 2;
  return heads.every(fits) ? heads : heads.map(shortSectionName);
}
