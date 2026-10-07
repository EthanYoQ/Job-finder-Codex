# Restore exact unbound source

This package contains configuration and executable source. It contains no observation, candidate readback, actual binding, run directory, historical status, archive outcome or publication result.

The producer dependency remains the exact commit `28402a299bb04cbf5873da66c2fe8ca76827c0d1` at the runtimeRoot in static-source-routes.json. The pinned Node dependency remains v22.23.3. The recipe verifies the producer commit, clean tree, implementation file hashes, full generated plans and source config hashes without network or database access.

Run `python3 restore-unbound-hosts.py --output-root <new-isolated-directory>` from any directory. The output directory must not exist. The recipe rejects production host, owner, producer and runtime directories and rejects symlink ancestry. It validates all package inputs and seed bytes before creating output.

This recipe restores exact reviewed final source bytes from package-local seeds. It intentionally does not repeat the earlier source-to-source conversion from another company host. The target paths, source IDs, loader markers, supervisor pins and owner mappings are already present in those fixed bytes. There are no dependencies on a historical routes file, a prior verification report, an external repair manifest or another host's intermediate generator.

Every emitted file must match seed-manifest.json byte-for-byte. Candidate and database templates must remain null. A source-only restore does not install a host, activate it, fetch a source or authorize publication. Current owner binding uses separate current official inputs under the original protocol.

The configuration's RecruitmentSource.status and executionAuthority are preserved because they are part of the exact static source plan and config hash. They are not assertions about a running process or a publication outcome. Missing required source configuration must fail validation; the recipe must never infer a default or silently remove a field needed by the producer.
