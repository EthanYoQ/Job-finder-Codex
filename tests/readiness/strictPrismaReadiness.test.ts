import { describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { getStrictP0ReadinessReportFromDb } from "../../src/readiness/strictPrismaReadiness";

const h = "a".repeat(64);
const currentHash=createHash("sha256").update('["job-1"]').digest("hex"),emptyHash=createHash("sha256").update('[]').digest("hex"),jobHash=createHash("sha256").update("job-1").digest("hex");
const setHash = createHash("sha256").update('["source-1"]').digest("hex");
const expected = { releaseCandidateId: "rc-1", commitSha: h, rosterSha256: h,
  sourcePlanSha256: h, sourceConfigSha256: h, adapterBundleSha256: h,
  sourceTreeSha256:h,runtimeTreeSha256:h,
  plannedSourceIds: ["source-1"], plannedSourceSetSha256: setHash,
  sourceConfigHashes: { "source-1": h }, adapterVersions: { "source-1": h },
  companyAudits: [{ companyId: "company-1", category: "FOREIGN_PHARMA" as const,
    status: "HAS_PUBLIC_OFFICIAL_CAREERS_LINK_AT_CAPTURE_TIME" as const }],
  releaseMembers: [{ companyId: "company-1", sourceId: "source-1", surfaceId: "surface-1", channelId: "channel-1", category:"FOREIGN_PHARMA" as const }],
  currentTime: new Date("2026-07-10T02:00:00Z"), freshnessMaximum: 10_800_001 };
const observation = { id: "obs-1", releaseCandidateId: "rc-1", batchId: "batch-1",
  sourceId: "source-1", sourceResultId: "result-1", atomicCommitSucceeded: true,
  completenessVerified: true, successful: true, crawledAt: new Date("2026-07-10T00:00:00Z"),
  structuredJobCount: 1, expectedJobCount: 1, completenessStatus: "VERIFIED",
  completenessEvidenceKind: "OFFICIAL_TOTAL_COUNT", completenessEvidenceUrl: "https://example.com/jobs",
  completenessBlockerReason: null, totalPages: 1, pageSize: 1, pagesVisited: 1,
  stableRequiredFields: ["COMPANY", "TITLE", "OFFICIAL_URL", "LOCATION"], failureReason: null,
  canonicalOutputSha256: currentHash, canonicalGraceSha256: emptyHash, canonicalVisibleSha256: currentHash,
  artifactRedactionCommitmentSha256: h, officialEvidenceArtifactId: "artifact-1" };
const batch = { id: "batch-1", releaseCandidateId: "rc-1", commitSha: h,
  rosterSha256: h, sourcePlanSha256: h, sourceConfigSha256: h, adapterBundleSha256: h,
  kind: "FULL_RELEASE", status: "SUCCESS",startedAt:new Date("2026-07-09T23:50:00Z"), finishedAt: new Date("2026-07-10T00:00:00Z"),
  plannedSourceIds: ["source-1"], plannedSourceSetSha256: setHash, plannedSourceCount: 1,
  aggregateJobSetSha256: h, sourceResults: [{ id: "result-1", sourceId: "source-1",
    atomicCommitState: "COMMITTED", transportState: "SUCCEEDED", adapterState: "SUCCEEDED",
    completenessState: "VERIFIED", sourceConfigHash: h, adapterVersion: h,
    canonicalOutputSetSha256: currentHash, canonicalCurrentJobSetSha256: currentHash,
    canonicalGraceJobSetSha256: emptyHash, canonicalVisibleJobSetSha256: currentHash,
    officialEvidenceArtifactId: null, artifactRedactionCommitmentSha256: null,
    officialSurfaceIds:["surface-1"],officialChannelIds:["channel-1"],
    observations: [observation],lifecycleSetMembers:["CURRENT","VISIBLE"].map(setKind=>({releaseCandidateId:"rc-1",batchId:"batch-1",sourceId:"source-1",sourceResultId:"result-1",setKind,jobKey:"job-1",jobKeySha256:jobHash,lifecycleStatus:"ACTIVE",missingCount:0})) }] };
const dbWith=(rows:any[])=>({crawlBatch:{findMany:async()=>rows},releaseCandidate:{findUnique:async()=>({id:"rc-1",status:"READY_FOR_QA",commitSha:h,rosterHash:h,sourcePlanHash:h,sourceConfigHash:h,adapterBundleHash:h,sourceTreeHash:h,runtimeTreeHash:h})},company:{findMany:async()=>[{id:"company-1",inclusionReason:"FOREIGN_PHARMA",sources:[{id:"source-1"}]}]}});

describe("strict Prisma readiness", () => {
  it("hydrates persisted lifecycle set members into strict readiness", async () => {
    const second = { ...batch, id: "batch-2", finishedAt: new Date("2026-07-10T00:30:00Z"), sourceResults: [{ ...batch.sourceResults[0]!,
      id: "result-2", observations: [{ ...observation, id: "obs-2", batchId: "batch-2", sourceResultId: "result-2", crawledAt: new Date("2026-07-10T00:30:00Z") }],lifecycleSetMembers:batch.sourceResults[0]!.lifecycleSetMembers.map(x=>({...x,batchId:"batch-2",sourceResultId:"result-2"})) }] };
    const findMany = vi.fn(async () => [batch, second]);
    const companyFindMany = vi.fn();
    await expect(getStrictP0ReadinessReportFromDb({...dbWith([]),crawlBatch:{findMany}} as never, expected)).resolves.toBeDefined();
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({
      kind: "FULL_RELEASE", releaseCandidateId: "rc-1" }) }));
    const query=(findMany.mock.calls as unknown as [[Record<string,any>]])[0]![0];
    expect(query).toEqual(expect.objectContaining({orderBy:{startedAt:"desc"}}));
    expect(query.where).not.toHaveProperty("status");
    expect(query.where).not.toHaveProperty("finishedAt");
    expect(companyFindMany).not.toHaveBeenCalled();
  });

  it("rejects tampered member hash",async()=>{const broken={...batch,sourceResults:[{...batch.sourceResults[0]!,lifecycleSetMembers:batch.sourceResults[0]!.lifecycleSetMembers.map((x,i)=>i?x:{...x,jobKeySha256:h})}]};await expect(getStrictP0ReadinessReportFromDb(dbWith([broken,{...broken,id:"batch-2"}]) as never,expected)).rejects.toThrow(/key hash mismatch/i)});

  it.each([
    ["missing",(m:any[])=>m.pop()],
    ["extra",(m:any[])=>m.push({...m[1],jobKey:"extra",jobKeySha256:createHash("sha256").update("extra").digest("hex")})],
    ["duplicate",(m:any[])=>m.push({...m[0],id:"duplicate"})],
    ["equal replacement",(m:any[])=>m.forEach(x=>{x.jobKey="replacement";x.jobKeySha256=createHash("sha256").update("replacement").digest("hex")})],
    ["mixed tuple",(m:any[])=>{m[0].batchId="other"}],
    ["status count",(m:any[])=>{m[0].lifecycleStatus="SUSPECTED_OFFLINE";m[0].missingCount=2}],
    ["set kind",(m:any[])=>{m[1].setKind="GRACE";m[1].missingCount=1}],
    ["reassociation",(m:any[])=>{m[0].sourceResultId="result-other"}]
  ])("fails closed on direct hydrated member %s",async(_name,mutate)=>{
    const broken:any=structuredClone(batch);mutate(broken.sourceResults[0].lifecycleSetMembers);
    const second:any=structuredClone(batch);second.id="batch-2";second.finishedAt=new Date("2026-07-10T00:30:00Z");second.sourceResults[0].id="result-2";
    second.sourceResults[0].observations[0].batchId="batch-2";second.sourceResults[0].observations[0].sourceResultId="result-2";
    second.sourceResults[0].lifecycleSetMembers.forEach((x:any)=>{x.batchId="batch-2";x.sourceResultId="result-2"});
    await expect(getStrictP0ReadinessReportFromDb(dbWith([broken,second]) as never,expected)).rejects.toThrow();
  });

  it("rejects when only one matching batch exists", async () => {
    await expect(getStrictP0ReadinessReportFromDb(dbWith([batch]) as never, expected)).rejects.toThrow(/two/i);
  });
  it.each(["PENDING","FAILED"])("queries and blocks a newer %s batch with finishedAt null",async status=>{
    const second:any=structuredClone(batch);second.id="batch-2";second.startedAt=new Date("2026-07-10T00:20:00Z");second.finishedAt=new Date("2026-07-10T00:30:00Z");second.sourceResults[0].id="result-2";second.sourceResults[0].observations[0].batchId="batch-2";second.sourceResults[0].observations[0].sourceResultId="result-2";second.sourceResults[0].lifecycleSetMembers.forEach((x:any)=>{x.batchId="batch-2";x.sourceResultId="result-2"});
    const newer={...second,id:"batch-3",status,startedAt:new Date("2026-07-10T00:40:00Z"),finishedAt:null,sourceResults:[]};
    await expect(getStrictP0ReadinessReportFromDb(dbWith([newer,second,batch]) as never,expected)).rejects.toThrow(/newer.*failed|pending|unreconciled/i);
  });

  it("requires a release-eligible exact RC and exact DB company/source/surface/channel members", async () => {
    const second = { ...batch, id: "batch-2", finishedAt: new Date("2026-07-10T00:30:00Z"), sourceResults: [{ ...batch.sourceResults[0]!,
      id: "result-2", officialSurfaceIds: ["surface-1"], officialChannelIds: ["channel-1"],
      observations: [{ ...observation, id: "obs-2", batchId: "batch-2", sourceResultId: "result-2" }],
      lifecycleSetMembers: batch.sourceResults[0]!.lifecycleSetMembers.map(x => ({...x,batchId:"batch-2",sourceResultId:"result-2"})) }] };
    const first = { ...batch, sourceResults: [{ ...batch.sourceResults[0]!, officialSurfaceIds: ["surface-1"], officialChannelIds: ["channel-1"] }] };
    const releaseCandidate = { findUnique: vi.fn(async () => ({ id: "rc-1", status: "READY_FOR_QA", commitSha: h,
      rosterHash: h, sourcePlanHash: h, sourceConfigHash: h, adapterBundleHash: h,sourceTreeHash:h,runtimeTreeHash:h })) };
    const company = { findMany: vi.fn(async () => [{ id: "company-1", inclusionReason:"FOREIGN_PHARMA", sources: [{ id: "source-1" }] }]) };
    await expect(getStrictP0ReadinessReportFromDb({ crawlBatch: { findMany: async () => [first, second] }, releaseCandidate, company } as never, expected)).resolves.toBeDefined();
    expect(releaseCandidate.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "rc-1" } }));
    expect(company.findMany).toHaveBeenCalled();
  });

  it("uses company audits for the DB roster while a no-link company has zero sources and observations", async () => {
    const second:any=structuredClone(batch);second.id="batch-2";second.finishedAt=new Date("2026-07-10T00:30:00Z");second.sourceResults[0].id="result-2";
    second.sourceResults[0].observations[0].batchId="batch-2";second.sourceResults[0].observations[0].sourceResultId="result-2";
    second.sourceResults[0].lifecycleSetMembers.forEach((x:any)=>{x.batchId="batch-2";x.sourceResultId="result-2"});
    const noLinkExpected={...expected,companyAudits:[...expected.companyAudits,{companyId:"company-2",category:"DOMESTIC_PHARMA" as const,status:"NO_PUBLIC_OFFICIAL_CAREERS_LINK_AT_CAPTURE_TIME" as const}]};
    const companies=[{id:"company-1",inclusionReason:"FOREIGN_PHARMA",sources:[{id:"source-1"}]},{id:"company-2",inclusionReason:"DOMESTIC_PHARMA",sources:[]}];
    const report=await getStrictP0ReadinessReportFromDb({...dbWith([batch,second]),company:{findMany:async()=>companies}} as never,noLinkExpected);
    expect(report.totalCandidates).toBe(2);
    expect(report.noPublicOfficialCareersLinkCompanies).toBe(1);
    expect(report.requiredOfficialLinkSources).toBe(1);
    expect(report.crawlEvidencedOfficialLinkSources).toBe(1);
    expect(report.canLaunchP0).toBe(true);
  });

  it("accepts an exact 30+30 DB roster with 58 planned sources and two zero-source no-link companies", async () => {
    const audits=Array.from({length:60},(_,index)=>({companyId:`company-${index}`,category:index<30?"FOREIGN_PHARMA" as const:"DOMESTIC_PHARMA" as const,
      status:index<58?"HAS_PUBLIC_OFFICIAL_CAREERS_LINK_AT_CAPTURE_TIME" as const:"NO_PUBLIC_OFFICIAL_CAREERS_LINK_AT_CAPTURE_TIME" as const}));
    const plannedSourceIds=Array.from({length:58},(_,index)=>`source-${String(index).padStart(2,"0")}`);
    const releaseMembers=plannedSourceIds.map((sourceId,index)=>({companyId:`company-${index}`,sourceId,surfaceId:`surface-${index}`,channelId:`channel-${index}`,category:audits[index]!.category}));
    const plannedSourceSetSha256=createHash("sha256").update(JSON.stringify(plannedSourceIds)).digest("hex");
    const largeExpected={...expected,plannedSourceIds,plannedSourceSetSha256,
      sourceConfigHashes:Object.fromEntries(plannedSourceIds.map(sourceId=>[sourceId,h])),adapterVersions:Object.fromEntries(plannedSourceIds.map(sourceId=>[sourceId,h])),
      companyAudits:audits,releaseMembers};
    const makeBatch=(id:string,finishedAt:Date)=>({ ...batch,id,startedAt:new Date(finishedAt.getTime()-60_000),finishedAt,plannedSourceIds,plannedSourceSetSha256,plannedSourceCount:58,
      sourceResults:plannedSourceIds.map((sourceId,index)=>{const sourceResultId=`result-${id}-${index}`,jobKey=`job-${index}`,jobKeySha256=createHash("sha256").update(jobKey).digest("hex"),setSha=createHash("sha256").update(JSON.stringify([jobKey])).digest("hex");
        return {...batch.sourceResults[0]!,id:sourceResultId,sourceId,canonicalOutputSetSha256:setSha,canonicalCurrentJobSetSha256:setSha,canonicalVisibleJobSetSha256:setSha,
          officialSurfaceIds:[`surface-${index}`],officialChannelIds:[`channel-${index}`],observations:[{...observation,id:`obs-${id}-${index}`,batchId:id,sourceId,sourceResultId,crawledAt:finishedAt,
            canonicalOutputSha256:setSha,canonicalVisibleSha256:setSha}],lifecycleSetMembers:["CURRENT","VISIBLE"].map(setKind=>({releaseCandidateId:"rc-1",batchId:id,sourceId,sourceResultId,setKind,jobKey,jobKeySha256,lifecycleStatus:"ACTIVE",missingCount:0}))};})});
    const companies=audits.map((audit,index)=>({id:audit.companyId,inclusionReason:audit.category,sources:index<58?[{id:`source-${String(index).padStart(2,"0")}`}]:[]}));
    const rows=[makeBatch("batch-large-1",new Date("2026-07-10T00:00:00Z")),makeBatch("batch-large-2",new Date("2026-07-10T00:30:00Z"))];
    const report=await getStrictP0ReadinessReportFromDb({...dbWith(rows),company:{findMany:async()=>companies}} as never,largeExpected);
    expect(report).toMatchObject({totalCandidates:60,foreignPharmaCompanies:30,domesticPharmaCompanies:30,
      requiredOfficialLinkSources:58,crawlEvidencedOfficialLinkSources:58,noPublicOfficialCareersLinkCompanies:2,canLaunchP0:true});
  });

  it("deduplicates multiple trusted channels for one DB source", async () => {
    const first:any=structuredClone(batch),second:any=structuredClone(batch);
    second.id="batch-2";second.finishedAt=new Date("2026-07-10T00:30:00Z");
    for(const [row,id] of [[first,"result-1"],[second,"result-2"]] as const){row.sourceResults[0].id=id;row.sourceResults[0].officialSurfaceIds=["surface-1","surface-1"];row.sourceResults[0].officialChannelIds=["channel-1","channel-2"];row.sourceResults[0].observations[0].batchId=row.id;row.sourceResults[0].observations[0].sourceResultId=id;row.sourceResults[0].lifecycleSetMembers.forEach((x:any)=>{x.batchId=row.id;x.sourceResultId=id});}
    const multiChannel={...expected,releaseMembers:[...expected.releaseMembers,{...expected.releaseMembers[0]!,channelId:"channel-2"}]};
    await expect(getStrictP0ReadinessReportFromDb(dbWith([first,second]) as never,multiChannel)).resolves.toMatchObject({requiredOfficialLinkSources:1,canLaunchP0:true});
  });

  it.each(["TRUST_FREEZE", "INVALIDATED", "BUILDING"])("rejects RC status %s", async (status) => {
    const db = { crawlBatch: { findMany: async () => [] }, releaseCandidate: { findUnique: async () => ({ status }) },
      company: { findMany: async () => [] } };
    await expect(getStrictP0ReadinessReportFromDb(db as never, expected)).rejects.toThrow(/release.eligible/i);
  });

  it.each([
    ["extra zero-source",[{id:"company-1",inclusionReason:"FOREIGN_PHARMA",sources:[{id:"source-1"}]},{id:"extra",inclusionReason:"DOMESTIC_PHARMA",sources:[]}]],
    ["unknown category",[{id:"company-1",inclusionReason:"OTHER",sources:[{id:"source-1"}]}]],
    ["duplicate company",[{id:"company-1",inclusionReason:"FOREIGN_PHARMA",sources:[{id:"source-1"}]},{id:"company-1",inclusionReason:"FOREIGN_PHARMA",sources:[]}]],
    ["replacement",[{id:"replacement",inclusionReason:"FOREIGN_PHARMA",sources:[{id:"source-1"}]}]],
    ["missing",[]]
  ])("rejects %s company/category roster",async(_name,companies)=>{
    const second:any=structuredClone(batch);second.id="batch-2";second.finishedAt=new Date("2026-07-10T00:30:00Z");second.sourceResults[0].id="result-2";second.sourceResults[0].observations[0].batchId="batch-2";second.sourceResults[0].observations[0].sourceResultId="result-2";second.sourceResults[0].lifecycleSetMembers.forEach((x:any)=>{x.batchId="batch-2";x.sourceResultId="result-2"});
    await expect(getStrictP0ReadinessReportFromDb({...dbWith([batch,second]),company:{findMany:async()=>companies}} as never,expected)).rejects.toThrow(/company|category|roster/i);
  });

  it.each([
    ["missing", [{id:"company-1",inclusionReason:"FOREIGN_PHARMA",sources:[]}]],
    ["extra", [{id:"company-1",inclusionReason:"FOREIGN_PHARMA",sources:[{id:"source-1"},{id:"source-extra"}]}]],
    ["duplicate", [{id:"company-1",inclusionReason:"FOREIGN_PHARMA",sources:[{id:"source-1"},{id:"source-1"}]}]]
  ])("rejects %s DB source set independently of the company roster",async(_name,companies)=>{
    await expect(getStrictP0ReadinessReportFromDb({...dbWith([]),company:{findMany:async()=>companies}} as never,expected)).rejects.toThrow(/source|roster/i);
  });

  it("rejects a planned source reassociated to another audited company",async()=>{
    const reassociatedExpected={...expected,companyAudits:[...expected.companyAudits,{companyId:"company-2",category:"DOMESTIC_PHARMA" as const,status:"NO_PUBLIC_OFFICIAL_CAREERS_LINK_AT_CAPTURE_TIME" as const}]};
    const companies=[{id:"company-1",inclusionReason:"FOREIGN_PHARMA",sources:[]},{id:"company-2",inclusionReason:"DOMESTIC_PHARMA",sources:[{id:"source-1"}]}];
    await expect(getStrictP0ReadinessReportFromDb({...dbWith([]),company:{findMany:async()=>companies}} as never,reassociatedExpected)).rejects.toThrow(/source|roster/i);
  });

  it.each([
    ["unsuccessful",{successful:false}],
    ["invalid completeness",{completenessStatus:"INCOMPLETE"}],
    ["missing stable fields",{stableRequiredFields:["COMPANY"]}]
  ])("returns canLaunch false for %s observation",async(_name,patch)=>{
    const first:any=structuredClone(batch),second:any=structuredClone(batch);second.id="batch-2";second.finishedAt=new Date("2026-07-10T00:30:00Z");
    for(const [row,id] of [[first,"result-1"],[second,"result-2"]] as const){row.sourceResults[0].id=id;row.sourceResults[0].observations[0]={...row.sourceResults[0].observations[0],...patch,batchId:row.id,sourceResultId:id};row.sourceResults[0].lifecycleSetMembers.forEach((x:any)=>{x.batchId=row.id;x.sourceResultId=id});}
    const report=await getStrictP0ReadinessReportFromDb(dbWith([first,second]) as never,expected);expect(report.canLaunchP0).toBe(false);expect(report.blockers.length).toBeGreaterThan(0);
  });
});
