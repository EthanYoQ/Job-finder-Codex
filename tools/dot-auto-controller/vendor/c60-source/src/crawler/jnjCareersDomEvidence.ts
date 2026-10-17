import { officialJsonAdapter } from "./adapters/officialJson";
import { load } from "cheerio";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { sourcePlanConfigSha256, type SourceCrawlPlan } from "./sourcePlan";
import type { NormalizedJobRecord } from "./normalizedJob";
import type { SourceFetchFunction } from "./runSourceCrawl";
import { parseJnjCareersChinaCards, type JnjCareersChinaJobSummary } from "./jnjCareersChinaSourceFetch";
import { hasUniqueJsonObjectKeys } from "./strictJsonObjectKeys";
import { deriveCanonicalPaginationEvidence, evaluatePaginationEvidence } from "./paginationEvidence";
import { parsePersistentSourceFetchEvidence, sha256Bytes, type PersistentSourceFetchEvidence, type SourceFetchArtifactDraft, type SourceFetchPageTrace } from "./sourceFetchEvidence";
import { JNJ_DOM_CAPTURE_TOOL, JNJ_DOM_COMPANY, JNJ_DOM_CONFIG_SHA256, JNJ_DOM_DETAIL_LOCATOR, JNJ_DOM_LIST_LOCATOR, JNJ_DOM_OBSERVATION_KIND, JNJ_DOM_SOURCE, isJnjDomListArtifact } from "./jnjCareersDomContract";

const ORIGIN = "https://www.careers.jnj.com";
const text = (value: string) => value.replace(/\s+/gu, " ").trim();
const stamp = z.string().datetime({ offset: true });
const base = z.object({ kind: z.literal(JNJ_DOM_OBSERVATION_KIND), url: z.string().url(), observedAt: stamp,
  heading: z.string().min(1), dom: z.string().min(1) });
