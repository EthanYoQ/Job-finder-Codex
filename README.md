# Owner helper source fixes

This snapshot preserves seven frozen Python, patch, and synthetic-test files (73,339 bytes). The source manifest SHA-256 is `ac8c29a85e7b632332d83f0e0819a1ce727722cd691c27be3f756312d9afc71f`. Verify SHA256SUMS before restoration.

Keep `owner-guard-review/` and `observation-fix-review/` as sibling directories. The latter test module reads its candidate and baseline, plus `../owner-guard-review/owner-ali-call.original.py`. The guard candidate and observation baseline are intentionally identical.

The synthetic tests require Python 3.8+ with its standard library, Linux `/proc`, and POSIX process/signal support. Use normal Python with assertions enabled: no `-O`, `-OO`, or `PYTHONOPTIMIZE`. Source checks depend on assertions. The tests use isolated temporary fixtures; the temporary directory must support executable scripts, hard links, and directory fsync. No test execution is claimed by this backup.

External runtime inputs and the CLI are not supplied. Fixed source bindings require deliberate review when adapting the helper. Credentials, environment/profile files, actual invocation ledgers, requests, responses, and operational reports are excluded.
