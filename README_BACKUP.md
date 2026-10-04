# Public-web response candidate source backup

Source checkpoint: `065892ee7951f1c6b1cc2c7ef2d4f3b3dbe26003`, at the 2026-10-04 15:55 UTC cutoff. It extends the previously backed-up `f32aa10767665cd8ad68085705bdfe70e93b0c8e` source. This candidate was not deployed at the cutoff.

965 unchanged source, UI asset, test and configuration files are included, plus this guide and `SOURCE_BACKUP.json`. Twelve source paths differ from the previous web backup. Shared Sanofi changes reuse the identical reviewed producer-candidate objects. Every included path, mode, byte length, Git blob and SHA-256 is recorded.

The candidate delays background refresh until the HTTP response finishes, adds lossless gzip and ETag handling for eligible static responses with bounded immutable-cache rules, and includes the same Chinese Sanofi encoding reader. Existing UI/font/logo/license source assets are retained.

The reported affected checks passed 181 cases, including one local private-capture replay. The frontend build produced 171 static output files byte-identical to the f32 build. Generated output is rebuilt from source rather than uploaded. Full-project TypeScript checking is not green because of known baseline test-type errors; no complete suite or production qualification is claimed. The temporary combined-test import issue was fixed in this frozen commit.

34 tracked non-source/evidence files are excluded, including actual historical database/context/control fixtures, raw or retained capture/JD material and internal recovery notes. Credentials, environment/private profiles, generated dependencies/builds, runtime state, uncommitted files and local Git history are excluded.

The 42 historical public-transition cases require the separately restored private database-context fixture. The optional saved-capture replay requires private capture directories supplied via `SANOFI_MAIN_CAPTURE_DIR` and `SANOFI_INDEPENDENT_CAPTURE_DIR`; originals are not included. Other retained-evidence tests have the same recovery boundary. Necessary non-secret historical verification pins and synthetic test code remain intact.

Workflow source is placed under `backup/disabled-workflows/`; no automatic CI, merge or deployment runs. This backup has its own commit identity and cannot reuse a runtime registration. A future deployment must rebuild and verify its identity independently.

