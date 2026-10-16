# Biogen fixed build profile (local candidate, disabled)

Baseline: frozen `0f7d297619d1f357a2da92682de9b62d7409733c` production-install source.
This is a separate compile-time source profile, not a runtime source selector.
The original Takeda generated entry remains byte-identical. Neither profile is activated by these generators.

## Actual caller chain

1. This directory's `render-install.py` composes the original install template, EX holder, staging verification, reader identity proof and control facts. It embeds this profile's `bound-artifacts.py.in`.
2. `bound-artifacts.py.in` validates the measured source manifest/native build and composes this profile's activation renderer and fixed CLI. It writes only the original disabled target artifact set through the original installer. It calls the unchanged shared lifecycle owner renderer.
3. The shared owner `functions-activate.js` preserves the original 16-field registration check, permanent activation/mutation journals, and EX fence. Shared `functions-loader.js` calls the actual profile `runLiveRound()` under SH through settlement.
4. The fixed CLI preflight pins Biogen source/config/owner, native package and original registration, then launches `connector-gate/biogen-run-with-owned-publication-pipe.mjs` with the original bounded portable runner. The wrapper independently generates the original outer deadline and IPC challenge.
5. Native `p0-cloud-portable-source-pilot.ts` selects the explicitly fixed Biogen owned mode; `cloudDbStartedPilot.ts` rejects simultaneous Takeda/Biogen selections. The native Workday capture and original file relay call `prepareOwnedBiogenPublish`, the independent Biogen packet/native/dual-reader gate, consumed one-shot review, publish, and exact outcome readback.
6. Actual generated functions consume the owned pipe proof, retain the original official-tool Promise and observer/settlement semantics, validate projected member hashes, then run source-specific public list and visible source-time checks. Workday IDs are SHA256 of exact UTF8 externalPath, never REQ suffixes.

The standalone `run-biogen.mjs`/old supervisor is not this caller chain. Its earlier tests do not qualify this profile.

## Source and time limits

`source-biogen-china-social`, `company-biogen-china`, config `47107a3a1f9dbd3411a1f9244866be7c4bc52422b94a1c92204dc66ac4340348`, original Workday `https://biibhr.wd3.myworkdayjobs.com/external`. Existing China facet/city pending and pagination policy are preserved. Schema50 and first-public empty-before-state remain the original native/compiler/reader semantics. Evidence expiry cannot exceed capture + 30 minutes or the earlier original outer deadline reserve; dispatch has its original reserve. UNKNOWN remains read-only reconciliation, never a replacement publish.

Biogen UI B1 / 渤健中国 derives from original 41-company coverage ordering. Root separately observed that label and seven previously published jobs on 2026-10-16; those historical UI observations are not fresh evidence for a new collection. Test fixtures remain explicitly synthetic.

## Remaining release work

This profile requires independent review, new measured native runtime/build and release registration, full original reader qualification, separately authorized install/activation, and a real bounded collection→atomic publish→readback round. None is established by synthetic tests. Global activation remains false.

Full36 is unfinished. A single immutable release still needs a closed compile-time source/profile allowlist, per-source independently pinned caller factories, and a sequential dispatcher that holds the original lifecycle scope, awaits each source's complete settlement, and halts on UNKNOWN before considering a different source. It must preserve per-source deadlines, original artifacts and native policies, with no caller-selected source/address or manual deployment swapping. This candidate does not implement that dispatcher. Other sources require actual native route-specific wiring and acceptance; no source is silently substituted.
