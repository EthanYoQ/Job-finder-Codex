# Incremental reader legacy replay source

This preserves five fixed offline replay and read-only export source files. The export adds the already-existing sourceJobId and listUrl columns; it does not create or migrate them. It uses a READ ONLY transaction with a 5-second statement timeout and 1-second lock timeout. The adapter requires its exact input hash and actual selected fields; it does not fill the missing fields in an older input.

The application increment is separate: [a47ed7f](https://github.com/EthanYoQ/Job-finder-Codex/tree/a47ed7feeb93e99d45633795cb5fecebc8c0818f) and its declared main/fallback baselines. The a775 source and Node22/Prisma recovery requirements are preserved in the earlier [reader replay backup](https://github.com/EthanYoQ/Job-finder-Codex/tree/2cabd430c3b8f0314f0d6c0459c05ca1450d3fb4). These source snapshots do not recreate the original full Git or runtime identity.

## Required recovery inputs

- Restore the three matching reader trees, Node 22.19.0, locked dependencies/tsx and genuine generated Prisma Client. The fixed runner expects specific sibling directory names and Git metadata; review its ROOT/BASE/PRIOR/INC paths before use
- Python with datetime.fromisoformat support, Linux, ctypes/libseccomp and support for the specified inherited kernel filter are required by run-replay.py. The two CJS guards are unchanged source from the earlier replay
- The exact refreshed private input, old private input, original a775 projection and trusted BEFORE_INTEGRITY.json are required but deliberately absent. Recreate the directory layout, logs/tmp/task-home and independently verified integrity prerequisites; do not invent missing inputs or silently replace the recorded source identity
- This snapshot has no actual job rows or comparison output. GitHub alone cannot restore the input data or independently replay this fixed case

The runner rejects existing comparison outputs and checks the three complete projections, job IDs and original timestamps. The input and private comparison artifacts remain subject to separate authorization and safety review. Output filenames containing SAFE are not a permission to publish their contents.

This backup did not run the program, tests, query or security filter. It is not proof of migration/concurrency acceptance, full-site CI, registered runtime identity or deployment readiness. Actual snapshots, projections, integrity records, logs, reports, query responses, installed dependencies and credentials are excluded.
