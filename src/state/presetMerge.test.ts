import {describe, expect, it} from '@jest/globals';

import {type FuelPreset, newPreset} from './fuelPresets';
import {
  baseOf,
  mergePresets,
  type PresetList,
  removeFrom,
  sameList,
  saveIn,
} from './presetMerge';

const NOW = Date.parse('2026-10-24T12:00:00Z');
const at = (day: number) => `2026-10-${String(day).padStart(2, '0')}T10:00:00Z`;
const p = (id: string, over: Partial<FuelPreset> = {}): FuelPreset => ({
  ...newPreset(`Rules ${id}`, {fuelL: 73}, id, at(20)),
  ...over,
});
const list = (presets: FuelPreset[], removed: Record<string, string> = {}): PresetList => ({
  presets,
  removed,
});
const ids = (l: PresetList) => l.presets.map(x => x.id);

describe('mergePresets: nothing is lost by accident', () => {
  it('a preset only on the device is kept, one only on the account is kept', () => {
    const merged = mergePresets(list([p('device')]), list([p('account')]), NOW);
    expect(ids(merged)).toEqual(['account', 'device']);
  });

  it('the same preset on both sides is one', () => {
    const merged = mergePresets(list([p('a')]), list([p('a')]), NOW);
    expect(merged.presets).toEqual([p('a')]);
  });

  it('the same id with different content keeps both: the newer savedAt keeps the id, the other becomes a copy', () => {
    const device = p('a', {name: 'Sprint', savedAt: at(22)});
    const account = p('a', {name: 'Old sprint', savedAt: at(21)});
    const merged = mergePresets(list([device]), list([account]), NOW);
    expect(merged.presets).toHaveLength(2);
    expect(merged.presets.find(x => x.id === 'a')).toEqual(device);
    const copy = merged.presets.find(x => x.id !== 'a');
    expect(copy).toMatchObject({name: 'Old sprint (copy)', savedAt: at(21)});
    // and the other way round
    const flipped = mergePresets(list([account]), list([device]), NOW);
    expect(flipped.presets.find(x => x.id === 'a')).toEqual(device);
    expect(flipped.presets).toHaveLength(2);
  });

  it('a clash is merged to the same copy each time, so repeating the sync never piles up copies', () => {
    const device = p('a', {name: 'Sprint', savedAt: at(22)});
    const account = p('a', {name: 'Old sprint', savedAt: at(21)});
    const once = mergePresets(list([device]), list([account]), NOW);
    // the write failed: the device merges the same account list again, now holding the copy
    const twice = mergePresets(once, list([account]), NOW);
    expect(ids(twice).sort()).toEqual(ids(once).sort());
    expect(twice.presets).toHaveLength(2);
  });

  it('merging a result again with either input gives it back', () => {
    const device = list([p('a', {savedAt: at(22), name: 'x'}), p('d')], {gone: at(19)});
    const account = list([p('a', {savedAt: at(21)}), p('s')], {other: at(18)});
    const merged = mergePresets(device, account, NOW);
    expect(sameList(mergePresets(merged, account, NOW), merged)).toBe(true);
    expect(sameList(mergePresets(merged, device, NOW), merged)).toBe(true);
  });
});

describe('mergePresets: a removal sticks', () => {
  it('a preset removed on one device stays gone when another device, offline, still holds it', () => {
    const phone = removeFrom(list([p('a'), p('b')]), 'a', at(23));
    const account = mergePresets(phone, list([]), NOW);
    expect(ids(account)).toEqual(['b']);
    // the PC never saw the removal and still holds `a`
    const pc = list([p('a'), p('b')]);
    const merged = mergePresets(pc, account, NOW);
    expect(ids(merged)).toEqual(['b']);
    expect(merged.removed).toEqual({a: at(23)});
  });

  it('a preset saved again after its removal wins over the tombstone, and the tombstone goes', () => {
    const merged = mergePresets(
      list([p('a', {savedAt: at(24), name: 'Back'})]),
      list([], {a: at(23)}),
      NOW,
    );
    expect(ids(merged)).toEqual(['a']);
    expect(merged.removed).toEqual({});
  });

  it('a preset edited after another device removed it is kept (the later action wins)', () => {
    const merged = mergePresets(list([p('a', {savedAt: at(25)})]), list([], {a: at(23)}), NOW);
    expect(ids(merged)).toEqual(['a']);
  });

  it('tombstones are kept for 90 days and dropped after', () => {
    const old = new Date(NOW - 91 * 86_400_000).toISOString();
    const recent = new Date(NOW - 89 * 86_400_000).toISOString();
    const merged = mergePresets(list([], {old, recent}), list([]), NOW);
    expect(merged.removed).toEqual({recent});
  });

  it('the later of two tombstones for one id is kept', () => {
    const merged = mergePresets(list([], {a: at(22)}), list([], {a: at(23)}), NOW);
    expect(merged.removed).toEqual({a: at(23)});
  });
});

