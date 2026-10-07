---
name: aliyun-safe-cleanup
description: Audit Alibaba Cloud server resource usage, identify recoverable cleanup candidates, and verify the real disk-space result. Use for server cleanup requests; do not use to change deployment architecture, remove rollback evidence, or perform a blanket Docker prune.
---

# Safe Aliyun server cleanup

Start with an explicitly authorized server and the existing official Alibaba Cloud connection. The bundled helper is a read-only Linux inventory for a PM2/Docker host. Review its fixed paths against the current host before running it. It is not a deletion script.

## Establish the execution boundary

- Read the available official `alibabacloud-cli-guidance` skill. Prefer the configured Ali MCP tool; use the already authorized CLI only when the MCP execution tool is unavailable. Inspect command help without displaying CLI credentials or reconfiguring authentication.
- Agree on one remote execution owner when deployment or data migration is also in progress. Freeze the live and fallback releases, requested rollback points, service dependencies, database storage, environment files, keys, cloud-assistant records, and unresolved command evidence. Do not restart services for a cleanup inventory.
- Use inspectable plaintext scripts. Preserve the original command body, SHA-256, target, timeout, and a local submission intent before invoking a remote command. Persist its exact official invocation ID. An unknown client result is not permission to resubmit; query the existing invocation. A denial requires explicit authorization evidence before retrying the same call, and a repeated denial ends that route.

## Inventory and choose a candidate

Run [scripts/inventory-readonly.sh](scripts/inventory-readonly.sh) only after reviewing its roots. It reports exact `df -B1` values, memory, bounded directory allocation, process paths/RSS, sanitized PM2 boot-unit metadata, and Docker totals. It does not call the PM2 CLI because that CLI may start a daemon. It retains bounded partial stdout on command failure or timeout, identifies the affected root, and emits no raw stderr. A timeout means incomplete coverage even if the enclosing script exits successfully.

Use directory sizes to choose the next small read-only query, not to estimate bytes already freed. Inspect only metadata until a concrete recovery check requires reading a selected archive. Distinguish compressed recovery packages from expanded duplicate trees. Names containing `retired`, `backup`, or `cache` do not prove a file is disposable.

The bundled helper is only an initial summary. Its process list is filtered, and its Docker summary is not a complete reference graph. Never use it alone to authorize deletion.

For Docker, enumerate full image IDs and **all** containers, including stopped containers. Record image references and mounted storage without dumping configuration or environment variables. Protect referenced images and all volumes. `RECLAIMABLE` is an estimate, not deletion authorization or a measured filesystem gain. Read [references/recovery-boundaries.md](references/recovery-boundaries.md) before proposing image removal.

## Gate a cleanup change

Proceed only for an exact, frozen candidate with an identified recovery route. A general cleanup request does not authorize an irreversible purge.

- Existing source, runtime, database data, protected rollback packages, security logs, and unresolved evidence remain protected.
- A same-filesystem rename retains data but does not free its allocated blocks. State that clearly.
- Before removing an expanded duplicate, verify the retained archive against the selected tree and required metadata, and demonstrate recovery in an isolated location within the authorized environment. Preserve ownership, modes, links, and any relevant extended attributes. Do not substitute a hash or a successful archive listing for a restore check.
- Before removing an image, establish which original references can actually be restored. A local image ID, a registry digest, and a tag are different identities. If the recovery route changes a required reference or loses metadata, explain the effect and obtain the user's specific approval before the removal.
- Recheck process, container, mount, and release references immediately before a mutation. If they changed, stop and revise the plan. Do not broaden to `prune`, volume deletion, log truncation, credential changes, service restarts, or another environment.

For an already available archive of exact untagged image IDs, [scripts/verify_docker_archive.py](scripts/verify_docker_archive.py) performs a bounded, read-only check of compressed integrity, config/image IDs, and layer-byte hashes. It supports classic Docker save archives with raw layer files; it rejects nonempty repository tags and OCI layouts. Its result explicitly does not prove `docker load`, registry-digest restoration, or a complete recovery. It must not be used as deletion authorization.

No destructive command is provided here because the verified run reached the recovery/approval boundary without performing cleanup.

## Verify and report

Take `df -B1` immediately before and after the authorized change on the same filesystem. Report the signed difference in available bytes, alongside the exact resources changed and retained recovery artifact. Do not substitute `du`, Docker's reclaimable estimate, or a rounded aspiration for this measurement. Note concurrent writes if they prevent attributing the delta exactly.

Verify the affected service health without restarting all services. Preserve failure evidence and recover through the approved retained artifact when needed. Report incomplete checks, unchanged space, or a restore limitation directly.

When the user requested a skill/code backup, hand only the sanitized skill, helper, and tests to the existing repository's designated writer. Verify the resulting commit. Never put real host receipts, image payloads, credentials, deployment configuration, or business data in the skill backup.

## Validation status

Validated on 2026-10-07: bounded remote inventory, retention of partial `du` output, sanitized PM2/Docker reporting, exact image/container reference enumeration, and distinguishing a compressed rollback package from an expanded duplicate. The bundled helper was subsequently hardened with bounded stream capture, explicit incomplete-root labels, missing-command handling, and no PM2 CLI call. Those changes passed 7 local subprocess-fixture tests; that revised helper has not been rerun on the server. The observed server inventory made **no cleanup change**. The archive checker passed 17 local synthetic tests, including corrupt/truncated gzip, path/member faults, decoded-stream and cumulative metadata budgets, concurrent file changes, unexpected references, and output redaction. Image removal, archive restoration, and freed disk space have **not** been validated by this skill's originating run.
