# Responsive homepage integration

This branch integrates the registered producer-41 collection source together with
the public homepage that was live at source commit
`a2bbb88dd4817da17493a62f9f530d2fb7dece9a` on 2026-10-04. It preserves the
responsive desktop/mobile layouts, consent gate, province and city filters,
company directory, feedback forms, and all 159 original logo/font assets.

The integration is based on the repository's `human-verified-code` commit
`75c202067052f332530c1a10c6291315541539b3`. It is a normal descendant of that
branch, not a replacement with the isolated backup history.

## Runtime contract

The full province/city interface uses the verified portable public snapshot.
Start the web server with the existing production setting
`JOBFINDER_PUBLICATION_POLICY=PLAN_BOUND_SOURCE_QUALITY_V1` and the matching
database. The reader validates source configuration, publication receipts,
lifecycle membership and freshness before displaying jobs. It does not initiate
crawls. Search facets and counts describe the published set, including explicitly
unresolved city locations, rather than invented or static counts.

For the Docker stack, combine `ops/docker-compose.yml` with
`ops/docker-compose.portable-public.yml`. The override passes that public-reader
policy to the web container without placing credentials in a configuration file.
Keep the existing database and credential configuration outside this repository.

The historic backend mode remains available when that setting is absent for
existing programmatic integrations. It does not support the full province/city
homepage contract. Deployment must select the portable policy explicitly; this
pull request does not change any running server or database.

The public reader and UI come from `a2bbb88`. Their shared collection and receipt
validation dependencies use the already registered producer-41 source
`b41a18415cfe8177740918b04c5139095d7abcc5` where it is newer. Collection commands,
scheduling and publication code, migration source, and relevant tests are included
alongside the reader so both sides use the same configuration hashes and proof
contracts. Operational state is not imported. The producer-41 source checkpoint
also remains available on
`backup/producer41-20261004-0340`.

The unregistered performance/capture/Sanofi candidates are not part of this
integration. No credentials, environment files, database exports, captured
response bodies, or private operational state are added.

An integration build has its own commit and runtime identity. Restoring or later
deploying it requires the normal build registration; it cannot reuse the original
producer-41 registration just because its source began at that checkpoint.

## Assets and verification

Vite copies `public/` into `dist/`. Docker build context, source identity and Git
provenance include these public assets. Font and image bytes are therefore
covered by the same build attestation as application source. The HTTP server
serves PNG, WebP and WOFF2 with their proper content types. The admin application
keeps its existing styles in a separate bundle.

`Homepage CI` checks locked installation, Prisma client generation, TypeScript,
the complete existing default test command, production build, and equality of
every public asset with the build output. Additional regression coverage includes
province/city discovery, consent and retry flows, cache refresh behavior, source
receipt validation, logo identities, and font tamper detection. The existing
external-evidence integration command remains separate as before. Default
regressions use invented rows and minimized identity cases rather than archived
job bodies. BI tests retrieve the official byte-pinned script from its public
URL and fail if that source is unavailable or its verified bytes change.

The workflow has read-only repository permissions and performs no image
publication or server deployment. The production-image workflow keeps its existing branch triggers and publication
guards; its two temporary-runner database migrations use the reviewed producer-41
ops-migrate command.

CI integration also fixes current-registry synchronization without changing the
frozen launch membership, and keeps diagnostic sessions bounded to 15 reviewed
sources even as the full catalog grows. Docker provenance uses a native filtered
Git bundle containing the original commit/tree objects and every current attested
blob. Unrelated historical blobs are omitted; the verifier disables network and
alternate-object access and retains the existing byte, mode and tamper checks.
