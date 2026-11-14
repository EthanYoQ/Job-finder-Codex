import { createHash } from "node:crypto";
import {verifyBeisenListQuarantines,beisenRawObservationId} from './beisenJobQuarantine';
import type { SourceCrawlPlan } from "./sourcePlan";
import type { PersistentSourceFetchEvidence } from "./sourceFetchEvidence";
import type { NormalizedJobRecord } from "./normalizedJob";
import { hasUniqueJsonObjectKeys } from "./strictJsonObjectKeys";
import { requestContractV2Locator } from "./strictPageRequestContract";
import { hasExactFosunMainlandGeography, mainlandDisplayCities } from "./fosunScopeGeography";
import { containsSensitiveAdapterValue } from "./adapters/safeAdapterValue";

const ENTRY = "https://hspharm.zhiye.com/social";
const ENDPOINT = "https://hspharm.zhiye.com/api/Jobad/GetJobAdPageList";
// The retained main capture requested these nine fields. The native UI requests
// six fields and PageSize20; neither capture may be relabelled as the other.
const DISPLAY = ["Category", "Kind", "LocId", "Salary", "Degree", "YearsOfWorking", "ClassificationOne", "WorkWeChatQrCode", "PostDate"];

export function requiresHansohNativeWindowReplay(plan: SourceCrawlPlan): boolean {
  return plan.source.id === "source-hansoh-social" || plan.company.id === "company-hansoh";
}

export function hasStrictHansohNativeWindowPlan(plan: SourceCrawlPlan): boolean {
  if (plan.adapterId !== "official-json" || plan.executionAuthority !== "STAGED") return false;
  const config = plan.officialJsonFetch;
  return plan.company.id === "company-hansoh" && plan.company.category === "DOMESTIC_PHARMA" &&
    plan.source.companyId === "company-hansoh" && plan.source.id === "source-hansoh-social" &&
    plan.source.kind === "SOCIAL" && plan.source.status === "VERIFIED_SCRAPABLE" &&
    plan.source.atsKind === "BEISEN_ZHIYE" && plan.source.officialEntryUrl === ENTRY &&
    plan.source.officialChainEvidenceUrl === "https://www.hansoh.cn/job/career-development.htm" &&
    config?.kind === "beisen-zhiye-2022" &&
    keys(config, ["kind", "postDateWithinDays", "geographyScope", "category", "pageSize", "maxPages", "detailPath", "displayFields"]) &&
    config.postDateWithinDays === 180 && config.geographyScope === "DOMESTIC_OFFICIAL_TENANT" &&
    config.category === "1" && config.pageSize === 100 && config.maxPages === 10 &&
    config.detailPath === "social/detail" && equal(config.displayFields, DISPLAY) &&
    keys(plan.json, ["jobsPath", "fields", "defaultCategory"]) && plan.json.jobsPath === "jobs" &&
    plan.json.defaultCategory === "其他" && keys(plan.json.fields, ["sourceJobId", "officialTitle", "officialUrl", "locationRaw", "cities"]) &&
    plan.json.fields.sourceJobId === "sourceJobId" && plan.json.fields.officialTitle === "title" &&
    plan.json.fields.officialUrl === "officialUrl" && plan.json.fields.locationRaw === "locationRaw" &&
    plan.json.fields.cities === "cities";
}

/** Independent semantic replay of the source-local native request and original
 * rows. This does not authenticate acquisition, issue B proof, or admit a run. */
