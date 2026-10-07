# Refresh diagnostic reader sources

`read-refresh-diagnostics-r2.sh` is the current source revision. `read-refresh-diagnostics.sh` is preserved only as the historical guessed-log-path implementation and is not the current entry point. Both original byte sequences are unchanged.

Dependencies: POSIX shell, Python 3 with the standard library and Linux descriptor/proc facilities, the fixed Node and PM2 installation, and an already-running PM2 daemon. The embedded shell, Python and JavaScript retain non-secret role names, release paths and executable-path bindings. An independently restored environment must satisfy those bindings; this source archive does not supply the environment or authorize execution.

R2 selects log paths from PM2 metadata for the two fixed roles and projects recognized event fields and counts. Each log read requests at most 65,536 bytes. The PM2 subprocess has a 12-second timeout; its 4-MiB stdout size check happens after capture, and stderr has no separate byte cap. These are not whole-script memory or runtime limits. The installed CLI is invoked with child-process creation blocked; that guard is not a general operating-system sandbox or an executable hash attestation.

File modification times are not event timestamps. Error counts describe the whole tail and are not assigned to a particular refresh. Empty or missing log events do not establish whether an operation ran or whether the public page is current. No actual log, PM2 environment, daemon metadata, response, execution receipt or diagnostic report is included.

The backup review checked fixed hashes, source text and embedded Python syntax without executing either script. No runtime test or deployment outcome is asserted by this snapshot.
