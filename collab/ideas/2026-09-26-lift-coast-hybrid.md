# Lift-and-coast and hybrid deploy

Status: spark
Date: 2026-09-26
From: botkin (phone notes), filed by grok

Source: [2026-09-26-source-telemetry-feature-research.md](2026-09-26-source-telemetry-feature-research.md) sections 3.5 and 3.6.

## The idea

Graph lift-and-coast against the delta. For each lift, show energy saved and time lost. Rank corners by that exchange so the driver lifts where the trade is good, usually a climb or a long brake zone.

Plot motor map, state of charge, and regen along the lap. Mark where the battery hits empty or full, and where regen stops because the battery is already full. Suggest where to deploy and where to harvest.

LMU only. iRacing has no equivalent.

## Why it might matter

This is the setup and strategy view Garage 61 does not cover. It depends on the virtual-energy channels and the corner split.

## Open questions

Confirm lift-and-coast, state of charge, regen, and motor map exist in the recording we already extract. If they are only in shared memory, this waits on the live adapter.
