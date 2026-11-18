# New manual request launch recovery

`run-round.ts` asks systemd to start `jobfinder-manual@recover.queued.service` after it saves the snapshot and its durable receipt, or after it reports a round failure with a database client already initialized. The start request has a two-second timeout. Launch failure is logged as `MANUAL_QUEUE_RECOVERY_START_FAILED` and leaves the round exit status intact. The existing manual template runs the queue check in its own process.

The reserved `recover.queued` instance contains a dot, which the manual request ID format excludes. Every request ID instance still handles one preview. Install the updated template and run `systemctl daemon-reload` before using the updated round. The existing `user` permission for `sudo -n systemctl start --no-block` must cover the reserved instance.

Only QUEUED requests created after the current candidate's database registration and belonging to the exact 36-source catalog are considered. Imported manual IDs are excluded through migration-state, and the existing direct-manual eligibility assertion is reused. Each candidate's fixed systemd unit is read first. Active/activating units, pending systemd jobs, missing units and uncertain reads do not cause a start. After an explicitly inactive/failed unit with no systemd job is observed, the request is read again and must still be eligible QUEUED before starting the same ID unit. The consumer retains its exact-ID atomic claim, so a race cannot reclaim RUNNING or completed requests.

A request unit start timeout is reported as unconfirmed. A later recovery sweep inspects both unit and request state again. It may request a new start only after observing an idle or failed unit and a still-QUEUED request. The recovery unit logs its own summary to the systemd journal.

The focused Node tests cover template dispatch, historical and finished request exclusions, active units, pending jobs, unknown unit state, claim races, and timeout recovery. The template syntax can be checked on Linux with `systemd-analyze verify`. A live launch requires the installed template, production runtime files, and the existing sudo permission.
