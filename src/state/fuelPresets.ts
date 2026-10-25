import AsyncStorage from '@react-native-async-storage/async-storage';
import {create} from 'zustand';
import {createJSONStorage, persist} from 'zustand/middleware';

import {
  baseOf,
  mergePresets,
  type PresetList,
  removeFrom,
  sameList,
  saveIn,
  type SyncedBase,
  type Tombstones,
} from './presetMerge';

// Named event rules for the fuel planner (pit wall thread 35, #955/#959):
// "GT3 Sprint 30 min", "Endurance 75 % fuel". A preset is not tied to a track,
// because the same event series visits many tracks. The list follows the account
// (src/state/presetMerge.ts, src/features/plan/presetSync.ts: kept on this device as the offline copy, merged with
// the account's, nothing dropped); the active one and the race length stay per device.
// The planner always says which rules it is using and never switches silently.

export type RaceLength = {kind: 'laps' | 'min'; value: number};

export type FuelPreset = {
  id: string;
  name: string;
  length: RaceLength;
  /** Litres loaded at the start; null means the fill limit of his last session. */
  fuelL: number | null;
  /** VE at the start, % of the full load. */
  vePct: number;
  /**
   * Litres of fuel one % of VE is worth at this event (an event/BoP value);
   * null uses the last session's measured ratio.
   */
  veRatio: number | null;
  formationLap: boolean;
  mandatoryStops: number;
  /** ISO date the rules were saved, for "set 09-26". */
  savedAt: string;
};

export const DEFAULT_LENGTH: RaceLength = {kind: 'min', value: 30};

export function newPreset(
  name: string,
  over: Partial<Omit<FuelPreset, 'id' | 'name'>>,
  id: string,
  savedAt: string,
): FuelPreset {
  return {
    id,
    name: name.trim() || 'Untitled',
    length: over.length ?? DEFAULT_LENGTH,
    fuelL: over.fuelL ?? null,
    vePct: over.vePct ?? 100,
    veRatio: over.veRatio ?? null,
    formationLap: over.formationLap ?? true,
    mandatoryStops: over.mandatoryStops ?? 0,
    savedAt,
  };
}

/** An id not used by any preset yet. */
export function freshId(presets: FuelPreset[], seed: number): string {
  let n = seed;
  while (presets.some(p => p.id === `p${n}`)) n++;
  return `p${n}`;
}

export function upsertPreset(
  presets: FuelPreset[],
  preset: FuelPreset,
): FuelPreset[] {
  return presets.some(p => p.id === preset.id)
    ? presets.map(p => (p.id === preset.id ? preset : p))
    : [...presets, preset];
}

export function removePreset(presets: FuelPreset[], id: string): FuelPreset[] {
  return presets.filter(p => p.id !== id);
}

/** What the device stored at `version`, as the current shape; nothing in the list is dropped. */
export function migrateStored(persisted: unknown, version: number): State & Actions {
  const old = (persisted ?? {}) as Partial<State>;
  const presets = Array.isArray(old.presets) ? old.presets : [];
  return {
    ...old,
    presets,
    activeId: old.activeId ?? null,
    // version 1's length was never a choice
    length: version < 2 || old.length == null ? DEFAULT_LENGTH : old.length,
    removed: old.removed ?? {},
    version: old.version ?? 0,
    pending: old.pending ?? presets.length > 0,
    synced: old.synced ?? {},
    owner: old.owner ?? null,
    byOwner: old.byOwner ?? {},
  } as State & Actions;
}

type State = {
  presets: FuelPreset[];
  /** Null is "no limits": the fill limit and 100 % VE. Per device: not synced. */
  activeId: string | null;
  /** The race length in use; a preset's length loads into it when picked. Per device. */
  length: RaceLength;
  /** The list follows the account (src/features/plan/presetSync.ts): a tombstone per removed preset id. */
  removed: Tombstones;
  /** The account's version this list was last merged with; 0 before the first sync. */
  version: number;
  /** A change here the account does not have yet (saved or removed offline, or before the first sync). */
  pending: boolean;
  /** What this device last saw of the account's presets (id -> savedAt): the base of the merge. */
  synced: SyncedBase;
  /** The uid the list belongs to; a different person signing in does not inherit it. */
  owner: string | null;
  /** The lists of other people who signed in here, kept for when they come back: nothing is dropped. */
  byOwner: Record<string, OwnerList>;
};

