import { createCipheriv, createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { candidateCompanies } from "../../src/data/companyRegistry";
import { buildStagedSourceCrawlPlans, getPlanBySourceId, sourcePlanConfigSha256 } from "../../src/crawler/sourcePlan";
import { createMokaSourceFetch, decryptMokaResponse, type MokaHttpRequest } from "../../src/crawler/mokaSourceFetch";
import { gskCustomDetailLocations, gskPrimaryLocationCity, hasGskNativeDetailLocations } from "../../src/crawler/gskMokaDetailLocations";
import { runSourceCrawl, validateStrictOfficialTotalCertificateEvidence } from "../../src/crawler/runSourceCrawl";
import { issueAGradeOfficialTotalCertificate } from "../../src/crawler/completenessCertificate";
import { hashCanonicalStringSet } from "../../src/crawler/runtimeBatchIdentity";
import { selectPortableSourceSnapshots, projectPortableSourceJobs } from "../../src/domain/portablePublicSnapshot";
import { accepted, job } from "../helpers/portablePublicSnapshotFixture";

const at = "2026-10-07T14:00:00.000Z", iv = "0123456789abcdef", key = "fedcba9876543210";
const plan = () => getPlanBySourceId(buildStagedSourceCrawlPlans(candidateCompanies), "source-gsk-china-social")!;
const encrypt = (value: unknown) => {
  const cipher = createCipheriv("aes-128-cbc", Buffer.from(key), Buffer.from(iv));
  return JSON.stringify({necromancer: key, data: cipher.update(JSON.stringify(value), "utf8", "base64") + cipher.final("base64")});
};
function raw(index = 0, missing = true): Record<string, any> {
  return {id: `synthetic-gsk-role-${index}`, orgId: "gsk", title: `Synthetic role ${index}`, status: "open",
    publishedAt: "2026-10-06T23:37:41", locations: missing ? [] : [{country: "中国", cityName: "上海市"}]};
}
function detail(row = raw()): Record<string, any> {
  return {...row, customFields: {
    "273744": {name: "Req status", value: "Open"},
    "277551": {name: "Primary job posting location", value: "Shanghai Qiantan Plaza"},
    "279542": {name: "Primary location", value: "Shanghai Qiantan Plaza"},
    "271770": {name: "Additional job posting locations", value: ""},
    "277552": {name: "Additional locations", value: ""}
  }};
}
async function capture(options: {normalList?: boolean; normalDetail?: boolean; mutate?: (d: Record<string, any>) => void} = {}) {
  const p = plan(), requests: MokaHttpRequest[] = [];
  const init = {org: {id: "gsk"}, siteId: "148067", mode: "social", aesIv: iv,
    jobCustomFields: [{id: 273744, name: "Req status", type: "select_info", detail: ["Open", "Frozen", "Filled", "Close"]}]};
  const fetch = createMokaSourceFetch({now: () => new Date(at), http: async request => {
    requests.push(request);
    let body: string;
    if (request.method === "GET") body = `<input id="init-data" value="${JSON.stringify(init).replaceAll('"', '&quot;')}">`;
    else if (request.url.endsWith("/job")) {
      const index = Number(String(request.body!.jobId).split("-").at(-1));
      const d = detail(raw(index));
      if (options.normalDetail) {d.locations = [{country: "中国", cityName: "上海市"}]; delete d.customFields;}
      options.mutate?.(d);
      body = encrypt({success: true, data: d});
    } else {
      expect(request.body!.customFields).toEqual({"273744": {values: ["Open"]}});
      const offset = Number(request.body!.offset);
      body = encrypt({success: true, data: {jobStats: {total: 67}, offset,
        jobs: Array.from({length: Math.min(50, 67 - offset)}, (_, i) => raw(offset + i, !options.normalList && offset + i < 2))}});
    }
    return {status: 200, body, finalUrl: request.url.replace(/#.*$/u, ""),
      contentType: request.method === "GET" ? "text/html" : "application/json", capturedAt: at};
  }});
  return {plan: p, result: await runSourceCrawl(p, {fetch}), requests};
}
type Capture = Awaited<ReturnType<typeof capture>>;
function certify(c: Capture, binding = {releaseCandidateId: "synthetic-gsk", batchId: "synthetic-gsk", sourceResultId: "synthetic-gsk", sourceConfigSha256: sourcePlanConfigSha256(c.plan)}) {
  const {result, plan: p} = c, evidence = result.fetchEvidence!;
  const official = evidence.artifacts.find(a => a.logicalKey === evidence.declaredCompleteness?.artifactLogicalKey);
  return issueAGradeOfficialTotalCertificate({binding, plan: p, transportSuccess: result.truth.transportSuccess,
    adapterSuccess: result.truth.adapterSuccess, evidence, paginationEvaluation: result.paginationEvaluation!,
    reconciliation: result.reconciliation!, jobs: result.jobs,
    officialArtifactSha256: official && createHash("sha256").update(official.body).digest("hex")});
}

describe("GSK official custom workplace fields", () => {
  it("keeps the existing exact GSK plan and source hash", () => {
    const p = plan(); expect(hasGskNativeDetailLocations(p)).toBe(true);
    expect(sourcePlanConfigSha256(p)).toBe("aa9bf82308c3b818a8c33b80561712b932389186c160ae83583a8c869eb54d74");
    const wrongSource = structuredClone(p); wrongSource.source.id = "source-other-social";
    expect(hasGskNativeDetailLocations(wrongSource)).toBe(false);
    const wrongEntry = structuredClone(p); wrongEntry.source.officialEntryUrl += "changed";
    expect(hasGskNativeDetailLocations(wrongEntry)).toBe(false);
    if (p.adapterId === "official-json") {delete p.moka!.requisitionStatusPolicy; expect(hasGskNativeDetailLocations(p)).toBe(false);}
  });
  it.each([
    ["Shanghai Qiantan Plaza", "上海"], ["Shanghai Riverside Office", "上海"], ["Beijing Central Office", "北京"],
    ["上海市", "上海"], ["Shanghai", "上海"], ["NotShanghai Qiantan Plaza", undefined],
    ["Unknown Qiantan Plaza", undefined], ["Shanghai/Hong Kong", undefined], ["Hong Kong Office", undefined],
    ["Shanghai Hong Kong Plaza", undefined], ["Shanghai HongKong Plaza", undefined], ["Shanghai Taipei Office", undefined],
    ["Shanghai Singapore Plaza", undefined], ["Taipei Office", undefined],
    ["Shanghai Beijing Office", undefined], ["Shanghai or Beijing", undefined], ["Shanghai Remote Office", undefined],
    ["Shanghai Qiantan Plaza; Singapore", undefined], ["China", undefined]
  ])("parses the complete workplace label %s", (text, city) => {expect(gskPrimaryLocationCity(text!)).toBe(city);});
  it("retains all 67 IDs, both full pages, exact details, raw labels and the original A certificate", async () => {
    const c = await capture();
    expect(c.result.status).toBe("SUCCESS"); expect(c.result.jobs).toHaveLength(67);
    expect(c.result.truth.completenessVerified).toBe(true);
    expect(c.requests.filter(r => r.url.endsWith("/jobs/v2")).map(r => r.body!.offset)).toEqual([0, 50]);
    expect(c.requests.filter(r => r.url.endsWith("/job"))).toHaveLength(2);
    expect(new Set(c.result.jobs.map(j => j.sourceJobId)).size).toBe(67);
    expect(c.result.jobs.slice(0, 2).map(j => ({cities: j.cities, raw: j.locationRaw, date: j.officialPublishedAt})))
      .toEqual(Array.from({length: 2}, () => ({cities: ["上海"], raw: "Shanghai Qiantan Plaza", date: undefined})));
    expect(c.result.fetchEvidence!.fetchCounts).toEqual({rawCount: 67, parsedCount: 67, validCount: 67, parseDiscardCount: 0, validationDiscardCount: 0});
    const details = c.result.fetchEvidence!.artifacts.filter(a => a.logicalKey.startsWith("moka-detail-"));
    expect(details).toHaveLength(2); expect(details.every(a => a.bodyRepresentation !== "REDACTED")).toBe(true);
    const d: any = decryptMokaResponse(JSON.parse(String(details[0]!.body)), iv);
    expect(d.data.locations).toEqual([]); expect(d.data.customFields["277551"].value).toBe("Shanghai Qiantan Plaza");
    expect(certify(c)).toMatchObject({status: "CERTIFIED", certificate: {schemaVersion: "a-grade-official-total-v2",
      counts: {officialTotal: 67, finalUniqueJobCount: 67, validationDiscardCount: 0}, legalScopeExclusionLedger: []}});
  });
  it.each(["normalList", "normalDetail"] as const)("preserves existing %s behavior", async mode => {
    const c = await capture({[mode]: true}); expect(c.result.jobs).toHaveLength(67);
    expect(c.result.jobs.every(j => j.locationRaw === "上海市" && j.cities[0] === "上海市")).toBe(true);
    expect(certify(c)).toMatchObject({status: "CERTIFIED"});
  });
  it.each([
    ["missing primary", (d: any) => {delete d.customFields["277551"];}],
    ["renamed primary", (d: any) => {d.customFields["277551"].name = "Recruiter location";}],
    ["foreign primary", (d: any) => {d.customFields["277551"].value = d.customFields["279542"].value = "Singapore Office";}],
    ["unknown primary", (d: any) => {d.customFields["277551"].value = d.customFields["279542"].value = "Unknown Office";}],
    ["different cities", (d: any) => {d.customFields["279542"].value = "Beijing Central Office";}],
    ["different facilities", (d: any) => {d.customFields["279542"].value = "Shanghai Riverside Office";}],
    ["foreign additional", (d: any) => {d.customFields["271770"].value = "Hong Kong";}],
    ["unknown additional", (d: any) => {d.customFields["277552"].value = "Unknown";}],
    ["hidden new country field", (d: any) => {d.customFields["999999"] = {name: "Workplace country", value: "Singapore"};}],
    ["not Open", (d: any) => {d.customFields["273744"].value = "Frozen";}],
    ["wrong title", (d: any) => {d.title += " mismatch";}],
    ["wrong ID", (d: any) => {d.id = "wrong";}],
    ["wrong org", (d: any) => {d.orgId = "other";}],
    ["wrong site", (d: any) => {d.siteId = "other";}],
    ["wrong source date", (d: any) => {d.publishedAt = "2026-10-05T23:37:41";}],
    ["missing official locations", (d: any) => {delete d.locations;}]
  ] as const)("fails closed on %s", async (_name, mutate) => {
    const c = await capture({mutate}); expect(c.result.status).toBe("FAILED");
    expect(c.result.jobs).toHaveLength(0); expect(c.result.truth.completenessVerified).toBe(false);
  });
  it("binds the exact original fields and normalized output during independent replay", async () => {
    const c = await capture();
    const strict = (value: Capture) => validateStrictOfficialTotalCertificateEvidence({plan: value.plan,
      evidence: value.result.fetchEvidence!, paginationEvaluation: value.result.paginationEvaluation!,
      reconciliation: value.result.reconciliation!, jobs: value.result.jobs});
    expect(strict(c)).toBe(true);
    const dated = structuredClone(c); dated.result.jobs[0]!.officialPublishedAt = "2026-09-01T00:00:00.000Z";
    expect(strict(dated)).toBe(false); expect(certify(dated)).toMatchObject({status: "REJECTED"});
    const extra = structuredClone(c); extra.result.fetchEvidence!.artifacts.push({...extra.result.fetchEvidence!.artifacts[0]!, id: "unbound-extra", logicalKey: "unbound-extra"});
    expect(strict(extra)).toBe(false); expect(certify(extra)).toMatchObject({status: "REJECTED"});
    const missing = structuredClone(c); missing.result.fetchEvidence!.artifacts = missing.result.fetchEvidence!.artifacts.filter(a => !a.logicalKey.startsWith("moka-detail-"));
    expect(strict(missing)).toBe(false);
    const forged = structuredClone(c); forged.result.jobs[0]!.cities = ["北京"]; expect(strict(forged)).toBe(false);
    const changed = structuredClone(c); const a = changed.result.fetchEvidence!.artifacts.find(a => a.logicalKey === "moka-detail-0000-0000")!;
    const d: any = decryptMokaResponse(JSON.parse(String(a.body)), iv); d.data.customFields["279542"].value = "Singapore Office"; a.body = encrypt(d);
    expect(strict(changed)).toBe(false); expect(certify(changed)).toMatchObject({status: "REJECTED"});
    const cropped = structuredClone(c); cropped.result.jobs = cropped.result.jobs.slice(2);
    expect(certify(cropped)).toMatchObject({status: "REJECTED"});
  });
  it("keeps the unchanged public reader publishing the complete A-certified set", async () => {
    const c = await capture(), finished = "2026-10-07T14:01:00.000Z";
    const fixture = accepted(finished, c.result.jobs.map(j => j.sourceJobId!), [], c.plan);
    const issued = certify(c, {releaseCandidateId: fixture.result.releaseCandidateId, batchId: fixture.result.batchId,
      sourceResultId: fixture.result.id, sourceConfigSha256: fixture.result.sourceConfigHash});
    if (issued.status !== "CERTIFIED") throw Error(issued.blockerCodes.join(","));
    const cert = issued.certificate;
    Object.assign(fixture.result, {startedAt: new Date(at), completenessCertificate: cert,
      completenessCertificateSha256: issued.certificateSha256, adapterReconciliationSha256: cert.output.adapterReconciliationSha256,
      collisionLedgerSha256: cert.output.collisionLedgerSha256, expectedSurfaceSha256: hashCanonicalStringSet(cert.scope.surfaceIds),
      visitedSurfaceSha256: hashCanonicalStringSet(cert.scope.surfaceIds), expectedChannelSha256: hashCanonicalStringSet(cert.scope.channelIds),
      visitedChannelSha256: hashCanonicalStringSet(cert.scope.channelIds)});
    const rows = c.result.jobs.map(j => ({...job(j.sourceJobId!, finished), companyId: c.plan.company.id, sourceId: c.plan.source.id,
      dedupeKey: `${c.plan.source.id}:${j.sourceJobId}`, officialTitle: j.officialTitle, officialUrl: j.officialUrl,
      cities: j.cities, city: j.cities[0]!, locationRaw: j.locationRaw}));
    const options = {currentTime: new Date("2026-10-07T14:02:00.000Z")};
    const selected = selectPortableSourceSnapshots([c.plan], [fixture.result], options)[0]!;
    expect(selected).toMatchObject({state: "PUBLISHING", lastAcceptedJobCount: 67});
    expect(projectPortableSourceJobs(selected, fixture.members, rows, options)).toMatchObject({state: "PUBLISHING", visibleJobCount: 67});
  });
});
