import { describe, expect, it } from "vitest";
import {
  createOfficialJsonSourceFetch,
  type OfficialJsonHttpResponse
} from "../../src/crawler/officialJsonSourceFetch";
import { runSourceCrawl } from "../../src/crawler/runSourceCrawl";
import type { SourceCrawlPlan } from "../../src/crawler/sourcePlan";

const NOW = "2026-07-11T00:00:00.000Z";
const ENTRY = "https://daiichisankyo.cnstaff.com/recruit";

function plan(overrides: Record<string, unknown> = {}): SourceCrawlPlan {
  return {
    adapterId: "official-json",
    company: { id: "company-cnstaff", officialChineseName: "第一三共（中国）" },
    source: {
      id: "source-cnstaff-social",
      companyId: "company-cnstaff",
      kind: "SOCIAL",
      atsKind: "OFFICIAL_JSON",
      status: "VERIFIED_SCRAPABLE",
      officialEntryUrl: ENTRY,
      officialChainEvidenceUrl: ENTRY
    },
    json: {
      jobsPath: "jobs",
      fields: {
        sourceJobId: "sourceJobId",
        officialTitle: "title",
        officialUrl: "officialUrl",
        locationRaw: "locationRaw",
        cities: "cities"
      }
    },
    officialJsonFetch: { kind: "cnstaff", pageSize: 2, maxPages: 5, ...overrides }
  };
}

function pageUrl(page: number): string {
  const url = new URL(ENTRY);
  url.searchParams.set("n", "1");
  url.searchParams.set("p", String(page));
  return url.toString();
}

function response(body: unknown, page = 1, overrides: Partial<OfficialJsonHttpResponse> = {}): OfficialJsonHttpResponse {
  return {
    status: 200,
    finalUrl: pageUrl(page),
    contentType: "application/json; charset=utf-8",
    capturedAt: NOW,
    body: typeof body === "string" ? body : JSON.stringify(body),
    ...overrides
  };
}

function job(id: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    job_id: id,
    job_publish_id: `publish-${id}`,
    job_name_show: `医学岗位 ${id}`,
    job_address_name: "上海市",
    ...overrides
  };
}

function body(list: unknown[], page: number, total = list.length, totalPages = 1): Record<string, unknown> {
  return { total, page: { total: totalPages, now: page }, list };
}

function withoutOpaqueBodies(value: unknown): string {
  const clone = structuredClone(value) as { fetchEvidence?: { artifacts?: Array<Record<string, unknown>> } };
  for (const artifact of clone.fetchEvidence?.artifacts ?? []) artifact.body = "[OPAQUE]";
  return JSON.stringify(clone);
}

