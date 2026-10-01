import AsyncStorage from '@react-native-async-storage/async-storage';
import {useCallback, useState} from 'react';
import {create} from 'zustand';
import {createJSONStorage, persist} from 'zustand/middleware';

// The width of each desktop page's side column, kept per user (not per
// session) so the page opens the way it was left. Compare keeps its own
// (`comparePrefs.rightW`). A width is only a preference: it is clamped on every
// read, so a stale or hand-edited value cannot break the layout.

export type PanelId = 'session' | 'race' | 'corner';

/** Points; `default` is what a double click on the divider goes back to. */
export type PanelLimits = {min: number; max: number; default: number};

export const PANEL_LIMITS: Record<PanelId, PanelLimits> = {
  // The right column: lap detail, Pit stops, Tires, Fuel use.
  session: {min: 340, max: 720, default: 400},
  // The board beside the field map.
  race: {min: 280, max: 560, default: 320},
  // Corner's left column: the braking map and the measures.
  corner: {min: 480, max: 900, default: 600},
};

/**
 * `width` kept inside the panel's limits, and inside `room`, the most the
 * layout can give without squeezing the other column (never below the
 * panel's own minimum). Whole points.
 */
export function clampPanelW(id: PanelId, width: number, room = Infinity) {
  const {min, max} = PANEL_LIMITS[id];
  const top = Math.max(min, Math.min(max, room));
  return Math.round(Math.min(top, Math.max(min, width)));
}

type PanelPrefs = {widths: Partial<Record<PanelId, number>>};
type Actions = {
  setWidth: (id: PanelId, width: number) => void;
  resetWidth: (id: PanelId) => void;
};

export const usePanelPrefs = create<PanelPrefs & Actions>()(
  persist(
    set => ({
      widths: {},
      setWidth: (id, width) =>
        set(s => ({widths: {...s.widths, [id]: clampPanelW(id, width)}})),
      resetWidth: id =>
        set(s => {
          const {[id]: _dropped, ...rest} = s.widths;
          return {widths: rest};
        }),
    }),
    {
      name: 'panel-prefs-v1',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: s => ({widths: s.widths}),
    },
  ),
);

/**
 * A side column's width for a page: the live value while the divider is
 * dragged, else the saved one, else the default; clamped to the limits and to
 * `room`. `onCommit` remembers the width, `reset` goes back to the default.
 */
export function usePanelWidth(id: PanelId, room: number) {
  const saved = usePanelPrefs(s => s.widths[id]);
  const setWidth = usePanelPrefs(s => s.setWidth);
  const resetWidth = usePanelPrefs(s => s.resetWidth);
  const [drag, setDrag] = useState<number | null>(null);
  const width = clampPanelW(
    id,
    drag ?? saved ?? PANEL_LIMITS[id].default,
    room,
  );
  const onCommit = useCallback(
    (w: number) => {
      setWidth(id, w);
      setDrag(null);
    },
    [id, setWidth],
  );
  const reset = useCallback(() => {
    resetWidth(id);
    setDrag(null);
  }, [id, resetWidth]);
  return {width, onResize: setDrag, onCommit, reset};
}
