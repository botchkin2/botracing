# Context events: flags, traffic, contact, track limits

Status: spark
Date: 2026-09-26
From: botkin (phone notes), filed by grok

Source: [2026-09-26-source-telemetry-feature-research.md](2026-09-26-source-telemetry-feature-research.md) sections 2.1–2.3 and 3.4.

## The idea

Tag why a lap was slow before calling it a driving mistake. Record blue flags, other cars, contact, track-limit steps, pit in and out, and safety car. Use those tags to split stint pace into clean air, traffic, yield, safety car, and in or out laps. The pace number is the clean-air median.

Blue flag: mark when it was shown and cleared, and the time lost against the driver's own clean lap, not against a ghost that was not yielding. iRacing has a session-flag bit. On LMU, confirm the flag exists; if it does not, infer from class, gap behind, and closing speed.

Other cars are a context channel, not a map widget. At a few samples a second, keep class, distance along the lap, lateral position, speed, pits, and place. From that: traffic nearby, clean-air percent, overtakes, and when the next class pack arrives.

Contact is a timeline, not a steward report. On an impact, store magnitude, where it hit, and the nearest cars. Mark the lap unusable as a reference. Look at pace after the hit.

## Why it might matter

An endurance "two tenths" is often a yield or a car ahead. Without the tag, every pace model is wrong. The notes say this layer has to exist before a corner-cost view or a pit planner is honest.

## Open questions

The recording we use today is the player car. Does it include the field, flags, and impact, or only the driving traces? Track-limit steps in the recording are not the same as the official penalty counter.