describe("CNStaff evidence instrumentation", () => {
  it("retains exact pages, observed coordinates, counts, and manual D1 evidence", async () => {
    const bodies = [JSON.stringify(body([job("1"), job("2")], 1, 3, 2)), JSON.stringify(body([job("3")], 2, 3, 2))];
    let call = 0;
    const result = await createOfficialJsonSourceFetch({
      now: () => new Date(NOW),
      http: async () => {
        const index = call++;
        return response(bodies[index]!, index + 1);
      }
    })(plan());

    expect(result).toMatchObject({
      ok: true,
      completeness: {
        completenessStatus: "NEEDS_MANUAL_COMPLETENESS_REVIEW",
        expectedJobCount: 3,
        completenessEvidenceKind: "OFFICIAL_TOTAL_COUNT",
        totalPages: 2,
        pageSize: 2,
        pagesVisited: 2
      },
      fetchEvidence: {
        fetchCounts: { rawCount: 3, parsedCount: 3, validCount: 3, parseDiscardCount: 0, validationDiscardCount: 0 },
        declaredCompleteness: { kind: "OFFICIAL_TOTAL_COUNT", value: 3, scope: "SOURCE" }
      }
    });
    if (!result.fetchEvidence) throw new Error("expected CNStaff evidence");
    expect(result.fetchEvidence.artifacts.map(({ logicalKey, body: raw }) => ({ logicalKey, body: raw }))).toEqual([
      { logicalKey: "cnstaff-page-0001", body: bodies[0] },
      { logicalKey: "cnstaff-page-0002", body: bodies[1] }
    ]);
    expect(result.fetchEvidence.artifacts[0]?.extractorLocator).toContain("json:$.total,$.page.total,$.page.now,$.list");
    expect(result.fetchEvidence.pages).toMatchObject([
      { requestedPage: 1, returnedPage: 1, declaredTotal: 3, declaredPages: 2, termination: "CONTINUE" },
      { requestedPage: 2, returnedPage: 2, declaredTotal: 3, declaredPages: 2, termination: "NEXT_ABSENT" }
    ]);
    expect(result.paginationEvaluation).toMatchObject({ safeCompleteness: true, verifiedEligible: false });
  });

  it.each([
    ["invalid JSON", "{"],
    ["array root", []],
    ["missing list", { total: 0, page: { total: 0, now: 1 } }],
    ["invalid list", { total: 0, page: { total: 0, now: 1 }, list: {} }],
    ["missing page", { total: 0, list: [] }],
    ["invalid page", { total: 0, page: [], list: [] }],
    ["invalid total", { total: "0", page: { total: 0, now: 1 }, list: [] }],
    ["invalid pages", { total: 0, page: { total: -1, now: 1 }, list: [] }],
    ["invalid returned page", { total: 0, page: { total: 0, now: "1" }, list: [] }],
    ["duplicate nested key", '{"total":0,"page":{"total":0,"now":1,"now":1},"list":[]}']
  ])("fails closed and retains the current raw artifact for %s", async (_label, raw) => {
    const exact = typeof raw === "string" ? raw : JSON.stringify(raw);
    const result = await createOfficialJsonSourceFetch({ now: () => new Date(NOW), http: async () => response(exact) })(plan());
    expect(result.ok).toBe(false);
    expect(result.fetchEvidence?.artifacts[0]?.body).toBe(exact);
    expect(result.fetchEvidence?.pages[0]).toMatchObject({ requestedPage: 1, termination: "FAILED" });
  });

  it("accepts the exact Daiichi CNStaff HTML-labelled JSON variant and rejects other wrong MIME responses", async () => {
    const exact = JSON.stringify(body([], 1, 0, 0));
    const missing = await createOfficialJsonSourceFetch({ now: () => new Date(NOW), http: async () => ({ status: 200, body: exact }) })(plan());
    expect(missing).toMatchObject({ ok: false });
    expect(missing.fetchEvidence).toBeUndefined();

    const htmlLabelledJson = await createOfficialJsonSourceFetch({
      now: () => new Date(NOW),
      http: async () => response(exact, 1, { contentType: "text/html; charset=UTF-8" })
    })(plan());
    expect(htmlLabelledJson).toMatchObject({
      ok: true,
      fetchEvidence: { artifacts: [{ contentType: "text/html; charset=UTF-8", body: exact }] }
    });

    const wrongMime = await createOfficialJsonSourceFetch({ now: () => new Date(NOW), http: async () => response(exact, 1, { contentType: "text/plain" }) })(plan());
    expect(wrongMime).toMatchObject({ ok: false, fetchEvidence: { artifacts: [{ body: exact }] } });

    const wrongHtmlShape = JSON.stringify({ list: [], page: [] });
    const htmlWithoutCnstaffShape = await createOfficialJsonSourceFetch({
      now: () => new Date(NOW),
      http: async () => response(wrongHtmlShape, 1, { contentType: "text/html" })
    })(plan());
    expect(htmlWithoutCnstaffShape).toMatchObject({ ok: false, fetchEvidence: { artifacts: [{ body: wrongHtmlShape }] } });
  });

  it.each([
    ["returned page mismatch", [body([job("1")], 2, 1, 1)], "RETURNED_PAGE_MISMATCH"],
    ["unstable total", [body([job("1")], 1, 2, 2), body([job("2")], 2, 3, 2)], "TOTAL_CHANGED"],
    ["unstable pages", [body([job("1")], 1, 2, 2), body([job("2")], 2, 2, 3)], "TOTAL_CHANGED"],
    ["repeated ID set", [body([job("1")], 1, 2, 2), body([job("1")], 2, 2, 2)], "REPEATED_JOB_ID_SET_WITH_NEXT"],
    ["intermediate empty", [body([], 1, 1, 2)], "INTERMEDIATE_EMPTY_PAGE"]
  ])("uses shared D1 for %s", async (_label, pages, anomaly) => {
    let index = 0;
    const result = await createOfficialJsonSourceFetch({
      now: () => new Date(NOW),
      http: async () => response(pages[index]!, index++ + 1)
    })(plan());
    if (!result.ok) throw new Error(result.failureReason);
    if (!result.ok) throw new Error("expected CNStaff result");
    expect(result.paginationEvaluation?.derivedAnomalyCodes).toContain(anomaly);
    expect(result.paginationEvaluation?.safeCompleteness).toBe(false);
    expect(result.completeness?.completenessStatus).toBe("NEEDS_MANUAL_COMPLETENESS_REVIEW");
  });

  it("aborts without declarations or returned page and never derives observed pages", async () => {
    for (const raw of [{ page: { now: 1 }, list: [job("1")] }, { total: 1, page: { total: 1 }, list: [job("1")] }]) {
      const result = await createOfficialJsonSourceFetch({ now: () => new Date(NOW), http: async () => response(raw) })(plan());
      expect(result).toMatchObject({ ok: true, completeness: { completenessStatus: "NEEDS_MANUAL_COMPLETENESS_REVIEW", pagesVisited: 1 } });
      expect(result.fetchEvidence?.pages[0]).toMatchObject({ termination: "ABORTED" });
      expect(result.paginationEvaluation?.verifiedEligible).toBe(false);
    }
  });

  it("reconciles parse, validation, duplicate, scope, URL, and sensitive-output losses", async () => {
    const rows = [
      null,
      job("missing-title", { job_name_show: undefined }),
      job("dup"), job("dup"),
      job("foreign", { job_address_name: "Boston, United States" }),
      job("mixed", { job_address_name: "上海 / Boston, United States" }),
      job("unsafe/id"),
      job("secret", { job_name_show: "token=abc123" }),
      job("ok")
    ];
    const result = await createOfficialJsonSourceFetch({ now: () => new Date(NOW), http: async () => response(body(rows, 1, 9, 1)) })(plan());
    expect(result.fetchEvidence?.fetchCounts).toEqual({ rawCount: 9, parsedCount: 8, validCount: 2, parseDiscardCount: 1, validationDiscardCount: 6 });
    expect(result.fetchEvidence?.fetchLosses).toHaveLength(7);
    if (!result.ok) throw new Error("expected CNStaff result");
    expect(result.completeness?.completenessStatus).toBe("NEEDS_MANUAL_COMPLETENESS_REVIEW");
    expect(withoutOpaqueBodies(result)).not.toContain("abc123");
  });

  it("separately rejects official identity and detail URL identity collisions", async () => {
    const rows = [
      job("detail-a", { job_publish_id: "official-a" }),
      job("detail-b", { job_publish_id: "official-a" }),
      job("detail-a", { job_publish_id: "official-c" })
    ];
    const result = await createOfficialJsonSourceFetch({
      now: () => new Date(NOW), http: async () => response(body(rows, 1, 3, 1))
    })(plan());
    expect(result.fetchEvidence?.fetchCounts).toMatchObject({ rawCount: 3, validCount: 1, validationDiscardCount: 2 });
    expect(result.fetchEvidence?.fetchLosses.map((loss) => loss.details.code)).toEqual([
      "DUPLICATE_OFFICIAL_ID", "DUPLICATE_DETAIL_ID"
    ]);
  });

  it.each([
    "全国", "中国大陆", "河北省", "山东", "石家庄市", "济南", "沈阳", "郑州", "合肥",
    "长沙", "福州", "厦门", "昆明", "宁波", "温州", "珠海", "南宁", "贵阳", "海口",
    "哈尔滨", "长春", "乌鲁木齐市", "呼和浩特", "拉萨", "银川", "西宁",
    "上海市浦东新区", "北京市朝阳区", "天津市滨海新区", "重庆市渝中区"
  ])("accepts auditable mainland China geography: %s", async (location) => {
    const result = await createOfficialJsonSourceFetch({
      now: () => new Date(NOW),
      http: async () => response(body([job("geo", { job_address_name: location })], 1, 1, 1))
    })(plan());
    expect(result.fetchEvidence?.fetchCounts).toMatchObject({ validCount: 1, validationDiscardCount: 0 });
  });

  it.each(["Country", "country", "job_country", "job_country_name", "country_name"])(
    "uses own explicit China country alias %s without exposing its value",
    async (field) => {
      const result = await createOfficialJsonSourceFetch({
        now: () => new Date(NOW),
        http: async () => response(body([job("country", { job_address_name: "Remote", [field]: "Ｃｈｉｎａ" })], 1, 1, 1))
      })(plan());
      expect(result.fetchEvidence?.fetchCounts).toMatchObject({ validCount: 1, validationDiscardCount: 0 });
      expect(withoutOpaqueBodies(result)).not.toContain("Ｃｈｉｎａ");
    }
  );

  it.each([
    ["foreign country plus China location", { Country: "United States", job_address_name: "上海" }, "AMBIGUOUS_SCOPE"],
    ["China country plus foreign location", { country: "China", job_address_name: "Tokyo, Japan" }, "AMBIGUOUS_SCOPE"],
    ["unknown country plus China location", { job_country: "Atlantis", job_address_name: "北京" }, "OUT_OF_SCOPE"],
    ["foreign city with Chinese suffix", { job_address_name: "大阪市" }, "OUT_OF_SCOPE"]
  ])("rejects explicit or geographic scope attack: %s", async (_label, overrides, code) => {
    const result = await createOfficialJsonSourceFetch({
      now: () => new Date(NOW),
      http: async () => response(body([job("scope", overrides)], 1, 1, 1))
    })(plan());
    expect(result.fetchEvidence?.fetchCounts).toMatchObject({ validCount: 0, validationDiscardCount: 1 });
    expect(result.fetchEvidence?.fetchLosses[0]?.details.code).toBe(code);
  });

  it("rejects conflicting own country aliases and records only field names", async () => {
    const result = await createOfficialJsonSourceFetch({
      now: () => new Date(NOW),
      http: async () => response(body([
        job("conflict", { Country: "China", country_name: "United States", job_address_name: "上海" })
      ], 1, 1, 1))
    })(plan());
    if (!result.ok) throw new Error(result.failureReason);
    expect(result.fetchEvidence?.fetchLosses[0]).toMatchObject({
      rawLocator: expect.stringContaining("#countryFields:Country+country_name"),
      details: { code: "AMBIGUOUS_SCOPE", field: "Country" }
    });
    expect(withoutOpaqueBodies(result)).not.toContain("United States");
  });

  it.each(["中国香港", "中国澳门", "中国台湾", "香港", "澳门", "台湾", "Hong Kong", "Macao", "Macau", "Taiwan", "Taipei", "欧洲大陆"])(
    "does not treat non-mainland geography as mainland China: %s",
    async (location) => {
      const result = await createOfficialJsonSourceFetch({
        now: () => new Date(NOW),
        http: async () => response(body([job("non-mainland", { job_address_name: location })], 1, 1, 1))
      })(plan());
      expect(result.fetchEvidence?.fetchCounts).toMatchObject({ validCount: 0, validationDiscardCount: 1 });
      expect(result.fetchEvidence?.fetchLosses[0]?.details.code).toBe("OUT_OF_SCOPE");
    }
  );

  it.each(["香港", "澳门", "台湾", "Hong Kong", "Macau", "Taipei"])(
    "rejects explicit China country combined with non-mainland geography: %s",
    async (location) => {
      const result = await createOfficialJsonSourceFetch({
        now: () => new Date(NOW),
        http: async () => response(body([
          job("mixed-mainland", { Country: "China", job_address_name: location })
        ], 1, 1, 1))
      })(plan());
      expect(result.fetchEvidence?.fetchCounts).toMatchObject({ validCount: 0, validationDiscardCount: 1 });
      expect(result.fetchEvidence?.fetchLosses[0]?.details.code).toBe("AMBIGUOUS_SCOPE");
    }
  );

  it.each(["中国大陆", "中华人民共和国", "大陆地区"])(
    "accepts only explicit mainland aliases: %s",
    async (location) => {
      const result = await createOfficialJsonSourceFetch({
        now: () => new Date(NOW),
        http: async () => response(body([job("mainland-alias", { job_address_name: location })], 1, 1, 1))
      })(plan());
      expect(result.fetchEvidence?.fetchCounts).toMatchObject({ validCount: 1, validationDiscardCount: 0 });
    }
  );

  it.each([
    "China%20Hong%20Kong",
    encodeURIComponent("Taiwan"),
    encodeURIComponent("Macau"),
    encodeURIComponent("Taipei"),
    encodeURIComponent("中国香港"),
    encodeURIComponent("中国澳门"),
    encodeURIComponent("中国台湾"),
    encodeURIComponent("欧洲大陆"),
    encodeURIComponent(encodeURIComponent("香港")),
    encodeURIComponent("台湾").replaceAll("%", "％")
  ])("rejects encoded non-mainland scope: %s", async (location) => {
    const result = await createOfficialJsonSourceFetch({
      now: () => new Date(NOW),
      http: async () => response(body([job("encoded-foreign", { job_address_name: location })], 1, 1, 1))
    })(plan());
    expect(result.fetchEvidence?.fetchCounts).toMatchObject({ validCount: 0, validationDiscardCount: 1 });
    expect(result.fetchEvidence?.fetchLosses[0]?.details.code).toBe("OUT_OF_SCOPE");
  });

  it.each([
    encodeURIComponent("上海"),
    encodeURIComponent("中国大陆"),
    encodeURIComponent(encodeURIComponent("上海")),
    encodeURIComponent("中国大陆").replaceAll("%", "％")
  ])("accepts bounded encoded mainland scope: %s", async (location) => {
    const result = await createOfficialJsonSourceFetch({
      now: () => new Date(NOW),
      http: async () => response(body([job("encoded-mainland", { job_address_name: location })], 1, 1, 1))
    })(plan());
    expect(result.fetchEvidence?.fetchCounts).toMatchObject({ validCount: 1, validationDiscardCount: 0 });
  });

  it.each([
    "%E4%B8",
    encodeURIComponent(encodeURIComponent(encodeURIComponent("上海")))
  ])("fails closed on malformed or over-nested scope encoding: %s", async (location) => {
    const result = await createOfficialJsonSourceFetch({
      now: () => new Date(NOW),
      http: async () => response(body([job("encoded-invalid", { job_address_name: location })], 1, 1, 1))
    })(plan());
    expect(result.fetchEvidence?.fetchCounts).toMatchObject({ validCount: 0, validationDiscardCount: 1 });
    expect(result.fetchEvidence?.fetchLosses[0]?.details.code).toBe("OUT_OF_SCOPE");
  });

  it.each([
    ["pages end before total", body([job("1")], 1, 2, 1)],
    ["positive total with zero pages", body([], 1, 1, 0)]
  ])("fails closed on contradictory official declarations: %s", async (_label, raw) => {
    const result = await createOfficialJsonSourceFetch({ now: () => new Date(NOW), http: async () => response(raw) })(plan());
    expect(result).toMatchObject({ ok: false, fetchEvidence: { pages: [{ termination: "FAILED" }] } });
  });

  it("exposes max-page exhaustion with next only through shared D1", async () => {
    const result = await createOfficialJsonSourceFetch({
      now: () => new Date(NOW), http: async () => response(body([job("1")], 1, 2, 2))
    })(plan({ maxPages: 1 }));
    expect(result).toMatchObject({ ok: true, paginationEvaluation: { safeCompleteness: false } });
    expect(result.paginationEvaluation?.derivedAnomalyCodes).toContain("MAX_PAGES_WITH_NEXT");
  });

  it("retains prior evidence on later transport failure and passes exact references through runSourceCrawl", async () => {
    let call = 0;
    const fetch = createOfficialJsonSourceFetch({
      now: () => new Date(NOW),
      http: async () => {
        call += 1;
        if (call === 2) throw new Error("credential token=do-not-leak");
        return response(body([job("1")], 1, 2, 2), 1);
      }
    });
    const direct = await fetch(plan());
    expect(direct).toMatchObject({ ok: false, fetchEvidence: { pages: [{ termination: "ABORTED" }] } });
    expect(JSON.stringify(direct)).not.toContain("do-not-leak");

    const through = await runSourceCrawl(plan(), { fetch: async () => direct });
    expect(through.fetchEvidence).toBe(direct.fetchEvidence);
    expect(through.paginationEvaluation).toBe(direct.paginationEvaluation);
  });
});
