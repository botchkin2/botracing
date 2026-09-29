import {useMemo} from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {create} from 'zustand';
import {createJSONStorage, persist} from 'zustand/middleware';

import {METRIC, type Units} from '@/src/analysis/units';

// Display units, set in Settings (handoff v2 M5). Display only.

type UnitPrefs = Units & {
  setSpeed: (speed: Units['speed']) => void;
  setDistance: (distance: Units['distance']) => void;
};

export const useUnitPrefs = create<UnitPrefs>()(
  persist(
    set => ({
      ...METRIC,
      setSpeed: speed => set({speed}),
      setDistance: distance => set({distance}),
    }),
    {
      name: 'unit-prefs-v1',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: s => ({speed: s.speed, distance: s.distance}),
    },
  ),
);

/** The current units, as a stable object for models. */
export function useUnits(): Units {
  const speed = useUnitPrefs(s => s.speed);
  const distance = useUnitPrefs(s => s.distance);
  return useMemo(() => ({speed, distance}), [speed, distance]);
}
