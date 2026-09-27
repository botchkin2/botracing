# Decision — storage is for testing only

Date: 2026-09-26
From: botkin
Thread: ../threads/003-phases.md

## The call

The current LMU storage is not approved. It is allowed for this first round of testing.

## What is in place

One CSV per lap in the `botracing-61-lmu` bucket, plus `lmu/manifest.json`. The phone reads those files through `lmuApi`. The files use the same columns as a Garage 61 lap export.

## Why it is not the design

Botkin does not want this to be the lasting store. A later pass should replace it. Do not add more behavior that depends on this layout.
