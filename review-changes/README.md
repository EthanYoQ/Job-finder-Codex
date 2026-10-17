# Inactive A/B review integration

Apply the accompanying existing-review.diff to the sole controller's offline-checkers only when it is idle. Copy original-ab-certificate-review.mts beside the existing replay script. The full source files here are reference snapshots of that patch, not another controller. Parent's existing review-original-publication.mjs still orchestrates SQL review, original readers, raw replay and final web projection.

SQL review uses host-config.mode=NATIVE_AB_CONNECTOR_V1 to select original A/B legacy certificates and omitted portable admission policy. Full original publicationContext/CAS80 comparison, mutation byte recompile and lifecycle checks remain unchanged.

Raw replay uses the original router and original HTTP adapters, with archived bodies only. Reissued original A/B certificates must exactly match the original receipt. CURRENT IDs and each source-owned normalized field are compared against the proposed/retained database projection. Pfizer needs the exact current run's artifacts/<batch>.independent-validation.json and original current-run certificate limits. All archived bytes and regenerated raw/derived bodies are compared.

AstraZeneca is intentionally held: the existing owned detail constructor has no injectable transport, and archived raw files alone do not retain its full detail envelope. Wire its existing replayAstraZenecaDetails using the producer's exact evidence before enabling its raw review; do not substitute the generic HTML collector. JNJ, Bayer and Servier remain excluded pending real DOM acquisition.

Validation: syntax transpile for all modified review files; four pure offline assertions for original Amgen certificate, modified IDs, expiry and independent-UI mismatch. No Vitest, cache write, database write or live network. Full raw HTTP reconstruction, valid Pfizer B fixture, SQL review against fresh A/B packet, and production readback remain unverified. Do not activate based on these tests alone.
