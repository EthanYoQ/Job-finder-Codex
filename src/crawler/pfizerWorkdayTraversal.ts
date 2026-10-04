import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type { SourceCrawlPlan } from "./sourcePlan";
import type { SourceFetchResult } from "./runSourceCrawl";
import type { WorkdaySourceFetchDeps, WorkdayHttpResponse } from "./workdaySourceFetch";
import type { NormalizedJobRecord } from "./normalizedJob";
import { officialJsonAdapter } from "./adapters/officialJson";
import { fetchWithOfficialTimeout, currentOfficialSourceAttemptSignal } from "./officialHttpRuntimeLimits";
import { hasUniqueJsonObjectKeys } from "./strictJsonObjectKeys";
import { irreversibleOfficialJsonEvidenceId, officialJsonNetworkArtifact, finalizeOfficialJsonSupportingFailureEvidence } from "./officialJsonEvidence";
import { deriveCanonicalPaginationEvidence, evaluatePaginationEvidence } from "./paginationEvidence";
import { parsePersistentSourceFetchEvidence, sha256Bytes, type PersistentSourceFetchEvidence, type SourceFetchArtifactDraft, type SourceFetchPageTrace } from "./sourceFetchEvidence";
import { WORKDAY_JSON_CONFIG } from "./companyRecruitmentProfiles/shared";
import { PFIZER_OFFICIAL_LOCALITIES } from "./pfizerOfficialLocalities";
import { CITY_PENDING } from "../domain/jobLocation";
export const PFIZER_TRAVERSAL_POLICY = "PFIZER_COUNTRY_DETAIL_COMPLETE_TRAVERSAL_V1";
export const PFIZER_ENTRY = "https://pfizer.wd1.myworkdayjobs.com/PfizerCareers";
export const PFIZER_API = "https://pfizer.wd1.myworkdayjobs.com/wday/cxs/pfizer/PfizerCareers";
export const PFIZER_CHINA = "6cb77610a8a543aea2d6bc10457e35d4";
export const PFIZER_CHANNEL = "source:source-pfizer-china-social:default";
export const PFIZER_PAGINATION_POLICY = { allowLaterZeroDeclaredTotalAfterExactReconciliation: true, allowAuditedTraversalScopeExclusions: true } as const;
export function isPfizerWorkdayTraversalPlan(plan: SourceCrawlPlan): boolean {
    if (plan.adapterId !== "official-json" || plan.workday?.traversalScopePolicy !== PFIZER_TRAVERSAL_POLICY)
        return false;
    const { traversalScopePolicy: _, ...config } = plan.workday;
    return plan.company.id === "company-pfizer-china" && plan.source.companyId === plan.company.id &&
        plan.source.id === "source-pfizer-china-social" && plan.source.kind === "SOCIAL" && plan.source.atsKind === "WORKDAY" &&
        plan.source.officialEntryUrl === PFIZER_ENTRY && plan.source.officialChainEvidenceUrl === "https://www.pfizer.com/about/careers/search-results" &&
        plan.source.status === "VERIFIED_SCRAPABLE" &&
        isDeepStrictEqual(plan.json, { ...WORKDAY_JSON_CONFIG, fields: { ...WORKDAY_JSON_CONFIG.fields, officialPublishedAt: "officialPublishedAt" } }) &&
        plan.executionAuthority === "STAGED" && isDeepStrictEqual(config, { tenant: "pfizer", site: "PfizerCareers", laterZeroTotalPolicy: "PFIZER_AUDITED_EXACT_RECONCILIATION", appliedFacets: { Location_Country: [PFIZER_CHINA] }, pageSize: 20, maxPages: 20 }) &&
        isDeepStrictEqual(plan.expectedChannels, [{ channelId: PFIZER_CHANNEL, kind: "SOCIAL" }]);
}
export function pfizerSourceJobId(externalPath: string): string {
    return `workday:sha256:${createHash("sha256").update(externalPath).digest("hex")}`;
}
function record(value: unknown): Record<string, any> {
    if (!value || typeof value !== "object" || Array.isArray(value))
        throw Error("Pfizer expected an object");
    return value as Record<string, any>;
}
function parse(body: unknown): Record<string, any> {
    if (typeof body !== "string" || !hasUniqueJsonObjectKeys(body))
        throw Error("Pfizer invalid or duplicate-key JSON");
    return record(JSON.parse(body));
}
function identity(raw: unknown) {
    const row = record(raw);
    if (typeof row.title !== "string" || !row.title.trim() || !Array.isArray(row.bulletFields) || row.bulletFields.length !== 1 ||
        typeof row.bulletFields[0] !== "string" || !/^\d{7}$/u.test(row.bulletFields[0]) ||
        typeof row.externalPath !== "string" || !/^\/job\/[^?#]+$/u.test(row.externalPath) ||
        !new RegExp(`_${row.bulletFields[0]}(?:-\\d+)?$`, "u").test(row.externalPath) ||
        new URL(row.externalPath, PFIZER_ENTRY).origin !== new URL(PFIZER_ENTRY).origin)
        throw Error("Pfizer list identity is invalid");
    return { row, id: row.bulletFields[0] as string, path: row.externalPath as string };
}
// Main path uses the native Workday country objects, not the browser's JSON-LD classifier.
export function projectPfizerDetail(raw: unknown, detailBody: string) {
    const { row, id, path } = identity(raw), root = parse(detailBody), info = record(root.jobPostingInfo);
    const country = record(info.country), requisition = record(record(info.jobRequisitionLocation).country);
    if (info.jobReqId !== id || info.title !== row.title || info.jobPostingSiteId !== "PfizerCareers" ||
        info.externalUrl !== PFIZER_ENTRY + path || info.posted !== true || info.canApply !== true ||
        typeof info.jobDescription !== "string" || info.jobDescription.replace(/<[^>]*>/gu, "").trim().length < 100 ||
        typeof info.location !== "string" || !info.location.trim() ||
        (info.additionalLocations !== undefined && (!Array.isArray(info.additionalLocations) || info.additionalLocations.some((v: unknown) => typeof v !== "string" || !v.trim()))))
        throw Error("Pfizer detail identity, activity or locations are unresolved");
    const locations: string[] = [info.location, ...(info.additionalLocations ?? [])];
    if (new Set(locations).size !== locations.length)
        throw Error("Pfizer duplicate detail locations");
    const mainland = locations.filter(v => /^(?:China|CHN) - [A-Za-z][A-Za-z '\-]+(?: - [A-Za-z][A-Za-z '\-]+)?$/u.test(v) && !/Hong Kong|Macau|Macao|Taiwan/iu.test(v));
    const included = country.descriptor === "China" && country.id === PFIZER_CHINA && requisition.descriptor === "China" && requisition.alpha2Code === "CN" && mainland.length > 0;
    const excluded = country.descriptor === "India" && country.id === "c4f78be1a8f14da0ab49ce1162348a5e" && requisition.descriptor === "India" && requisition.alpha2Code === "IN" &&
        /^India - /u.test(info.location) && locations.every(v => /^India - [A-Za-z ]+$/u.test(v) || ["APAC - Any Pfizer Site", "Europe - Any Pfizer Site", "IDM - Any Pfizer Site"].includes(v));
    if (!included && !excluded)
        throw Error("Pfizer country evidence is unknown or conflicting");
    const date = info.startDate;
    if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(date) || new Date(date).toISOString().slice(0, 10) !== date)
        throw Error("Pfizer posting date is invalid");
    const cities = mainland.map(location => PFIZER_OFFICIAL_LOCALITIES[location] ?? CITY_PENDING);
    return { id, path, excluded, locations, job: { sourceJobId: pfizerSourceJobId(path), title: row.title, officialUrl: info.externalUrl,
            locationRaw: locations.join(" | "), cities: cities.includes(CITY_PENDING) ? [CITY_PENDING] : [...new Set(cities)], officialPublishedAt: `${date}T00:00:00.000Z` } };
}
function requestBody(offset: number) { return { appliedFacets: { Location_Country: [PFIZER_CHINA] }, limit: 20, offset, searchText: "" }; }
function artifact(key: string, url: string, response: WorkdayHttpResponse, request: unknown): SourceFetchArtifactDraft {
    if (response.status !== 200 || response.finalUrl !== url || !/^application\/json(?:;|$)/iu.test(response.contentType ?? "") || !response.capturedAt || !Number.isFinite(Date.parse(response.capturedAt)))
        throw Error("Pfizer response metadata is invalid");
    if (Buffer.byteLength(response.body) > 2000000)
        throw Error("Pfizer response body budget exceeded");
    return officialJsonNetworkArtifact({ id: key, logicalKey: key, kind: key.startsWith("pfizer-page-") ? "PAGINATION_PAGE" : "ATS_API_RESPONSE", requestedUrl: url, response, extractorLocator: JSON.stringify(request), bodyRepresentation: "EXACT" });
}
async function http(request: {
    url: string;
    method: "GET" | "POST";
    headers: Record<string, string>;
    body?: string;
}): Promise<WorkdayHttpResponse> {
    const response = await fetchWithOfficialTimeout(request.url, { method: request.method, headers: { ...request.headers, "User-Agent": "job-search-crawler/0.1" }, ...(request.body ? { body: request.body } : {}) });
    return { status: response.status, body: await response.text(), finalUrl: response.url, contentType: response.headers.get("content-type") ?? "", capturedAt: new Date().toISOString() };
}
// The official CXS endpoint resets a beyond-end offset to its first page. Keep
// that response as an auxiliary artifact, never as an empty or additional page.
function terminalBoundaryMatches(first: Record<string, any>, end: Record<string, any>, total: number, lastCount: number): boolean {
    if (!Array.isArray(end.jobPostings)) return false;
    if (end.jobPostings.length === 0) return end.total === 0 || end.total === total;
    return lastCount > 0 && lastCount < 20 && lastCount === total % 20 && first.total === total && end.total === total &&
        Array.isArray(first.jobPostings) && first.jobPostings.length === Math.min(total, 20) &&
        isDeepStrictEqual(end.jobPostings, first.jobPostings);
}

