# ops/backups

Backups of the lap store (pit wall thread 3 #5; thread 2 #140, #151, #167, #174, #176). Platform features, no second copy of the bucket.

| Protects                                    | How                                                      | Window                |
| ------------------------------------------- | -------------------------------------------------------- | --------------------- |
| A bad write or delete in Firestore          | point-in-time recovery (PITR)                            | 7 days, to the second |
| Losing the database                         | daily managed backup, restorable into a **new** database | 7 days                |
| Deleting the database by accident           | Firestore delete protection                              | until turned off      |
| A deleted or overwritten file in the bucket | bucket soft delete                                       | 7 days                |

Not covered, on purpose, for now: anything older than 7 days; the **project** (one compromised owner account or a deleted project loses data and backups together; a weekly export to a bucket in a separate project is on the roadmap, marshal #176.4); and the runtime's own permissions (the default service account has Editor and so can delete backups: the IAM split is its own PR after these are on).

## Turn it on (an owner of `botracing-61`, once)

```
gcloud auth login
node ops/backups/enable.mjs            # dry run: reads the state, prints the commands, changes nothing
node ops/backups/enable.mjs --apply    # runs only the steps that are not already in place
node ops/backups/status.mjs --sizes    # what is on, how old the newest backup is, bucket size by folder
```

Safe to re-run. A step whose current state could not be read is refused (a second backup schedule would double the cost); `--force` overrides. The first managed backup appears after the first scheduled run, up to a day later.

## Prove a restore (apex or Botkin, with Admin credentials)

```
gcloud auth application-default login
node ops/backups/restoreDrill.mjs            # newest backup -> scratch database -> counts -> delete the scratch
node ops/backups/restoreDrill.mjs --files    # also: write, delete, restore and read back one object under backup-drill/
```

Production is only read. The restored copy must hold at least what the live database says existed when the backup was taken (sessions last written before the snapshot, with their laps and recordings) and no more than live now, so uploads during the drill do not make it flake. Counts say "present", so it also **compares content**: up to five sessions nothing has written since the snapshot, and up to three laps of each, must be identical field for field in both databases (a PASS means restorable, not just present); with no such session it fails, because nothing was proven. `--files` checks that the restored object's bytes equal what was written. It exits 1 on any failure; `--keep` leaves the scratch database (it is billed: delete it).

## Check every day

`node ops/backups/status.mjs` exits 1 when PITR or delete protection is off, there is no daily schedule, the newest READY backup is older than 26 h, or soft delete is off. It only helps if something runs it and tells someone: run it from the monitoring check (thread 3 #10).

## Restoring (never over production: restore beside it, look, then copy back)

1. **A document or a few, as they were at a time (PITR).** Read at a past time without changing anything, then write back what you want:
   `gcloud firestore export gs://<scratch-bucket>/pitr --snapshot-time=<RFC 3339 time within 7 days> --collection-ids=laps` and import into a scratch database; or in Node, `db.runTransaction(fn, {readOnly: true, readTime: Timestamp})` with the Admin SDK. Only within the last 7 days.
2. **The whole database from a backup.** `gcloud firestore backups list --location=<location>`, then `gcloud firestore databases restore --source-backup=<name> --destination-database=<new id>`. The destination must be a new database; the app keeps reading `(default)`, so bring data back by copying documents from the restored database, not by switching the app to it.
3. **A file from soft delete.** `gcloud storage ls --soft-deleted gs://botracing-61-lmu/<path>` lists the generations; `gcloud storage restore gs://botracing-61-lmu/<path>#<generation>` brings one back. The uploader prunes and rewrites `field`, `slices` and `bands` files, so this is the normal way to undo that.

## What was not verified when this was written

The scripts have run only against fakes (`node --test ops/backups/backups.test.mjs`); nobody has run them against the project yet. The field names the readers expect from `gcloud ... --format=json`, the `--soft-deleted` and `storage restore` forms, whether `gcloud firestore databases restore` waits for the restore to finish, and the real cost are all to be confirmed by the first real run (`enable.mjs` without `--apply` and `status.mjs` change nothing and are the safe first steps).
