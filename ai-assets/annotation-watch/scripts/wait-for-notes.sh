#!/usr/bin/env bash
# Block until the annotation inbox has open notes not yet seen, print them, record them as seen.
#   wait-for-notes.sh <origin> <seen-file> [max-seconds]
# stdout: one compact JSON object per new note. Exit 0 = new notes, 2 = timed out with none, 1 = inbox unreachable.
set -euo pipefail
origin=${1:?origin, e.g. http://localhost:3050}
seen=${2:?seen-file path}
max=${3:-3000}
interval=${ANNOTATION_POLL_SECONDS:-4}
touch "$seen"
deadline=$((SECONDS + max))
failures=0
while ((SECONDS < deadline)); do
  if body=$(curl -sf --max-time 5 "$origin/__annotations?status=open"); then
    failures=0
    new=$(jq -c --rawfile seen "$seen" '
      ($seen | split("\n") | map(select(length > 0))) as $known
      | .items[] | select(.inboxId as $id | $known | index($id) | not)
      | {inboxId, comment, target, url, elementPath, nearbyText, receivedAt}' <<<"$body")
    if [[ -n $new ]]; then
      jq -r .inboxId <<<"$new" >>"$seen"
      printf '%s\n' "$new"
      exit 0
    fi
  else
    ((++failures >= 15)) && { echo "inbox unreachable at $origin/__annotations" >&2; exit 1; }
  fi
  sleep "$interval"
done
exit 2
