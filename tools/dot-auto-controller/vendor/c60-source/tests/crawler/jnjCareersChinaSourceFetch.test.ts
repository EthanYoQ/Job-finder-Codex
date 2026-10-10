import { describe, expect, it, vi } from "vitest";
import {
  JNJ_CAREERS_CHINA_FETCH_CONFIG,
  auditJnjCareersChinaResultSet,
  createJnjCareersChinaSourceFetch,
  parseJnjCareersChinaPage,
  validateStrictJnjCareersChinaEvidence,
  type JnjCareersHttpResponse
} from "../../src/crawler/jnjCareersChinaSourceFetch";
import type { SourceCrawlPlan } from "../../src/crawler/sourcePlan";
import { buildStagedSourceCrawlPlans } from "../../src/crawler/sourcePlan";
import { runSourceCrawl } from "../../src/crawler/runSourceCrawl";
import { candidateCompanies } from "../../src/data/companyRegistry";

const NOW = "2026-09-02T04:00:00.000Z";

function pageHtml(first: number, last: number, total: number, ids: readonly string[]): string {
  return `<main>
    <form><label>Country / Territory</label><select name="country"><option value="China" selected>China</option></select></form>
    <h2>Displaying <strong>${first}</strong> to <strong>${last}</strong> of <strong>${total}</strong> matching jobs</h2>
    <ul class="PageList-items">${ids.map((id, index) => `<li class="PageList-items-item card-job" data-id="r-${id}">
      <h3 class="PagePromo-title"><a href="/en/jobs/r-${id}/role-${id}/">Role ${id}</a></h3>
      <div class="PagePromo-category">${index % 2 === 0 ? "Pharmaceutical Sales" : "MedTech Sales"}</div>
      <address class="PagePromo-location">Nanjing</address>
    </li>`).join("")}</ul>
  </main>`;
}

function ids(from: number, through: number): string[] {
  return Array.from({ length: through - from + 1 }, (_, index) => String(from + index).padStart(6, "0"));
}

function response(url: string, body: string): JnjCareersHttpResponse {
  return { status: 200, body, finalUrl: url, contentType: "text/html; charset=utf-8", capturedAt: NOW };
}

function plan(): SourceCrawlPlan {
  const staged = buildStagedSourceCrawlPlans(candidateCompanies).find(
    (candidate) => candidate.source.id === "source-johnson-innovative-medicine-social"
  );
  if (!staged) throw new Error("Expected staged J&J group-China plan");
  return staged;
}

