import { describe, expect, it } from "vitest";
import { profile_xinhua_pharma } from "../../src/crawler/companyRecruitmentProfiles/profiles/xinhua-pharma";
import {
  createXinhuaOfficialAnnouncementSourceFetch,
  validateStrictXinhuaOfficialAnnouncementReplay,
  XINHUA_OFFICIAL_ANNOUNCEMENT_PROFILE_BOUND_SOURCE,
  type XinhuaOfficialAnnouncementHttpRequest,
  type XinhuaOfficialAnnouncementHttpResponse
} from "../../src/crawler/xinhuaOfficialAnnouncementSourceFetch";
import { runSourceCrawl } from "../../src/crawler/runSourceCrawl";
import { parsePersistentSourceFetchEvidence } from "../../src/crawler/sourceFetchEvidence";
import {
  buildStagedSourceCrawlPlans,
  getPlanBySourceId,
  type SourceCrawlPlan
} from "../../src/crawler/sourcePlan";
import { candidateCompanies } from "../../src/data/companyRegistry";

const origin = "https://www.xhzy.com";
const desktopEntryUrl = `${origin}/SHZP/index.html`;
const mobileEntryUrl = `${origin}/SHZP/m_index.html`;
const currentDetailUrl = `${origin}/SHZP/2026-06-16/12351.html`;

const plan = {
  adapterId: "official-json",
  company: {
    id: "company-xinhua-pharma",
    officialChineseName: "山东新华制药股份有限公司"
  },
  source: {
    id: "source-xinhua-pharma-social",
    companyId: "company-xinhua-pharma",
    kind: "SOCIAL",
    atsKind: "OFFICIAL_JSON",
    status: "VERIFIED_SCRAPABLE",
    officialEntryUrl: desktopEntryUrl,
    officialChainEvidenceUrl: desktopEntryUrl
  },
  json: {
    jobsPath: "jobs",
    fields: {
      sourceJobId: "sourceJobId",
      officialTitle: "officialTitle",
      officialUrl: "officialUrl",
      locationRaw: "locationRaw",
      cities: "cities"
    },
    defaultCategory: "其他"
  },
  profileBoundSource: XINHUA_OFFICIAL_ANNOUNCEMENT_PROFILE_BOUND_SOURCE
} as unknown as SourceCrawlPlan;

interface FixtureOptions {
  now?: string;
  pages?: Readonly<Record<string, string>>;
}

function listHtml(detailLinks: readonly string[], paginationLinks: readonly string[] = []): string {
  return `<html><body><main class="social-recruitment-list">
    ${detailLinks.map((href) => `<article><a href="${href}">山东新华制药招聘简章</a></article>`).join("\n")}
    <nav class="pagination">${paginationLinks.map((href) => `<a href="${href}">下一页</a>`).join("\n")}</nav>
  </main></body></html>`;
}

function detailHtml(input: { deadlineText: string; image?: boolean }): string {
  return `<html><body><article>
    <h1>山东新华制药股份有限公司招聘简章</h1>
    <div class="RCMS_EDITOR">
      <p>五、招聘程序</p>
      <p>${input.deadlineText}</p>
      ${input.image ? '<img src="../../../SHZP/2026-06-16/jobs.png" alt="招聘岗位">' : ""}
    </div>
  </article></body></html>`;
}

function response(
  request: XinhuaOfficialAnnouncementHttpRequest,
  body: string,
  capturedAt: string
): XinhuaOfficialAnnouncementHttpResponse {
  return {
    status: 200,
    body,
    finalUrl: request.url,
    contentType: "text/html; charset=utf-8",
    capturedAt
  };
}

function fixture(options: FixtureOptions = {}) {
  const now = options.now ?? "2026-07-16T00:01:00.000Z";
  const pages: Readonly<Record<string, string>> = options.pages ?? {
    [desktopEntryUrl]: listHtml(["../SHZP/2026-06-16/12351.html"]),
    [mobileEntryUrl]: listHtml(["../SHZP/2026-06-16/12351.html"]),
    [currentDetailUrl]: detailHtml({
      deadlineText: "招聘报名时间：2026年6月17日-2026年6月24日",
      image: true
    })
  };
  const requests: XinhuaOfficialAnnouncementHttpRequest[] = [];
  const http = async (
    request: XinhuaOfficialAnnouncementHttpRequest
  ): Promise<XinhuaOfficialAnnouncementHttpResponse> => {
    requests.push(request);
    const body = pages[request.url];
    if (body === undefined) throw new Error(`unexpected URL ${request.url}`);
    return response(request, body, now);
  };
  return {
    requests,
    run: (runPlan: SourceCrawlPlan = plan) => createXinhuaOfficialAnnouncementSourceFetch({
      http,
      now: () => new Date(now)
    })(runPlan)
  };
}

