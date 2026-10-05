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

function run(request: (signal: AbortSignal, check?: string) => Promise<Result>) {
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

  it("forwards replacement checks without renewing the attempt budget", async () => {
    let checkId = 0;
    const request = vi.fn(async (_signal: AbortSignal, _check?: string): Promise<Result> => ({
      ...updating, snapshotRefresh: { state: "UPDATING", version: "v1", check: `check-${++checkId}` }
    }));
    run(request);
    await vi.advanceTimersByTimeAsync(SNAPSHOT_REFRESH_DELAY_MS - 1);
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0]?.[1]).toBeUndefined();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(request).toHaveBeenCalledTimes(1 + SNAPSHOT_REFRESH_MAX_ATTEMPTS);
    expect(request.mock.calls.map(([, check]) => check)).toEqual([
      undefined, "check-1", "check-2", "check-3", "check-4", "check-5"
    ]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps the original deadline after a replacement check and ignores resolution after abort", async () => {
    let resolve!: (result: Result) => void;
    const request = vi.fn<(signal: AbortSignal, check?: string) => Promise<Result>>()
      .mockResolvedValueOnce({ ...updating, snapshotRefresh: { state: "UPDATING", version: "v1", check: "first" } })
      .mockResolvedValueOnce({ ...updating, snapshotRefresh: { state: "UPDATING", version: "v1", check: "replacement" } })
      .mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    const recording = run(request);
    await vi.advanceTimersByTimeAsync(SNAPSHOT_REFRESH_DELAY_MS * 2);
    expect(request).toHaveBeenCalledTimes(3);
    expect(request.mock.calls[2]?.[1]).toBe("replacement");
    await vi.advanceTimersByTimeAsync(SNAPSHOT_REFRESH_BUDGET_MS - SNAPSHOT_REFRESH_DELAY_MS * 2);
    expect(request.mock.calls[2]?.[0].aborted).toBe(true);
    resolve({ value: "too late", snapshotRefresh: { state: "CURRENT", version: "v2" } });
    await vi.advanceTimersByTimeAsync(0);
    expect(recording.onResult).toHaveBeenCalledTimes(2);
    expect(recording.onError).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps a check inside its own round when a later response omits it", async () => {
    const request = vi.fn<(signal: AbortSignal, check?: string) => Promise<Result>>()
      .mockResolvedValue(updating)
      .mockResolvedValueOnce({ ...updating, snapshotRefresh: { state: "UPDATING", version: "v1", check: "first-round" } });
    const first = run(request);
    await vi.advanceTimersByTimeAsync(SNAPSHOT_REFRESH_DELAY_MS * 2);
    expect(request.mock.calls.map(([, check]) => check)).toEqual([undefined, "first-round", "first-round"]);
    first.cancel();
    const second = run(request);
    await vi.advanceTimersByTimeAsync(0);
    expect(request.mock.lastCall?.[1]).toBeUndefined();
    second.cancel();
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
