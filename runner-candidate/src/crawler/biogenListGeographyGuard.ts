import { explicitlyForeignOrNonMainlandLocation } from "./officialJsonEvidence";
import { reviewedMainlandCityLabel } from "./reviewedMainlandCity";
import { CITY_PENDING } from "../domain/jobLocation";
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type { NormalizedJobRecord } from "./normalizedJob";
import type { SourceCrawlPlan } from "./sourcePlan";
import type { PersistentSourceFetchEvidence } from "./sourceFetchEvidence";
import { hasUniqueJsonObjectKeys } from "./strictJsonObjectKeys";

export const BIOGEN_SOURCE_ID = "source-biogen-china-social";
export const BIOGEN_LIST_GEOGRAPHY_POLICY = "BIOGEN_MAINLAND_CITY_PENDING_V1" as const;
const CHINA_ID = "6cb77610a8a543aea2d6bc10457e35d4";
const hash = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
const record = (value: unknown): Record<string, unknown> | undefined => value !== null && typeof value === "object" && !Array.isArray(value)
  ? value as Record<string, unknown> : undefined;
const count = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const same = isDeepStrictEqual;

export function requiresBiogenListGeography(plan: SourceCrawlPlan): boolean {
  return plan.source.id === BIOGEN_SOURCE_ID || (plan.adapterId === "official-json" && plan.workday?.listGeographyPolicy !== undefined);
}

export function exactBiogenListGeographyPlan(plan: SourceCrawlPlan): boolean {
  if (plan.adapterId !== "official-json" || !plan.workday) return false;
  return plan.company.id === "company-biogen-china" && plan.company.officialChineseName === "渤健中国" &&
    plan.company.category === "FOREIGN_PHARMA" && plan.source.id === BIOGEN_SOURCE_ID &&
    plan.source.companyId === plan.company.id && plan.source.kind === "SOCIAL" && plan.source.atsKind === "WORKDAY" &&
    plan.source.status === "VERIFIED_SCRAPABLE" &&
    plan.source.officialEntryUrl === "https://biibhr.wd3.myworkdayjobs.com/external" &&
    plan.source.officialChainEvidenceUrl === "https://www.biogen.cn/careers.html" &&
    same(plan.workday, { tenant: "biibhr", site: "external", appliedFacets: { locationCountry: [CHINA_ID] },
      pageSize: 20, maxPages: 3, listGeographyPolicy: BIOGEN_LIST_GEOGRAPHY_POLICY }) &&
    same(plan.json, { jobsPath: "jobPostings", fields: { sourceJobId: "sourceJobId", officialTitle: "title",
      officialUrl: "officialUrl", locationRaw: "locationRaw", cities: "cities" }, defaultCategory: "其他" }) &&
    !plan.officialJsonFetch && !plan.moka && !plan.hotjob && !plan.hotjobLegacy && !plan.profileBoundSource;
}

/** The exact list country/location establishes mainland scope. A known mainland
 * title-location disagreement preserves the job with only the pending marker;
 * it does not select either city. Foreign/unknown/opaque evidence still fails. */
export function biogenListCities(raw: Record<string, unknown>): string[] | undefined {
  if (typeof raw.locationsText !== "string" || typeof raw.title !== "string" || !raw.title.trim() ||
    typeof raw.externalPath !== "string" || !/^[^,]+, China$/u.test(raw.locationsText) ||
    explicitlyForeignOrNonMainlandLocation(raw.locationsText)) return undefined;
  const cityLabel = raw.locationsText.slice(0, -7);
  const path = /^\/job\/([^/]+)-China\/[^/?#\s]+_(REQ[0-9]+)-[1-9][0-9]*$/u.exec(raw.externalPath);
  if (!path || path[1] !== cityLabel.replaceAll(" ", "-") || !same(raw.bulletFields, [path[2]])) return undefined;
  const city = reviewedMainlandCityLabel(cityLabel, "China");
  const clauses = [...raw.title.matchAll(/\(Location:\s*([^()]+)\)/gu)];
  if (clauses.some(match => explicitlyForeignOrNonMainlandLocation(match[1]!))) return undefined;
  const residual = raw.title.replace(/\(Location:\s*([^()]+)\)/gu, "");
  return !city || clauses.some(match => match[1]!.trim() !== cityLabel) || /\blocations?\b|工作地点|地点/iu.test(residual)
    ? [CITY_PENDING] : [city];
}


function facetGroups(value: unknown, parameter: string): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.flatMap(child => facetGroups(child, parameter));
  const item = record(value);
  return item ? [...(item.facetParameter === parameter ? [item] : []), ...facetGroups(item.values, parameter)] : [];
}