function stagedXinhuaPlan(): Extract<SourceCrawlPlan, { adapterId: "official-json" }> {
  const staged = getPlanBySourceId(
    buildStagedSourceCrawlPlans(candidateCompanies),
    "source-xinhua-pharma-social"
  );
  if (staged?.adapterId !== "official-json" ||
    staged.profileBoundSource?.kind !== "xinhua-official-announcements") {
    throw new Error("Expected staged Xinhua profile-bound plan");
  }
  return staged;
}

describe("Xinhua official social announcement source", () => {
  it("passes the shared runSourceCrawl strict gate as an independently replayed official zero", async () => {
    const stagedPlan = stagedXinhuaPlan();
    const result = await fixture().run(stagedPlan);
    const crawled = await runSourceCrawl(stagedPlan, { fetch: async () => result });

    expect(crawled).toMatchObject({
      status: "SUCCESS",
      truth: {
        transportSuccess: true,
        adapterSuccess: true,
        completenessVerified: true
      },
      jobs: [],
      observation: {
        structuredJobCount: 0,
        completenessStatus: "VERIFIED"
      }
    });
  });

  it("makes runSourceCrawl reject an archived detail changed from expired to active", async () => {
    const stagedPlan = stagedXinhuaPlan();
    const result = await fixture().run(stagedPlan);
    if (!result.ok || !result.fetchEvidence) throw new Error("Expected complete staged Xinhua evidence");
    const fetchEvidence = structuredClone(parsePersistentSourceFetchEvidence(result.fetchEvidence));
    const detail = fetchEvidence.artifacts.find((artifact) => artifact.requestedUrl === currentDetailUrl);
    if (!detail) throw new Error("Missing staged Xinhua detail archive");
    detail.body = detailHtml({
      deadlineText: "招聘报名时间：2026年7月15日-2026年7月31日",
      image: true
    });

    const crawled = await runSourceCrawl(stagedPlan, {
      fetch: async () => ({ ...result, fetchEvidence })
    });
    expect(crawled.truth.completenessVerified).toBe(false);
    expect(crawled.observation.completenessStatus).not.toBe("VERIFIED");
  });

  it("proves the current official surface has zero open jobs without hardcoding zero", async () => {
    const source = fixture();
    const result = await source.run();

    expect(result).toMatchObject({
      ok: true,
      capturedAt: "2026-07-16T00:01:00.000Z",
      payload: { jobs: [] },
      completeness: {
        completenessStatus: "NEEDS_MANUAL_COMPLETENESS_REVIEW",
        expectedJobCount: 0,
        completenessEvidenceKind: "COMPLETE_PAGE_TRAVERSAL"
      }
    });
    if (!result.ok) throw new Error(result.failureReason);
    const evidence = parsePersistentSourceFetchEvidence(result.fetchEvidence);
    expect(evidence.fetchCounts).toEqual({
      rawCount: 0,
      parsedCount: 0,
      validCount: 0,
      parseDiscardCount: 0,
      validationDiscardCount: 0
    });
    expect(evidence.fetchLosses).toEqual([]);
    expect(validateStrictXinhuaOfficialAnnouncementReplay(plan, evidence, [])).toBe(true);
    expect(evidence.pages.map((page) => page.channelId)).toEqual(["desktop", "mobile"]);
    expect(evidence.artifacts.some((artifact) =>
      artifact.requestedUrl === currentDetailUrl && artifact.bodyRepresentation === "EXACT"
    )).toBe(true);
    expect(source.requests.map((request) => request.url)).toEqual([
      desktopEntryUrl,
      mobileEntryUrl,
      currentDetailUrl
    ]);
  });

  it("keeps an actually empty pair of official lists as an exact independently replayable zero", async () => {
    const source = fixture({
      pages: {
        [desktopEntryUrl]: listHtml([]),
        [mobileEntryUrl]: listHtml([])
      }
    });
    const result = await source.run();

    expect(result).toMatchObject({ ok: true, payload: { jobs: [] } });
    if (!result.ok) throw new Error(result.failureReason);
    const evidence = parsePersistentSourceFetchEvidence(result.fetchEvidence);
    expect(evidence.declaredCompleteness).toMatchObject({
      kind: "OFFICIAL_TOTAL_COUNT",
      value: 0
    });
    expect(evidence.pages.map((page) => page.termination)).toEqual(["EMPTY_PAGE", "EMPTY_PAGE"]);
    expect(validateStrictXinhuaOfficialAnnouncementReplay(plan, evidence, [])).toBe(true);
  });

  it("fails closed while the same image-only announcement is still accepting applications", async () => {
    const source = fixture({ now: "2026-06-20T00:01:00.000Z" });
    const result = await source.run();

    expect(result).toMatchObject({
      ok: false,
      failureReason: "XINHUA_ACTIVE_ANNOUNCEMENT_IMAGE_ONLY"
    });
    if (result.ok) throw new Error("expected fail-closed result");
    const evidence = parsePersistentSourceFetchEvidence(result.fetchEvidence);
    expect(evidence.fetchCounts.validCount).toBe(0);
    expect(evidence.fetchLosses[0]?.details).toMatchObject({
      code: "XINHUA_ACTIVE_IMAGE_ONLY_UNSTRUCTURED"
    });
  });

  it("treats the published deadline as inclusive through midnight in China", async () => {
    const lastSecond = await fixture({ now: "2026-06-24T15:59:59.999Z" }).run();
    expect(lastSecond).toMatchObject({
      ok: false,
      failureReason: "XINHUA_ACTIVE_ANNOUNCEMENT_IMAGE_ONLY"
    });

    const nextMidnight = await fixture({ now: "2026-06-24T16:00:00.000Z" }).run();
    expect(nextMidnight).toMatchObject({ ok: true, payload: { jobs: [] } });
  });

  it("enumerates every same-origin desktop and mobile pagination link", async () => {
    const secondDetailUrl = `${origin}/SHZP/2026-05-01/12000.html`;
    const desktopPage2 = `${origin}/SHZP/index_2.html`;
    const mobilePage2 = `${origin}/SHZP/m_index_2.html`;
    const source = fixture({
      pages: {
        [desktopEntryUrl]: listHtml(["../SHZP/2026-06-16/12351.html"], ["./index_2.html"]),
        [desktopPage2]: listHtml(["../SHZP/2026-05-01/12000.html"]),
        [mobileEntryUrl]: listHtml(["../SHZP/2026-06-16/12351.html"], ["./m_index_2.html"]),
        [mobilePage2]: listHtml(["../SHZP/2026-05-01/12000.html"]),
        [currentDetailUrl]: detailHtml({
          deadlineText: "招聘报名时间：2026年6月17日-2026年6月24日",
          image: true
        }),
        [secondDetailUrl]: detailHtml({
          deadlineText: "报名时间：2026年5月2日至2026年5月8日",
          image: true
        })
      }
    });
    const result = await source.run();

    expect(result).toMatchObject({ ok: true, payload: { jobs: [] } });
    if (!result.ok) throw new Error(result.failureReason);
    const evidence = parsePersistentSourceFetchEvidence(result.fetchEvidence);
    expect(evidence.pages).toHaveLength(4);
    expect(evidence.fetchCounts).toEqual({
      rawCount: 0,
      parsedCount: 0,
      validCount: 0,
      parseDiscardCount: 0,
      validationDiscardCount: 0
    });
    expect(source.requests.map((request) => request.url)).toEqual([
      desktopEntryUrl,
      desktopPage2,
      mobileEntryUrl,
      mobilePage2,
      secondDetailUrl,
      currentDetailUrl
    ]);
    expect(source.requests.every((request) =>
      request.method === "GET" && new URL(request.url).origin === origin
    )).toBe(true);
    expect(evidence.pages[0]?.nextPageSignalAfter).toBe(desktopPage2);
    expect(evidence.pages[1]?.nextPageSignalBefore).toBe(desktopPage2);
    expect(evidence.pages[2]?.nextPageSignalAfter).toBe(mobilePage2);
    expect(evidence.pages[3]?.nextPageSignalBefore).toBe(mobilePage2);
    expect(validateStrictXinhuaOfficialAnnouncementReplay(plan, evidence, [])).toBe(true);
  });

  it("independently rejects an archived active announcement even when the fetch result claimed zero", async () => {
    const result = await fixture().run();
    if (!result.ok) throw new Error(result.failureReason);
    const evidence = structuredClone(parsePersistentSourceFetchEvidence(result.fetchEvidence));
    const detail = evidence.artifacts.find((artifact) => artifact.requestedUrl === currentDetailUrl);
    if (!detail) throw new Error("missing archived detail artifact");
    detail.body = detailHtml({
      deadlineText: "招聘报名时间：2026年7月15日-2026年7月31日",
      image: true
    });

    expect(evidence.fetchCounts.validCount).toBe(0);
    expect(validateStrictXinhuaOfficialAnnouncementReplay(plan, evidence, [])).toBe(false);
  });

  it("independently rejects trace identifiers that do not match the archived list body", async () => {
    const result = await fixture().run();
    if (!result.ok) throw new Error(result.failureReason);
    const evidence = structuredClone(parsePersistentSourceFetchEvidence(result.fetchEvidence));
    evidence.pages[0]!.rawJobIds = ["2026-01-01-99999"];
    evidence.pages[0]!.validJobIds = ["2026-01-01-99999"];

    expect(validateStrictXinhuaOfficialAnnouncementReplay(plan, evidence, [])).toBe(false);
  });

  it("fails closed for a still-active text announcement until job rows are structurally supported", async () => {
    const source = fixture({
      now: "2026-06-20T00:01:00.000Z",
      pages: {
        [desktopEntryUrl]: listHtml(["../SHZP/2026-06-16/12351.html"]),
        [mobileEntryUrl]: listHtml(["../SHZP/2026-06-16/12351.html"]),
        [currentDetailUrl]: detailHtml({
          deadlineText: "招聘报名时间：2026年6月17日-2026年6月24日"
        })
      }
    });

    await expect(source.run()).resolves.toMatchObject({
      ok: false,
      failureReason: "XINHUA_ACTIVE_ANNOUNCEMENT_UNSUPPORTED_STRUCTURE"
    });
  });

  it("fails closed when an announcement does not expose one unambiguous application deadline", async () => {
    const source = fixture({
      pages: {
        [desktopEntryUrl]: listHtml(["../SHZP/2026-06-16/12351.html"]),
        [mobileEntryUrl]: listHtml(["../SHZP/2026-06-16/12351.html"]),
        [currentDetailUrl]: detailHtml({
          deadlineText: "报名时间另行通知",
          image: true
        })
      }
    });
    const result = await source.run();

    expect(result).toMatchObject({
      ok: false,
      failureReason: "XINHUA_ANNOUNCEMENT_DEADLINE_UNPROVEN"
    });
  });

  it("fails closed when the official social list introduces an unsupported recruitment URL shape", async () => {
    const source = fixture({
      pages: {
        [desktopEntryUrl]: `<html><body><main class="social-recruitment-list"><article>
          <a href="../SHZP/notice/next-hiring.html">山东新华制药新一轮招聘公告</a>
        </article></main></body></html>`,
        [mobileEntryUrl]: listHtml([])
      }
    });

    await expect(source.run()).resolves.toMatchObject({
      ok: false,
      failureReason: "XINHUA_UNSUPPORTED_RECRUITMENT_LINK"
    });
  });

  it("uses the company profile to request the official-json job envelope", () => {
    expect(profile_xinhua_pharma.sources).toEqual([
      expect.objectContaining({
        sourceId: "source-xinhua-pharma-social",
        executionConfig: expect.objectContaining({
          adapterId: "official-json",
          json: expect.objectContaining({ jobsPath: "jobs" }),
          profileBoundSource: XINHUA_OFFICIAL_ANNOUNCEMENT_PROFILE_BOUND_SOURCE
        })
      })
    ]);
  });
});