/** One person's list on this device (the fields that follow the account). */
export type OwnerList = PresetList & {version: number; pending: boolean; synced: SyncedBase};

type Actions = {
  save: (preset: FuelPreset) => void;
  remove: (id: string) => void;
  /** Pick a preset (loading its length) or null for no limits. */
  select: (id: string | null) => void;
  setLength: (length: RaceLength) => void;
  /** Merge the account's list in (src/features/plan/presetSync.ts); what the account lacks stays pending. */
  applyServer: (doc: PresetList & {version: number}, nowMs: number) => void;
  /** The list belongs to `uid`: the first sign-in adopts it; another person gets their own, and this one is kept for them. */
  adoptOwner: (uid: string) => void;
};

/** What a device that never synced holds: its list is all pending, so the first sync uploads it. */
export const initialSync = {
  removed: {} as Tombstones,
  version: 0,
  pending: false,
  synced: {} as SyncedBase,
  owner: null as string | null,
  byOwner: {} as Record<string, OwnerList>,
};

export const useFuelPresets = create<State & Actions>()(
  persist(
    (set, get) => ({
      presets: [],
      activeId: null,
      length: DEFAULT_LENGTH,
      ...initialSync,
      save: preset =>
        set(s => ({
          ...saveIn(s, preset),
          activeId: preset.id,
          length: preset.length,
          pending: true,
        })),
      remove: id =>
        set(s => {
          const next = removeFrom(s, id, new Date().toISOString());
          return {
            ...next,
            activeId: s.activeId === id ? null : s.activeId,
            pending: next === s ? s.pending : true,
          };
        }),
      applyServer: (doc, nowMs) =>
        set(s => {
          const merged = mergePresets(s, doc, nowMs, s.synced);
          return {
            ...merged,
            version: doc.version,
            synced: baseOf(doc.presets),
            pending: !sameList(merged, doc),
            activeId: merged.presets.some(p => p.id === s.activeId) ? s.activeId : null,
          };
        }),
      adoptOwner: uid =>
        set(s => {
          if (s.owner === uid) return s;
          if (s.owner == null) return {owner: uid};
          // the person who was here keeps their list, and gets it back when they sign in
          const {[uid]: theirs, ...others} = s.byOwner;
          return {
            byOwner: {
              ...others,
              [s.owner]: {
                presets: s.presets,
                removed: s.removed,
                version: s.version,
                pending: s.pending,
                synced: s.synced,
              },
            },
            ...(theirs ?? {presets: [], removed: {}, version: 0, pending: false, synced: {}}),
            activeId: null,
            length: DEFAULT_LENGTH,
            owner: uid,
          };
        }),
      select: id => {
        const preset = get().presets.find(p => p.id === id);
        set(s => ({
          activeId: preset ? preset.id : null,
          length: preset ? preset.length : s.length,
        }));
      },
      setLength: length => set({length}),
    }),
    {
      name: 'fuel-presets-v1',
      // Version 1 stored a length the Plan had prefilled in laps from the last
      // race (thread 44 #1954); it was never a choice, so it goes back to the
      // default. Saved rule sets keep their own lengths.
      // Version 3 adds the account sync (thread 104, B2): a list from before it is
      // all pending, so the first sync uploads it, merged into the account's by id.
      version: 3,
      migrate: (persisted, version) => migrateStored(persisted, version),
      storage: createJSONStorage(() => AsyncStorage),
      partialize: s => ({
        presets: s.presets,
        activeId: s.activeId,
        length: s.length,
        removed: s.removed,
        version: s.version,
        pending: s.pending,
        synced: s.synced,
        owner: s.owner,
        byOwner: s.byOwner,
      }),
    },
  ),
);
