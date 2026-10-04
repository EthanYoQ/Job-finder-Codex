# Public request-timing candidate backup

Source checkpoint: `a775d114668c466562660105ee52dc2306b6fdeb`, directly based on `065892ee7951f1c6b1cc2c7ef2d4f3b3dbe26003`. At the 2026-10-04 17:43 UTC status report this was a frozen diagnostic candidate, not deployed.

This source-only backup includes 965 original source, asset, test and configuration files plus this guide and `SOURCE_BACKUP.json`. Seven existing paths changed: four runtime files and three tests. Their exact original Git blobs, byte lengths, SHA-256 values and modes are retained. Other source and all existing UI/font/logo/license assets are reused unchanged.

The change reports finite numerical Server-Timing phases from a fixed allowlist, separating request-owned read/SQL/projection/encoding work from waiting or cloning by a joining request. It adds measurement without exposing SQL text or identifiers through timing descriptions.

Reported verification passed 116 focused tests in six files. Typechecking still reports seven unchanged pre-existing test errors and is not a pass. The four changed runtime file hashes were independently checked against the delivery manifest and their base hashes. No full suite, live production requests or frontend changes were reported.

The same 34 tracked files remain excluded: actual database/context/control fixtures, raw or retained body evidence, internal operation/recovery notes and certificate material. Credentials, environment/private profiles, generated dependencies/builds, runtime identities/state, uncommitted files, delivery reports and local Git history are excluded.

Historical-transition tests and optional private saved-capture replay still require separately authorized recovery of their excluded inputs. Necessary non-secret receipt pins and synthetic test source remain included.

Workflow source is relocated under `backup/disabled-workflows/`; the branch does not automatically run CI, merge or deploy. The backup commit is a separate identity and cannot substitute for a registered runtime. Any later deployment must rebuild and verify its own identity.

