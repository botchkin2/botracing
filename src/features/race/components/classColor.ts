import {type ColorTokens} from '@/src/design';

import {type ClassKey} from '../model';

/** Class colours mark other cars only (R1f): dots, class bars, never a line or a number. */
export function classColor(color: ColorTokens, key: ClassKey): string {
  switch (key) {
    case 'hypercar':
      return color.classHypercar;
    case 'lmp2':
      return color.classLmp2;
    case 'gt3':
      return color.classGt3;
    default:
      return color.textSecondary;
  }
}
