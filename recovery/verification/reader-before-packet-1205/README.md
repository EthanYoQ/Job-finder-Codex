# Compact reader-before and single stored current certificate

Frozen inactive candidate on external 1145 canonical decda27f823985086758fcde801d203cb6104808. Native 110 ac70c21b686c498c4c6a28dbe5bd0f423922d140 stays unchanged. Eight exact before/after paths and hashes are in manifest.json; every active before image matched when frozen. Entry file does not change.

## Changes and retained boundaries

reader-before SQL now supplies native 110 compact reader inputs rather than every historical certificate original. Publisher first/latest full certificate context, source/config identities, jobs, members, and snapshot binding remain. The existing split helper retrieves only distinct first/latest full publication records and reuses their current member array in its compact header. It still checks row hashes and a final snapshot hash; a changed row or snapshot rejects. Sanofi publisher evidence remains; unused public historical artifact loading/binding is removed. No acquisition, publication SQL gate, lock, or unknown-outcome reconciliation changes.

PACKET_REVIEW stores its current certificate once in decoded.terminal. Existing packet writer checks and in-memory returns remain unchanged. The raw archive reader aliases decoded.receipt to terminal.completenessCertificate; for old packets it first requires the redundant receipt to match. Only the redundant top-level receipt and duplicated terminal decoded row are omitted on disk. Job/EvidenceArtifact rows and other consumers remain. No new wrapper or protocol and no merged process boundary.

## Existing saved input checks

Bayer reader-before 12,656,196 -> 4,884,837 bytes and 9 -> 4 SQL calls; Hengrui 9,949,532 -> 8,435,696 and 21 -> 4; Sanofi 907,230 -> 755,046 and 24 -> 2. These are historical local input tests and helper query counts, not live latency. Complete public reader outputs and publisher context are equal on each input; only input representation hash changes. Official EXPLAIN validated both SQL templates and the compact header; no ANALYZE or full data fetch.

Bayer stored packet 15,040,449 -> 8,394,549 bytes; Hengrui 10,784,272 -> 6,980,010. All three writer serializers preserve original in-memory values and checks. Bayer original/new/legacy packet raw replay reports agree, including 160 jobs and 167 archived requests, with network blocked. Legacy conflicting receipt remains rejected. Syntax/transpile and diff whitespace checks pass. Full current release chain was not rerun. Total production diff is +57/-45, net +12 lines; benefit is eliminated transfer/query/storage duplication, not fewer lines.

## Backup and activation

Back up the eight after files under manifest module-relative paths, this README and verification-summary.json. Do not include real source packets, originals, before/after duplicate trees or large test fixtures. Restore against original 1145 full backup and verify all 61 runtime files before activation.

Activation requires no running producer/root loop and exact active before-image matching. Update raw archive consumer first (it reads both old and new packets), then remaining writers/helper/templates/read adapter while no process is active. Old raw readers cannot read new reduced packets, so no producer may run during this replacement. Recheck all 61 runtime files and unchanged entry SHA. This candidate does not start collection. PUBLIC_BEFORE HTTP gating is untouched and remains a separate pending decision.
