import { describe, expect, it } from "vitest";
import type { ArchivedEvidenceArtifact } from "../../src/crawler/artifactArchive";
import { createOfficialJsonSourceFetch } from "../../src/crawler/officialJsonSourceFetch";
import { irreversibleOfficialJsonEvidenceId, persistentOfficialJsonJobId } from "../../src/crawler/officialJsonEvidence";
import { runSourceCrawl } from "../../src/crawler/runSourceCrawl";
import { buildStagedSourceCrawlPlans, getPlanBySourceId, sourcePlanConfigSha256 } from "../../src/crawler/sourcePlan";
import { canonicalStringSetSha256, sha256Bytes } from "../../src/crawler/sourceFetchEvidence";
import { buildAtomicRuntimeCommit, buildPendingRuntimeBatch } from "../../src/crawler/runtimeAtomicEvidence";
import { createOfficialJsonRenderedTraversalValidation, requiresBGradeTraversalCertificate } from "../../src/crawler/traversalCertificate";
import { OFFICIAL_JSON_RENDERED_TRAVERSAL_POLICIES } from "../../src/crawler/officialJsonRenderedTraversalValidator";
import { candidateCompanies } from "../../src/data/companyRegistry";

const AT = "2026-10-01T11:00:35.000Z";
const SHA = "a".repeat(64);

// This covers the new profile's fail-closed B boundary. The legacy filtered-B
// positive regression remains on United Lab; native Hansoh B is not repaired here.
describe("Hansoh native main replay does not substitute for formal B", () => {
  it("keeps the native profile unadmitted without a compatible independent B traversal", async () => {
    const sourceId = "source-hansoh-social";
    const plan = getPlanBySourceId(buildStagedSourceCrawlPlans(candidateCompanies), sourceId);
    if (plan?.adapterId !== "official-json" || plan.officialJsonFetch?.kind !== "beisen-zhiye-2022" ||
        plan.officialJsonFetch.postDateWithinDays !== 180 || !plan.source.surfaceId || !plan.expectedChannels?.[0]) throw Error("Missing native Hansoh plan");
    const raw = {Id: "00000000-0000-4000-8000-000000000001", JobAdId: 1, JobAdName: "职位一", LocNames: ["上海市"],
      Category: "社会招聘", CategoryId: "1", Kind: "全职", Status: 1, ChangeDate: "2026-09-20T12:00:00", PostDate: "2026-09-20T12:00:00"};
    const result = await runSourceCrawl(plan, {fetch: createOfficialJsonSourceFetch({now: () => new Date(AT), http: async request => ({
      status: 200, finalUrl: request.url, contentType: "application/json", capturedAt: AT,
      body: JSON.stringify({Code: 200, Count: 1, Data: [raw]})
    })})});
    expect(result.truth.completenessVerified).toBe(true);
    expect(requiresBGradeTraversalCertificate(plan)).toBe(true);
    expect(OFFICIAL_JSON_RENDERED_TRAVERSAL_POLICIES[sourceId].changedWithinDays).toBe(183);
    const identity = {releaseCandidateId: "synthetic-hansoh-native-test", commitSha: SHA, rosterSha256: SHA,
      sourcePlanSha256: SHA, sourceConfigSha256: SHA, adapterBundleSha256: SHA, batchKind: "SCHEDULED" as const,
      ownerId: "hansoh-native-test", expectedPlannedSourceIds: [sourceId],
      expectedPlannedSourceSetSha256: canonicalStringSetSha256([sourceId]), expectedPlannedSourceCount: 1};
    const batchId = "synthetic-hansoh-native-batch";
    const pending = buildPendingRuntimeBatch(batchId, [plan], identity, new Date(AT)).sources[0]!;
    const artifacts: ArchivedEvidenceArtifact[] = result.fetchEvidence!.artifacts.map(a => ({id: a.id, logicalKey: a.logicalKey,
      releaseCandidateId: identity.releaseCandidateId, batchId, sourceId, sourceResultId: pending.id, kind: a.kind,
      requestedUrl: a.requestedUrl!, finalUrl: a.finalUrl!, httpStatus: a.httpStatus!, contentType: a.contentType!,
      capturedAt: new Date(a.capturedAt), ...sha256Bytes(Buffer.from(a.body as string)),
      path: `outputs/p0-rc/${identity.releaseCandidateId}/${a.logicalKey}.json`, extractorLocator: a.extractorLocator,
      captureToolName: result.fetchEvidence!.captureTool.name, captureToolVersion: result.fetchEvidence!.captureTool.version}));
    const base = {plan, pending, identity, batchId, result, previousJobs: [], baselineCompletedBeforeCrawl: true,
      artifacts, completedAt: new Date(AT)};
    const uncertified = buildAtomicRuntimeCommit(base);
    expect(uncertified.sourceResult).toMatchObject({completenessState: "NEEDS_MANUAL_COMPLETENESS_REVIEW",
      completenessCertificate: null, blockerCode: "B_GRADE_CERTIFICATE_NOT_ISSUED"});
    for (const sourceConfigSha256 of [SHA, sourcePlanConfigSha256(plan)]) {
      // Synthetic legacy semantics, deliberately not a real UI acquisition.
      const legacyValidation = createOfficialJsonRenderedTraversalValidation({sourceId, companyId: plan.company.id,
        sourceConfigSha256, surfaceIds: [plan.source.surfaceId], channelIds: [plan.expectedChannels[0].channelId],
        pages: [{channelId: plan.expectedChannels[0].channelId, pageNumber: 1, declaredTotalPages: 1, declaredTotalJobs: 1,
          uiRequestCandidateIds: [], nextControlPresent: false,
          rawRows: [{sourceJobId: persistentOfficialJsonJobId(raw.Id), rawEvidenceId: irreversibleOfficialJsonEvidenceId(raw.Id),
            scopeMarker: JSON.stringify({locations: raw.LocNames, changeDate: raw.ChangeDate, cutoffAt: "2026-03-31T16:00:00.000Z"}),
            scopeDecision: "INCLUDED_MAINLAND", recordIndex: 0, rawPayload: raw}]}],
        observedAt: AT, expiresAt: "2026-10-02T11:00:35.000Z"});
      const unadmitted = buildAtomicRuntimeCommit({...base, independentTraversalValidation: legacyValidation,
        independentTraversalValidationExecution: "CURRENT_RUN", independentTraversalValidationTrigger: "INITIAL_QUALIFICATION"});
      expect(unadmitted.sourceResult.completenessState).not.toBe("VERIFIED");
      expect(unadmitted.sourceResult.completenessCertificate).toBeNull();
      expect(unadmitted.sourceResult.blockerCode).toBe("B_GRADE_CERTIFICATE_NOT_ISSUED");
    }
  });
});
