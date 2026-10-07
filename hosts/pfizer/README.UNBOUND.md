# Pfizer TRUE_B source-only package

This package contains exact, reviewed, unbound source bytes and pure static configuration. It does not authorize registration, activation, capture, database operations, publication, or uploads. Candidate and database placeholders are null.

The source restoration recipe copies the pinned final implementations. It does not replay the historical Servier-to-Pfizer conversion. This avoids dependence on historical reports, route inventories, or original preparation directories.

From the frozen export, use verification/released-native-requirements-20261007T1548Z/prepare-pfizer-host.py with an explicit new absolute output directory and the restoreManifestSha256 from the enclosing source-plan.json. Use finish-pfizer-static.py to compare that output against the complete pinned package. Source reads are confined to the three Pfizer namespaces; other source namespaces are ignored and never copied. The new output directory must contain exactly the pinned Pfizer package. Both scripts require --manifest-sha256. Neither script runs the runtime, owner, or supervision source.

The separate export-route-audit.mts only validates static source configuration against the pinned producer. Its required --producer argument is the producer checkout. It verifies local implementation byte hashes before dynamic imports and recomputes the full plan, route, and configuration hash. Run Node with the enclosed offline.cjs preloader and the producer tsx loader. Test sources use synthetic fixtures; they are not operational records.

Runtime source embeds the fixed deployment root. An exact source restoration into a new review directory does not rebind these paths. Do not run runtime or owner entrypoints from the review directory.