function facetsMatch(root: Record<string, unknown>, total: number): Array<{ descriptor: string; count: number }> | undefined {
  const countries = facetGroups(root.facets, "locationCountry"), locations = facetGroups(root.facets, "locations");
  if (countries.length !== 1 || locations.length !== 1 || !Array.isArray(countries[0]!.values) ||
    !Array.isArray(locations[0]!.values)) return undefined;
  const countryValues = countries[0]!.values.map(record);
  if (countryValues.some(value => !value || typeof value.id !== "string" || typeof value.descriptor !== "string" || !count(value.count)) ||
    new Set(countryValues.map(value => value!.id)).size !== countryValues.length) return undefined;
  const china = countryValues.filter(value => value!.id === CHINA_ID || value!.descriptor === "China");
  if (china.length !== 1 || china[0]!.id !== CHINA_ID || china[0]!.descriptor !== "China" || china[0]!.count !== total) return undefined;
  const values: Array<{ descriptor: string; count: number }> = [];
  for (const raw of locations[0]!.values) {
    const value = record(raw);
    if (!value || typeof value.id !== "string" || typeof value.descriptor !== "string" ||
      !/^[^,]+, China$/u.test(value.descriptor) || explicitlyForeignOrNonMainlandLocation(value.descriptor) ||
      !count(value.count) || value.count === 0 || values.some(item => item.descriptor === value.descriptor)) return undefined;
    values.push({ descriptor: value.descriptor, count: value.count });
  }
  return values.reduce((sum, value) => sum + value.count, 0) === total
    ? values.sort((a, b) => a.descriptor.localeCompare(b.descriptor)) : undefined;
}

type Projection = { sourceJobId: string; title: string; location: string; cities: string[]; url: string };
function biogenListProjection(plan: SourceCrawlPlan, evidence: PersistentSourceFetchEvidence): Projection[] | undefined {
  if (!exactBiogenListGeographyPlan(plan) || evidence.pages.length === 0 || evidence.artifacts.length !== evidence.pages.length ||
    evidence.fetchLosses.length !== 0) return undefined;
  const expected: Projection[] = [], reqIds = new Set<string>();
  let declaredTotal: number | undefined, locationCounts: Array<{ descriptor: string; count: number }> | undefined;
  const endpoint = "https://biibhr.wd3.myworkdayjobs.com/wday/cxs/biibhr/external/jobs";
  for (const page of evidence.pages) {
    const artifact = evidence.artifacts.find(item => item.logicalKey === page.artifactLogicalKey);
    if (!artifact || artifact.kind !== "PAGINATION_PAGE" || artifact.bodyRepresentation === "REDACTED" ||
      artifact.requestedUrl !== endpoint || artifact.finalUrl !== endpoint || artifact.httpStatus !== 200 ||
      !/^application\/json(?:\s*;|$)/iu.test(artifact.contentType ?? "")) return undefined;
    const body = typeof artifact.body === "string" ? artifact.body : Buffer.from(artifact.body).toString("utf8");
    if (!hasUniqueJsonObjectKeys(body)) return undefined;
    const root = record(JSON.parse(body));
    if (!root || !count(root.total) || !Array.isArray(root.jobPostings) || page.declaredTotal !== root.total ||
      (declaredTotal !== undefined && declaredTotal !== root.total)) return undefined;
    const facets = facetsMatch(root, root.total);
    if (!facets || (locationCounts && !same(locationCounts, facets))) return undefined;
    declaredTotal = root.total; locationCounts = facets;
    const rawIds: string[] = [], validIds: string[] = [];
    for (const candidate of root.jobPostings) {
      const raw = record(candidate), cities = raw && biogenListCities(raw);
      if (!raw || !cities) return undefined;
      const path = raw.externalPath as string, reqId = (raw.bulletFields as string[])[0]!;
      const sourceJobId = `workday:sha256:${hash(path)}`;
      if (reqIds.has(reqId)) return undefined;
      reqIds.add(reqId); rawIds.push(`sha256:${hash(JSON.stringify(raw))}`); validIds.push(`sha256:${hash(JSON.stringify(sourceJobId))}`);
      expected.push({ sourceJobId, title: (raw.title as string).replace(/\s+/gu, " ").trim(),
        location: raw.locationsText as string, cities, url: `${plan.source.officialEntryUrl}${path}` });
    }
    if (!same(page.rawJobIds, rawIds) || !same(page.validJobIds, validIds)) return undefined;
  }
  const counts = evidence.fetchCounts;
  if (expected.length !== declaredTotal || counts.rawCount !== declaredTotal || counts.parsedCount !== declaredTotal ||
    counts.validCount !== declaredTotal || counts.parseDiscardCount !== 0 || counts.validationDiscardCount !== 0 ||
    !locationCounts?.every(value => expected.filter(job => job.location === value.descriptor).length === value.count)) return undefined;
  return expected;
}

export function biogenListEvidenceComplete(plan: SourceCrawlPlan, evidence: PersistentSourceFetchEvidence): boolean {
  return biogenListProjection(plan, evidence) !== undefined;
}

/** Exact raw/identity/facet/count replay; no inferred publication date or city. */
export function replayBiogenListGeography(
  plan: SourceCrawlPlan, evidence: PersistentSourceFetchEvidence, output: readonly NormalizedJobRecord[]
): boolean {
  if (!requiresBiogenListGeography(plan)) return true;
  const projected = biogenListProjection(plan, evidence);
  if (!projected || output.length !== projected.length || new Set(output.map(job => job.sourceJobId)).size !== output.length) return false;
  const expected = new Map(projected.map(job => [job.sourceJobId, job]));
  return output.every(job => {
    const raw = job.sourceJobId ? expected.get(job.sourceJobId) : undefined;
    return raw && job.sourceId === plan.source.id && job.companyId === plan.company.id &&
      job.officialTitle === raw.title && job.officialUrl === raw.url && job.locationRaw === raw.location &&
      same(job.cities, raw.cities) && job.officialPublishedAt === undefined;
  });
}
