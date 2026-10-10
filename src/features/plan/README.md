# src/features/plan

The Plan screen: the stops, laps and fuel for the next race at a track and car, from the driver's own recorded laps, and the class pace of the cars he races with.

- `PlanScreen.tsx`: layout (phone column; desktop setup | results | scatter) and which cards each `PlanState` draws (`planState.ts`).
- `usePlanData.ts`: the rules, history, plan and cards for one track and car; the Track page reads the same hook.
- `model.ts`, `planCards.ts`, `pitPlan.ts`, `planHalf.ts`, `pooledUse.ts`: pure. Combos, the plan's rows and cards, the pit slider, pooled use.
- Class pace (Botkin's D55): `classTiming.ts` is pure. It pools each session's stored `classLaps` (`analysis/classLaps.ts`) into one row per class: lap (≈, to a tenth), its lap against his median (minus is faster), first catch, every. `classPaceInput.ts` (pure) picks the sessions (same sim and track, races and practices, whatever car), his class and his median. `useClassTiming.ts` only gathers them. `components/ClassTimingSection.tsx` draws the Race timeline and the Class pace card on both widths and in every plan state: class pace needs no fuel and none of his laps.
- Imports `src/analysis`, `src/data`, `src/design`, `src/ui`, `src/state`, `src/charts`, `src/nav`, and `features/session/pitCard` (the pit stop facts the Race card shares).
