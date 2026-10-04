/** Current official-surface audit findings. These holds are deliberately separate
 * from immutable accepted history and from the historical 41-company manifest. */
export const SOURCE_COVERAGE_REVIEW_PENDING = "SOURCE_COVERAGE_REVIEW_PENDING" as const;
export function getPortableSourceCoverageHold(_sourceId: string): typeof SOURCE_COVERAGE_REVIEW_PENDING | null {
  // 2026-10-03: manual D36 selects the registered CSPC social channel, not a
  // group/subsidiary union. Its reviewed UI/API set agrees; configured candidates
  // remain a separate unknown ledger. Publication still requires a committed,
  // current-config source-quality receipt and the unchanged freshness checks.
  return null;
}
