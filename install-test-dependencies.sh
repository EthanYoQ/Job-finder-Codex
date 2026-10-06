#!/usr/bin/env bash
set -euo pipefail
jnj_test_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
npm ci --prefix "$jnj_test_root/dependencies" --ignore-scripts --no-audit --no-fund \
  --registry=https://registry.npmjs.org --cache="$jnj_test_root/.npm-cache"
