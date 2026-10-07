#!/usr/bin/env bash
set -euo pipefail
test_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
runtime_root="$(cd -- "$test_root/../.." && pwd)"
node_binary="/workspace/scratch/5e9614251709/jb-incremental-proxy-runtime-20261007T0057Z/runtime/node-v22.23.3-linux-x64/bin/node"
export JOBFINDER_CLOUD_SOURCE_ID=source-kelun-social TSX_DISABLE_CACHE=1 NODE_DISABLE_COMPILE_CACHE=1 PYTHONDONTWRITEBYTECODE=1 GIT_OPTIONAL_LOCKS=0
"$node_binary" --import "$runtime_root/producer/node_modules/tsx/dist/loader.mjs" --test "$test_root/owner.test.mjs"
