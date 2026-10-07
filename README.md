# Continuous publication and monitor owner source snapshot

This snapshot preserves seven exact frozen source, synthetic-test and baseline-hash files. It does not establish an application/runtime identity, a deployment, or a completed publication. Original review, test output and live diagnostic/terminal receipts are excluded.

Keep the files and tests directory together. The JavaScript entry files are functions.exec AsyncFunction bodies, not standalone Node programs. They require the existing injected tools/load/store environment, pinned host helper/stage/monitor code, producer 28402a299bb04cbf5873da66c2fe8ca76827c0d1 and its Node/runtime dependencies. Baseline-manifest.json records 45 host source files; SOURCE_BACKUP.json maps them to prior immutable source backups. Those host files are dependencies, not duplicated in this snapshot.

The existing source loader and actual authorized candidate/configuration, original session/run/request/review and current state bindings are also required. None of those operational bindings or actual SQL requests, responses, raw captures, credentials or logs is included. Exact absolute paths remain in the originals. build-fragments.py requires Python 3 and writes entry fragments using its current directory and source hashes; regenerating them after relocation changes bytes and is a new adaptation, not restoration of the original frozen fragments. Python assertion checks in the preload must remain enabled.

The owner awaits the original PUBLISH dispatch and the existing monitor in one lifetime. Resume is monitor-only. Durable dispatch exclusivity, request expiry, official SQL connector behavior and outcome handling remain dependencies of the unchanged host code. A yielded active call must be continued through its original execution session. This archive does not authorize invoking a publication or a retry.

Terminal evidence readback accepts exact serialized JSON or that JSON followed by one LF, without arbitrary trimming. A validated process terminal is separate from publication reconciliation: the source returns publicationReconciled:false. No successful capture, publication or public acceptance result is asserted here.

The fixture under tests is synthetic. Tests require the separately restored baseline host sources and their expected layout; they are not standalone. Backup verification was limited to static source review, exact hashes, the generator's literal/template relationship and matching prior-source hashes. The source and tests were not executed for this backup.
