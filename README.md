# Recoverable controller source templates

This backup preserves the eight rollout/acceptance controllers plus their two required source helpers: the predecessor role controller and the pure JavaScript facet sorter. Deployment bindings are supplied separately. The original algorithms are preserved, including both ports, memory floors, identity checks, precise Astra recovery contract, global timestamp maximum, worker draining, evidence persistence before rejection, and recovery of only identified roles.

## Reconstruct source locally

Use Python 3.8 or later for the offline renderer and tests. Reconstructed Python controller bytes retain the original Python 3.6 syntax. The facet helper retains its already-qualified Node 22 behavior.

1. Run `python3 -B test_synthetic.py` from this directory. Tests use invented input and mocked operational interfaces; they never import or execute a generated controller.
2. Copy `synthetic.bindings.json` to a private file outside the Git checkout. Replace all values with explicitly verified local bindings described in `bindings.schema.json`. The synthetic example is deliberately unusable as a deployment configuration. There are no operational defaults.
3. Reconstruct into a new private local directory:
   `python3 render.py --bindings /private/original.bindings.json --expected /private/original.expected.json --output /private/recovered-source`
   The optional expected file maps each of the nine Python component IDs to its original `filename` and `sha256`. When supplied, every match is checked before output is written. Omitting it reconstructs the provided configuration but makes no original-byte claim.
4. Keep the bindings, expected map, reconstructed deployment-specific files and `RECONSTRUCTED.json` private. The renderer prints only a source count. It does not import generated code, install files, run commands, contact a service or create a deployment plan.

`recipe.json` orders the dependency graph. The renderer hashes each completed helper, derives its content-addressed filename, then substitutes both into dependent source. The asset-manifest filename is derived from the separately supplied manifest hash. Templates retain an unconditional refusal before imports or other actions; only the data-only renderer removes it after every input and dependency is resolved. Template and facet hashes are checked before reconstruction. Original source hashes in the recipe are provenance, not hashes of the transformed templates.

## Binding groups and runtime inputs

- `RELEASE_*`, `BASELINE_ROOT`, paths, names and host: deployment locations and role identities
- `*_METADATA`, process IDs and start ticks: exact observed filesystem/process identities; these are comparisons, never instructions to change permissions
- `CANDIDATE_*`, `BASELINE_*`, archive/config hashes: already-qualified application and runtime identities
- `PRIOR_*`, attempt label: the specific terminal failed attempt and confirmed restoration; failure status and restoration conditions are fixed in source and cannot be overridden by a binding
- expectation, facet-expectation and asset hashes: private acceptance inputs installed independently

Required operational data is intentionally outside this source backup: application source/build/runtime, baked identity files, original route contents, runtime qualification and prior terminal receipts, private acceptance projections, static asset manifest and existing environment-file contents. The controllers verify these inputs; this backup does not invent or include them. The predecessor controller source and facet helper source are included, so no controller-source dependency is left unresolved.

Reconstructing a historical attempt does not authorize or make it safe to replay that attempt. Existing attempt directories and receipts remain exclusive. UNKNOWN operations are not eligible for the known-terminal admission mechanism. A future operation must have its own verified inputs and the existing authorization and review gates.

## Publication boundary

Publish only the files enumerated by `PUBLICATION_MANIFEST.json`. Do not publish private binding files, reconstructed instances, command catalogs, receipts, runtime bodies, logs, process snapshots or environment files. This is a source-recovery backup; its tests do not establish the health of a deployed service.
