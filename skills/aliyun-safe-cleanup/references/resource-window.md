# Defer safely when the resource window is insufficient

The observed approved cleanup attempt stopped before its first write because the server did not meet the reviewed initial memory reserve. The existing workloads remained running, all original images remained present, and no recovery directory or archive was generated. Adequate free disk space meant there was no reason to add risk to live services merely to complete cleanup.

## Decision boundary

- Establish both disk headroom and available-memory reserves before starting compression, export, verification, or import. Include temporary Docker export/import space, retained backups, and live-service headroom in the plan. Per-image work can limit temporary disk growth, but does not remove the memory gate.
- A failed starting reserve means stop before allocation. Do not create an archive and hope resources recover, restart workloads, drop caches, or silently lower the reserve to bypass the guard.
- Recheck a specific suspected transient condition only when it will change the decision. If the live workload needs the resources and disk capacity is adequate, record a deferral. Do not create recurring polling merely because cleanup did not run.
- Resume the existing bounded authorization when a sufficient resource window is confirmed. Recheck every current container/image reference, live service, protected release and recovery condition first. Authorization to clean old images is not authorization to change architecture or stop current services.

The concrete thresholds in an execution plan are workload-specific. The observed choice to retain a conservative starting reserve is not a universal RAM requirement for all servers.

## Evidence and reporting

Record exact before/after available-byte measurements and their source. Prefer df -B1 on the same filesystem for a cleanup comparison. If a later check uses statvfs, label it explicitly rather than calling it df. Concurrent background writes can change available capacity even when no cleanup occurred.

Report separately:
- Whether the guard stopped before creating the archive directory
- Whether any export, load, image removal, or service restart actually began
- Whether original images and recovery evidence remain present
- Whether capacity was actively freed by this cleanup

When no cleanup mutation ran, actively freed capacity is zero. A small background change in available space is not a cleanup result. An archive that was never generated must not be described as a verified recovery package.

If a remote command or Docker client is interrupted after it starts, reconcile its actual result before retrying. A local client exit alone does not prove that a remote command or daemon operation stopped. Preserve the invocation and partial evidence; do not automatically replay an indeterminate operation.
