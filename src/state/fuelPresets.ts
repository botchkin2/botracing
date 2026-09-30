import AsyncStorage from '@react-native-async-storage/async-storage';
import {create} from 'zustand';
import {createJSONStorage, persist} from 'zustand/middleware';

// Named event rules for the fuel planner (pit wall thread 35, #955/#959):
// "GT3 Sprint 30 min", "Endurance 75 % fuel". A preset is not tied to a track,
// because the same event series visits many tracks. Kept on this device; the
// planner always says which rules it is using and never switches silently.

export type RaceLength = {kind: 'laps' | 'min'; value: number};

export type FuelPreset = {
  id: string;
  name: string;
  length: RaceLength;
  /** Litres loaded at the start; null means the fill limit of his last session. */
  fuelL: number | null;
  /** VE at the start, % of the full load. */
  vePct: number;
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

type State = {
  presets: FuelPreset[];
  /** Null is "no limits": the fill limit and 100 % VE. */
  activeId: string | null;
  /** The race length in use; a preset's length loads into it when picked. */
  length: RaceLength;
};

type Actions = {
  save: (preset: FuelPreset) => void;
  remove: (id: string) => void;
  /** Pick a preset (loading its length) or null for no limits. */
  select: (id: string | null) => void;
  setLength: (length: RaceLength) => void;
};

export const useFuelPresets = create<State & Actions>()(
  persist(
    (set, get) => ({
      presets: [],
      activeId: null,
      length: DEFAULT_LENGTH,
      save: preset =>
        set(s => ({
          presets: upsertPreset(s.presets, preset),
          activeId: preset.id,
          length: preset.length,
        })),
      remove: id =>
        set(s => ({
          presets: removePreset(s.presets, id),
          activeId: s.activeId === id ? null : s.activeId,
        })),
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
      storage: createJSONStorage(() => AsyncStorage),
      partialize: s => ({
        presets: s.presets,
        activeId: s.activeId,
        length: s.length,
      }),
    },
  ),
);
