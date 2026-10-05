# Offline a775-based Sanofi-compatible fallback candidate

Original source commit: c754d92e98d964655abdca783d9ed1e52b19c3e3. Actual direct parent: a775d114668c466562660105ee52dc2306b6fdeb. At the 2026-10-05 17:07 UTC handoff this was an offline application fallback candidate, unregistered and undeployed. It did not replace protected port 3031 or change any running service.

It pairs with publisher 46beb14fcca2dd05854f45781abbc1b43da90ea1 on [the publisher backup branch](https://github.com/EthanYoQ/Job-finder-Codex/tree/backup/sanofi-paired-publisher-20261005-1700). The separate main Web candidate 7e5390495bc41b846d6a4a6d12a7f9061bbb745f is on [the main Web backup branch](https://github.com/EthanYoQ/Job-finder-Codex/tree/backup/sanofi-paired-web-20261005-1700).

## Compatibility and behavior

The same six reader source files are byte-identical to the main Web candidate. They enforce the same Chinese Sanofi receipt and independently persisted seven-field artifact commitments. All other runtime source preserves a775 behavior: readWithStatus has two arguments; even a warm cache waits for foreground version SQL and rejects query failure. Only an existing background rebuild may serve a cloned old verified projection immediately. Original barriers, per-request timing, retries and post-build checks remain. No e4cd nonblocking/HMAC correlation behavior was added.

Strictly pinned historical A88 remains valid only before a newer committed Chinese writer. A valid new B may display its CURRENT set; invalid/expired B or an unknown writer produces HOLD, without republishing old88. Arbitrary historical A or older Chinese B missing the new persisted commitments remain unsupported.

Original a775 and original 3031/db56 are still incompatible with the new B contract. This c754 application candidate addresses receipt compatibility only. It does not change or bypass deployment database-version, schema, build or routing checks. In particular it is not permission to overwrite 3031 or relax its rollback controller. Target environment verification and an authorized deployment decision remain separate.

## Reported verification and limits

The author reports 15 suites / 383 focused tests, a 24-root focused TypeScript check and a Vite build passing. Six new paired cases use the final publisher's two-job synthetic receipt alongside the historical fixture. All 171 build files reportedly match the original a775 target-dist manifest, including original logo/fonts/CSS/JS. Tests ran in groups, not full CI. The listener-based httpServer suite was not run; native response barriers used in-memory streams.

No database connection, SQL execution, official request, service/listener start, registration, deployment, mobile/browser visual or public performance acceptance was performed. No full repository test/typecheck success is claimed. This backup did not execute tests or source. These source commits and local build results are not registered production identities.

## Safe snapshot and recovery

The tree contains 970 exact source/test/config/asset files and two backup metadata files. Thirty-five tracked private or operational files remain excluded. The six reader source blobs and most changed tests reuse the already verified main-pair objects. Necessary fonts, logos and licenses are retained.

The self-authored contract fixture has only two invented jobs, short synthetic HTML and test-only bindings. Real historical88 database/control data, captured-page gzip fixtures, original job bodies, actual SQL/request/response evidence, operation/proof notes and user authorization text, credentials/environments, runtime identities, generated dependencies/builds, uncommitted files and original Git history are excluded. The six new paired cases and historical tests need the separately excluded historical88 fixture; they cannot all run from this safe tree alone.

Workflow source is relocated under backup/disabled-workflows. This independent branch performs no CI, merge, default-branch update or deployment. A compatible candidate is not an approved or verified live rollback.
