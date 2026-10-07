# ops/alerts

Alerting for the two functions (pit wall thread 3 #10: the #274 hosting failure was found by accident).

| Watches                                   | How                                                                  | Fires when                          |
| ----------------------------------------- | -------------------------------------------------------------------- | ----------------------------------- |
| Server errors from `lmuApi`, `uploadApi`  | log-based metric `botracing_http_5xx` + alert policy                 | more than 5 in 5 minutes            |
| Auth failures (token expiry, a bad build) | log-based metric `botracing_http_401` + alert policy                 | more than 50 in 5 minutes           |
| The site being down or unreachable        | uptime checks on `/api/upload/me` and `/api/lmu/tracks`, every 5 min | no 2xx and no 401 from outside      |
| Spend                                     | budget on the project, mails billing admins                          | 50 %, 90 %, 100 % of 25 USD a month |

A 401 counts as "up" for the uptime check: an anonymous check from outside is expected to be refused, and a refusal proves the function is running and checking tokens. The limits and the budget are in `lib.mjs` (`CONFIG`); change them there.

## Turn it on (an owner of `botracing-61`, once)

```
gcloud auth login
gcloud services enable monitoring.googleapis.com logging.googleapis.com billingbudgets.googleapis.com --project=botracing-61
node ops/alerts/enable.mjs --email <where alerts go>            # dry run: reads what exists, prints what it would create
node ops/alerts/enable.mjs --email <where alerts go> --apply    # creates only what is missing
```

Options: `--budget <usd>`, `--host <hostname>` (defaults to `botracing-61.web.app`; use the real hosting domain if it differs), `--skip-budget`.

Safe to re-run: everything is matched by name and left alone if present. A part whose current state cannot be read is reported as `CANNOT TELL` and not created; the script then exits 1.

## Not covered

- Backups going stale: `node ops/backups/status.mjs` exits 1 when they do, but nothing runs it yet. Run it from a scheduled job and mail the result.
- The tray's heartbeat (a missing uploader) is not a function error and is not watched here.
- Error Reporting needs no setup: it groups the same logs once the functions log errors.

## Verified when this was written

- `node --test ops/alerts/alerts.test.mjs`: 10 pass (planning, dry run changes nothing, apply creates each thing once, a second run creates nothing, a failed read creates nothing).
- The dry run (`enable.mjs --email x@y.z`, no `--apply`) was run against the real project with read-only calls: it found no metrics, channel, policies or uptime checks yet, and reported the budget as `CANNOT TELL` because the Cloud Billing Budget API is not enabled on the project (the `gcloud services enable` line above fixes it).
- **Not verified:** `--apply` has not been run, so the exact accepted shapes of the alert policy, the uptime check (the 401 status code entry) and the budget are unproven against the live APIs. The first apply is the test; an API error in one part is reported and the other parts still run; a re-run picks up what failed.
