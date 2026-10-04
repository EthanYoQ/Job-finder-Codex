/** Synthetic exact Organon rows for request-contract mutation tests; never live evidence. */
import { organonRow, organonBootstrap } from "../fixtures/organonChinaQuality";
import { irreversibleOfficialJsonEvidenceId, persistentOfficialJsonJobId } from "../../src/crawler/officialJsonEvidence";
import { organonBootstrapLocator } from "../../src/crawler/organonOfficialPostedDate";
import { createHash } from "node:crypto";

export { organonBootstrap, organonBootstrapLocator };
export function strictOrganonRow(id: string): Record<string, unknown> {
  const index = parseInt(createHash("sha256").update(id).digest("hex").slice(0, 6), 16);
  return organonRow(index, "Shanghai", { title: "Synthetic Manager", postedDate: "2026-07-14T00:00:00.000+0000" });
}
export function strictOrganonPayload(ids: readonly string[]) {
  return { jobs: ids.map(id => {
    const row = strictOrganonRow(id);
    return { sourceJobId: persistentOfficialJsonJobId(row.jobSeqNo as string), title: row.title,
      officialUrl: row.applyUrl, locationRaw: row.location, cities: ["上海"], officialPublishedAt: "2026-07-14T00:00:00.000Z" };
  }) };
}
export function strictOrganonRawId(id: string) { return irreversibleOfficialJsonEvidenceId(strictOrganonRow(id).jobSeqNo); }
export function strictOrganonValidId(id: string) { return irreversibleOfficialJsonEvidenceId(persistentOfficialJsonJobId(strictOrganonRow(id).jobSeqNo as string)); }
export function strictOrganonPageLocator(offset: number) {
  return ["phenom-page-v1", "entry:phenom-entry-0000",
    `config:${irreversibleOfficialJsonEvidenceId(organonBootstrapLocator(organonBootstrap))}`,
    `selectedFields:${irreversibleOfficialJsonEvidenceId(JSON.stringify({ country: ["China"] }))}`,
    `requestOffset:${offset}`, "json:$.refineSearch.totalHits"].join("|");
}

export async function captureStrictOrganon(plan: import("../../src/crawler/sourcePlan").SourceCrawlPlan, ids: readonly string[], capturedAt: string) {
  const { createOfficialJsonSourceFetch } = await import("../../src/crawler/officialJsonSourceFetch");
  const fetch = createOfficialJsonSourceFetch({ now: () => new Date(capturedAt), allowBrowserFallback: false,
    http: async request => {
      const requestBody = request.method === "POST" ? JSON.parse(request.body!) : undefined;
      return { status: 200, finalUrl: request.url, capturedAt,
        contentType: request.method === "POST" ? "application/json" : "text/html",
        body: request.method === "POST" ? JSON.stringify({ refineSearch: { totalHits: ids.length,
          from: requestBody.from, data: { jobs: ids.slice(requestBody.from, requestBody.from + requestBody.size).map(strictOrganonRow), aggregations: [] } } })
          : `<script>var phApp=${JSON.stringify(organonBootstrap)};</script>` };
    }
  });
  const result = await fetch(plan);
  if (!result.ok || !result.fetchEvidence || !result.paginationEvaluation) throw Error(result.ok ? "Missing Organon evidence" : result.failureReason);
  return { evidence: result.fetchEvidence, evaluation: result.paginationEvaluation, fetched: result };
}
