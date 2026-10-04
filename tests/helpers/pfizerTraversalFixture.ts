/** Invented offline rows and native details for the current Pfizer traversal contract. */
import { createWorkdaySourceFetch } from "../../src/crawler/workdaySourceFetch";
import { buildStagedSourceCrawlPlans } from "../../src/crawler/sourcePlan";
import { candidateCompanies } from "../../src/data/companyRegistry";

export async function captureSyntheticPfizerTraversal(count: number, capturedAt: string, laterZero = false) {
  const plan = buildStagedSourceCrawlPlans(candidateCompanies).find(p => p.source.id === "source-pfizer-china-social")!;
  const rows = Array.from({ length: count }, (_, index) => {
    const id = String(4960000 + index);
    return { title: `Official role ${id}`, externalPath: `/job/China/Official-role_${id}`,
      locationsText: "China - Shanghai - Shanghai", bulletFields: [id] };
  });
  const response = (url: string, payload: unknown) => ({ status: 200, body: JSON.stringify(payload),
    finalUrl: url, contentType: "application/json; charset=utf-8", capturedAt });
  const fetch = createWorkdaySourceFetch({
    now: () => new Date(capturedAt),
    http: async request => {
      const { offset, limit } = JSON.parse(request.body) as { offset: number; limit: number };
      return response(request.url, { total: laterZero && offset > 0 ? 0 : rows.length,
        jobPostings: rows.slice(offset, offset + limit) });
    },
    detailHttp: async request => {
      const row = rows.find(row => request.url.endsWith(row.externalPath));
      if (!row) throw Error("SYNTHETIC_PFIZER_UNEXPECTED_DETAIL");
      return response(request.url, { jobPostingInfo: { title: row.title, jobReqId: row.bulletFields[0],
        jobPostingSiteId: "PfizerCareers", externalUrl: plan.source.officialEntryUrl + row.externalPath,
        location: row.locationsText, country: { descriptor: "China", id: "6cb77610a8a543aea2d6bc10457e35d4" },
        jobRequisitionLocation: { country: { descriptor: "China", alpha2Code: "CN" } },
        posted: true, canApply: true, startDate: "2026-07-01",
        jobDescription: "Synthetic pharmaceutical duties and application requirements. ".repeat(5) } });
    }
  });
  const fetched = await fetch(plan);
  if (!fetched.ok || !fetched.fetchEvidence || !fetched.paginationEvaluation) {
    throw Error(fetched.ok ? "Missing synthetic Pfizer evidence" : fetched.failureReason);
  }
  return { plan, fetched: { ...fetched, fetchEvidence: fetched.fetchEvidence, paginationEvaluation: fetched.paginationEvaluation } };
}
