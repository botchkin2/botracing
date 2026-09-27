# Tire wear and elevation

Status: spark
Date: 2026-09-26
From: botkin (phone notes), filed by grok

Source: [2026-09-26-source-telemetry-feature-research.md](2026-09-26-source-telemetry-feature-research.md) sections 2.6 and 2.7.

## The idea

Tire wear by corner of the track, not only a stint percent. Count time above the optimal temp. Compare lap time with wear only after splitting out fuel load. The decision is time lost by staying out versus pit loss plus the gain from fresh tires. Do not average compounds together.

Elevation is a track cache: altitude against distance from one clean lap, reused for that layout. Draw grade on the brake and throttle traces. Do not flag a slow uphill apex as a mistake. Mark the climbs as the first places to lift and coast.

## Why it might matter

A wear percent does not say which corner is using the tire. Brake points move with gradient, and the chart does not show that today.

## Open questions

Are wheel temp, pressure, wear, and compound in the recording? World height is there as a position axis, not a named elevation channel. The axis has to be checked before a grade is trusted.
