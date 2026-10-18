# Source-scope selftests off the publication hot path

Inactive two-file delta based on module 413569e0a2e52afcff099277f8ab73777728c97c (1251) and native111 c44ff2790fa9e5e9edd51d04be116b2da356eca2. No active files were changed.

Only the Biogen and Hengrui artificial scopeNegativeTests loops and their nested report fields change. The existing explicit packet-only-sql-selftest entry already passes sqlNegativeTests=true. These two loops now use that same explicit offline-only option. No entry, scheduler option, helper, framework, source route, deadline, or binding was added or changed.

Normal source review continues to check actual strict total/scope evidence, actual evidence/job digests, original raw rows and ID sets, original HTTP diagnostics, exact SQL, current identity, and original deadlines. It omits scopeNegativeTests because those five artificial cases did not run. The existing explicit offline entry runs the original five cases and reports their actual results, alongside its original six SQL cases.

Verification uses the existing real Hengrui 2026-10-18 06:11 batch. The retained comparison script executes the original archive-byte checks and original Moka archive replay, confirms actual strict scope and evidence/job digests, and compares raw source rows with the saved report. It then executes the old, new default, and explicit offline artificial-test sections and the actual report expressions. Old and offline reports equal the saved report. The default report differs only by omitting scopeNegativeTests. Artificial clone/strict-check/digest calls are 5/5/5 before, 0/0/0 by default, and 5/5/5 offline; real evidence remains unchanged.

Both file diffs were mechanically limited to that gating and conditional report field. All real validations and the original five case bodies were confirmed unchanged. TypeScript syntax and diff whitespace checks passed. No framework or extra persistent test entry was added.

Biogen has no available real packet. Its five original cases are retained byte-for-byte, but this batch does not claim actual Biogen negative-case or source validation. The historical Hengrui check does not assert current release identity or deadline validity. No live capture, SQL execution, database write, network request, activation, or scheduled end-to-end run occurred.
