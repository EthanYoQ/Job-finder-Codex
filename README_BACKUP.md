# Sanofi transport and capture candidate backup

Source checkpoint: `4acb35abfe104e38caf9cc75204b73fead6ab6ef`, whose Git parent is `40141b32bafaef4f2585cad8caf11c6088546de3`. At the 2026-10-04 17:21 UTC status report it was frozen and checked, but not registered, freshly acquired or deployed.

This safe snapshot retains 858 original source/test/config files, plus this guide and `SOURCE_BACKUP.json`. Only four source files differ from the preceding producer backup: three implementation files and one synthetic test. Every included file's source path, Git blob, SHA-256, byte length and mode is recorded.

The change keeps the existing HTTP deadline and cancellation active while consuming Sanofi response bodies. Main-path responses can be retained individually before parser validation, preserving completed originals even when later processing fails. Existing transport policies remain represented in source. Actual captured responses and private acquisition outputs are not included in this backup.

Reported checks passed 57 targeted tests and targeted TypeScript validation. No complete suite, full-project typecheck, new acquisition success or production publication is claimed. Making this backup performs no tests or production operations.

The existing 46 tracked exclusions remain: raw/retained job-body and database/control evidence, internal operational/recovery notes and certificate material. Credentials, environment/private profiles, actual SQL payloads, generated dependencies/builds, runtime state, uncommitted files and local Git history are excluded.

Private saved-capture replay and retained-evidence tests still need separately authorized recovery of their inputs. The new HTTP capture tests use synthetic responses without network acquisition. Source code for retaining originals is included; those originals are not.

Workflow source is moved under `backup/disabled-workflows/`, with no active workflow. This backup branch does not merge or deploy. Its new commit identity cannot substitute for a registered runtime; a future runtime must be rebuilt and independently registered.

