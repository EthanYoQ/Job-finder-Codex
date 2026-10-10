export const FORMAL_QUALIFICATION_MINIMUM_SEPARATION_MS = 6 * 60 * 60 * 1_000;
export const FORMAL_QUALIFICATION_MAXIMUM_WINDOW_MS = 72 * 60 * 60 * 1_000;

// The receipt CLI supplies newest-first batches. Selection does not qualify them:
// the authoritative receipt still verifies the complete identity and A/B evidence.
export function selectQualificationPair<T extends { finishedAt: Date | null }>(batches: readonly T[], now: Date): T[] {
  for (let newer = 0; newer < batches.length; newer += 1) {
    for (let older = newer + 1; older < batches.length; older += 1) {
      const newTime = batches[newer]!.finishedAt?.getTime(), oldTime = batches[older]!.finishedAt?.getTime();
      if (newTime !== undefined && oldTime !== undefined && now.getTime() - oldTime <= FORMAL_QUALIFICATION_MAXIMUM_WINDOW_MS &&
          newTime - oldTime >= FORMAL_QUALIFICATION_MINIMUM_SEPARATION_MS) return [batches[newer]!, batches[older]!];
    }
  }
  // Preserve diagnostic evidence so the authoritative receipt can fail closed.
  return batches.slice(0, 2);
}