describe("JNJ public China careers audit", () => {
  it("replays every country-filtered page and closes the declared total without loss", async () => {
    const expectedUrls = [
      "https://www.careers.jnj.com/en/jobs/?search=&country=China&pagesize=20",
      "https://www.careers.jnj.com/en/jobs/?page=2&country=China&pagesize=20",
      "https://www.careers.jnj.com/en/jobs/?page=3&country=China&pagesize=20"
    ];
    const bodies = [
      pageHtml(1, 20, 41, ids(1, 20)),
      pageHtml(21, 40, 41, ids(21, 40)),
      pageHtml(41, 41, 41, ids(41, 41))
    ];
    const requested: Array<{ url: string; userAgent: string | undefined }> = [];
    const result = await auditJnjCareersChinaResultSet(JNJ_CAREERS_CHINA_FETCH_CONFIG, {
      http: async (request) => {
        requested.push({ url: request.url, userAgent: request.headers["User-Agent"] });
        const index = expectedUrls.indexOf(request.url);
        if (index < 0) throw new Error("unexpected request");
        return response(request.url, bodies[index]!);
      }
    });

    expect(result).toMatchObject({ ok: true, total: 41, pagesVisited: 3 });
    expect(result.ok && result.jobs).toHaveLength(41);
    expect(result.ok && new Set(result.jobs.map((job) => job.officialId)).size).toBe(41);
    expect(requested.map(({ url }) => url)).toEqual(expectedUrls);
    expect(requested.every(({ userAgent }) => userAgent?.startsWith("Mozilla/5.0 "))).toBe(true);
  });

  it("rejects total drift and cross-page duplicate requisitions", async () => {
    for (const secondPage of [
      pageHtml(21, 40, 42, ids(21, 40)),
      pageHtml(21, 40, 41, ["000001", ...ids(22, 40)])
    ]) {
      let call = 0;
      const result = await auditJnjCareersChinaResultSet(JNJ_CAREERS_CHINA_FETCH_CONFIG, {
        http: async (request) => response(request.url, call++ === 0
          ? pageHtml(1, 20, 41, ids(1, 20))
          : secondPage)
      });
      expect(result).toEqual({ ok: false, failureCode: "JNJ_PAGINATION_DRIFT" });
    }
  });

  it("parses only exact official J&J job links and rejects a lossy page", () => {
    const lossy = pageHtml(1, 2, 2, ["000001"]).replace(
      "</ul>",
      '<li><a href="https://attacker.example/en/jobs/r-000002/role/">Role 2</a></li></ul>'
    );
    expect(parseJnjCareersChinaPage(lossy, 1, 20)).toBeUndefined();
  });

  it("rejects a global results page that merely contains China as an unselected filter option", () => {
    const global = pageHtml(1, 20, 1_472, ids(1, 20)).replace(
      '<option value="China" selected>',
      '<option value="China">'
    );
    expect(parseJnjCareersChinaPage(global, 1, 20)).toBeUndefined();
  });

  it("maps the current official Jiaxing location without discarding the job", () => {
    const html = pageHtml(1, 1, 1, ["000001"]).replace(
      '<address class="PagePromo-location">Nanjing</address>',
      '<address class="PagePromo-location">Jiaxing</address>'
    );
    expect(parseJnjCareersChinaPage(html, 1, 20)?.jobs[0]).toMatchObject({
      locationRaw: "Jiaxing",
      cities: ["嘉兴"]
    });
  });

  it("publishes the complete user-authorized J&J group China result set with strict replay evidence", async () => {
    const fetcher = createJnjCareersChinaSourceFetch({
      now: () => new Date(NOW),
      http: async (request) => response(request.url, pageHtml(1, 1, 1, ["000001"]))
    });
    const sourcePlan = plan();
    const fetched = await fetcher(sourcePlan);
    expect(fetched).toMatchObject({
      ok: true,
      capturedAt: NOW,
      payload: { jobs: [{ sourceJobId: "r-000001", title: "Role 000001", locationRaw: "Nanjing", cities: ["南京"] }] },
      fetchEvidence: {
        declaredCompleteness: { kind: "OFFICIAL_TOTAL_COUNT", value: 1 },
        fetchCounts: { rawCount: 1, parsedCount: 1, validCount: 1, parseDiscardCount: 0,
          validationDiscardCount: 0 }
      }
    });
    expect(fetched).not.toHaveProperty("priorTransportAttempts");
    if (!fetched.ok || !fetched.fetchEvidence) throw new Error("Expected J&J group evidence");
    const crawl = await runSourceCrawl(sourcePlan, { fetch: async () => fetched });
    expect(validateStrictJnjCareersChinaEvidence(sourcePlan, fetched.fetchEvidence, crawl.jobs)).toBe(true);
    expect(crawl.truth).toEqual({ transportSuccess: true, adapterSuccess: true, completenessVerified: true });
  });

  it("falls back to the formal browser session after a blocked direct request and preserves both attempts", async () => {
    const close = vi.fn(async () => undefined);
    const fetcher = createJnjCareersChinaSourceFetch({
      now: () => new Date(NOW),
      http: async (request) => ({
        status: 403,
        body: "<html>blocked direct request</html>",
        finalUrl: request.url,
        contentType: "text/html; charset=utf-8",
        capturedAt: NOW
      }),
      browserSession: async () => ({
        close,
        http: async (request) => response(request.url, pageHtml(1, 1, 1, ["000001"]))
      })
    });
    const sourcePlan = plan();
    const fetched = await fetcher(sourcePlan);
    expect(fetched).toMatchObject({
      ok: true,
      priorTransportAttempts: [
        { transport: "DIRECT_HTTP", outcome: "FAILED", code: "JNJ_DIRECT_FAILED",
          fetchEvidence: { supportingArtifactOnlyFailure: { code: "JNJ_HTTP_FAILURE" } } },
        { transport: "BROWSER_SESSION", outcome: "SUCCEEDED", code: "JNJ_BROWSER_SUCCEEDED" }
      ]
    });
    expect(close).toHaveBeenCalledOnce();
    const crawl = await runSourceCrawl(sourcePlan, { fetch: async () => fetched });
    expect(crawl.truth).toEqual({ transportSuccess: true, adapterSuccess: true, completenessVerified: true });
  });

  it("fails closed with both attempt records when direct and browser transports are blocked", async () => {
    const close = vi.fn(async () => undefined);
    const blocked = async (request: { url: string }) => ({
      status: 403,
      body: "<html>blocked</html>",
      finalUrl: request.url,
      contentType: "text/html; charset=utf-8",
      capturedAt: NOW
    });
    const fetched = await createJnjCareersChinaSourceFetch({
      now: () => new Date(NOW),
      http: blocked,
      browserSession: async () => ({ close, http: blocked })
    })(plan());
    expect(fetched).toMatchObject({
      ok: false,
      failureReason: "JNJ_BROWSER_FETCH_FAILED",
      transportFailure: { code: "OFFICIAL_BROWSER_SESSION_ERROR", retryable: true, stage: "ENTRY" },
      priorTransportAttempts: [
        { transport: "DIRECT_HTTP", outcome: "FAILED", code: "JNJ_DIRECT_FAILED" },
        { transport: "BROWSER_SESSION", outcome: "FAILED", code: "JNJ_BROWSER_FETCH_FAILED",
          fetchEvidence: { supportingArtifactOnlyFailure: { code: "JNJ_HTTP_FAILURE" } } }
      ]
    });
    expect(close).toHaveBeenCalledOnce();
  });
});
