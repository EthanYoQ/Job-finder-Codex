import { candidateCompanies } from "../../src/data/companyRegistry";
import { buildStagedSourceCrawlPlans, sourcePlanConfigSha256 } from "../../src/crawler/sourcePlan";
import { createOfficialJsonSourceFetch } from "../../src/crawler/officialJsonSourceFetch";
import { runSourceCrawl } from "../../src/crawler/runSourceCrawl";
import { issueAGradeOfficialTotalCertificate } from "../../src/crawler/completenessCertificate";
import { sha256Bytes } from "../../src/crawler/sourceFetchEvidence";
import { describe, expect, it } from "vitest";
import { rocheNativeDetail, rocheNativeDetailUrl } from "../../src/crawler/rocheChinaQuality";
import type { SourceFetchArtifactDraft } from "../../src/crawler/sourceFetchEvidence";

const started = "2026-10-02T12:00:00.000Z";
const raw = { reqId: "202609-123373", jobId: "202609-123373", jobSeqNo: "ROCHGLOBAL202609123373EXTERNALZHCN",
  title: "Role", applyUrl: "https://roche.wd3.myworkdayjobs.com/roche-ext/job/Shanghai/Role_202609-123373/apply",
  postedDate: "2026-09-30T00:00:00.000+0000", country: "中国大陆", location: "上海, 中国大陆", multi_location: ["上海, 中国大陆"],
  siteType: "external", visibilityType: "External", jobVisibility: ["external"], locale: "zh_cn" };
const info = { title: "Role", jobReqId: raw.reqId, jobPostingId: "Role_202609-123373", jobPostingSiteId: "roche-ext",
  externalUrl: raw.applyUrl.replace(/\/apply$/, ""), location: "Shanghai", country: { descriptor: "China" },
  posted: true, canApply: true, jobDescription: "<p>Responsible for laboratory quality and process compliance.</p>", startDate: "2026-09-30" };
function artifact(row = raw, patch: Record<string, unknown> = {}): SourceFetchArtifactDraft {
  const url = rocheNativeDetailUrl(row)!;
  return { id: `roche-detail-${row.reqId}`, logicalKey: `roche-detail-${row.reqId}`, kind: "ATS_API_RESPONSE", requestedUrl: url, finalUrl: url, httpStatus: 200,
    contentType: "application/json", capturedAt: "2026-10-02T12:02:00.000Z", bodyRepresentation: "EXACT",
    extractorLocator: "roche-workday-jobposting-v1", body: JSON.stringify({ jobPostingInfo: {...info, ...patch} }) };
}
describe("Roche native application and public field binding", () => {
  it("binds exact official identities, active native detail and timestamp without age filtering", () => {
    expect(rocheNativeDetail(raw, artifact(), started)).toMatchObject({ title: "Role", cities: ["上海"], locationRaw: "上海, 中国大陆",
      officialUrl: raw.applyUrl, officialPublishedAt: "2026-09-30T00:00:00.000Z" });
  });
  it.each([{posted:false},{canApply:false},{jobReqId:"different"},{title:"Wrong role"},{jobPostingId:"wrong"},
    {externalUrl:"https://evil.test"},{jobDescription:""}])("rejects conflicting native identity/application %j", patch => {
    expect(rocheNativeDetail(raw, artifact(raw, patch), started)).toBeUndefined();
  });
  it("rejects absent, redirected, stale, or non-exact native evidence", () => {
    expect(rocheNativeDetail(raw, undefined, started)).toBeUndefined();
    for (const patch of [{finalUrl:"https://evil.test"},{capturedAt:"2026-10-01T00:00:00.000Z"},{bodyRepresentation:"REDACTED"}])
      expect(rocheNativeDetail(raw, {...artifact(),...patch} as SourceFetchArtifactDraft, started)).toBeUndefined();
  });
  it("accepts the native empty slug for a Chinese title", () => {
    const row={...raw,applyUrl:raw.applyUrl.replace("Role_", "_")};
    expect(rocheNativeDetail(row, artifact(row,{jobPostingId:"_202609-123373",externalUrl:row.applyUrl.replace(/\/apply$/, "")}),started)).toBeDefined();
  });
  it("keeps all corroborated mainland locations", () => {
    const row = {...raw, multi_location:["上海, 中国大陆", "北京, 北京, 中国大陆"]};
    expect(rocheNativeDetail(row, artifact(row,{additionalLocations:["Beijing"]}),started)?.cities).toEqual(["上海","北京"]);
  });
  it("retains positive China roles with inconsistent locality as city pending", () => {
    const row={...raw,location:"抚州, 福建, 中国大陆",multi_location:["抚州, 福建, 中国大陆"]};
    expect(rocheNativeDetail(row,artifact(row,{location:"Fuzhou"}),started)).toMatchObject({cities:["城市待核"],locationRaw:row.location});
  });
  it("preserves the native publication suffix and corroborates a mainland alternative", () => {
    const row={...raw,country:"波兰",location:"Warsaw, 波兰",multi_location:["Warsaw, 波兰","苏州, 江苏, 中国大陆"],
      applyUrl:raw.applyUrl.replace("Shanghai", "Warsaw").replace("/apply","-1/apply")};
    const a=artifact(row,{location:"Warsaw",additionalLocations:["Suzhou"],country:{descriptor:"Poland"},
      jobPostingId:"Role_202609-123373-1",externalUrl:row.applyUrl.replace(/\/apply$/,"")});
    expect(rocheNativeDetail(row,a,started)?.cities).toEqual(["苏州"]);
    expect(rocheNativeDetail(row,artifact(row,{location:"Warsaw",country:{descriptor:"Poland"}}),started)).toBeUndefined();
  });
  it("does not infer China scope from a generic location", () => {
    const row={...raw,multi_location:["Remote"]};
    expect(rocheNativeDetail(row,artifact(row),started)).toBeUndefined();
  });
  it("keeps an unparseable publication field unknown rather than fabricating midnight", () => {
    const row={...raw,postedDate:"2026-09-30"};
    expect(rocheNativeDetail(row,artifact(row),started)?.officialPublishedAt).toBeUndefined();
  });
});

