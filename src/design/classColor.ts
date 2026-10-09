import {type ClassSlot} from '@/src/analysis/fieldClasses';
import {type ColorTokens} from './tokens';

/** Class colours mark other cars only (R1f): dots, class bars, never a line or a number. */
export function classColor(color: ColorTokens, slot: ClassSlot): string {
  switch (slot) {
    case 'class1':
      return color.class1;
    case 'class2':
      return color.class2;
    case 'class3':
      return color.class3;
    default:
      return color.textSecondary;
  }
}
