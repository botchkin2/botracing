# Data model: app data and user data

Every piece of stored data is one of two kinds. Code that does not fit one of
them is a bug (pit-wall thread 54, #2457). STORAGE.md has the paths and file
formats; this file has who owns what and who may write it.

## The two kinds

**User data** belongs to one signed-in person. It is keyed by their Firebase
uid, nothing else: no alias, no owner key, no shared default. Only that user
reads it. Only that user writes it, and only through the upload API with their
token (the tray). Deleting a user deletes all of it.

**App data** is shared by every user: what a track is, not what anyone drove
there. It is curated by admin tools with Admin credentials, read by everyone,
written by no user. It never holds a uid, an owner field or a session id: it
is derived from sessions, but once built it stands on its own, and a user's
data can be deleted without touching it.

A user's sync never writes app data. An admin tool never writes user data.

## Where each lives

| Data | Kind | Firestore | Bucket (`botracing-61-lmu`) | Written by |
|---|---|---|---|---|
| Sessions, laps, recordings | user | `sessions`, `laps`, `recordings`, field `ownerId = uid` | | upload API |
| Traces, slices, bands, field | user | path in the session/lap doc | `traces/{uid}/`, `slices/{uid}/`, `bands/{uid}/`, `field/{uid}/` | upload API (signed URL) |
| Raw recordings archive | user | | `archive/{uid}/{sim}/` | upload API |
| Uploader heartbeats | user | `uploaders/{uid}__{hostId}` | | upload API |
| Profile and usage | user | `users/{uid}` | | upload API (usage), sign-in |
| Tracks: identity, length, georef, corner map | app | `tracks/{trackId}` | `trackmaps/{trackId}/` | curate, track-fit |
| Section boundaries | app | `trackBoundaries/{trackId}` | | curate |
| Track surface | app | `tracks/{trackId}.surface` | `surface/{trackId}/` | curate (rebuild) |
| Track catalog (names, places) | app | | bundled: `tools/track-info/tracks.json` | PR |

## Rules that follow

- **Owner = uid.** A read or write resolves the owner from the token's uid and
  nothing else. There is no mapping table and no legacy owner.
- **Ids can't collide across users.** Session, lap and recording ids are
  derived from the uid plus the recording, so two users never share an id. A
  write naming an id another user owns is refused.
- **References stay inside one owner.** A lap's `sessionId` must name a session
  of the same owner. A session's `trackId` must name an existing track, or be
  null until a curator places it.
- **App data is rebuilt, not folded.** A curator builds a track's boundaries or
  surface from a named set of sessions, from scratch, and stores only the
  result. Running it twice on the same set gives the same result. Nothing
  records which sessions it came from.
- **Reading across users is admin-only and aggregate.** Curation may count or
  measure sessions on a track across users; no user-facing read ever does.
- **Every user write is bounded.** Per-user caps on documents, bytes, files and
  uploader hosts, counted in `users/{uid}.usage`.
- **Clients never touch the stores directly.** Firestore and Storage rules deny
  everything; the functions are the only way in.

## Local files on the user's PC

These are user data that never leave the PC except through an upload. They
live in the tray's profile folder (`%LOCALAPPDATA%\BotRacing`), not in a
folder shared by every tool on the machine: the sync's own state (`sessions\`),
the token, settings and status. The game's telemetry folder and the recorder's
captures are read in place. Nothing deletes captures today; a disk cap comes
with the bundled recorder.
