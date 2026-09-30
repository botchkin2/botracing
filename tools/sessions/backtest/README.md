# Fuel backtest (pit-wall thread 36)

Reruns the fuel planner (`src/analysis/fuelPlan.ts`) on every LMU race with a pit stop, fed only laps from earlier sessions at the same track, layout and car model, and prints the stops it would have said against what happened.

1. `node tools/sessions/backtest/hist.mjs [hist.json]` reads every .duckdb in the Telemetry folder (`LMU_TELEMETRY` to point elsewhere): fuel and VE per lap, pit windows, stops. Read-only, about 1 s a file, resumable.
2. `node tools/sessions/backtest/backtest.mjs [hist.json] [rows.json]` runs the planner per race and writes one row per race. `LASTN=8` limits the history to the last 8 sessions, `SAMELIMIT=1` to sessions with the same fill limit (a balance-of-performance change shows there, Barcelona 08-13).

The planner is given the laps he drove, so this tests the load maths, not minutes to laps. Green laps in the history are approximated from the .duckdb (not in the pit lane, not lap 0, at most 1.10x the file's median lap time); the uploader's stint medians agree within 0.03 L per lap on the three races checked. A new car class (Hypercar, LMP2) needs only a rerun of both.
