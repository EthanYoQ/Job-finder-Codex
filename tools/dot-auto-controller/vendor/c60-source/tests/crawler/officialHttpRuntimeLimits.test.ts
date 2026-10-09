import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import {
  createAbortableClose,
  currentOfficialSourceAttemptRemainingMs,
  currentOfficialSourceAttemptSignal,
  DEFAULT_OFFICIAL_HTTP_TIMEOUT_MS,
  DEFAULT_OFFICIAL_BROWSER_TIMEOUT_MS,
  DEFAULT_HCM_CLOUD_BROWSER_SETTLE_MS,
  DEFAULT_SOURCE_ATTEMPT_TIMEOUT_MS,
  DEFAULT_SCHEDULED_ATTEMPT_TIMEOUT_MS,
  fetchWithOfficialTimeout,
  hcmCloudBrowserSettleMs,
  officialBrowserTimeoutMs,
  officialHttpTimeoutMs,
  runWithOfficialSourceAttemptTimeout,
  runWithOfficialSourceCancellation,
  scheduledAttemptMaxRunningAgeHours,
  scheduledAttemptTimeoutMs
} from "../../src/crawler/officialHttpRuntimeLimits";

describe("official crawl runtime limits", () => {
  afterEach(() => { vi.useRealTimers(); });

  it("preserves the remaining source budget through cancellation and nested timeout contexts", async () => {
    vi.useFakeTimers();
    const startedAt = Date.now();
    const controller = new AbortController();
    expect(currentOfficialSourceAttemptRemainingMs()).toBeUndefined();

    await runWithOfficialSourceAttemptTimeout(async () => {
      expect(currentOfficialSourceAttemptRemainingMs()).toBe(30_000);
      vi.setSystemTime(startedAt + 2_000);
      await runWithOfficialSourceCancellation(controller.signal, async () => {
        expect(currentOfficialSourceAttemptRemainingMs()).toBe(28_000);
        await runWithOfficialSourceAttemptTimeout(async () => {
          expect(currentOfficialSourceAttemptRemainingMs()).toBe(28_000);
          vi.setSystemTime(startedAt + 3_000);
          expect(currentOfficialSourceAttemptRemainingMs()).toBe(27_000);
        }, 60_000);
        expect(currentOfficialSourceAttemptRemainingMs()).toBe(27_000);
      });
      expect(currentOfficialSourceAttemptRemainingMs()).toBe(27_000);
    }, 30_000);

    expect(currentOfficialSourceAttemptRemainingMs()).toBeUndefined();
    expect(currentOfficialSourceAttemptSignal()).toBeUndefined();
  });

  it("keeps an outer cancellation active when a source timeout is nested inside it", async () => {
    const controller = new AbortController();
    const lostOwnership = new Error("ownership lost");
    await expect(runWithOfficialSourceCancellation(controller.signal,
      () => runWithOfficialSourceAttemptTimeout(async () => {
        controller.abort(lostOwnership);
        expect(currentOfficialSourceAttemptSignal()?.aborted).toBe(true);
        expect(currentOfficialSourceAttemptRemainingMs()).toBe(0);
        return await new Promise<never>(() => undefined);
      }, 30_000)
    )).rejects.toBe(lostOwnership);
    expect(currentOfficialSourceAttemptRemainingMs()).toBeUndefined();
    expect(currentOfficialSourceAttemptSignal()).toBeUndefined();
  });

  it("does not replace an earlier outer deadline with a longer nested timeout", async () => {
    vi.useFakeTimers();
    let innerSignal: AbortSignal | undefined;
    let innerOperation!: Promise<never>;
    const source = runWithOfficialSourceAttemptTimeout(() => {
      innerOperation = runWithOfficialSourceAttemptTimeout(async () => {
        innerSignal = currentOfficialSourceAttemptSignal();
        return await new Promise<never>(() => undefined);
      }, 60_000);
      return innerOperation;
    }, 10_000);
    const rejected = expect(source).rejects.toMatchObject({ code: "OFFICIAL_SOURCE_ATTEMPT_TIMEOUT" });
    await vi.advanceTimersByTimeAsync(10_000);
    await rejected;
    await expect(innerOperation).rejects.toThrow("10000 milliseconds");
    expect(innerSignal?.aborted).toBe(true);
    expect(currentOfficialSourceAttemptRemainingMs()).toBeUndefined();
  });

  it("reports no source deadline for cancellation-only contexts and restores context afterward", async () => {
    const controller = new AbortController();
    await runWithOfficialSourceCancellation(controller.signal, async () => {
      expect(currentOfficialSourceAttemptRemainingMs()).toBeUndefined();
      expect(currentOfficialSourceAttemptSignal()).toBe(controller.signal);
    });
    expect(currentOfficialSourceAttemptRemainingMs()).toBeUndefined();
    expect(currentOfficialSourceAttemptSignal()).toBeUndefined();
  });

  it("closes an aborted browser exactly once and shares the same close promise", async () => {
    const controller = new AbortController();
    let finishClose!: () => void;
    const closeOperation = vi.fn(() => new Promise<void>((resolve) => { finishClose = resolve; }));
    const lifecycle = createAbortableClose(controller.signal, closeOperation);
    controller.abort(new Error("company deadline"));
    await Promise.resolve();
    const first = lifecycle.close();
    const second = lifecycle.close();
    expect(closeOperation).toHaveBeenCalledOnce();
    expect(first).toBe(second);
    finishClose();
    await first;
    lifecycle.dispose();
  });

  it("uses bounded production defaults and rejects unsafe environment overrides", () => {
    expect(DEFAULT_OFFICIAL_HTTP_TIMEOUT_MS).toBe(45_000);
    expect(DEFAULT_OFFICIAL_BROWSER_TIMEOUT_MS).toBe(60_000);
    expect(DEFAULT_HCM_CLOUD_BROWSER_SETTLE_MS).toBe(3_000);
    expect(DEFAULT_SOURCE_ATTEMPT_TIMEOUT_MS).toBe(300_000);
    expect(DEFAULT_SCHEDULED_ATTEMPT_TIMEOUT_MS).toBe(21_600_000);
    expect(officialHttpTimeoutMs({})).toBe(45_000);
    expect(officialHttpTimeoutMs({ P0_SOURCE_HTTP_TIMEOUT_MS: "30000" })).toBe(30_000);
    expect(officialHttpTimeoutMs({ P0_SOURCE_HTTP_TIMEOUT_MS: "0" })).toBe(45_000);
    expect(officialBrowserTimeoutMs({ P0_BROWSER_TIMEOUT_MS: "120000" })).toBe(120_000);
    expect(officialBrowserTimeoutMs({ P0_BROWSER_TIMEOUT_MS: "999999" })).toBe(60_000);
    expect(hcmCloudBrowserSettleMs({ P0_HCM_CLOUD_BROWSER_SETTLE_MS: "500" })).toBe(500);
    expect(hcmCloudBrowserSettleMs({ P0_HCM_CLOUD_BROWSER_SETTLE_MS: "0" })).toBe(3_000);
    expect(scheduledAttemptTimeoutMs({ P0_SCHEDULED_ATTEMPT_TIMEOUT_MS: "14400000" })).toBe(14_400_000);
    expect(scheduledAttemptTimeoutMs({ P0_SCHEDULED_ATTEMPT_TIMEOUT_MS: "86400001" })).toBe(21_600_000);
    expect(scheduledAttemptMaxRunningAgeHours({})).toBe(6.25);
    expect(scheduledAttemptMaxRunningAgeHours({ P0_SCHEDULED_ATTEMPT_TIMEOUT_MS: "14400000" })).toBe(4.25);
  });

  it("wires every default official HTTP family through the shared abortable request limit", () => {
    for (const path of [
      "src/crawler/hotjobLegacySourceFetch.ts",
      "src/crawler/hotjobWecruitSourceFetch.ts",
      "src/crawler/mokaSourceFetch.ts",
      "src/crawler/workdaySourceFetch.ts"
    ]) {
      const source = readFileSync(path, "utf8");
      expect(source, path).toContain("fetchWithOfficialTimeout");
      expect(source, path).not.toMatch(/\bawait\s+fetch\s*\(/u);
    }
  });

  it("aborts the active request at the company-level deadline", async () => {
    const fetchImpl = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
    }));
    await expect(runWithOfficialSourceAttemptTimeout(
      () => fetchWithOfficialTimeout("https://jobs.example.test", {}, { fetchImpl, timeoutMs: 120_000 }),
      25
    )).rejects.toMatchObject({ code: "OFFICIAL_SOURCE_ATTEMPT_TIMEOUT" });
  });

  it("aborts a hanging official request at the configured per-request deadline", async () => {
    const fetchImpl = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
    }));
    const started = Date.now();
    await expect(fetchWithOfficialTimeout("https://jobs.example.test", {}, { fetchImpl, timeoutMs: 25 }))
      .rejects.toMatchObject({ code: "OFFICIAL_HTTP_TIMEOUT" });
    expect(Date.now() - started).toBeLessThan(500);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });
});