it("runs current Roche acquisition through native details and rejects output-only tampering", async () => {
  const plan=buildStagedSourceCrawlPlans(candidateCompanies).find(p=>p.source.id==="source-roche-china-social")!;
  const urls:string[]=[]; let posts=0; let clock=0;
  const fetcher=createOfficialJsonSourceFetch({now:()=>new Date(clock++===0?started:"2026-10-02T12:00:03.000Z"),http:async request=>{
    urls.push(request.url);
    const body=request.method==="POST" ? JSON.stringify({refineSearch:{totalHits:1,data:{jobs:posts++===0?[]:[raw],
      aggregations:posts===1?[{field:"country",value:{中国大陆:1}}]:[]}}}) :
      request.url.includes("/wday/cxs/") ? artifact().body as string :
      '<script>var phApp={"widgetApiEndpoint":"https://careers.roche.com/widgets","country":"cn","deviceType":"desktop","locale":"zh_cn","refNum":"ROCHGLOBAL","pageName":"search-results","pageId":"page11-ds"};</script>';
    return {status:200,body,finalUrl:request.url,capturedAt:request.url===plan.source.officialEntryUrl?"2026-10-02T12:00:01.000Z":"2026-10-02T12:00:02.000Z",contentType:request.method==="POST"||request.url.includes("/wday/cxs/")?"application/json":"text/html"};
  }});
  const result=await runSourceCrawl(plan,{fetch:fetcher});
  expect(urls).toContain(rocheNativeDetailUrl(raw));
  expect(result.truth).toMatchObject({completenessVerified:true});
  expect(result.jobs[0]).toMatchObject({officialPublishedAt:"2026-09-30T00:00:00.000Z",cities:["上海"]});
  const evidence=result.fetchEvidence!, declaration=evidence.declaredCompleteness!;
  const original=evidence.artifacts.find(a=>a.logicalKey===declaration.artifactLogicalKey)!;
  const candidate={binding:{releaseCandidateId:"rc-roche",batchId:"batch-roche",sourceResultId:"result-roche",sourceConfigSha256:sourcePlanConfigSha256(plan)},
    plan,transportSuccess:true,adapterSuccess:true,evidence,paginationEvaluation:result.paginationEvaluation!,reconciliation:result.reconciliation!,jobs:result.jobs,
    officialArtifactSha256:sha256Bytes(typeof original.body==="string"?Buffer.from(original.body):original.body).sha256};
  expect(issueAGradeOfficialTotalCertificate(candidate)).toMatchObject({status:"CERTIFIED"});
  for (const key of ["phenom-entry-0000","phenom-facet-global","phenom-facet-country","phenom-page-0000"]) {
    for (const patch of [{httpStatus:503},{contentType:"text/plain"},{capturedAt:"2026-10-02T12:31:02.000Z"}]) {
      const changed=structuredClone(evidence); Object.assign(changed.artifacts.find(a=>a.logicalKey===key)!,patch);
      expect(issueAGradeOfficialTotalCertificate({...candidate,evidence:changed})).toMatchObject({status:"REJECTED"});
    }
  }
  expect(issueAGradeOfficialTotalCertificate({...candidate,jobs:result.jobs.map(job=>({...job,officialTitle:"Forged"}))})).toMatchObject({status:"REJECTED"});
});
