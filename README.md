# Collector source follow-up

Six unchanged source, patch, and synthetic-test files, 12,976 bytes. Source inventory SHA-256: `870e2dcef372fdddf43f4f6dab89e30b01a839adad722887d18d42b52adad8d9`. SOURCE_BACKUP.json is the file allowlist; verify SHA256SUMS before restoration.

Preserve the listed collector-fixes/ and diagnostics/ paths. Tests require Node.js built-in modules. The serialization test additionally imports the previously backed-up [list-readiness source](https://github.com/EthanYoQ/Job-finder-Codex/blob/edeccd08ee104fd2113b6a9b43479dd8f331f9d2/list-readiness-proposal.cjs), SHA-256 `f0cf3c5a3ffe9e4cedaffd19ea21cdaae93a6377db82bf2c1a9423fa72f72b31`; restore it at hosts46/jnj/diagnostics/jnj-delayed-scope-20261006T052730Z/list-readiness-proposal.cjs. That dependency is not duplicated here.

The collector and diagnostic wrapper need separately supplied browser/helper bindings. Actual calls, browser documents, capture inputs, responses, generated test results, configuration, and session state are excluded. This backup does not claim test execution or real collection success.
