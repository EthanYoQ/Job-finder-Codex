Single-run backup helper load reuse

Parent external0325 c013de32be9067012d827ae4a5c2e1fb455c4df4; native117 unchanged. Only run-original-functions.js changes. The helper has no module-level mutable state. All source/run/requestIds and upload stage/fileId remain call-local. Cache only a successfully loaded function, not its invocation or rejected promise. First load failure remains eligible for the next source, preserving current behavior. The variable belongs to one AsyncFunction entry invocation and is absent in Functions persistent store.

Tradeoff: a helper file replaced during an active loop would no longer be reloaded. Existing operational boundary already freezes module files during a loop. New run always reads current bytes. Actual17-success loop avoids16 exec reads and46,208 bytes of tool output; one-success/zero-success runs add no reads. No source binding, packet/hash validation, upload, download, or per-source backup changes.

Inline isolated checks: syntax, two distinct source arguments, one successful load, failed first read followed by second load. No new test file/framework and no business tools called. Production remains inactive; actual next scheduled run remains acceptance boundary.