export function validateStrictHansohNativeWindowEvidence(
  plan: SourceCrawlPlan, evidence: PersistentSourceFetchEvidence, jobs: readonly NormalizedJobRecord[]
): boolean {
  try {
    if(evidence.jobQuarantines?.length&&!verifyBeisenListQuarantines(plan,evidence))return false;
    if (!hasStrictHansohNativeWindowPlan(plan) || evidence.supportingArtifactOnlyFailure ||
        evidence.pages.length === 0 || evidence.pages.length > 10 ||
        evidence.artifacts.length !== evidence.pages.length || evidence.fetchLosses.some(loss=>loss.details.code!=='JOB_QUARANTINED')) return false;
    const declaration = evidence.declaredCompleteness;
    if (declaration?.kind !== "OFFICIAL_TOTAL_COUNT" || declaration.scope !== "SOURCE" ||
        declaration.channelId !== undefined || declaration.artifactLogicalKey !== evidence.pages[0]!.artifactLogicalKey) return false;
    const seen = new Set<string>(); const rows: Record<string, unknown>[] = [];
    const artifactKeys = new Set<string>();
    let total: number | undefined;
    for (let sequence = 0; sequence < evidence.pages.length; sequence += 1) {
      const page = evidence.pages[sequence]!;
      const matching = evidence.artifacts.filter(artifact => artifact.logicalKey === page.artifactLogicalKey);
      const artifact = matching.length === 1 ? matching[0] : undefined;
      if (!artifact || artifactKeys.has(artifact.logicalKey) || artifact.kind !== "PAGINATION_PAGE" ||
          artifact.requestedUrl !== ENDPOINT || artifact.finalUrl !== ENDPOINT || artifact.httpStatus !== 200 ||
          !/^application\/json(?:\s*;|$)/iu.test(artifact.contentType ?? "") ||
          artifact.bodyRepresentation !== "EXACT" || artifact.rawBodySha256 !== undefined ||
          artifact.redactionDescriptors !== undefined || typeof artifact.body !== "string" ||
          !Number.isFinite(Date.parse(artifact.capturedAt)) || page.capturedAt !== artifact.capturedAt ||
          !hasUniqueJsonObjectKeys(artifact.body) || page.responseFingerprintSha256 !== hash(artifact.body)) return false;
      artifactKeys.add(artifact.logicalKey);
      const root: unknown = JSON.parse(artifact.body);
      if (!record(root) || root.Code !== 200 || !Array.isArray(root.Data) || !count(root.Count) ||
          (root.PageIndex !== undefined && root.PageIndex !== sequence)) return false;
      total ??= root.Count;
      if (root.Count !== total || declaration.value !== total || page.sequence !== sequence ||
          page.requestedPage !== sequence || page.returnedPage !== (root.PageIndex ?? null) ||
          page.requestedPageSize !== 100 || page.returnedPageSize !== null ||
          page.requestedCursor !== null || page.returnedCursor !== null ||
          page.requestedOffset !== null || page.returnedOffset !== null || page.declaredTotal !== total ||
          page.declaredPages !== null || page.declaredCount !== null || page.anomalyCodes.length !== 0 ||
          root.Data.length !== Math.min(100, total - sequence * 100)) return false;
      const last = sequence === evidence.pages.length - 1;
      if (page.nextPageSignalBefore !== (sequence === 0 ? null : `page:${sequence}`) ||
          page.nextPageSignalAfter !== (last ? null : `page:${sequence + 1}`) ||
          page.termination !== (last ? total === 0 ? "EMPTY_PAGE" : "NEXT_ABSENT" : "CONTINUE")) return false;
      const request = {PageIndex: sequence, PageSize: 100, PostDate: [180], Category: ["1"], KeyWords: "", SpecialType: 0, PortalId: "", DisplayFields: DISPLAY};
      const base = `beisen-zhiye-page-v1|requestPageIndex:${sequence}|requestPageSize:100|requestCategory:${irreversible("1")}|json:$.Count,$.Data`;
      const locator = requestContractV2Locator(base, {family: "beisen", role: "page", method: "POST", url: ENDPOINT, body: request,
        coordinate: {sequence, requestedPage: sequence, requestedPageSize: 100}});
      if (artifact.extractorLocator !== locator || sequence === 0 && declaration.extractorLocator !== locator) return false;
      const rawIds: string[] = []; const validIds: string[] = [];
      for (const [recordIndex,raw] of root.Data.entries()) {
        rawIds.push(beisenRawObservationId(raw,sequence,recordIndex));
        if(evidence.jobQuarantines?.some(q=>q.pageSequence===sequence&&q.recordIndex===recordIndex))continue;
        if (!record(raw) || typeof raw.Id !== "string" ||
            !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(raw.Id) ||
            seen.has(raw.Id) || typeof raw.JobAdName !== "string" || !raw.JobAdName.trim() ||
            containsSensitiveAdapterValue(raw.JobAdName) || raw.Category !== "社会招聘" ||
            raw.CategoryId !== "1" || raw.Status !== 1 || !socialKind(raw.Kind) ||
            !mainlandGeography(raw)) return false;
        seen.add(raw.Id); rows.push(raw); validIds.push(irreversible(persistentId(raw.Id)));
      }
      if (!equal(page.rawJobIds, rawIds) || !equal(page.validJobIds, validIds)) return false;
    }
    const counts = evidence.fetchCounts;
    const quarantined=evidence.jobQuarantines?.length??0;
    if (total !== rows.length+quarantined || evidence.pages.length !== Math.max(1, Math.ceil(total / 100)) ||
        counts.rawCount !== total || counts.parsedCount !== total || counts.validCount+quarantined !== total ||
        counts.parseDiscardCount !== 0 || counts.validationDiscardCount !== quarantined || jobs.length+quarantined !== total ||
        new Set(jobs.map(job => job.sourceJobId)).size !== jobs.length) return false;
    const byId = new Map(jobs.map(job => [job.sourceJobId, job]));
    return rows.every(raw => {
      const parts = (raw.LocNames as string[]).map(value => value.trim());
      const cities = mainlandDisplayCities(parts);
      const job = byId.get(persistentId(raw.Id as string)); const url = new URL("/social/detail", ENTRY);
      url.searchParams.set("jobAdId", raw.Id as string);
      return job !== undefined && job.sourceId === plan.source.id && job.companyId === plan.company.id &&
        job.sourceKind === "SOCIAL" && job.atsKind === "BEISEN_ZHIYE" && job.officialUrl === url.toString() &&
        job.officialTitle === clean(raw.JobAdName as string) && job.locationRaw === clean(parts.join(" / ")) &&
        equal(job.cities, cities) && job.officialPublishedAt === undefined;
    });
  } catch { return false; }
}

