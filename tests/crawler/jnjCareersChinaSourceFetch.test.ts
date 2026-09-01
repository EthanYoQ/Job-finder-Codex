import { describe, expect, it } from "vitest";
import {
  JNJ_CAREERS_CHINA_FETCH_CONFIG,
  auditJnjCareersChinaResultSet,
  createJnjCareersChinaSourceFetch,
  parseJnjCareersChinaPage,
  type JnjCareersHttpResponse
} from "../../src/crawler/jnjCareersChinaSourceFetch";
import type { SourceCrawlPlan } from "../../src/crawler/sourcePlan";

const NOW = "2026-09-02T04:00:00.000Z";

function pageHtml(first: number, last: number, total: number, ids: readonly string[]): string {
  return `<main>
    <form><label>Country / Territory</label><span>China</span></form>
    <h2>Displaying <strong>${first}</strong> to <strong>${last}</strong> of <strong>${total}</strong> matching jobs</h2>
    <ul>${ids.map((id) => `<li><a href="/en/jobs/r-${id}/role-${id}/">Role ${id}</a></li>`).join("")}</ul>
  </main>`;
}

function ids(from: number, through: number): string[] {
  return Array.from({ length: through - from + 1 }, (_, index) => String(from + index).padStart(6, "0"));
}

function response(url: string, body: string): JnjCareersHttpResponse {
  return { status: 200, body, finalUrl: url, contentType: "text/html; charset=utf-8" };
}

function plan(): SourceCrawlPlan {
  return {
    adapterId: "official-json",
    company: { id: "company-johnson-innovative-medicine", officialChineseName: "强生创新制药", category: "FOREIGN_PHARMA" },
    source: {
      id: "source-johnson-innovative-medicine-social",
      companyId: "company-johnson-innovative-medicine",
      kind: "SOCIAL",
      atsKind: "OFFICIAL_JSON",
      status: "VERIFIED_SCRAPABLE",
      officialEntryUrl: JNJ_CAREERS_CHINA_FETCH_CONFIG.officialSearchUrl,
      officialChainEvidenceUrl: "https://www.jnjpharmaceutical.com.cn/en/about-jjp/company-overview"
    },
    json: {
      jobsPath: "jobs",
      fields: {
        sourceJobId: "sourceJobId",
        officialTitle: "title",
        officialUrl: "officialUrl",
        locationRaw: "locationRaw",
        cities: "cities"
      },
      defaultCategory: "其他"
    },
    profileBoundSource: {
      kind: "jnj-careers-china",
      config: JNJ_CAREERS_CHINA_FETCH_CONFIG
    },
    transportPolicy: { primary: "DIRECT_HTTP" }
  };
}

describe("JNJ public China careers audit", () => {
  it("replays every country-filtered page and closes the declared total without loss", async () => {
    const expectedUrls = [
      "https://www.careers.jnj.com/en/jobs/?country=China",
      "https://www.careers.jnj.com/en/jobs/?page=2&country=China",
      "https://www.careers.jnj.com/en/jobs/?page=3&country=China"
    ];
    const bodies = [
      pageHtml(1, 20, 41, ids(1, 20)),
      pageHtml(21, 40, 41, ids(21, 40)),
      pageHtml(41, 41, 41, ids(41, 41))
    ];
    const requested: string[] = [];
    const result = await auditJnjCareersChinaResultSet(JNJ_CAREERS_CHINA_FETCH_CONFIG, {
      http: async (request) => {
        requested.push(request.url);
        const index = expectedUrls.indexOf(request.url);
        if (index < 0) throw new Error("unexpected request");
        return response(request.url, bodies[index]!);
      }
    });

    expect(result).toMatchObject({ ok: true, total: 41, pagesVisited: 3 });
    expect(result.ok && result.jobs).toHaveLength(41);
    expect(result.ok && new Set(result.jobs.map((job) => job.officialId)).size).toBe(41);
    expect(requested).toEqual(expectedUrls);
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

  it("keeps the complete mixed J&J China result set quarantined", async () => {
    const fetcher = createJnjCareersChinaSourceFetch({
      now: () => new Date(NOW),
      http: async (request) => response(request.url, pageHtml(1, 1, 1, ["000001"]))
    });
    await expect(fetcher(plan())).resolves.toEqual({
      ok: false,
      capturedAt: NOW,
      failureReason: "JNJ_INNOVATIVE_MEDICINE_SCOPE_UNPROVEN"
    });
  });
});
