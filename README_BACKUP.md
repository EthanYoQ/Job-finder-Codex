# Four original PORTABLE C46 hosts and public-read transport helper

This source-only backup contains the restored Astellas, Grifols, BMS and Biogen external hosts, shared preparation/check source, and `observation/read-public-v2.py`. It does not contain a registered runtime image, change producer source, deploy services or run CI.

## Version cutoff and reported checks

The four-host delivery was frozen at 2026-10-05 22:18:04 UTC. At the publisher's 22:22 UTC handoff none of the four new hosts had launched. Astellas was expected to become naturally due at 22:23:14.492 UTC; this archive does not infer a later start or success from that schedule. No live run or capture directory was inspected for the backup.

The publisher reports 15 local synthetic checks per source, with the 48-migration schema, matching registered C46 identity, formal lock and 12-hour observation-due gates checked. It also reports the original external-host66 package's 57 manifest hash/length entries matched. These are preparation checks, not fresh capture, database publication, full CI or public acceptance. This backup independently checked the selected frozen source hashes and reviewed the selected bytes; it did not execute source or tests.

The producer source is still `fb0b8e3b708d4f57cae09b465fb1c9ceddf7ad8d`, with the separately registered regular C46 runtime. The backup Git commit is an archive identity, not the source producer Git identity or registered runtime hash. The four hosts and this v2 observer were not included in code82 at handoff.

## Preserved host contract

Each host retains its original PORTABLE route, 256 MiB heap setting, exact source/config binding, official entrypoint and source-specific namespace. The adaptation updates local paths and C46 bindings, scopes loaders per source, disables compilation caches, checks that batch IDs are strings, clears stale batch input, and renames the inherited context-read filename without changing its contract.

A real launch still requires a fresh database observation matching its successful source tuple, 12 hours since that observation, the correct registered candidate, a free formal lock and exclusive publisher ownership. Bootstrap freshness remains 60 seconds; the original producer quality, publication expiry, uncertain-dispatch and atomic commit gates remain required. Parent review and separately authorized evidence archival are external steps. The CSPC context reread change is not included.

Original archived configuration bytes were intentionally absent. Current configurations were reconstructed from the archived prepare-host recipe, exact source-specific stage bindings and matching current C46 control, then validated against the canonical source plan. This is documented reconstruction, not byte-for-byte recovery of an original config. Configurations and registered/runtime identity objects remain outside this GitHub archive.

The historical `ARCHIVE_STORE` branch references an absent audit helper and is unsupported; the current `DB_STARTED_OWNER_V1` flow uses separate archival handling. Use each dedicated source starter plus preflight check. Inherited generic preflight launch is a diagnostic template, not substitute launch authority. Names ending in `42` are preserved filenames; their frozen source contains the current C46 bindings.

## Public observer v2

`read-public-v2.py` is exactly 2816 bytes, SHA256 `3c2c6161c88bda76e7e4fc642a08f4c474ccd3636b905ab1820c0d3145264899`. Its original two public API URLs, consent header, compression and network parameters are unchanged from the compared original helper (SHA256 `909d94f6c0438e91ea3e75f413a6af92830b7a2ffc2b75edb778133aa34b6ee5`).

After curl returns, missing response files no longer raise FileNotFoundError before diagnostics are recorded. The helper retains curl stdout/stderr, per-endpoint attempt metadata and a separate transport-summary file so a later validator need not overwrite transport evidence. This is a diagnostic preservation change, not a website performance fix. It is not a general exception handler for every process timeout or malformed curl metadata case; attempt flags are derived from curl write-out records.

The publisher reports a syntax check and an actual public CURRENT read completed at 22:12:46 UTC; there were no dedicated regression tests or CI. No response bodies, headers, diagnostics or observations from that read are uploaded. Running the helper requires Python, curl and a new output directory; it makes network reads and writes local evidence, neither of which this backup executed.

## Contents and recovery boundary

57 unchanged source files are included: 13 for each of the four hosts, 4 shared verification/preparation tools and the observer v2. `SOURCE_BACKUP.json` binds each file by SHA256 and Git blob SHA. `SHA256SUMS` covers these files plus this README and the new manifest. Existing safe GitHub objects are reused.

The matching producer and dependencies, authorized configuration/control/source plan, registration, active publisher state, original template references and fresh runtime evidence must be restored separately before running hosts or their preparation checks. Preparation scripts read those external inputs and create broad inventories/reports. Their generated source indexes include configuration, original references and NONQUAL diagnostics and must never be used as unfiltered upload lists.

Of the 284 entries in the delivery source index, 56 current source entries are included and 228 are excluded. The observer is separately frozen and included as the 57th source file. Excluded items include original code80/template trees, originals/diffs, host/control/source-plan JSON, runtime and registration identity, PREPARED/SPEC/CONFIG_RECONSTRUCTION and internal reports, actual or synthetic generated request packets, NONQUAL/local-preflight outputs and original inventories. No live runs, captures/raw jobs, actual DB responses, SQL publication requests, environment files or credentials are included. Eisai is outside this delivery.

Related preceding C46 host source is available in [the verified host archive](https://github.com/EthanYoQ/Job-finder-Codex/tree/fccc397f6abb90c0f980af63bcc1d3cb469aac59). This independent backup branch contains no active workflow and does not alter the default branch.
