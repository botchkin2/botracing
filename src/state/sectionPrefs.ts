import AsyncStorage from '@react-native-async-storage/async-storage';
import {create} from 'zustand';
import {createJSONStorage, persist} from 'zustand/middleware';

import {type SectionMode} from '@/src/analysis/segments';

// Whether tables cut a lap into our turn sections (T1, T2–5, …) or the game's
// three sectors (decisions/lap/2026-10-04-sections-and-compare.md). Turns by
// default; the Settings toggle writes it, and every table reads it through
// `segmentTimesFor` without knowing which one it got.

/** Anything stored that is not the sectors choice reads as the default. */
export function sectionModeOf(stored: unknown): SectionMode {
  return stored === 'sectors' ? 'sectors' : 'turns';
}

type Prefs = {mode: SectionMode; setMode: (mode: SectionMode) => void};

export const useSectionPrefs = create<Prefs>()(
  persist(
    set => ({
      mode: 'turns',
      setMode: mode => set({mode: sectionModeOf(mode)}),
    }),
    {
      name: 'section-prefs-v1',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: s => ({mode: s.mode}),
    },
  ),
);

/** The mode in force. */
export function useSectionMode(): SectionMode {
  return useSectionPrefs(s => sectionModeOf(s.mode));
}
