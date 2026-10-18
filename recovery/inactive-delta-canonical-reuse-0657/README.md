# Inactive member canonical serialization reuse

Only src/domain/jobProjectionDeltaReceipt.ts changes. In parseJobProjectionDeltaReceipt the canonical sorted member array string is already computed for the order comparison. Reuse that exact string as the SHA256 input rather than recursively serializing the same sorted array again.

The receipt hash, manifest hash, binding, GRACE history checks, schema checks and all rejection conditions remain in their original locations. No cross-call/request cache, parsing-result trust shortcut, new framework or producer/native change.

Small CURRENT and GRACE fixtures: exact original/candidate returned objects and unchanged input; instrumentation counts full member-array serializations 4→3 per parse with receipt hash (sorted array alone 2→1). Receipt hash, manifest hash and binding mismatch still reject. This is a CPU/allocation reduction in this specific loop, not a measured whole-process memory or OOM fix.

Cross-boundary prefetch→domain parse reuse remains unimplemented: full acceptance includes plan/time and historical checks, so reusing a complete acceptance result is unsafe. A structure-only reuse would require threading ownership through the selector and historical call paths, a larger change than this patch.

Prepared from recovered reader-main/fallback source (same before SHA1accefb16c321dfb87fc2a1c0abdef9d0deaff2be20e084ba47004d780130f63). Activation must recheck the live file base. No deployed files changed.
