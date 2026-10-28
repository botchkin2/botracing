import AsyncStorage from '@react-native-async-storage/async-storage';
import {create} from 'zustand';
import {createJSONStorage, persist} from 'zustand/middleware';

// What he typed as the car's start for the race he is planning (pit-wall
// thread 104 #7968): kept across screens and restarts so the phone, where he
// plans before a race and looks at other screens in between, does not ask
// again. It belongs to one track and car (the Plan's combo key); typing for
// another combo replaces it, so a start never carries over to another race.
// Per device, like the race length.

export type StartText = {ve: string; fuel: string};

type State = {key: string; ve: string; fuel: string};
type Actions = {
  /** The text typed for `key`; the other combo's is dropped. */
  setStart: (key: string, text: StartText) => void;
};

const EMPTY: StartText = {ve: '', fuel: ''};

/** The start typed for this combo, blank for any other. */
export function startTextFor(state: State, key: string | null): StartText {
  return key != null && state.key === key
    ? {ve: state.ve, fuel: state.fuel}
    : EMPTY;
}

export const usePlanStart = create<State & Actions>()(
  persist(
    set => ({
      key: '',
      ve: '',
      fuel: '',
      setStart: (key, text) =>
        set({
          key,
          ve: typeof text.ve === 'string' ? text.ve : '',
          fuel: typeof text.fuel === 'string' ? text.fuel : '',
        }),
    }),
    {
      name: 'plan-start-v1',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: s => ({key: s.key, ve: s.ve, fuel: s.fuel}),
    },
  ),
);
