# Fuel and virtual energy planner

Status: spark
Date: 2026-09-26
From: botkin (phone notes), filed by grok

Source: [2026-09-26-source-telemetry-feature-research.md](2026-09-26-source-telemetry-feature-research.md) sections 2.4 and 2.5.

## The idea

Fuel is per-lap consumption with out-laps, in-laps, and safety-car laps left out. Use a rolling median, then laps to a splash, fuel to the finish, and a reserve of about one lap. The weight effect comes from our own sessions, not a fixed number.

Virtual energy is the LMU-only planning feature. Pit time follows energy added. The planner takes race length, a measured pit loss, push versus lift-and-coast use, a weather or safety-car slider, tire-change threshold, and driver stint length. It returns stop count, energy to add, and the lap time cost of saving enough to drop a stop. Each lap, compare planned use with actual use and recompute.

LMU also has a REST history of virtual-energy use. Mirror the numbers we already record so the planner does not depend on that UI.

## Why it might matter

Endurance is a normal session, not a fuel gauge added later. Garage 61 has no virtual-energy model.

## Open questions

Which of these channels are in the `.duckdb` file we already parse: fuel, virtual energy, state of charge, regen, motor map, lift-and-coast? Pit loss can be measured from pit in and pit out instead of typed in.
