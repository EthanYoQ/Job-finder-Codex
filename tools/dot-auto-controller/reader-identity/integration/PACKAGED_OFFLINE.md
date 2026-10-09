# Reproduce the optional HTTP adapter check from this package

Run from `tools/dot-auto-controller`, after the offline dependency preparation in the top-level README. The commands create disposable copies; neither the application nor the frozen reader capsules are edited. The verifier emits an in-process request event and never starts a listener.

```sh
work=$(mktemp -d)
for role in main fallback; do
  cp -R "vendor/reader-$role" "$work/$role"
  cp reader-identity/web-module/src/server/readerIdentity.mjs "$work/$role/src/server/"
  cp reader-identity/web-module/src/server/readerIdentity.d.mts "$work/$role/src/server/"
  patch --directory "$work/$role" -p1 < "reader-identity/integration/$role-httpServer.patch"
  ln -s "$PWD/vendor/c60-source/node_modules" "$work/$role/node_modules"
  node --max-old-space-size=384 --require ./test/no-network.cjs --import tsx \
    reader-identity/integration/verify-http-integration.mjs "$work/$role"
done
```

The base entrypoint hashes and provenance are in `BASES.json`. A patch conflict is a blocker; do not force it onto a different deployed source. This checks adapter behavior only, not a deployed endpoint, secure startup, database access, or permission to activate either service.

The regular package suite runs `reader-identity/integration/verify-client-contract.mjs .` automatically and requires no patched server or listener.
