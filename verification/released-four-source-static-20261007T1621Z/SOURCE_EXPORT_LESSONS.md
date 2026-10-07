# Source-only export boundaries

The earlier exporter copied a source reference and dependency report with whole-object expansion. Removing the most obvious binding fields did not remove the rest of the operational metadata. Review timestamps, workbook audit positions, historical process status and archive outcome text were still attached. The generator also read the complete report and an external routes document, so deleting those files alone would have broken restoration.

The repair uses explicit field allowlists. The source projection contains only source identity, original route, exact source configuration, complete source plan and concrete implementation hashes. Dependency documents describe required code, binary, paths and protocol. They do not describe an observed run or current archive result. Historical audit reports remain outside the source package.

Configuration and operational state must be distinguished by meaning, not by a broad word filter. RecruitmentSource.status and the plan's executionAuthority are required configuration and contribute to the producer contract. They are retained and compared to the pinned producer. Runtime observation timestamps, actual candidate/database tuples and publication outcomes are excluded.

The exact final unbound implementations are now package-local, hash-pinned seeds. A deterministic restore recipe validates the complete input and copies those exact bytes into a fresh directory. This avoids rebuilding through an older company template and accidentally losing later fixes. The recipe has no dependency on an external history file, repair report or intermediate generator.

Validation must cover missing required fields, unexpected metadata, altered config values, seed byte changes, changed validators, unsafe paths and output collisions. A stripped field is acceptable only when it is explicitly classified as metadata and is not required to regenerate or validate the source. Missing required fields fail before any output is written.

The source export repair is independent of an authorized current crawl. It changes export and restore material only. It does not change production host code, active controls, running processes, source architecture, source scope or publication authorization.
