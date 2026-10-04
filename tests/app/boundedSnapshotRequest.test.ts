import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  SNAPSHOT_REFRESH_BUDGET_MS,
  SNAPSHOT_REFRESH_DELAY_MS,
  SNAPSHOT_REFRESH_MAX_ATTEMPTS,
  startBoundedSnapshotRequest
} from "../../src/app/boundedSnapshotRequest";
import type { PublicSnapshotRefresh } from "../../src/domain/publicSnapshotRefresh";

type Result = { snapshotRefresh?: PublicSnapshotRefresh; value: string };
const updating: Result = { value: "old", snapshotRefresh: { state: "UPDATING", version: "v1" } };

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function run(request: (signal: AbortSignal) => Promise<Result>) {
  const onResult = vi.fn(), onError = vi.fn(), onInitialSettled = vi.fn();
  const cancel = startBoundedSnapshotRequest({ request, onResult, onError, onInitialSettled });
  return { cancel, onResult, onError, onInitialSettled };
}

describe("bounded snapshot requests", () => {
  it.each([undefined, "CURRENT", "FAILED"] as const)("never polls a %s response", async state => {
    const result: Result = { value: "old", ...(state ? { snapshotRefresh: { state, version: "v1" } } : {}) };
    const request = vi.fn(async () => result);
    const recording = run(request);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(request).toHaveBeenCalledTimes(1);
    expect(recording.onResult).toHaveBeenCalledWith(result, false);
    expect(recording.onInitialSettled).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps the old response usable and stops when a new version becomes current", async () => {
    const current: Result = { value: "new", snapshotRefresh: { state: "CURRENT", version: "v2" } };
    const request = vi.fn(async () => current).mockResolvedValueOnce(updating).mockResolvedValueOnce(updating);
    const recording = run(request);
    await vi.advanceTimersByTimeAsync(SNAPSHOT_REFRESH_DELAY_MS - 1);
    expect(request).toHaveBeenCalledTimes(1);
    expect(recording.onResult).toHaveBeenLastCalledWith(updating, false);
    await vi.advanceTimersByTimeAsync(SNAPSHOT_REFRESH_DELAY_MS + 1);
    expect(request).toHaveBeenCalledTimes(3);
    expect(recording.onResult).toHaveBeenLastCalledWith(current, true);
    expect(recording.onInitialSettled).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(request).toHaveBeenCalledTimes(3);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("limits attempts even if every response remains updating", async () => {
    const request = vi.fn(async () => updating);
    run(request);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(request).toHaveBeenCalledTimes(1 + SNAPSHOT_REFRESH_MAX_ATTEMPTS);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("aborts a stalled refresh at the deadline and ignores providers that resolve after abort", async () => {
    let resolve!: (result: Result) => void;
    const request = vi.fn<(signal: AbortSignal) => Promise<Result>>()
      .mockResolvedValueOnce(updating)
      .mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    const recording = run(request);
    await vi.advanceTimersByTimeAsync(SNAPSHOT_REFRESH_DELAY_MS);
    expect(request).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(SNAPSHOT_REFRESH_BUDGET_MS - SNAPSHOT_REFRESH_DELAY_MS);
    expect(request.mock.calls[1]?.[0].aborted).toBe(true);
    resolve({ value: "too late", snapshotRefresh: { state: "CURRENT", version: "v2" } });
    await vi.advanceTimersByTimeAsync(0);
    expect(recording.onResult).toHaveBeenCalledTimes(1);
    expect(recording.onError).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["failure", "rejection"])("stops a refresh after %s without retrying", async kind => {
    const request = vi.fn(async () => updating).mockResolvedValueOnce(updating);
    if (kind === "rejection") request.mockRejectedValueOnce(new Error("offline"));
    else request.mockResolvedValueOnce({ ...updating, snapshotRefresh: { state: "FAILED", version: "v1" } });
    const recording = run(request);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(request).toHaveBeenCalledTimes(2);
    expect(recording.onError).toHaveBeenCalledTimes(kind === "rejection" ? 1 : 0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cancels the next refresh and its deadline", async () => {
    const request = vi.fn(async () => updating);
    const recording = run(request);
    await vi.advanceTimersByTimeAsync(0);
    recording.cancel();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(request).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});
