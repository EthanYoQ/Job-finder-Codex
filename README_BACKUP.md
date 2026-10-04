# Combined public-web candidate backup

Source checkpoint: `f32aa10767665cd8ad68085705bdfe70e93b0c8e`, frozen at 2026-10-04 13:55 UTC. **Locally tested, not deployed at this cutoff.**

This source-only backup contains 961 unchanged source, asset, test and configuration files, plus this guide and `SOURCE_BACKUP.json`. The manifest records every included source path, Git blob, SHA-256, byte length and mode. The 17 changed files relative to the earlier reader backup are 9 application files and 8 tests; unchanged assets and source objects are reused.

## Source provenance and behavior

The actual Git parent is `62cf4cca99d4e4f42b64e464c01cfc39d7c14d29`. Bounded-refresh changes were integrated from `d565da9378044000fec845dd9edc35f38a894705`; that is change provenance, not a second Git parent. The preceding reader checkpoint is `43c53a6262e4c94c1fd84fbf8418d4a3064f01a6`.

This combines the Chinese Sanofi reader and narrow historical receipt pins with bounded follow-up reads for an explicitly UPDATING public snapshot and Server-Timing measurements. It preserves the prior prepared performance baseline and exact historical A88 verification behavior. Ordinary Sanofi A issuance remains disabled.

The restored baseline `6085e424957f6e1b06e2b2844d23d88994eb7ded` has source provenance `a789e0db617fcd204eca2101f4a6c5669a6c25da`; original historical Git ancestry was not recovered. This GitHub backup is a separate commit identity. Any later runtime must be rebuilt and independently registered in its deployment environment.

## Reported verification

The implementation passed 363 affected tests in 15 files: 321 in the combined run and 42 Sanofi cases rerun in their correct Node environment after the mixed-environment invocation failed those cases. Limited application-source TypeScript checking and the production frontend build passed. The reported build contained 171 static output files; generated output is rebuilt rather than uploaded here.

No complete test suite, full semantic TypeScript check or five-second browser acceptance is claimed. No tests, CI, source acquisition or deployment are initiated by making this backup.

## Recovery boundaries

The existing 33-file exclusion set is retained: real database/context/control fixtures, raw or retained capture evidence, internal operational/recovery notes and certificate material. Credentials, environment files, private profiles, generated dependencies/builds, local runtime identity files, uncommitted work and local Git history are excluded.

The historical public-context fixture remains private. Its 42 transition cases require separately authorized fixture recovery; other retained-evidence tests have the same limitation. Synthetic test code and necessary non-secret historical verification pins remain intact.

UI source, all fonts and logos, and their license/readme files are included unchanged. Workflow source is kept under `backup/disabled-workflows/`; there is no active workflow. This recovery branch is not automatically merged or deployed.

