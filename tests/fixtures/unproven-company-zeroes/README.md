# Rejected legacy zero evidence

These JSON files are **synthetic regression fixtures, not official captures or qualification evidence**. Their reduced HTML reproduces the candidate-warning and HR/contact shapes observed on 2026-10-01. There is no explicit no-vacancy statement in either fixture.

The fixtures were generated locally against pre-correction HEAD `04d971d`, using the canonical staged source plans, injected in-memory HTTP responses, `runSourceCrawl`, `createPlanBoundHtmlBrowserTraversalValidation`, and `issueBGradeTraversalCertificate`. At generation time both candidates incorrectly had `completenessVerified: true`; both certificates were issued as B grade and passed `verifyBGradeTraversalCertificateReceipt` with final count zero. No real network, browser, database, or qualification run was performed.

The fixed tests load those frozen outputs rather than reconstructing old certificates through corrected constructors. They verify rejection even at the original valid timestamp, with the original source configuration and correct certificate hash, so failure cannot be attributed merely to expiry, corruption, or configuration drift.

- `source-otsuka-china-social.json`: selected ChinaOtsuka pharmaceutical page, generic HR prose plus recruitment contact
- `source-sandoz-china-social.json`: retained legacy ID for Aspen China, candidate-fraud warning

The embedded timestamps and release/batch/result IDs are test-only. The historical manually supplied zero does not establish a current zero, and the excluded Otsuka group SSC jobs are not a replacement source.
