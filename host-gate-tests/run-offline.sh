#!/usr/bin/env bash
set -euo pipefail
test_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
runtime_root="$(cd -- "$test_root/.." && pwd)"
node_binary="/workspace/scratch/5e9614251709/jb-incremental-proxy-runtime-20261007T0057Z/runtime/node-v22.23.3-linux-x64/bin/node"
export JOBFINDER_CLOUD_SOURCE_ID=source-gilead-china-social TSX_DISABLE_CACHE=1 NODE_DISABLE_COMPILE_CACHE=1 PYTHONDONTWRITEBYTECODE=1 GIT_OPTIONAL_LOCKS=0
if [[ "${1:-}" == "--restore-only" && "$#" == 1 ]]; then
  exec "$node_binary" --import "$runtime_root/producer/node_modules/tsx/dist/loader.mjs" "$runtime_root/recovery-tests/verify-restore-binder.mts"
fi
if [[ "$#" != 0 ]]; then
  echo "Usage: run-offline.sh [--restore-only]" >&2
  exit 2
fi
"$node_binary" --import "$runtime_root/producer/node_modules/tsx/dist/loader.mjs" "$test_root/verify-host-offline.mts"
"$node_binary" --import "$runtime_root/producer/node_modules/tsx/dist/loader.mjs" "$test_root/verify-owner-gates.mts"
"$node_binary" "$test_root/verify-starter-gates.mjs"
"$node_binary" "$test_root/verify-completion-gates.mjs"
