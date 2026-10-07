# Refresh state diagnostic reader source

This snapshot preserves read-refresh-state-0748.sh unchanged. It extends the earlier metadata-based [refresh diagnostic reader](https://github.com/EthanYoQ/Job-finder-Codex/tree/eb84097c185b1489ae2ab33d4463fd69fc9d1cd2) with MemAvailable, selected metadata for the two fixed PM2 roles and a digest of the fixed nginx configuration file. Existing non-secret role, path, port and executable bindings remain in the source. No actual memory value, PM2 record, nginx content, log, environment, response or receipt is included.

Dependencies are POSIX shell, Python 3 standard library, Linux descriptor/proc facilities, the fixed Node/PM2 installation and an existing PM2 daemon. The script is mode 100644. It is source for separately authorized read-only diagnostics; this backup did not execute it or change services.

The inherited log tail read is capped at 65,536 requested bytes per file. PM2 has a 12-second subprocess timeout; its 4-MiB stdout check is after collection and stderr has no separate byte cap. These do not impose a whole-script resource bound. The nginx read checks the regular file size against 65,536 bytes and reads at most 65,537 bytes; its hash is an observation of file bytes, not proof of the configuration loaded by active workers. Memory and PM2 metadata are point-in-time observations.

Event timestamps and file modification times are different. Error counts concern the whole tail, not a particular refresh. Missing events do not establish non-execution or public-page freshness. Only fixed metadata fields are selected from the existing roles; raw logs and the full PM2 environment are not emitted by design.

Backup checks covered exact hashes, a narrow source diff and embedded Python syntax. No runtime validation result or deployment outcome is asserted.
