// @vitest-environment node
import { createNovoSyntheticFixture, NOVO_SYNTHETIC_BODY_SHA256 } from "../helpers/novoSyntheticFixture";
import { afterEach, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { candidateCompanies } from "../../src/data/companyRegistry";
import { buildStagedSourceCrawlPlans, getPlanBySourceId } from "../../src/crawler/sourcePlan";
import { createOfficialJsonSourceFetch } from "../../src/crawler/officialJsonSourceFetch";
import { runSourceCrawl } from "../../src/crawler/runSourceCrawl";
import { runWithOfficialSourceAttemptTimeout } from "../../src/crawler/officialHttpRuntimeLimits";

const dirs: string[] = [];
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); dirs.splice(0).forEach(path => rmSync(path, { recursive: true, force: true })); });

it("uses the normal Novo HTTP client and retains every synthetic response body exactly (no network)", async () => {
  const endpoint = "https://www.novonordisk.com.cn/bin/nncorp/careersearch?keyword=&country=China&category=&locale=zh-cn";
  const { body, captures } = createNovoSyntheticFixture();
  const directory = mkdtempSync(join(tmpdir(), "novo-http-lifecycle-test-")); dirs.push(directory);
  const path = join(directory, "requests.jsonl"); vi.stubEnv("P0_OFFICIAL_HTTP_DIAGNOSTICS_PATH", path);
  const responses: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
    expect(init.method).toBe("GET"); expect(init.signal).toBeInstanceOf(AbortSignal);
    const retained = url === endpoint ? { body, finalUrl: endpoint, contentType: "application/json;charset=utf-8" } : captures[url];
    if (!retained) throw Error("Unexpected synthetic URL");
    responses.push(retained.body);
    const response = new Response(retained.body, { status: 200, headers: { "content-type": retained.contentType } });
    Object.defineProperty(response, "url", { value: retained.finalUrl });
    return response;
  }));
  const plan = getPlanBySourceId(buildStagedSourceCrawlPlans(candidateCompanies), "source-novo-nordisk-china-social")!;
  const result = await runWithOfficialSourceAttemptTimeout(() => runSourceCrawl(plan, {
    fetch: createOfficialJsonSourceFetch({ allowBrowserFallback: false, now: () => new Date("2026-10-02T01:44:06.473Z") }),
    isBaseline: true
  }));
  expect(result).toMatchObject({ status: "SUCCESS", fetchEvidence: { fetchCounts: { rawCount: 27, validCount: 20, validationDiscardCount: 7 } } });
  const evidenceBodies = result.fetchEvidence!.artifacts.map(artifact => artifact.body);
  expect(evidenceBodies).toEqual(responses);
  expect(createHash("sha256").update(evidenceBodies[0]!).digest("hex"))
    .toBe(NOVO_SYNTHETIC_BODY_SHA256);
  const records = readFileSync(path, "utf8").trim().split("\n").map(line => JSON.parse(line));
  expect(records.filter(row => row.event === "REQUEST_START")).toHaveLength(responses.length);
  expect(records.filter(row => row.event === "HEADERS_RECEIVED")).toHaveLength(responses.length);
  expect(records.filter(row => row.event === "BODY_COMPLETE")).toHaveLength(responses.length);
  expect(records.some(row => row.event.endsWith("FAILED"))).toBe(false);
});
