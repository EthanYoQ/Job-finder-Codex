#!/bin/bash
set -euo pipefail
[[ ${1:-} =~ ^[0-9]{13}$ ]] || exit 2
[[ $# -le 2 ]] || exit 2
[[ -z ${2:-} || $2 =~ ^[a-f0-9]{32}$ ]] || exit 2
cd "/data/job-finder/app"
exec 9>"/data/job-finder/round.lock"
flock -n 9 || exit 75
# The DB lease fences writes too; this lock also avoids duplicate browser processes.
receipt="/data/job-finder/snapshots/latest.json"
if [[ -n ${2:-} ]]; then
  receipt="/data/job-finder/snapshots/round-$2.json"
fi
if ./bin/node -e '
const fs=require("fs"),path=require("path");
const [receipt,slot,roundId,latest]=process.argv.slice(1);
const matches=r=>r.slot===slot&&(roundId?r.roundId===roundId:r.complete);
try {
  let bytes;
  try { bytes=fs.readFileSync(receipt); }
  catch(error) {
    if(error.code!=="ENOENT"||!roundId)throw error;
    bytes=fs.readFileSync(latest);
    if(!matches(JSON.parse(bytes)))process.exit(1);
    const temporary=receipt+"."+process.pid+".tmp";
    try {
      const fd=fs.openSync(temporary,"wx",0o600);
      try {fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);} finally {fs.closeSync(fd);}
      fs.renameSync(temporary,receipt);
      if(process.platform!=="win32") {
        const directory=fs.openSync(path.dirname(receipt),"r");
        try {fs.fsyncSync(directory);} finally {fs.closeSync(directory);}
      }
    } finally {fs.rmSync(temporary,{force:true});}
  }
  process.exit(matches(JSON.parse(bytes))?0:roundId?2:1);
} catch(error) {process.exit(roundId&&error.code!=="ENOENT"?2:1);}
' "$receipt" "$1" "${2:-}" "/data/job-finder/snapshots/latest.json"; then
  cat "$receipt"
  exit 0
else
  receipt_status=$?
  [[ $receipt_status -eq 1 ]] || exit "$receipt_status"
fi
export JOBFINDER_SLOT="$1"
if [[ -n ${2:-} ]]; then export JOBFINDER_ROUND_ID="$2"; else unset JOBFINDER_ROUND_ID; fi
exec ./bin/node --env-file="/data/job-finder/postgres.env" --env-file="/data/job-finder/runtime.env" --import tsx pipeline/run-round.ts