export async function fetchPfizerWorkdayTraversal(plan: SourceCrawlPlan, deps: WorkdaySourceFetchDeps): Promise<SourceFetchResult> {
    const started = (deps.now?.() ?? new Date()).toISOString(), artifacts: SourceFetchArtifactDraft[] = [], pages: SourceFetchPageTrace[] = [];
    let evidence: PersistentSourceFetchEvidence | undefined;
    try {
        if (!isPfizerWorkdayTraversalPlan(plan))
            throw Error("Pfizer traversal policy does not match the exact source plan");
        const listHttp = deps.http ?? http, detailHttp = deps.detailHttp ?? (deps.http ? undefined : http);
        if (!detailHttp)
            throw Error("Pfizer traversal needs explicit detail transport");
        const jobs: ReturnType<typeof projectPfizerDetail>["job"][] = [], losses: PersistentSourceFetchEvidence["fetchLosses"] = [];
        const seen = new Set<string>();
        let total: number | undefined, bytes = 0;
        for (let index = 0; index < 20; index++) {
            currentOfficialSourceAttemptSignal()?.throwIfAborted();
            const offset = index * 20, body = requestBody(offset), key = `pfizer-page-${index}`, url = PFIZER_API + "/jobs";
            const response = await listHttp({ url, method: "POST", headers: { Accept: "application/json", "Content-Type": "application/json", Referer: PFIZER_ENTRY }, body: JSON.stringify(body) });
            const pageArtifact = artifact(key, url, response, { method: "POST", url, body });
            artifacts.push(pageArtifact);
            bytes += Buffer.byteLength(response.body);
            const root = parse(response.body);
            if (!Number.isSafeInteger(root.total) || root.total < 0 || !Array.isArray(root.jobPostings))
                throw Error("Pfizer list response is invalid");
            total ??= root.total;
            if (!total || root.jobPostings.length < 1 || root.jobPostings.length > 20 || (root.total !== total && !(index > 0 && root.total === 0)))
                throw Error("Pfizer list total or continuation changed");
            const valid: string[] = [], raw: string[] = [];
            for (let recordIndex = 0; recordIndex < root.jobPostings.length; recordIndex++) {
                const row = root.jobPostings[recordIndex], { id, path } = identity(row);
                if (seen.has(id))
                    throw Error("Pfizer duplicate official ID");
                seen.add(id);
                raw.push(irreversibleOfficialJsonEvidenceId(id));
                const detailUrl = PFIZER_API + path, detailKey = `pfizer-detail-${id}`;
                const response = await detailHttp({ url: detailUrl, method: "GET", headers: { Accept: "application/json", Referer: PFIZER_ENTRY } });
                artifacts.push(artifact(detailKey, detailUrl, response, { method: "GET", url: detailUrl, officialId: id }));
                bytes += Buffer.byteLength(response.body);
                if (bytes > 35000000)
                    throw Error("Pfizer source body budget exceeded");
                const projected = projectPfizerDetail(row, response.body);
                if (projected.excluded)
                    losses.push({ stage: "VALIDATION", reason: "Official detail establishes India and no explicit mainland posting location", rawLocator: `${key}#record:${recordIndex}#${irreversibleOfficialJsonEvidenceId(id)}`, details: { code: "PFIZER_VERIFIED_INDIA_SCOPE", pageSequence: index, recordIndex }, recordedAt: response.capturedAt });
                else {
                    jobs.push(projected.job);
                    valid.push(irreversibleOfficialJsonEvidenceId(projected.job.sourceJobId));
                }
            }
            if (seen.size > total || (seen.size < total && root.jobPostings.length !== 20))
                throw Error("Pfizer incomplete page before declared end");
            const done = seen.size === total;
            pages.push({ sequence: index, artifactLogicalKey: key, requestedOffset: offset, returnedOffset: offset, requestedPage: index, returnedPage: index, requestedPageSize: 20, rawJobIds: raw, validJobIds: valid, declaredTotal: root.total, declaredPages: root.total === 0 ? 0 : Math.ceil(total / 20), nextPageSignalBefore: index === 0 ? null : String(offset), nextPageSignalAfter: done ? null : String(offset + 20), termination: done ? "NEXT_ABSENT" : "CONTINUE", anomalyCodes: [], capturedAt: response.capturedAt!, responseFingerprintSha256: sha256Bytes(Buffer.from(response.body)).sha256 });
            if (!done)
                continue;
            const terminalBody = requestBody(offset + 20), terminal = await listHttp({ url, method: "POST", headers: { Accept: "application/json", "Content-Type": "application/json", Referer: PFIZER_ENTRY }, body: JSON.stringify(terminalBody) });
            artifacts.push(artifact("pfizer-terminal", url, terminal, { method: "POST", url, body: terminalBody }));
            const end = parse(terminal.body);
            if (!terminalBoundaryMatches(parse(artifacts[0]!.body), end, total, raw.length))
                throw Error("Pfizer beyond-end response is neither empty nor an exact first-page reset after a short final page");
            evidence = parsePersistentSourceFetchEvidence({ captureTool: { name: "pfizer-workday-full-traversal", version: "1" }, artifacts, pages, declaredCompleteness: { kind: "COMPLETE_PAGE_TRAVERSAL", scope: "SOURCE", value: pages.length, artifactLogicalKey: "pfizer-terminal", extractorLocator: artifacts.at(-1)!.extractorLocator }, fetchCounts: { rawCount: seen.size, parsedCount: seen.size, validCount: jobs.length, parseDiscardCount: 0, validationDiscardCount: losses.length }, fetchLosses: losses });
            evidence = deriveCanonicalPaginationEvidence({ evidence, expectedChannelIds: [], filteredOutput: true, ...PFIZER_PAGINATION_POLICY });
            const paginationEvaluation = evaluatePaginationEvidence({ evidence, expectedChannelIds: [], filteredOutput: true, ...PFIZER_PAGINATION_POLICY });
            if (!paginationEvaluation.verifiedEligible)
                throw Error("Pfizer full traversal has pagination anomalies");
            return { ok: true, capturedAt: artifacts[0]!.capturedAt, payload: { jobPostings: jobs }, fetchEvidence: evidence, paginationEvaluation, completeness: { completenessStatus: "NEEDS_MANUAL_COMPLETENESS_REVIEW", completenessEvidenceKind: "COMPLETE_PAGE_TRAVERSAL", completenessEvidenceUrl: PFIZER_ENTRY, pagesVisited: pages.length, totalPages: pages.length, pageSize: 20, completenessBlockerReason: "Full main traversal requires independent current-run UI comparison" } };
        }
        throw Error("Pfizer reached the page safety limit without a terminal proof");
    }
    catch (error) {
        // Failure-only support retains the exact API bytes; it makes no page/count/completeness claim.
        // The existing support-only schema excludes PAGINATION_PAGE classifications.
        if (!evidence && artifacts.length) evidence = finalizeOfficialJsonSupportingFailureEvidence({
            artifacts: artifacts.map(a => ({...a, kind: a.kind === "PAGINATION_PAGE" ? "ATS_API_RESPONSE" : a.kind})),
            code:"PFIZER_TRAVERSAL_UNVERIFIED"
        });
        return { ok: false, capturedAt: started, failureReason: error instanceof Error ? error.message : String(error), ...(evidence ? { fetchEvidence: evidence } : {}) };
    }
}
/** Replays archived requests, raw pages, details, exclusions, end proof and the full normalized output. */
export function replayPfizerWorkdayTraversal(plan: SourceCrawlPlan, evidence: PersistentSourceFetchEvidence, output: readonly NormalizedJobRecord[], now?: Date): boolean {
    try {
        if (!isPfizerWorkdayTraversalPlan(plan) || plan.adapterId !== "official-json" || evidence.supportingArtifactOnlyFailure || evidence.declaredCompleteness?.kind !== "COMPLETE_PAGE_TRAVERSAL" || evidence.declaredCompleteness.scope !== "SOURCE" || evidence.declaredCompleteness.value !== evidence.pages.length || evidence.declaredCompleteness.artifactLogicalKey !== "pfizer-terminal" || evidence.pages.length < 1 || evidence.pages.length > 20)
            return false;
        const map = new Map(evidence.artifacts.map(a => [a.logicalKey, a]));
        if (map.size !== evidence.artifacts.length)
            return false;
        const firstAt = Date.parse(evidence.artifacts.find(a => a.logicalKey === "pfizer-page-0")?.capturedAt ?? "");
        const terminalAt = Date.parse(evidence.artifacts.find(a => a.logicalKey === "pfizer-terminal")?.capturedAt ?? "");
        if (!Number.isFinite(firstAt) || !Number.isFinite(terminalAt) || terminalAt < firstAt || terminalAt - firstAt > 3_600_000 ||
            evidence.artifacts.some(a => !Number.isFinite(Date.parse(a.capturedAt)) || Date.parse(a.capturedAt) < firstAt || Date.parse(a.capturedAt) > terminalAt) ||
            now && (!Number.isFinite(now.getTime()) || terminalAt > now.getTime() || now.getTime() - firstAt > 3_600_000)) return false;
        const used = new Set<string>(), seen = new Set<string>(), jobs: ReturnType<typeof projectPfizerDetail>["job"][] = [], losses: unknown[] = [];
        let total = 0;
        const get = (key: string, url: string, request: unknown) => { const a = map.get(key); if (!a || a.kind !== (key.startsWith("pfizer-page-") ? "PAGINATION_PAGE" : "ATS_API_RESPONSE") || a.requestedUrl !== url || a.finalUrl !== url || a.httpStatus !== 200 || !/^application\/json(?:;|$)/iu.test(a.contentType ?? "") || !isDeepStrictEqual(JSON.parse(a.extractorLocator), request) || a.bodyRepresentation !== "EXACT")
            throw Error("Pfizer artifact binding mismatch"); used.add(key); return a; };
        for (let index = 0; index < evidence.pages.length; index++) {
            const p = evidence.pages[index]!, key = `pfizer-page-${index}`, url = PFIZER_API + "/jobs", a = get(key, url, { method: "POST", url, body: requestBody(index * 20) }), root = parse(a.body);
            if (index === 0)
                total = root.total;
            if (!Number.isSafeInteger(total) || total < 1 || !Array.isArray(root.jobPostings) || root.jobPostings.length < 1 || root.jobPostings.length > 20 || root.total !== total && !(index > 0 && root.total === 0))
                return false;
            const raw: string[] = [], valid: string[] = [];
            for (let n = 0; n < root.jobPostings.length; n++) {
                const row = root.jobPostings[n], { id, path } = identity(row);
                if (seen.has(id))
                    return false;
                seen.add(id);
                raw.push(irreversibleOfficialJsonEvidenceId(id));
                const d = get(`pfizer-detail-${id}`, PFIZER_API + path, { method: "GET", url: PFIZER_API + path, officialId: id }), r = projectPfizerDetail(row, String(d.body));
                if (r.excluded)
                    losses.push({ stage: "VALIDATION", reason: "Official detail establishes India and no explicit mainland posting location", rawLocator: `${key}#record:${n}#${irreversibleOfficialJsonEvidenceId(id)}`, details: { code: "PFIZER_VERIFIED_INDIA_SCOPE", pageSequence: index, recordIndex: n }, recordedAt: d.capturedAt });
                else {
                    jobs.push(r.job);
                    valid.push(irreversibleOfficialJsonEvidenceId(r.job.sourceJobId));
                }
            }
            const done = index === evidence.pages.length - 1;
            if (p.sequence !== index || p.artifactLogicalKey !== key || p.channelId !== undefined || p.requestedOffset !== index * 20 || p.returnedOffset !== index * 20 || p.requestedPage !== index || p.returnedPage !== index || p.requestedPageSize !== 20 || p.declaredTotal !== root.total || p.declaredPages !== (root.total === 0 ? 0 : Math.ceil(total / 20)) || p.termination !== (done ? "NEXT_ABSENT" : "CONTINUE") || p.nextPageSignalBefore !== (index === 0 ? null : String(index * 20)) || p.nextPageSignalAfter !== (done ? null : String((index + 1) * 20)) || !isDeepStrictEqual(p.rawJobIds, raw) || !isDeepStrictEqual(p.validJobIds, valid) || p.capturedAt !== a.capturedAt || p.responseFingerprintSha256 !== sha256Bytes(Buffer.from(String(a.body))).sha256 || (!done && raw.length !== 20))
                return false;
        }
        const url = PFIZER_API + "/jobs", terminal = get("pfizer-terminal", url, { method: "POST", url, body: requestBody(evidence.pages.length * 20) }), end = parse(terminal.body);
        if (!terminalBoundaryMatches(parse(map.get("pfizer-page-0")!.body), end, total, evidence.pages.at(-1)!.rawJobIds.length) || seen.size !== total || used.size !== map.size || evidence.declaredCompleteness.extractorLocator !== terminal.extractorLocator || !isDeepStrictEqual(evidence.fetchLosses, losses) || !isDeepStrictEqual(evidence.fetchCounts, { rawCount: total, parsedCount: total, validCount: jobs.length, parseDiscardCount: 0, validationDiscardCount: losses.length }))
            return false;
        const projected = officialJsonAdapter.extract({ company: plan.company, source: plan.source, json: plan.json, capturedAt: evidence.artifacts[0]!.capturedAt, isBaseline: output[0]?.isBaseline ?? true, payload: { jobPostings: jobs } });
        return projected.status === "SUCCESS" && isDeepStrictEqual(projected.jobs, output);
    }
    catch {
        return false;
    }
}

/** Call only after strict main replay; preserve native paths for excluded identities as well. */
export function pfizerMainSourceJobIds(evidence: PersistentSourceFetchEvidence): string[] {
  return evidence.pages.flatMap(page => parse(evidence.artifacts.find(a => a.logicalKey === page.artifactLogicalKey)!.body).jobPostings
    .map((raw: unknown) => pfizerSourceJobId(identity(raw).path)));
}
