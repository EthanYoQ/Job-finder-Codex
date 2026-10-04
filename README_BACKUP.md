# Nonblocking verified-cache candidate backup

Source checkpoint: `3e41e8975027e8bd7a5cff6fd8859f59ef6843eb`, directly based on `065892ee7951f1c6b1cc2c7ef2d4f3b3dbe26003`. At the 2026-10-04 18:34 UTC report this was an independently reviewed local candidate, not deployed or build-verified.

This safe snapshot contains 967 original source, asset, test and configuration files, plus this guide and `SOURCE_BACKUP.json`. Fourteen source/test paths changed: eight product files and six tests. All included source paths, original Git blobs, SHA-256 values, byte lengths and modes are recorded.

## Behavior and boundaries

HTTP reads with an already fully verified cached projection can return its real old display and timestamps immediately. A bounded version check starts after the fixed response group finishes; successful validation atomically replaces the projection when needed. Internal strict reads, startup validation, database eligibility and publication rules remain unchanged. Failed HTTP background checks retain the real old display with FAILED status.

Follow-up reads use a short-lived, process-local signed correlation containing only a sequence and expiry. It grants no data access, creates no persistent credential or per-user table, and saves no key to files or environment. Only the code is included; no generated signing material exists in the backup. The 60-second lifetime is for correlation, not cache freshness. Follow-up requests retain the existing five-second interval, five-attempt cap and 30-second total budget.

Invalid or old-process correlations fail closed without restarting database work. A single active task and bounded response groups prevent unbounded work. Multiple-instance routing must keep a follow-up on the same reader process; this candidate does not introduce shared state.

This is a separate 065-derived candidate. The a775 request-timing patch is not included and must not be silently overwritten by treating this as its successor.

## Verification and recovery

Reported verification passed 161 focused tests and application-source TypeScript checking; independent review had no remaining blocker. Full-project typechecking still has seven unchanged test errors. The full suite, Vite build, production load and public-browser timing acceptance were not run. The changed frontend is therefore not claimed to be deployment-ready.

The same 34 tracked exclusions remain: real database/context/control fixtures, raw or retained job-body evidence and internal recovery notes. Real public-response/benchmark payloads, private signing material, credentials, environment/private profiles, generated builds/dependencies, runtime state and identity, uncommitted files, proof reports and local Git history are excluded.

Dependent historical and private-capture tests need separately authorized recovery of their excluded inputs. Existing UI assets, fonts, logos, license/readme files and non-secret verification pins are retained unchanged.

Workflow source is stored under `backup/disabled-workflows/`; the branch does not run CI, merge or deploy. Its commit identity is separate from any runtime and requires independent build verification and registration.

