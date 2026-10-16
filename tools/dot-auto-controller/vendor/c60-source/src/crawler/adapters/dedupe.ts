import { buildJobDedupeKey, type NormalizedJobRecord } from "../normalizedJob";

export function dedupeJobsByDedupeKey(
  jobs: readonly NormalizedJobRecord[]
): NormalizedJobRecord[] {
  const jobsByKey = new Map<string, NormalizedJobRecord>();

  for (const job of jobs) {
    const dedupeKey = buildJobDedupeKey(job);
    if (!jobsByKey.has(dedupeKey)) {
      jobsByKey.set(dedupeKey, job);
    }
  }

  return [...jobsByKey.values()];
}
