import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import {
  createAbortableClose,
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
  scheduledAttemptMaxRunningAgeHours,
  scheduledAttemptTimeoutMs
} from "../../src/crawler/officialHttpRuntimeLimits";

describe("official crawl runtime limits", () => {
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
