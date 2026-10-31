#!/bin/bash
set -euo pipefail
[[ ${1:-} =~ ^[0-9]{13}$ ]] || exit 2
cd /data/job-finder/app
exec 9>/data/job-finder/round.lock
flock -n 9 || exit 75
# The DB lease fences writes too; this lock also avoids duplicate browser processes.
if ./bin/node -e 'const fs=require("fs");try{const r=JSON.parse(fs.readFileSync(process.argv[1]));process.exit(r.slot===process.argv[2]&&r.complete?0:1)}catch{process.exit(1)}' /data/job-finder/snapshots/latest.json "$1"; then
  cat /data/job-finder/snapshots/latest.json
  exit 0
fi
export JOBFINDER_SLOT="$1"
exec ./bin/node --env-file=/data/job-finder/postgres.env --env-file=/data/job-finder/runtime.env --import tsx pipeline/run-round.ts
