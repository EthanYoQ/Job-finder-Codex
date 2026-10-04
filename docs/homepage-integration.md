# Responsive homepage integration

This branch integrates the public homepage that was live at source commit
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

The historic backend mode remains available when that setting is absent for
existing programmatic integrations. It does not support the full province/city
homepage contract. Deployment must select the portable policy explicitly; this
pull request does not change any running server or database.

The public reader and UI come from `a2bbb88`. Their shared collection and receipt
validation dependencies use the already registered producer-41 source
`b41a18415cfe8177740918b04c5139095d7abcc5` where it is newer. The necessary shared
source modules are included so the reader uses the same configuration hashes and
proof contracts. Unrelated collection command scripts and operational state are
not imported. The complete producer-41 source remains available on
`backup/producer41-20261004-0340`.

The unregistered performance/capture/Sanofi candidates are not part of this
integration. No credentials, environment files, database exports, captured
response bodies, or private operational state are added.

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
external-evidence integration command remains separate as before.

The workflow has read-only repository permissions and performs no image
publication or server deployment. The existing production-image workflow and its
branch triggers are unchanged.
