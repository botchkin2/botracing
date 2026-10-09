// An iRacing car's class, as the field file carries it: the sim's class id and
// a label a driver reads ("GTP", "LMP2", "GT3"). Pure.
//
// Online sessions name their classes (CarClassShortName); offline ones leave
// the name empty and only the id and the cars say which class is which. Ids
// are stable, so the classes a multiclass race can hold are named by id. An
// unknown id that every car shares one model of is named after that model;
// one that mixes models is "<most common model> +N", never one model's name
// alone, which would tell the driver the Cadillac ahead is in a Porsche class
// (rake, pit-wall thread 1 #3186).

/**
 * Class ids seen in Botkin's .ibt history (2026-10-09, 1993 files), named by
 * the class, not by iRacing's own short name ("IMSA23" is the 2023 IMSA GT3s).
 */
export const KNOWN_CLASSES = new Map([
  [4029, 'GTP'],
  [2523, 'LMP2'],
  [4018, 'LMP3'],
  [100, 'GTE'],
  [4011, 'GT3'],
  [2708, 'GT3'],
  [2268, 'GT4'],
  [2264, 'GT4'],
  [4067, 'GT4'],
]);

/**
 * The cars of an .ibt session YAML's DriverInfo: {carIdx, classId, className,
 * carName}. The pace car and spectators are left out: they are not a class.
 */
export function driversOfYaml(yaml) {
  const list = (yaml ?? '').split(/\n\s*Drivers:\s*\n/)[1] ?? '';
  const out = [];
  for (const block of list.split(/(?:^|\n)\s*- CarIdx:/)) {
    const idx = block.match(/^\s*(\d+)/);
    const pick = key => {
      const m = block.match(new RegExp(`\\n\\s*${key}:[ \\t]*(.*)`));
      return m ? m[1].trim() : '';
    };
    if (!idx || pick('CarIsPaceCar') === '1' || pick('IsSpectator') === '1')
      continue;
    const classId = Number(pick('CarClassID'));
    out.push({
      carIdx: Number(idx[1]),
      classId:
        Number.isFinite(classId) && pick('CarClassID') !== '' ? classId : null,
      className: pick('CarClassShortName'),
      carName: pick('CarScreenName'),
    });
  }
  return out;
}

/** A class's label from its cars (see the header): known id, the sim's name, one model, or "<model> +N". */
export function classLabel(classId, cars) {
  if (KNOWN_CLASSES.has(classId)) return KNOWN_CLASSES.get(classId);
  const members = cars.filter(c => c.classId === classId);
  const named = members.find(c => c.className);
  if (named) return named.className;
  const counts = new Map();
  for (const c of members)
    if (c.carName) counts.set(c.carName, (counts.get(c.carName) ?? 0) + 1);
  if (counts.size === 0) return '';
  // Most cars wins; the first seen breaks a tie.
  let best = null;
  for (const [name, n] of counts) if (!best || n > best[1]) best = [name, n];
  return counts.size === 1 ? best[0] : `${best[0]} +${counts.size - 1}`;
}

/**
 * Every car's {classId, classLabel} by car index: from the capture's own list
 * when it carries class ids (the tray since #370), else from the .ibt's
 * DriverInfo. A car neither knows has none.
 */
export function carClasses(metaCars, ibtDrivers) {
  const fromMeta = (metaCars ?? [])
    .filter(c => Number.isFinite(c.classId))
    .map(c => ({
      carIdx: c.carIdx,
      classId: c.classId,
      className: c.className ?? '',
      carName: c.carName ?? '',
    }));
  const cars = fromMeta.length ? fromMeta : ibtDrivers ?? [];
  const labels = new Map();
  const out = new Map();
  for (const c of cars) {
    if (c.classId == null) continue;
    if (!labels.has(c.classId))
      labels.set(c.classId, classLabel(c.classId, cars));
    out.set(c.carIdx, {classId: c.classId, classLabel: labels.get(c.classId)});
  }
  return out;
}

/**
 * A stored iRacing field from before the field carried classes, with each car's
 * class from the .ibt matched by model: the file keeps no car index, and a
 * model drives in one class per session. A model the .ibt puts in two classes
 * is left without one. Null when there is nothing to add (the field has class
 * ids already, or the .ibt names none of its models).
 */
export function relabelField(field, ibtDrivers) {
  if (!field?.cars?.length || field.cars.some(c => c.classId != null))
    return null;
  const byModel = new Map();
  for (const [carIdx, cls] of carClasses([], ibtDrivers)) {
    const model = ibtDrivers.find(d => d.carIdx === carIdx)?.carName;
    if (!model) continue;
    const seen = byModel.get(model);
    byModel.set(model, seen && seen.classId !== cls.classId ? 'mixed' : cls);
  }
  let added = 0;
  const cars = field.cars.map(car => {
    const cls = byModel.get(car.vehicle);
    if (!cls || cls === 'mixed') return car;
    added++;
    return {...car, ...cls};
  });
  return added ? {...field, cars} : null;
}
