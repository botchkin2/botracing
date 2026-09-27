# One channel catalog for LMU and iRacing

Status: spark
Date: 2026-09-26
From: botkin (phone notes), filed by grok

Source: [2026-09-26-source-telemetry-feature-research.md](2026-09-26-source-telemetry-feature-research.md) sections 1 and 3.10.

## The idea

Own a small session and lap model. Map Garage 61, LMU, and iRacing into it. Do not treat the Garage 61 CSV as the schema.

LMU has four inputs that should become the same channels: official shared memory for live, the local REST port for virtual energy and repairs, the `.duckdb` recording for the offline archive, and the session XML after a race. iRacing has live shared memory and `.ibt` for the same role the recording already plays.

A first catalog: time, distance, distance fraction, speed, throttle, brake, steer, gear, rpm, fuel, energy, state of charge, four tires, flags, a field snapshot, impact, altitude, weather. Sim-only fields sit beside that, and they do not block the shared charts.

## Why it might matter

Every later improvement (traffic, fuel, virtual energy, tires) needs the same names in both sims. Live and offline must not grow two schemas.

## Open questions

The current path is the `.duckdb` file into the existing nine-column CSV. Shared memory, REST, and `.ibt` are not built. What does the recording already store at full rate, and is the chart distance-based or time-based?
