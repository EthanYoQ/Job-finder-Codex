#!/usr/bin/env bash
# Offline reconstruction from a separately obtained, verified official archive.
# Run in this support directory. Never starts a postmaster or binds a socket.
set -euo pipefail
archive=$(realpath "${1:?Pass postgresql-17.5.tar.bz2}")
support_root=$(pwd -P)
expected=fcb7ab38e23b264d1902cb25e6adafb4525a6ebcbd015434aeef9eda80f528d8
actual=$(sha256sum "$archive")
test "${actual%% *}" = "$expected"
test ! -e source-base
test ! -e source-crypto
test ! -e install
mkdir source-base source-crypto logs
tar -xjf "$archive" --strip-components=1 -C source-base
tar -xjf "$archive" --strip-components=1 -C source-crypto
(
 cd source-base
 ./configure --prefix="$support_root/install" --without-readline --without-icu
 make -j2
 make install
) > logs/rebuild-base.log 2>&1
(
 cd source-crypto
 ./configure --prefix="$support_root/install" --without-readline --without-icu --with-openssl
 make -C src/backend generated-headers
 make -C contrib/pgcrypto -j1
 make -C contrib/pgcrypto install
) > logs/rebuild-pgcrypto.log 2>&1
node test-native-adapter.mjs
