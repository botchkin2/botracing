# Pace study tools

Study only; nothing in the app imports these (pit-wall thread 1 #4889).

- `paceSimGen.mjs`: `makeDriver(rng, {level, sections, base, laps})`: one stint of laps with section times: base per section, a fuel burn-off then a tyre knee (sometimes a cliff), an AR(1) rhythm shared across sections, independent exponential section noise scaled by `level`, and truth-labelled events per lap (`kind`: clean, mistake (one section, +0.3..10 s), spread (2-3 adjacent sections, +0.3..2 s), pacechange (3-6 laps at +1..3 % on every section; truth: keep); `size`; `cleanTime`, the lap without its event).
- `paceSim.mjs`: runs judges over 400 drivers per level (0.02..0.3 s) and prints events caught by kind and size, clean laps dropped, pace-change laps dropped, and the error of the kept laps' median against the truth median (with the keep-everything error in brackets). `node tools/study/paceSim.mjs [--judges <module>]`; a judge module exports `judges` (name -> `stint => [{out}]`).
