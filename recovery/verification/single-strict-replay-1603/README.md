# One strict replay per raw archive review

Frozen isolated candidate on native112 b9ef32f269b1e7433d65a0c5a20710ccc59da282 and external1526 15c7dc23810ce421f83ccb8a3170de9718be8baa. One external runtime file changes: replay-original-json-archive.mts. Remove its JNJ and non-AB duplicate replayStrictSourceQualityEvidenceAsync calls and unused named import. The two call sites are mutually exclusive. Normal affected raw review performs one complete strict replay instead of two; no wall-time or memory percentage was measured.

## Why the inputs and boundary are identical

The external fetch callback returns the same replay object to runSourceCrawl. finalizeTruth lines367/376–377 use plan, fetchEvidence, paginationEvaluation, result.jobs, capturedAt and the ledger. assertAdapterReconciliation returns result.reconciliation directly (reconciliation.ts38/71); finalizeTruth returns the same result references, replacing only observation/truth (421). Therefore the external call's native.reconciliation and jobs are the same objects as the internal call. No extra options differ.

After the internal strict replay, observation rebuilding writes a shallow copy; parsing evidence is not assigned back to the input. Sanofi projection mutation happens before strict, not between the checks. The external intervening evidence/job digests do not modify their arguments; job sorting uses a copied array. The immediately retained native.truth assertion requires completenessVerified:true, so a failed internal strict replay still blocks publication.

## Boundaries retained

Do not remove sourceQualityAdmission: its admission/owned-acquisition binding is a different trust boundary. Archive bytes/hash checks, SQL compilation review, current membership/Job projection binding, receipt issuer/hash verification, AB certificate replay, independent BI DOM-versus-HTTP comparison, original publication deadline and unknown-outcome handling remain unchanged. This candidate changes no native source, collector, SQL, route, scheduler or active file.

## Existing evidence verification

JNJ159, Novartis169 and BI50 original archived runs were replayed offline with a historical clock fixed to each original reviewedAt. Before and after raw reports are byte-identical and match each original saved report. Input bytes and actual official contexts were not replaced. This is historical local replay, not a new collection, live publication or current-expiry claim. Syntax transpilation reports zero diagnostics.

The code proof establishes identical inputs for the shared call sites; no all36-source replay or new testing framework was added. A future change that mutates these inputs after runSourceCrawl would require reevaluating the ownership boundary.

## Delivery

changes.json holds the one runtime before/after SHA and source paths; fix.patch is the minimal diff. Back up only that after file plus this README and verification-summary.json. Verification fixtures and symlinked helper files are local-only and must not be included. Restore all63 runtime files against the original1526 map before any activation. No activation or collection is authorized by this artifact itself.
