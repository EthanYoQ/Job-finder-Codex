import { describe, expect, it, vi } from "vitest";
import {
  captureQiluRenderedUiTraversal,
  isStrictQiluOfficialJobUrl,
  qiluRenderedLocationIsMainland
} from "../../src/crawler/qiluRenderedTraversalValidator";
import { createQiluBrowserTraversalValidation } from "../../src/crawler/traversalCertificate";

describe("Qilu rendered traversal location scope", () => {
  it.each([
    ["https://qilu-pharma.zhiye.com/social/detail?jobAdId=00000000-0000-4000-8000-000000000001", true],
    ["https://evil.example/social/detail?jobAdId=00000000-0000-4000-8000-000000000001", false],
    ["https://qilu-pharma.zhiye.com/social/detail?jobAdId=not-a-uuid", false],
    ["https://qilu-pharma.zhiye.com/social/detail?jobAdId=00000000-0000-4000-8000-000000000001&next=1", false],
    ["https://qilu-pharma.zhiye.com/social/detail?jobAdId=00000000-0000-4000-8000-000000000001#fragment", false]
  ])("validates the fixed official detail URL contract %#", (value, expected) => {
    expect(isStrictQiluOfficialJobUrl(value)).toBe(expected);
  });

  it.each([
    "北京市",
    "上海市",
    "山东省济南市",
    "山东省·济南市·历城区",
    "广西壮族自治区",
    "全国",
    "中国大陆"
  ])("accepts an explicit mainland administrative location: %s", (location) => {
    expect(qiluRenderedLocationIsMainland(location)).toBe(true);
  });

  it.each([
    "香港特别行政区",
    "美国",
    "United States of America",
    "日本东京",
    "日本大阪市",
    "Korea, Republic Of",
    ""
  ])("rejects a location without explicit mainland evidence: %s", (location) => {
    expect(qiluRenderedLocationIsMainland(location)).toBe(false);
  });

  it("keeps a multi-location role when one explicit alternative is mainland", () => {
    expect(qiluRenderedLocationIsMainland("上海市 / 香港特别行政区")).toBe(true);
  });

  it("binds every clicked row and independently replays its scope decision", () => {
    const validation = createQiluBrowserTraversalValidation({
      sourceConfigSha256: "a".repeat(64),
      surfaceIds: ["surface-qilu-social"],
      channelIds: ["source:source-qilu-social:default"],
      pages: [{
        pageNumber: 1,
        declaredTotalPages: 1,
        rawRows: [
          { officialUrl: "https://qilu-pharma.zhiye.com/social/detail?jobAdId=00000000-0000-4000-8000-000000000001", locationRaw: "山东省·济南市·历城区", scopeDecision: "INCLUDED_MAINLAND" },
          { officialUrl: "https://qilu-pharma.zhiye.com/social/detail?jobAdId=00000000-0000-4000-8000-000000000002", locationRaw: "美国", scopeDecision: "EXCLUDED_FOREIGN" }
        ],
        nextControlPresent: false
      }],
      observedAt: "2026-08-12T12:00:00.000Z",
      expiresAt: "2026-08-19T12:00:00.000Z"
    });
    expect(validation).toMatchObject({
      schemaVersion: "qilu-browser-traversal-validator-v2",
      pages: [{ matchKeys: [expect.stringContaining("000000000001")], rawRows: [{}, {}] }]
    });
    expect(() => createQiluBrowserTraversalValidation({
      sourceConfigSha256: "a".repeat(64),
      surfaceIds: ["surface-qilu-social"],
      channelIds: ["source:source-qilu-social:default"],
      pages: [{
        pageNumber: 1,
        declaredTotalPages: 1,
        rawRows: [{
          officialUrl: "https://qilu-pharma.zhiye.com/social/detail?jobAdId=00000000-0000-4000-8000-000000000002",
          locationRaw: "美国",
          scopeDecision: "INCLUDED_MAINLAND"
        }],
        nextControlPresent: false
      }],
      observedAt: "2026-08-12T12:00:00.000Z",
      expiresAt: "2026-08-19T12:00:00.000Z"
    })).toThrow(/scope replay/i);
    expect(() => createQiluBrowserTraversalValidation({
      sourceConfigSha256: "a".repeat(64),
      surfaceIds: ["surface-qilu-social"],
      channelIds: ["source:source-qilu-social:default"],
      pages: [{
        pageNumber: 1,
        declaredTotalPages: 1,
        rawRows: [{
          officialUrl: "https://evil.example/social/detail?jobAdId=00000000-0000-4000-8000-000000000002",
          locationRaw: "美国",
          scopeDecision: "EXCLUDED_FOREIGN"
        }],
        nextControlPresent: false
      }],
      observedAt: "2026-08-12T12:00:00.000Z",
      expiresAt: "2026-08-19T12:00:00.000Z"
    })).toThrow(/scope replay/i);
  });

  it("rejects the same raw official row repeated across rendered pages", () => {
    const row = {
      officialUrl: "https://qilu-pharma.zhiye.com/social/detail?jobAdId=00000000-0000-4000-8000-000000000002",
      locationRaw: "美国",
      scopeDecision: "EXCLUDED_FOREIGN" as const
    };
    expect(() => createQiluBrowserTraversalValidation({
      sourceConfigSha256: "a".repeat(64),
      surfaceIds: ["surface-qilu-social"],
      channelIds: ["source:source-qilu-social:default"],
      pages: [
        { pageNumber: 1, declaredTotalPages: 2, rawRows: [row], nextControlPresent: true },
        { pageNumber: 2, declaredTotalPages: 2, rawRows: [row], nextControlPresent: false }
      ],
      observedAt: "2026-08-12T12:00:00.000Z",
      expiresAt: "2026-08-19T12:00:00.000Z"
    })).toThrow(/duplicate raw job URLs/i);
  });

  it("rejects a non-mainland row outside the exact US or Hong Kong exclusion policy", () => {
    expect(() => createQiluBrowserTraversalValidation({
      sourceConfigSha256: "a".repeat(64),
      surfaceIds: ["surface-qilu-social"],
      channelIds: ["source:source-qilu-social:default"],
      pages: [{
        pageNumber: 1,
        declaredTotalPages: 1,
        rawRows: [{
          officialUrl: "https://qilu-pharma.zhiye.com/social/detail?jobAdId=00000000-0000-4000-8000-000000000007",
          locationRaw: "日本东京",
          scopeDecision: "EXCLUDED_FOREIGN"
        }],
        nextControlPresent: false
      }],
      observedAt: "2026-08-12T12:00:00.000Z",
      expiresAt: "2026-08-19T12:00:00.000Z"
    })).toThrow(/audited scope policy/i);
  });

  it("closes an aborted launch and releases the browser permit for the next validator", async () => {
    for (let iteration = 0; iteration < 2; iteration += 1) {
      const controller = new AbortController();
      const close = vi.fn(async () => undefined);
      await expect(captureQiluRenderedUiTraversal({
        entryUrl: "https://qilu-pharma.zhiye.com/social/jobs",
        signal: controller.signal,
        launchBrowser: async () => {
          controller.abort(new Error("cancelled during launch"));
          return { newPage: vi.fn() as never, close };
        }
      })).rejects.toThrow("cancelled during launch");
      expect(close).toHaveBeenCalledTimes(1);
    }
  });

  it("closes the browser and releases the permit after a page creation failure", async () => {
    const close = vi.fn(async () => undefined);
    await expect(captureQiluRenderedUiTraversal({
      entryUrl: "https://qilu-pharma.zhiye.com/social/jobs",
      launchBrowser: async () => ({
        newPage: vi.fn(async () => { throw new Error("page creation failed"); }) as never,
        close
      })
    })).rejects.toThrow("page creation failed");
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("closes exactly once when aborted after the active listener is installed", async () => {
    const controller = new AbortController();
    const close = vi.fn(async () => undefined);
    await expect(captureQiluRenderedUiTraversal({
      entryUrl: "https://qilu-pharma.zhiye.com/social/jobs",
      signal: controller.signal,
      launchBrowser: async () => ({
        newPage: vi.fn(async () => {
          controller.abort(new Error("cancelled while active"));
          throw controller.signal.reason;
        }) as never,
        close
      })
    })).rejects.toThrow("cancelled while active");
    expect(close).toHaveBeenCalledTimes(1);
  });
});
