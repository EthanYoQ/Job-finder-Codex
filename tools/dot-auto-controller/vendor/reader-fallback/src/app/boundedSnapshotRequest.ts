import type { PublicSnapshotRefresh } from "../domain/publicSnapshotRefresh";

export const SNAPSHOT_REFRESH_DELAY_MS = 5_000;
export const SNAPSHOT_REFRESH_BUDGET_MS = 30_000;
export const SNAPSHOT_REFRESH_MAX_ATTEMPTS = 5;

/** A single user request may briefly follow an explicitly updating snapshot.
 * No timer survives a terminal response, error, cancellation, or the budget. */
export function startBoundedSnapshotRequest<T extends { snapshotRefresh?: PublicSnapshotRefresh }>(options: {
  request: (signal: AbortSignal) => Promise<T>;
  onResult: (result: T, refreshing: boolean) => void;
  onError: (error: unknown, refreshing: boolean) => void;
  onInitialSettled: () => void;
}): () => void {
  const controller = new AbortController();
  let stopped = false;
  let attempts = 0;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
  let deadline: number | undefined;

  function stop(abort = false) {
    stopped = true;
    clearTimeout(retryTimer);
    clearTimeout(deadlineTimer);
    if (abort) controller.abort();
  }

  async function read(refreshing: boolean) {
    try {
      const result = await options.request(controller.signal);
      if (stopped) return;
      if (deadline !== undefined && Date.now() >= deadline) { stop(true); return; }
      options.onResult(result, refreshing);
      if (!refreshing) options.onInitialSettled();
      if (result.snapshotRefresh?.state !== "UPDATING" || attempts >= SNAPSHOT_REFRESH_MAX_ATTEMPTS) {
        stop();
        return;
      }
      if (deadline === undefined) {
        deadline = Date.now() + SNAPSHOT_REFRESH_BUDGET_MS;
        deadlineTimer = setTimeout(() => stop(true), SNAPSHOT_REFRESH_BUDGET_MS);
      }
      if (Date.now() + SNAPSHOT_REFRESH_DELAY_MS >= deadline) {
        stop();
        return;
      }
      retryTimer = setTimeout(() => {
        if (stopped || Date.now() >= deadline!) return;
        attempts++;
        void read(true);
      }, SNAPSHOT_REFRESH_DELAY_MS);
    } catch (error) {
      if (stopped) return;
      options.onError(error, refreshing);
      if (!refreshing) options.onInitialSettled();
      stop();
    }
  }

  void read(false);
  return () => stop(true);
}
