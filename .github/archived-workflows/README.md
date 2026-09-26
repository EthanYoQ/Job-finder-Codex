# Archived cloud qualification workflow

The owner requested that GEO and JobFinder automatic tasks stop consuming Actions minutes. The default branch was already cleared; this branch still carried a push-triggered production build that could be reintroduced by a merge.

On 2026-09-07, `production-image.yml` was moved here without changing its bytes (Git blob `2bc753e5af67629e0e80e749e4b517e91f32b2da`). GitHub Actions does not execute files in this directory. Do not restore it to `.github/workflows/` or dispatch/re-run its historical runs without explicit approval for a cloud qualification.

This is a scheduling change, not a passed qualification. All image, runtime, security, same-SHA, and round-one/round-two validation steps remain in the archived file. Restoring cloud qualification requires restoring the intended workflow and running every existing gate; a skipped or missing run is not release evidence. Business source, deployed services, Actions artifacts, logs, and prior receipts were not modified by this change.