function socialKind(value: unknown): boolean {
  return value === undefined || value === null ||
    typeof value === "string" && !/(?:校园|校招|campus)/iu.test(value);
}

// The native request filter owns window membership; projected dates are optional.
function mainlandGeography(raw: Record<string, unknown>): boolean {
  return hasExactFosunMainlandGeography(raw);
}
function record(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value); }
function count(value: unknown): value is number { return typeof value === "number" && Number.isSafeInteger(value) && value >= 0; }
function keys(value: object, expected: string[]): boolean { return equal(Object.keys(value).sort(), [...expected].sort()); }
function equal(left: readonly string[] | undefined, right: readonly string[]): boolean { return left?.length === right.length && left.every((value, i) => value === right[i]); }
function clean(value: string): string { return value.replace(/\s+/gu, " ").trim(); }
function hash(value: string): string { return createHash("sha256").update(value, "utf8").digest("hex"); }
function irreversible(value: unknown): string { return `sha256:${hash(JSON.stringify(value))}`; }
function persistentId(value: string): string { return `official-json:${irreversible(value)}`; }


// Diagnostic only: acceptance still requires the complete native replay above.
export function hasUnrecognizedHansohLocation(evidence: PersistentSourceFetchEvidence): boolean {
  try {
    return evidence.pages.some(page => {
      const artifact = evidence.artifacts.find(item => item.logicalKey === page.artifactLogicalKey);
      const root: unknown = JSON.parse(typeof artifact?.body === "string" ? artifact.body : Buffer.from(artifact?.body ?? []).toString("utf8"));
      return record(root) && Array.isArray(root.Data) &&
        root.Data.some(raw => record(raw) && !mainlandGeography(raw));
    });
  } catch { return false; }
}
