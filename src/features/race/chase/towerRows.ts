// The 3D view's tower: a broadcast replay's timing tower, cut to the rows around the followed car. Pure; the component only draws it.

import {formatGap, formatSignedWhole} from '@/src/design/format';
import {roadOffsetM} from '@/src/features/race/model';

/** What the tower needs of one car, taken from the Race screen's own car (place, class colour, model). */
export type TowerCar = {
  index: number;
  /** Place in its own class, the HUD's basis (the standings' classPlace); 0 when it has none. */
  classPlace: number;
  classKey: string;
  /** The class's short title ("GT3"), printed beside the place. */
  classTag: string;
  /** Class colour from the design tokens. */
  color: string;
  model: string;
  lapDistM: number;
  /** Seconds to the car ahead in its class, the HUD's own interval (null on the grid, in the garage, or for a class leader). */
  intervalS: number | null;
  inGarage: boolean;
};

/** Order: the followed car's class by class place, so its neighbours are the HUD's P11 and P13. Near: the cars by their road distance from the followed car, ahead on top. */
export type TowerMode = 'order' | 'near';

export type TowerRow = {
  index: number;
  classPlace: number;
  classTag: string;
  color: string;
  model: string;
  /** Order: seconds to the followed car in its class ("−1.2" ahead), the sum of the standings' intervals between the two, so the next car reads what the HUD's ▲ and ▼ read. Near: metres along the road ("+35 m"). "" on the followed car. */
  gap: string;
  followed: boolean;
};

/** `span` rows around the followed car (it keeps its own row, near the middle); fewer when the field is smaller. */
export function towerRows(
  cars: readonly TowerCar[],
  followed: number | null,
  mode: TowerMode,
  span: number,
  trackM: number,
): TowerRow[] {
  const me = cars.find(c => c.index === followed);
  if (!me) return [];
  const live = cars.filter(c => !c.inGarage && c.classPlace > 0);
  if (!live.includes(me)) return [];
  const ordered =
    mode === 'order'
      ? live.filter(c => c.classKey === me.classKey).sort((a, b) => a.classPlace - b.classPlace)
      : live
          .flatMap(c => {
            const d = roadOffsetM(c, me, trackM);
            return d === null ? [] : [{car: c, d}];
          })
          .sort((a, b) => b.d - a.d)
          .map(e => e.car);
  const at = ordered.indexOf(me);
  const count = Math.min(span, ordered.length);
  const first = Math.max(0, Math.min(at - Math.floor(count / 2), ordered.length - count));
  return ordered.slice(first, first + count).map(c => ({
    index: c.index,
    classPlace: c.classPlace,
    classTag: c.classTag,
    color: c.color,
    model: c.model,
    gap: c === me ? '' : gapText(c, me, mode, trackM, ordered),
    followed: c === me,
  }));
}

function gapText(c: TowerCar, me: TowerCar, mode: TowerMode, trackM: number, ordered: readonly TowerCar[]): string {
  if (mode === 'near') {
    const d = roadOffsetM(c, me, trackM);
    return d === null ? '–' : `${formatSignedWhole(d)} m`;
  }
  // Order holds one class by class place: the cars between the two each add their interval to the one ahead of them.
  const from = ordered.indexOf(c);
  const to = ordered.indexOf(me);
  const [first, last] = from < to ? [from + 1, to] : [to + 1, from];
  let sumS = 0;
  for (let i = first; i <= last; i++) {
    const intervalS = ordered[i].intervalS;
    if (intervalS === null) return '–';
    sumS += intervalS;
  }
  return formatGap(from < to ? -sumS : sumS, 1);
}
