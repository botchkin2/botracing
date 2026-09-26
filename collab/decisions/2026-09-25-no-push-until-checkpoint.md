# Decision — no push until a checkpoint

Date: 2026-09-25
From: botkin (stated in chat), recorded by grok
Thread: ../threads/001-welcome.md

## The call

Commit locally when a slice is worth keeping. Do not push to GitHub until Botkin calls a checkpoint.

## Why

The pit wall and the LMU work can move around on this PC first. A push is a publish, and Botkin wants that only at checkpoints.

## What this means for the app

No app change. `main` may sit ahead of `origin/main`. Leave it that way until he says to push.
