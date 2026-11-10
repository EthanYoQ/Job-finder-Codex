import type { PrismaClient } from "@prisma/client";
import { load } from "cheerio";
import { z } from "zod";
import { verifyArchivedSourceEvidence } from "../runner-candidate/src/crawler/artifactArchive";
import { SANOFI_CN_SOURCE } from "../runner-candidate/src/crawler/sanofiChineseNative";
import { SANOFI_CN_INDEPENDENT_PATH } from "../runner-candidate/src/crawler/sanofiChineseRenderedTraversal";
import { sanofiPersistentJobId } from "../runner-candidate/src/crawler/sanofiLegacyIdentity";
import { SANOFI_INDEPENDENT_ORIGINAL_LOCATOR } from "../runner-candidate/src/crawler/traversalCertificate";
import type { PortablePublicSnapshot } from "../web-candidate/src/db/portablePublicSnapshotRepository";
import { classifyJob } from "../web-candidate/src/domain/jobClassification";
import type { PortablePublicJob } from "../web-candidate/src/domain/portablePublicSnapshot";
import type { JobCategory } from "../web-candidate/src/domain/search";

const categories = new Map<string, JobCategory>([
  ["32102208:Sales", "销售"],
  ["32102272:Quality", "质量"],
  ["32102144:Production", "生产/工程"],
  ["32158528:Engineering", "生产/工程"],
  ["32116096:Supply Chain", "供应链/采购"]
]);
const archiveSchema = z.object({
  schemaVersion: z.literal("official-json-browser-network-traversal-v1"),
  sourceId: z.literal(SANOFI_CN_SOURCE),
  retrievalPath: z.literal(SANOFI_CN_INDEPENDENT_PATH),
  pages: z.array(z.object({ rawRows: z.array(z.unknown()) }))
});
const rowSchema = z.object({
  sourceJobId: z.string(),
  scopeMarker: z.literal("PUBLISHING"),
  scopeDecision: z.literal("INCLUDED_MAINLAND"),
  rawPayload: z.object({
    captureMethod: z.literal(SANOFI_CN_INDEPENDENT_PATH),
    domRow: z.object({ id: z.string().regex(/^\d+$/u), url: z.string().url() }),
    detailResponse: z.object({ method: z.literal("GET"), status: z.literal(200),
      url: z.string(), finalUrl: z.string(), body: z.string() })
  })
});

function readCategories(bytes: Buffer) {
  const archive = archiveSchema.parse(JSON.parse(bytes.toString("utf8")));
  const found = new Map<string, JobCategory | undefined>();
  for (const page of archive.pages) for (const raw of page.rawRows) {
    const row = rowSchema.safeParse(raw);
    if (!row.success) continue;
    const { sourceJobId, rawPayload: { domRow, detailResponse } } = row.data;
    const url = new URL(domRow.url);
    if (url.origin !== "https://jobs.sanofi.cn" || url.username || url.password || url.search || url.hash ||
        !url.pathname.endsWith(`/3036/${domRow.id}`) || detailResponse.url !== domRow.url || detailResponse.finalUrl !== domRow.url) continue;
    const end = detailResponse.body.search(/<\/head>/iu);
    if (end < 0) continue;
    const $ = load(detailResponse.body.slice(0, end + 7));
    const meta = (name: string) => {
      const tags = $(`head > meta[name="${name}"]`);
      return tags.length === 1 ? tags.attr("content") : undefined;
    };
    const req = meta("job-ats-req-id");
    if (!req || !/^R\d+$/u.test(req) || sourceJobId !== sanofiPersistentJobId(req)) continue;
    const category = categories.get(`${meta("job-category-ids")}:${meta("gtm_tbcn_jobcategory")}`);
    found.set(req, found.has(req) ? undefined : category);
  }
  return found;
}

function publicationRequisition(job: PortablePublicJob): string | undefined {
  const url = new URL(job.officialUrl);
  if (url.username || url.password) return undefined;
  if (url.origin === "https://www.ajinga.com") return /^\/ats\/job-detail-new\/13537\/(R\d+)\/c\/?$/u.exec(url.pathname)?.[1];
  if (url.origin === "https://careersite.tupu360.com" && url.pathname === "/sanofi/position/detail") {
    const [req, duplicate] = url.searchParams.getAll("exid");
    return !duplicate && req && /^R\d+$/u.test(req) ? req : undefined;
  }
  return undefined;
}

export async function enrichSanofiPublicationClassification(
  db: Pick<PrismaClient, "crawlBatchSourceResult">, workspaceRoot: string, snapshot: PortablePublicSnapshot
): Promise<number> {
  const source = snapshot.sources.find(row => row.sourceId === SANOFI_CN_SOURCE && row.state === "PUBLISHING");
  if (!source?.selectedSourceResultId) return 0;
  const jobs = source.jobs.filter(job => job.sourceId === SANOFI_CN_SOURCE && job.sourceResultId === source.selectedSourceResultId &&
    !job.inGrace && !job.categoryManuallyCorrected && classifyJob(job).category === "其他");
  if (!jobs.length) return 0;
  const replacements = new Map<string, PortablePublicJob>();
  try {
    const result = await db.crawlBatchSourceResult.findFirst({
      where: { id: source.selectedSourceResultId, sourceId: SANOFI_CN_SOURCE, completenessState: "VERIFIED", atomicCommitState: "COMMITTED" },
      select: { id: true, releaseCandidateId: true, batchId: true, evidenceArtifacts: {
        where: { kind: "COMMAND_OUTPUT", extractorLocator: SANOFI_INDEPENDENT_ORIGINAL_LOCATOR }, take: 2,
        select: { id: true, releaseCandidateId: true, batchId: true, sourceId: true, sourceResultId: true, kind: true,
          capturedAt: true, sha256: true, byteCount: true, path: true, extractorLocator: true, captureToolName: true, captureToolVersion: true }
      } }
    });
    if (result?.evidenceArtifacts.length !== 1) return 0;
    const artifact = result.evidenceArtifacts[0]!;
    await verifyArchivedSourceEvidence({ workspaceRoot, releaseCandidateId: result.releaseCandidateId, batchId: result.batchId,
      sourceId: SANOFI_CN_SOURCE, sourceResultId: result.id, evidenceSubdirectory: "runtime-evidence",
      artifacts: [{ ...artifact, logicalKey: SANOFI_INDEPENDENT_ORIGINAL_LOCATOR }] }, (_metadata, bytes) => {
      const byReq = readCategories(bytes);
      for (const job of jobs) {
        const req = publicationRequisition(job), category = req && byReq.get(req);
        if (category) replacements.set(job.id, { ...job, category });
      }
    });
  } catch {
    return 0;
  }
  if (replacements.size) {
    const enrich = (job: PortablePublicJob) => replacements.get(job.id) ?? job;
    source.jobs = source.jobs.map(enrich);
    const company = snapshot.companies.find(row => row.id === source.companyId);
    if (company) company.jobs = company.jobs.map(enrich);
  }
  return replacements.size;
}
