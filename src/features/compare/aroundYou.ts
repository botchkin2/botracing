import {type Field} from '@/src/analysis/field';
import {
  type ClassSlot,
  type ClassTable,
  classOfCar,
} from '@/src/analysis/fieldClasses';
import {type Radar} from '@/src/analysis/radar';

// The CARS AROUND YOU list beside the desktop radar (round 3 R2c): one row per
// car in the radar, nearest first, in words and numbers a driver can read.
// Pure: a radar view and the field in, rows out.

/** Closer than this sideways reads as in line, not left or right. */
const IN_LINE_M = 0.5;

export interface AroundRow {
  index: number;
  slot: ClassSlot;
  /** The class's short label, beside its colour ("HY", "GTP"). */
  short: string;
  /** The car model when the recorder had it, else the class name. */
  label: string;
  /** "+12 m" / "−8 m": ahead / behind. */
  forwardText: string;
  /** "in line", "left 2.4 m", "right 1.0 m". */
  sideText: string;
  /** Set when a car is alongside: the row says ALONGSIDE L / R instead. */
  alongside: 'left' | 'right' | null;
}

const signed = (m: number) =>
  `${m < 0 ? '−' : '+'}${Math.abs(Math.round(m))} m`;

export function aroundYouRows(
  radar: Radar,
  field: Field,
  classes: ClassTable,
): AroundRow[] {
  return radar.cars
    .map(c => {
      const car = field.cars[c.index];
      const side = Math.abs(c.sideM);
      const cls = car ? classes.of(classOfCar(car).key) : null;
      return {
        index: c.index,
        slot: c.slot,
        short: cls?.short ?? '',
        label: car?.vehicle ?? cls?.label ?? '',
        forwardM: c.forwardM,
        forwardText: signed(c.forwardM),
        sideText:
          side < IN_LINE_M
            ? 'in line'
            : `${c.sideM < 0 ? 'left' : 'right'} ${side.toFixed(1)} m`,
        alongside: c.alongside,
      };
    })
    .sort((a, b) => Math.abs(a.forwardM) - Math.abs(b.forwardM))
    .map(({forwardM: _forwardM, ...row}) => row);
}
