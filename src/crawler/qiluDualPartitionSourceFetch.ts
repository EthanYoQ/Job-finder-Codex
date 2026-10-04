import { load } from "cheerio";
import { collectQiluMainPartitions, qiluPartitionPlans, type QiluMainPartitionCapture } from "./qiluDualPartitionMainCapture";
import { QILU_DUAL_PARTITION_PROFILE } from "./qiluDualPartitionConfig";
import type { SourceFetchFunction } from "./runSourceCrawl";
import { validateExecutablePlanChannelBinding, type SourceCrawlPlan } from "./sourcePlan";
import { parsePersistentSourceFetchEvidence, sha256Bytes, type PersistentSourceFetchEvidence } from "./sourceFetchEvidence";
import { evaluatePaginationEvidence } from "./paginationEvidence";
import type { StrictProfileBoundSourcePolicy } from "./profileBoundSourceEvidence";
import type { NormalizedJobRecord } from "./normalizedJob";
import { validateStrictHtmlCompletenessProof } from "./strictHtmlCompletenessProof";
import { htmlTableAdapter } from "./adapters/htmlTable";
import { irreversibleOfficialJsonEvidenceId, persistentOfficialJsonJobId } from "./officialJsonEvidence";
import { requestContractV2Locator } from "./strictPageRequestContract";
import { replayManualQiluCapture, qiluReviewedRowGeography } from "./manualChromeQiluReplay";
import { parseManualCaptureJson } from "./manualChromeCaptureEvidence";
import { validateQiluForeignLossRowsForDiagnostic } from "./strictSourceScopeExclusionProof";
const CHANNELS = QILU_DUAL_PARTITION_PROFILE.expectedChannelIds;
const MARKETING = QILU_DUAL_PARTITION_PROFILE.config.marketingEntryUrl;
const API = "https://qilu-pharma.zhiye.com/api/Jobad/GetJobAdPageList";
const MANIFEST = "qilu-partition-metadata";
const DECLARATION = "qilu-required-partitions-declaration";
const LOCATOR = "qilu-marketing-and-nonmarketing-complete-traversal-v1";
const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const sha = (s: string) => sha256Bytes(Buffer.from(s, "utf8")).sha256;
function exactPlan(plan: SourceCrawlPlan): boolean {
    try {
        validateExecutablePlanChannelBinding(plan);
    }
    catch {
        return false;
    }
    return plan.executionAuthority === "STAGED" && plan.company.id === "company-qilu" && plan.source.companyId === "company-qilu" &&
        plan.source.id === "source-qilu-social" && plan.source.officialEntryUrl === MARKETING &&
        plan.adapterId === "official-json" && eq(plan.profileBoundSource, QILU_DUAL_PARTITION_PROFILE);
}
export function getStrictQiluDualPartitionPolicy(plan: SourceCrawlPlan): StrictProfileBoundSourcePolicy | undefined {
    if (!exactPlan(plan))
        return undefined;
    return { allowMissingReturnedPage: true, allowIndependentlyVerifiedProfileBoundExclusions: true,
        urlRules: [{ id: "qilu-marketing", url: MARKETING, match: "EXACT", allowsPagination: true, allowsDeclaration: true },
            { id: "qilu-nonmarketing", url: API, match: "EXACT", allowsPagination: true }] };
}
/** Production main acquisition only. Independent B validation and staged release QA remain separate. */
export function createQiluDualPartitionSourceFetch(deps: Parameters<typeof collectQiluMainPartitions>[0] = {}): SourceFetchFunction {
    return async (plan) => {
        const capturedAt = (deps.now ?? (() => new Date()))().toISOString();
        if (!exactPlan(plan))
            return { ok: false, capturedAt, failureReason: "QILU_DUAL_PLAN_BINDING_INVALID" };
        const capture = await collectQiluMainPartitions(deps);
        if (capture.state !== "COLLECTED")
            return { ok: false, capturedAt, failureReason: "QILU_REQUIRED_PARTITION_INCOMPLETE", fetchEvidence: failedAttemptEvidence(capture, capturedAt) };
        const originals = capture.partitions.map(p => p.result!.fetchEvidence!);
        const evidence = compose(originals);
        const paginationEvaluation = evaluatePaginationEvidence({ evidence, expectedChannelIds: CHANNELS, filteredOutput: true,
            allowMissingReturnedPage: true, allowIndependentlyVerifiedProfileBoundExclusions: true });
        return { ok: true, capturedAt, payload: { jobs: capture.candidateRecords.map(j => ({ sourceJobId: j.sourceJobId, title: j.officialTitle,
                    officialUrl: j.officialUrl, locationRaw: j.locationRaw, cities: j.cities })) }, fetchEvidence: evidence, paginationEvaluation,
            completeness: { completenessStatus: "NEEDS_MANUAL_COMPLETENESS_REVIEW", completenessEvidenceKind: "COMPLETE_PAGE_TRAVERSAL",
                completenessEvidenceUrl: MARKETING, pagesVisited: evidence.pages.length } };
    };
}
function failedAttemptEvidence(capture: QiluMainPartitionCapture, capturedAt: string): PersistentSourceFetchEvidence {
    const artifacts: PersistentSourceFetchEvidence["artifacts"] = [];
    const partitions = capture.partitions.map(partition => {
        const evidence = partition.result?.fetchEvidence;
        if (evidence)
            artifacts.push(...evidence.artifacts.map(a => ({ ...a,
                id: partition.partitionId + "-" + a.id, logicalKey: partition.partitionId + "-" + a.logicalKey,
                channelId: partition.partitionId, kind: a.kind === "PAGINATION_PAGE" ? "ATS_PAGE" as const : a.kind })));
        return { partitionId: partition.partitionId, state: partition.state, sourcePlanSha256: partition.sourcePlanSha256,
            ...(evidence ? { originalEvidence: { ...evidence, artifacts: evidence.artifacts.map(({ body, ...a }) => ({ ...a,
                        bodySha256: sha(typeof body === "string" ? body : Buffer.from(body).toString("utf8")) })) } } : {}) };
    });
    artifacts.push({ id: "qilu-failed-attempt", logicalKey: "qilu-failed-attempt", kind: "COMMAND_OUTPUT", capturedAt,
        body: JSON.stringify({ schemaVersion: "qilu-required-partition-failure-v1", failureCodes: capture.failureCodes, partitions }),
        extractorLocator: "non-certifying-required-partition-attempt-diagnostics" });
    return parsePersistentSourceFetchEvidence({ captureTool: { name: "qilu-required-partition-http", version: "1" }, artifacts, pages: [],
        supportingArtifactOnlyFailure: { code: "QILU_REQUIRED_PARTITION_INCOMPLETE" },
        fetchCounts: { rawCount: 0, parsedCount: 0, validCount: 0, parseDiscardCount: 0, validationDiscardCount: 0 }, fetchLosses: [] });
}
function compose(originals: readonly PersistentSourceFetchEvidence[]): PersistentSourceFetchEvidence {
    if (originals.length !== 2)
        throw new Error("Qilu requires two partitions");
    const artifacts: PersistentSourceFetchEvidence["artifacts"] = [];
    const pages: PersistentSourceFetchEvidence["pages"] = [];
    const losses: PersistentSourceFetchEvidence["fetchLosses"] = [];
    const metadata = originals.map((e, index) => {
        const channelId = CHANNELS[index]!;
        const prefix = channelId + "-";
        const offset = pages.length;
        artifacts.push(...e.artifacts.map(a => ({ ...a, id: prefix + a.id, logicalKey: prefix + a.logicalKey, channelId })));
        pages.push(...e.pages.map(p => ({ ...p, sequence: offset + p.sequence, artifactLogicalKey: prefix + p.artifactLogicalKey, channelId })));
        losses.push(...e.fetchLosses.map(l => ({ ...l, rawLocator: prefix + l.rawLocator, details: { ...l.details,
                ...(l.details.pageSequence !== undefined ? { pageSequence: offset + l.details.pageSequence } : {}) } })));
        return { channelId, evidence: { ...e, artifacts: e.artifacts.map(({ body, ...a }) => ({ ...a, bodySha256: sha(typeof body === "string" ? body : Buffer.from(body).toString("utf8")) })) } };
    });
    const first = originals[0]!.artifacts.find(a => a.requestedUrl === MARKETING)!;
    artifacts.push({ ...first, id: DECLARATION, logicalKey: DECLARATION, kind: "OFFICIAL_COMPANY_PAGE", extractorLocator: LOCATOR });
    artifacts.push({ id: MANIFEST, logicalKey: MANIFEST, kind: "COMMAND_OUTPUT", capturedAt: first.capturedAt,
        body: JSON.stringify({ schemaVersion: "qilu-main-partition-metadata-v1", partitions: metadata }), extractorLocator: "retained-original-partition-declarations-and-traces" });
    const fetchCounts = { rawCount: 0, parsedCount: 0, validCount: 0, parseDiscardCount: 0, validationDiscardCount: 0 };
    for (const e of originals)
        for (const key of Object.keys(fetchCounts) as Array<keyof typeof fetchCounts>)
            fetchCounts[key] += e.fetchCounts[key];
    return parsePersistentSourceFetchEvidence({ captureTool: { name: "qilu-required-partition-http", version: "1" }, artifacts, pages,
        declaredCompleteness: { kind: "COMPLETE_PAGE_TRAVERSAL", value: pages.length, artifactLogicalKey: DECLARATION, extractorLocator: LOCATOR, scope: "SOURCE" },
        fetchCounts, fetchLosses: losses });
}
function recover(e: PersistentSourceFetchEvidence): PersistentSourceFetchEvidence[] {
    const artifact = e.artifacts.find(a => a.logicalKey === MANIFEST);
    if (!artifact || typeof artifact.body !== "string")
        throw new Error("Missing partition metadata");
    const m = parseManualCaptureJson(artifact.body) as any;
    if (m.schemaVersion !== "qilu-main-partition-metadata-v1" || !Array.isArray(m.partitions) || m.partitions.length !== 2)
        throw new Error("Invalid partition metadata");
    return m.partitions.map((p: any, index: number) => {
        if (p.channelId !== CHANNELS[index] || !Array.isArray(p.evidence?.artifacts))
            throw new Error("Invalid partition order");
        return parsePersistentSourceFetchEvidence({ ...p.evidence, artifacts: p.evidence.artifacts.map((meta: any) => {
                const { bodySha256, ...a } = meta;
                const actual = e.artifacts.find(x => x.logicalKey === p.channelId + "-" + a.logicalKey);
                if (!actual || typeof actual.body !== "string" || sha(actual.body) !== bodySha256)
                    throw new Error("Partition body mismatch");
                return { ...a, body: actual.body };
            }) });
    });
}
/** Independent replay of exact partition bodies, loss locations, IDs, pagination and emitted rows. */
export function validateStrictQiluDualPartitionEvidence(plan: SourceCrawlPlan, input: unknown, jobs: readonly NormalizedJobRecord[]): boolean {
    try {
        if (!exactPlan(plan))
            return false;
        const e = parsePersistentSourceFetchEvidence(input);
        const originals = recover(e);
        if (!eq(e, compose(originals)))
            return false;
        const [marketing, nonmarketing] = originals as [
            PersistentSourceFetchEvidence,
            PersistentSourceFetchEvidence
        ];
        const marketingPlan = qiluPartitionPlans()[0];
        if (marketing.captureTool.name !== "official-html-http" || marketing.captureTool.version !== "1" || marketingPlan.adapterId !== "html-table" || !validateStrictHtmlCompletenessProof(marketingPlan, marketing))
            return false;
        const ma = marketing.artifacts.find(a => a.requestedUrl === MARKETING)!;
        if (typeof ma.body !== "string")
            return false;
        const $ = load(ma.body);
        if (!$("a[href]").toArray().some(a => $(a).attr("href") === "https://qilu-pharma.zhiye.com/social" && /社会招聘/u.test($(a).text()) && /非营销/u.test($(a).text())))
            return false;
        const marketingJobs = htmlTableAdapter.extract({ ...marketingPlan, html: ma.body, capturedAt: ma.capturedAt, isBaseline: true }).jobs;
        if (marketingJobs.length !== marketing.fetchCounts.validCount)
            return false;
        const expected = marketingJobs.map(j => ({ sourceJobId: j.sourceJobId, title: j.officialTitle, url: j.officialUrl, location: j.locationRaw, cities: j.cities }));
        if (expected.some(j => { const u=new URL(j.url); return u.origin !== "https://www.qilu-pharma.com" || !u.pathname.startsWith("/JobPosting_Detail/") || u.search!=="" || u.hash!=="" || u.username!=="" || u.password!==""; }))
            return false;
        if (nonmarketing.captureTool.name !== "official-json-http" || nonmarketing.captureTool.version !== "1" ||
            nonmarketing.artifacts.length !== nonmarketing.pages.length || !validateQiluForeignLossRowsForDiagnostic(nonmarketing))
            return false;
        const entries = nonmarketing.pages.map((p, index) => {
            const a = nonmarketing.artifacts.find(a => a.logicalKey === p.artifactLogicalKey)!;
            const request = { PageIndex: index, PageSize: 15, Category: ["1"], KeyWords: "", SpecialType: 0, PortalId: "", DisplayFields: ["Category", "LocId", "Org", "PostDate", "WorkWeChatQrCode"] };
            const base = `beisen-zhiye-page-v1|requestPageIndex:${index}|requestPageSize:15|requestCategory:${irreversibleOfficialJsonEvidenceId("1")}|json:$.Count,$.Data`;
            const locator = requestContractV2Locator(base, { family: "beisen", role: "page", method: "POST", url: API, body: request,
                coordinate: { sequence: index, requestedPage: index, requestedPageSize: 15 } });
            if (!a || typeof a.body !== "string" || a.requestedUrl !== API || a.finalUrl !== API || a.httpStatus !== 200 || a.bodyRepresentation !== "EXACT" ||
                a.kind !== "PAGINATION_PAGE" || a.extractorLocator !== locator || a.channelId !== undefined || p.sequence !== index || p.requestedPage !== index || p.requestedPageSize !== 15 ||
                p.capturedAt !== a.capturedAt || p.responseFingerprintSha256 !== sha(a.body))
                throw new Error("Invalid Beisen page binding");
            const root = parseManualCaptureJson(a.body) as any;
            const last = index === nonmarketing.pages.length - 1;
            if (p.declaredTotal !== root.Count || p.returnedPage !== (root.PageIndex ?? null) || p.returnedPageSize != null ||
                p.requestedCursor != null || p.returnedCursor != null || p.requestedOffset != null || p.returnedOffset != null ||
                p.declaredCount != null || p.declaredPages != null || p.channelId !== undefined ||
                p.nextPageSignalBefore !== (index === 0 ? null : `page:${index}`) ||
                p.nextPageSignalAfter !== (last ? null : `page:${index + 1}`) || p.termination !== (last ? "NEXT_ABSENT" : "CONTINUE") ||
                p.anomalyCodes.length !== 0 || !/^application\/(?:[a-z0-9.+-]+\+)?json(?:;|$)/iu.test(a.contentType ?? ""))
                throw new Error("Invalid Beisen trace");
            if (!eq(p.rawJobIds, root.Data.map((r: any) => irreversibleOfficialJsonEvidenceId(r.Id.toLowerCase()))))
                throw new Error("Invalid raw IDs");
            if (root.Data.some((r: any) => typeof r.Id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(r.Id))) throw new Error("Invalid canonical UUID");
            if (root.Data.some((r: any) => typeof r.Category !== "string" || r.Category.trim() !== "社会招聘" ||
                String(r.CategoryId).trim() !== "1" || (typeof r.Kind === "string" && /(?:校园|校招|campus)/iu.test(r.Kind))))
                throw new Error("Invalid social channel row");
            if (root.Data.some((row: unknown) => qiluReviewedRowGeography(row) === undefined)) throw new Error("Unresolved or conflicting alternate geography");
            const excluded = new Set(nonmarketing.fetchLosses.filter(l => l.details.pageSequence === index).map(l => l.details.recordIndex));
            const valid = root.Data.filter((_r: any, i: number) => !excluded.has(i));
            if (!eq(p.validJobIds, valid.map((r: any) => irreversibleOfficialJsonEvidenceId(persistentOfficialJsonJobId(r.Id.toLowerCase())))))
                throw new Error("Invalid valid IDs");
            if (valid.some((r: any) => [r.Country, r.CountryName].some(country => country != null &&
                (typeof country !== "string" || (country.trim() !== "" && !/^(?:china|prc|mainland china|china mainland|people'?s republic of china|中国|中国大陆|中华人民共和国)$/iu.test(country.normalize("NFKC").trim()))))))
                throw new Error("Conflicting country scope");
            for (const r of valid)
                expected.push({ sourceJobId: persistentOfficialJsonJobId(r.Id.toLowerCase()), title: r.JobAdName.trim(),
                    url: `https://qilu-pharma.zhiye.com/social/detail?jobAdId=${r.Id.toLowerCase()}`, location: r.LocNames.map((s: string) => s.trim()).join(" / "),
                    cities: [...new Set<string>(r.LocNames.flatMap((s: string) => s.split(/[/,，;；、]/u).map(s => s.trim()).filter(Boolean).map(s => s.split("·").map(s => s.trim()).filter(Boolean).at(-1)!)))] });
            return { started_at: a.capturedAt, url: API, method: "POST", http_status: 200, request_json_text: JSON.stringify(request), response_json_text: a.body,
                request_text_sha256: sha(JSON.stringify(request)), response_text_sha256: sha(a.body) };
        });
        const nd = nonmarketing.declaredCompleteness;
        if (nd?.kind !== "COMPLETE_PAGE_TRAVERSAL" || nd.scope !== "SOURCE" || nd.channelId !== undefined ||
            nd.value !== nonmarketing.pages.length || nd.artifactLogicalKey !== nonmarketing.pages[0]?.artifactLogicalKey ||
            nd.extractorLocator !== nonmarketing.artifacts[0]?.extractorLocator || nonmarketing.fetchCounts.parseDiscardCount !== 0 ||
            nonmarketing.fetchCounts.parsedCount !== nonmarketing.fetchCounts.rawCount || nonmarketing.supportingArtifactOnlyFailure !== undefined)
            return false;
        const replay = replayManualQiluCapture({ business: { entries }, now: new Date(Math.max(...entries.map(e => Date.parse(e.started_at)))) });
        if (replay.geographyCounts.unresolvedOrMixed !== 0 || replay.geographyCounts.auditedForeignOnly !== nonmarketing.fetchLosses.length ||
            replay.rawCount !== nonmarketing.fetchCounts.rawCount || nonmarketing.fetchCounts.validCount !== expected.length - marketingJobs.length)
            return false;
        const evaluation = evaluatePaginationEvidence({ evidence: e, expectedChannelIds: CHANNELS, filteredOutput: true, allowMissingReturnedPage: true, allowIndependentlyVerifiedProfileBoundExclusions: true });
        if (!evaluation.safeCompleteness || !evaluation.verifiedEligible)
            return false;
        if (jobs.some(j => j.companyId !== plan.company.id || j.sourceId !== plan.source.id))
            return false;
        return eq(expected, jobs.map(j => ({ sourceJobId: j.sourceJobId, title: j.officialTitle, url: j.officialUrl, location: j.locationRaw, cities: j.cities })));
    }
    catch {
        return false;
    }
}