describe('mergePresets: an edit is not a conflict (three-way, against what the device last saw)', () => {
  const old = p('a', {name: 'Sprint', savedAt: at(20)});
  const edited = p('a', {name: 'Sprint', mandatoryStops: 1, savedAt: at(22)});
  const base = {a: at(20)};

  it("the device holds the old copy the account edited: the account's edit, no copy", () => {
    const merged = mergePresets(list([old]), list([edited]), NOW, base);
    expect(merged.presets).toEqual([edited]);
  });

  it("the device edited and the account did not move: the device's edit, no copy", () => {
    const merged = mergePresets(list([edited]), list([old]), NOW, base);
    expect(merged.presets).toEqual([edited]);
  });

  it('both moved since the base: a real conflict, both kept', () => {
    const theirs = p('a', {name: 'Theirs', savedAt: at(21)});
    const merged = mergePresets(list([edited]), list([theirs]), NOW, base);
    expect(merged.presets).toHaveLength(2);
    expect(merged.presets.find(x => x.id === 'a')).toEqual(edited);
  });

  it('with no base (the first sync) a difference is a conflict and both are kept', () => {
    expect(mergePresets(list([old]), list([edited]), NOW, {}).presets).toHaveLength(2);
  });

  it("baseOf is the account list's ids and save times", () => {
    expect(baseOf([old, p('b', {savedAt: at(21)})])).toEqual({a: at(20), b: at(21)});
  });
});

describe('mergePresets: times are compared as times, not as text', () => {
  it('a tombstone in another time zone is not mis-ordered against a savedAt', () => {
    // 10:00+02:00 is 08:00Z, before 09:00Z, though the text sorts after it
    const saved = p('a', {savedAt: '2026-10-23T09:00:00Z'});
    const kept = mergePresets(list([saved]), list([], {a: '2026-10-23T10:00:00+02:00'}), NOW);
    expect(ids(kept)).toEqual(['a']);
    expect(kept.removed).toEqual({});
    // removed after it was saved stays removed
    const gone = mergePresets(list([saved]), list([], {a: '2026-10-23T10:30:00Z'}), NOW);
    expect(ids(gone)).toEqual([]);
  });
});

describe('the local operations', () => {
  it('saveIn replaces by id, appends a new one and ends a removal of that id', () => {
    const base = list([p('a')], {b: at(20)});
    expect(ids(saveIn(base, p('b')))).toEqual(['a', 'b']);
    expect(saveIn(base, p('b')).removed).toEqual({});
    const edited = p('a', {name: 'Edited'});
    expect(saveIn(base, edited).presets).toEqual([edited]);
  });

  it('removeFrom drops the preset and stamps a tombstone; an unknown id changes nothing', () => {
    const base = list([p('a'), p('b')]);
    expect(removeFrom(base, 'a', at(23))).toEqual(list([p('b')], {a: at(23)}));
    expect(removeFrom(base, 'zzz', at(23))).toBe(base);
  });

  it('sameList ignores order and compares content and tombstones', () => {
    expect(sameList(list([p('a'), p('b')]), list([p('b'), p('a')]))).toBe(true);
    expect(sameList(list([p('a')]), list([p('a', {name: 'x'})]))).toBe(false);
    expect(sameList(list([p('a')]), list([p('a')], {b: at(20)}))).toBe(false);
    expect(sameList(list([p('a')]), list([p('a'), p('b')]))).toBe(false);
  });
});
