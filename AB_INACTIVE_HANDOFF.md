# Inactive original A/B connector branch

No production activation, database changes, candidate registration, or live browser capture occurred.

The existing host gains NATIVE_AB_CONNECTOR_V1. Route stays TRUE_A or TRUE_B; producer is p0-cloud-source-pilot.ts with --db-started-control. Original schema50 databaseIdentity and retired-candidate fence remain mandatory, as does the original compiler's delta transaction. Context uses the original A/B admission path, without portable SOURCE_QUALITY_POLICY_ID. Existing four requests and parent review remain in place.

Route interface covers twelve non-JNJ A sources and Pfizer B. Amgen and GSK catalogue labels proved stale against this source: the actual plans include amgen-manual-workday-lookup and GSK_NATIVE_OPEN_REQUISITIONS_V1, respectively, and their exact source hashes match the catalogue. Existing 34 Amgen and 4 GSK tests pass. Host verifies these source-specific plan features before accepting those two stale catalogue labels; other source-fix restrictions remain. Twelve wired A routes still do not imply twelve production-qualified routes.

Pfizer adds `capture-pfizer-b-source.ts browser <new-private-dir>` using the existing real rendered Playwright collector. Output independent-validation.json can be bound in the original bootstrap. Main HTTP collection remains separate. No CUA or HTTP evidence is fabricated.

Bayer and Servier still require an actual cloud DOM collector feeding their existing independent HTTP detail helpers. JNJ still requires actual native DOM observations; prepare-jnj-dom-current-capture only transforms those observations. They are excluded from this profile.

Integration owner: original-relay-automation. That worker owns prepare/run and external original SQL/certificate/raw replay review. Do not activate this branch until that review path, fresh candidate registration and source-specific end-to-end readback are ready. Never remove databaseIdentity to get around an incompatible fence. No second controller was added.

Verification: four mocked original host-stage tests passed (both grade branches, all four requests, PUBLISH waiting for review, expired/uncertain/source/candidate rejection). Modified Pfizer script syntax transpiles. Actual connector launch, typed full build, live Pfizer browser, A/B SQL compile/runtime and production web readback were not executed.

Follow-on source check: actual source plan hashes Amgen 1854166be2d563e3e9cc075df017d3f04e1f65e3b06186bb64c95a3c8676f6a6; GSK aa9bf82308c3b818a8c33b80561712b932389186c160ae83583a8c869eb54d74. Existing fixture tests pass; fresh capture/publication remains unverified.