const listSchema = base.extend({
  fragment: z.object({ html: z.string().min(1), htmlLength: z.number().int().positive(),
    items: z.array(z.object({ text: z.string(), links: z.array(z.object({ title: z.string(), url: z.string().url() }).strict()) }).strict()) }).strict(),
  filters: z.array(z.object({ id: z.string(), name: z.string(), selectedOptions: z.array(z.object({ text: z.string(), value: z.string() }).strict()) }).strict()),
  pagination: z.array(z.object({ label: z.string(), text: z.string().optional(), url: z.string().url() }).strict()),
  sameIdentityOrderAsEarlier: z.boolean().optional()
}).strict();
const detailSchema = base.extend({ expectedUrl: z.string().url(), expectedTitle: z.string().min(1),
  body: z.object({ html: z.string().min(1), htmlLength: z.number().int().positive(), text: z.string().min(1) }).strict(),
  applyLinks: z.array(z.object({ text: z.string(), href: z.string().url() }).strict()).min(1),
  check: z.record(z.unknown()).optional()
}).strict();
function json(body: string): unknown {
  if (Buffer.byteLength(body) > 2_000_000 || !hasUniqueJsonObjectKeys(body)) throw Error("JNJ_DOM_OBSERVATION_INVALID");
  return JSON.parse(body);
}
function assert(condition: unknown): asserts condition { if (!condition) throw Error("JNJ_DOM_OBSERVATION_INVALID"); }
export function isJnjDomPlan(plan: SourceCrawlPlan): boolean {
  return plan.source.id === JNJ_DOM_SOURCE && plan.company.id === JNJ_DOM_COMPANY && plan.source.companyId === JNJ_DOM_COMPANY &&
    plan.executionAuthority === "STAGED" && plan.adapterId === "official-json" && plan.profileBoundSource?.kind === "jnj-careers-china" &&
    sourcePlanConfigSha256(plan) === JNJ_DOM_CONFIG_SHA256;
}
function listUrl(page: number): string {
  return `${ORIGIN}/en/jobs/?${page === 1 ? "" : `page=${page}&`}country=China&origin=global#results`;
}
const listKey = (sequence: number) => `jnj-dom-list-${String(sequence).padStart(4, "0")}`;
const detailKey = (id: string) => `jnj-dom-detail-${id}`;
const evidenceId = (id: string) => `jnj:sha256:${sha256Bytes(Buffer.from(id)).sha256}`;
function parseList(body: string, page: number) {
  const original = listSchema.parse(json(body));
  // Submitting the native empty search form leaves its exact page-one URL in
  // the address bar; the native Page 1 pagination link uses listUrl(1).
  // Admit only these observed aliases, with no nonempty search or extra filter.
  const observedListUrl = original.url === listUrl(page) ||
    (page === 1 && original.url === `${ORIGIN}/en/jobs/?search=&country=China&origin=global`);
  assert(observedListUrl && original.fragment.html.length === original.fragment.htmlLength);
  assert(original.sameIdentityOrderAsEarlier !== false);
  const filters = original.filters;
  assert(isDeepStrictEqual(filters.map(f => f.name), ["team", "subteam", "country", "state", "location", "type", "pattern"]));
  assert(filters.every(f => f.name === "country" ? isDeepStrictEqual(f.selectedOptions, [{ text: "China", value: "China" }]) : f.selectedOptions.length === 0));
  assert(original.dom.includes('- option "China" [selected]') && original.dom.includes(original.heading));
  const match = /^Displaying (\d+) to (\d+) of (\d+) matching jobs$/u.exec(original.heading);
  assert(match);
  const [first, last, total] = match.slice(1).map(Number) as [number, number, number];
  assert([first, last, total].every(Number.isSafeInteger) && total > 0 && total <= 400 && page <= Math.ceil(total / 20));
  const $ = load(original.fragment.html);
  assert($("#js-job-search-results").length === 1 && $("#js-job-search-results").attr("data-results") === String(total));
  const jobs = parseJnjCareersChinaCards(original.fragment.html, "China");
  assert(jobs && jobs.length === Math.min(20, total - (page - 1) * 20) && jobs.every(job => job.cities.length > 0));
  assert(first === (page - 1) * 20 + 1 && last === first + jobs.length - 1 && original.fragment.items.length === jobs.length);
  for (let i = 0; i < jobs.length; i++) {
    const job = jobs[i]!, item = original.fragment.items[i]!;
    assert(item.links.length === 1 && text(item.links[0]!.title) === job.title && item.links[0]!.url === job.officialUrl);
    assert(original.dom.includes(new URL(job.officialUrl).pathname) || original.dom.includes(decodeURI(new URL(job.officialUrl).pathname)));
  }
  const lastPage = Math.ceil(total / 20), next = original.pagination.filter(a => a.label === "Next page"), previous = original.pagination.filter(a => a.label === "Previous page");
  assert(next.length === (page < lastPage ? 1 : 0) && (!next.length || next[0]!.url === listUrl(page + 1)));
  assert(previous.length === (page > 1 ? 1 : 0) && (!previous.length || previous[0]!.url === listUrl(page - 1)));
  assert(original.pagination.some(a => a.label === `Page ${page}` && a.url === listUrl(page)));
  for (const link of original.pagination) {
    const n = /^Page (\d+)$/u.exec(link.label);
    assert(n ? Number(n[1]) >= 1 && Number(n[1]) <= lastPage && link.url === listUrl(Number(n[1])) : ["Next page", "Previous page"].includes(link.label));
  }
  assert((page < lastPage) === original.dom.includes('link "Next page"'));
  return { original, jobs, total };
}
function parseDetail(body: string, job: JnjCareersChinaJobSummary) {
  const original = detailSchema.parse(json(body));
  assert(original.url === job.officialUrl && original.expectedUrl === job.officialUrl &&
    text(original.expectedTitle) === job.title && text(original.heading) === job.title && original.body.html.length === original.body.htmlLength);
  const $ = load(original.body.html), container = $("#js-job-detail"), article = container.find("article.RichTextBody");
  assert(container.length === 1 && container.attr("data-id") === job.officialId && text(container.attr("data-jobtitle") ?? "") === job.title && article.length === 1);
  const metadata = new Map<string, string>();
  article.find(".job-meta > li").each((_, e) => {
    const li = $(e), label = text(li.clone().children().remove().end().text());
    assert(!metadata.has(label)); metadata.set(label, text(li.find("span").text()));
  });
  assert(metadata.get("Job title") === job.title && metadata.get("Requisition number")?.toLowerCase() === job.officialId && metadata.get("Function") === job.functionRaw);
  const locations = metadata.get("Location")?.split(" / ").map(text) ?? [];
  assert(locations.includes("China") && job.locationRaw.split(" / ").every(location => locations.includes(location)));
  assert(article.find("h2").toArray().some(e => text($(e).text()) === "Description"));
  const description = article.clone(); description.find(".job-meta").remove();
  assert(text(description.text()).length >= 200 && /Job Description:/u.test(text(description.text())));
  assert(original.body.text.toLowerCase().includes(job.officialId) && original.dom.toLowerCase().includes(job.officialId));
  assert(!/this (?:job|position) (?:is |has been )?(?:no longer available|closed)|job (?:has expired|is no longer available)/iu.test(original.body.text));
  assert(original.dom.includes('link "Apply now"'));
  const applies = new Set<string>();
  for (const link of original.applyLinks) {
    const url = new URL(link.href), id = job.officialId.toUpperCase();
    assert(text(link.text) === "Apply now" && !applies.has(link.href) && url.protocol === "https:" && !url.username && !url.password && !url.hash);
    const china = url.origin === "https://careers.jnj.com.cn" && url.pathname === "/jnj/apply" &&
      url.searchParams.get("exid") === id && url.searchParams.get("m") === "1" && [...url.searchParams.keys()].sort().join(",") === "exid,m";
    const workday = url.origin === "https://jj.wd5.myworkdayjobs.com" && !url.search &&
      url.pathname.startsWith("/en-US/JJ/job/") && new RegExp(`_${id}(?:-[0-9]+)?/apply$`, "u").test(url.pathname);
    assert((china || workday) && original.dom.includes(link.href)); applies.add(link.href);
  }
  return original;
}
function artifact(key: string, body: string, capturedAt: string, locator: string): SourceFetchArtifactDraft {
  return { id: key, logicalKey: key, kind: "COMMAND_OUTPUT", capturedAt, body, bodyRepresentation: "EXACT", extractorLocator: locator };
}
export function auditJnjCareersDomObservations(lists: readonly string[], details: readonly string[]) {
  assert(lists.length > 0 && lists.length <= 20);
  const parsed = lists.map((body, i) => parseList(body, i + 1)), total = parsed[0]!.total;
  assert(parsed.every(p => p.total === total) && lists.length === Math.ceil(total / 20));
  const jobs = parsed.flatMap(p => p.jobs);
  assert(jobs.length === total && new Set(jobs.map(j => j.officialId)).size === total && details.length === total);
  const detailMap = new Map<string, string>();
  for (const body of details) { const value = detailSchema.parse(json(body)); assert(!detailMap.has(value.url)); detailMap.set(value.url, body); }
  const artifacts = parsed.map((p, i) => artifact(listKey(i), lists[i]!, p.original.observedAt, JNJ_DOM_LIST_LOCATOR));
  for (const job of jobs) { const body = detailMap.get(job.officialUrl); assert(body); const d = parseDetail(body, job); artifacts.push(artifact(detailKey(job.officialId), body, d.observedAt, JNJ_DOM_DETAIL_LOCATOR)); }
  const times = artifacts.map(a => Date.parse(a.capturedAt)), startedAt = new Date(Math.min(...times)).toISOString(), finishedAt = new Date(Math.max(...times)).toISOString();
  assert(Date.parse(finishedAt) - Date.parse(startedAt) < 30 * 60_000);
  const pages: SourceFetchPageTrace[] = parsed.map((p, sequence) => ({ sequence, artifactLogicalKey: listKey(sequence),
    requestedCursor: null, returnedCursor: null, requestedOffset: sequence * 20, returnedOffset: sequence * 20,
    requestedPage: sequence + 1, returnedPage: sequence + 1, requestedPageSize: 20, returnedPageSize: 20,
    rawJobIds: p.jobs.map(j => evidenceId(j.officialId)), validJobIds: p.jobs.map(j => evidenceId(j.officialId)),
    declaredTotal: total, declaredCount: total, declaredPages: parsed.length,
    nextPageSignalBefore: sequence === 0 ? null : listUrl(sequence + 1),
    nextPageSignalAfter: sequence + 1 === parsed.length ? null : listUrl(sequence + 2),
    responseFingerprintSha256: sha256Bytes(Buffer.from(lists[sequence]!)).sha256,
    termination: sequence + 1 === parsed.length ? "DECLARED_TOTAL_REACHED" : "CONTINUE", anomalyCodes: [], capturedAt: p.original.observedAt }));
  const evidence = deriveCanonicalPaginationEvidence({ evidence: parsePersistentSourceFetchEvidence({ captureTool: JNJ_DOM_CAPTURE_TOOL,
    artifacts, pages, declaredCompleteness: { kind: "OFFICIAL_TOTAL_COUNT", value: total, artifactLogicalKey: listKey(0), extractorLocator: JNJ_DOM_LIST_LOCATOR, scope: "SOURCE" },
    fetchCounts: { rawCount: total, parsedCount: total, validCount: total, parseDiscardCount: 0, validationDiscardCount: 0 }, fetchLosses: [] }),
    expectedChannelIds: [], filteredOutput: true, allowPositiveOfficialTotalCountAfterAdapterReconciliation: true });
  const paginationEvaluation = evaluatePaginationEvidence({ evidence, expectedChannelIds: [], filteredOutput: true, allowPositiveOfficialTotalCountAfterAdapterReconciliation: true });
  assert(paginationEvaluation.safeCompleteness && paginationEvaluation.verifiedEligible);
  return { jobs, total, evidence, paginationEvaluation, startedAt, finishedAt };
}
/** Retains the unmodified UI tool JSON bytes. No HTTP envelope is manufactured. */
export function createJnjCareersDomSourceFetch(input: { lists: readonly string[]; details: readonly string[] }): SourceFetchFunction {
  return async plan => {
    if (!isJnjDomPlan(plan)) return { ok: false, capturedAt: new Date().toISOString(), failureReason: "JNJ_PLAN_BINDING_INVALID" };
    try {
      const value = auditJnjCareersDomObservations(input.lists, input.details);
      return { ok: true, capturedAt: value.startedAt, payload: { jobs: value.jobs.map(job => ({ sourceJobId: job.officialId, title: job.title,
        officialUrl: job.officialUrl, locationRaw: job.locationRaw, cities: job.cities })) },
        completeness: { completenessStatus: "VERIFIED", expectedJobCount: value.total, completenessEvidenceKind: "OFFICIAL_TOTAL_COUNT",
          completenessEvidenceUrl: plan.source.officialEntryUrl, totalPages: value.evidence.pages.length, pageSize: 20, pagesVisited: value.evidence.pages.length },
        fetchEvidence: value.evidence, paginationEvaluation: value.paginationEvaluation };
    } catch { return { ok: false, capturedAt: new Date().toISOString(), failureReason: "JNJ_DOM_OBSERVATION_INVALID" }; }
  };
}
export function replayJnjCareersDomEvidence(plan: SourceCrawlPlan, evidence: PersistentSourceFetchEvidence, outputJobs: readonly NormalizedJobRecord[]): boolean {
  try {
    if (!isJnjDomPlan(plan) || !isDeepStrictEqual(evidence.captureTool, JNJ_DOM_CAPTURE_TOOL)) return false;
    const listArtifacts = evidence.artifacts.filter(a => a.logicalKey.startsWith("jnj-dom-list-"));
    if (listArtifacts.length !== evidence.pages.length || !listArtifacts.every(a => isJnjDomListArtifact(evidence.captureTool, a))) return false;
    const details = evidence.artifacts.filter(a => a.logicalKey.startsWith("jnj-dom-detail-"));
    if (listArtifacts.length + details.length !== evidence.artifacts.length || evidence.artifacts.some(a => typeof a.body !== "string")) return false;
    const rebuilt = auditJnjCareersDomObservations(listArtifacts.map(a => a.body as string), details.map(a => a.body as string));
    // Artifact IDs may acquire a batch prefix during archiving; logical identity,
    // bytes and every evidence field must otherwise remain identical.
    const canonical = (e: PersistentSourceFetchEvidence) => ({ ...e, artifacts: e.artifacts.map(a => ({ ...a, id: a.logicalKey })) });
    if (!isDeepStrictEqual(canonical(rebuilt.evidence), canonical(evidence))) return false;
    if (plan.adapterId !== "official-json") return false;
    const adapted = officialJsonAdapter.extract({company:plan.company,source:{...plan.source,officialEntryUrl:"https://www.careers.jnj.com/en/jobs/"},json:plan.json,
      capturedAt:rebuilt.startedAt,isBaseline:outputJobs[0]?.isBaseline ?? true,payload:{jobs:rebuilt.jobs.map(j=>({
        sourceJobId:j.officialId,title:j.title,officialUrl:j.officialUrl,locationRaw:j.locationRaw,cities:j.cities}))}});
    const sorted=(jobs:readonly NormalizedJobRecord[])=>[...jobs].sort((a,b)=>(a.sourceJobId??"").localeCompare(b.sourceJobId??""));
    return adapted.status === "SUCCESS" && isDeepStrictEqual(sorted(adapted.jobs),sorted(outputJobs));
  } catch { return false; }
}
