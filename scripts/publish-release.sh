#!/usr/bin/env bash
# Publishes a laid-out release to Storage, for a release workflow's last step:
#
#   scripts/publish-release.sh <kind> <version> <dir>
#
# uploads <dir>/<kind>/<version>/* to <kind>/<version>/ and then
# <dir>/<kind>/latest.json to <kind>/latest.json, in gs://botracing-61-lmu,
# with the token of the gcloud account the job signed in as (google-github-
# actions/auth). Used by tray-release.yml and android-release.yml; the rules:
#
# A published version is immutable: users may already have it, so a fix is a
# new version. The files first, latest.json last: a half-finished upload never
# points the function at a missing file.
#
# One JSON API upload per object, by its full name. The release account can
# only touch <kind>/ (an IAM condition), so nothing may list: `gcloud storage
# cp` resolves its destination and `--no-clobber` checks it by listing, which
# failed tray-v0.1.0's publish. `ifGenerationMatch=0` makes Storage itself
# refuse (412) to replace an existing object, so no pre-check is needed.
# latest.json is the one object that is replaced each release.
set -euo pipefail
kind="$1"
version="$2"
dir="$3"
bucket="botracing-61-lmu"

token="$(gcloud auth print-access-token)"
echo "::add-mask::$token"
out="$(mktemp)"
upload() { # <file> <object name> <content type> [create-only]
  local extra=()
  [ "${4:-}" = create-only ] && extra=(--url-query "ifGenerationMatch=0")
  code="$(curl -sS -o "$out" -w '%{http_code}' -X POST \
    -H "Authorization: Bearer $token" -H "Content-Type: $3" \
    --data-binary @"$1" \
    --url-query "uploadType=media" --url-query "name=$2" "${extra[@]}" \
    "https://storage.googleapis.com/upload/storage/v1/b/$bucket/o")"
  if [ "$code" = 412 ]; then
    echo "$2 already exists: a published version is never overwritten" >&2
    exit 1
  fi
  if [ "$code" != 200 ]; then
    echo "uploading $2 failed ($code):" >&2
    head -c 400 "$out" >&2
    exit 1
  fi
  echo "uploaded $2"
}

files=("$dir/$kind/$version"/*)
[ -e "${files[0]}" ] || { echo "nothing under $dir/$kind/$version" >&2; exit 1; }
[ -f "$dir/$kind/latest.json" ] || { echo "no $dir/$kind/latest.json" >&2; exit 1; }
for f in "${files[@]}"; do
  upload "$f" "$kind/$version/$(basename "$f")" application/octet-stream create-only
done
upload "$dir/$kind/latest.json" "$kind/latest.json" application/json
