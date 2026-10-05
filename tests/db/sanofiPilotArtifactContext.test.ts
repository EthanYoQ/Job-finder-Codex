// @vitest-environment node
import {createHash} from "node:crypto";
import {mkdtemp,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join,resolve} from "node:path";
import {pathToFileURL} from "node:url";
import {afterAll,beforeAll,describe,expect,it,vi} from "vitest";
import {candidateCompanies} from "../../src/data/companyRegistry";
import {buildStagedSourceCrawlPlans,sourcePlanConfigSha256} from "../../src/crawler/sourcePlan";
import {createSanofiChineseSourceFetch,bindSanofiChineseIndependentArtifact} from "../../src/crawler/sanofiChineseNative";
import {captureSanofiChineseIndependent} from "../../src/crawler/sanofiChineseRenderedTraversal";
import {createOfficialJsonRenderedTraversalValidation,sanofiCertificateArtifactLocators} from "../../src/crawler/traversalCertificate";
import {runSourceCrawl} from "../../src/crawler/runSourceCrawl";
import {buildAtomicRuntimeCommit,buildPendingRuntimeBatch,bindRuntimeEvidenceArtifactIds} from "../../src/crawler/runtimeAtomicEvidence";
import {canonicalStringSetSha256} from "../../src/crawler/sourceFetchEvidence";
import {deriveCurrentStagedScheduleExpectation,STAGED_SCHEDULE_ORACLE_VERSION} from "../../src/crawler/stagedScheduleAuthority";
import {archiveSourceEvidence} from "../../src/crawler/artifactArchive";
import {loadPilotContext} from "../../src/crawler/cloudPilotContext";
import {CLOUD_PILOT_SQL45} from "../../src/db/cloudPilotSql45Manifest";
import {http,dom} from "../helpers/sanofiHeaderFixture";

const base={schemaVersion:2 as const,commitSha:"a".repeat(40),sourceTreeSha256:"b".repeat(64),runtimeTreeSha256:"c".repeat(64)};
const build={...base,contentSha256:createHash("sha256").update(JSON.stringify(base)).digest("hex")};
const candidate={id:"synthetic-sanofi-paired-context",goalId:"jobfinder-portable-required-40",version:10};
const common={projectId:"yiopvxysxrtrnvqxwgbx",build,candidate};
const p=buildStagedSourceCrawlPlans(candidateCompanies).find(p=>p.source.id==="source-sanofi-china-social")!;
const expectation=deriveCurrentStagedScheduleExpectation(build),ids=[p.source.id];
const identity={releaseCandidateId:candidate.id,commitSha:expectation.commitSha,rosterSha256:expectation.rosterSha256,sourcePlanSha256:expectation.sourcePlanSha256,
  sourceConfigSha256:expectation.sourceConfigSha256,adapterBundleSha256:expectation.adapterBundleSha256,batchKind:"SCHEDULED" as const,
  ownerId:"dot-cloud-sanofi-china-social-pilot",expectedPlannedSourceIds:ids,expectedPlannedSourceSetSha256:canonicalStringSetSha256(ids),expectedPlannedSourceCount:1};
const candidateRow={...candidate,commitSha:expectation.commitSha,...CLOUD_PILOT_SQL45.databaseIdentity,rosterHash:expectation.rosterSha256,
  sourcePlanHash:expectation.sourcePlanSha256,sourceConfigHash:expectation.sourceConfigSha256,adapterBundleHash:expectation.adapterBundleSha256,
  sourceTreeHash:expectation.sourceTreeSha256,runtimeTreeHash:expectation.runtimeTreeSha256,oracleVersion:STAGED_SCHEDULE_ORACLE_VERSION,
  minimumStableCompanyCount:expectation.minimumStableCompanyCount,status:"BUILDING"};
const sourceRow={id:p.source.id,companyId:p.company.id,kind:p.source.kind,atsKind:p.source.atsKind,status:p.source.status,officialEntryUrl:p.source.officialEntryUrl,officialChainEvidenceUrl:p.source.officialChainEvidenceUrl};
const companyRow={id:p.company.id,officialChineseName:p.company.officialChineseName};
const dirs:string[]=[];
async function captured(batchId:string,at:string,later:string){
  at=new Date(at).toISOString();later=new Date(later).toISOString();
  const main=http(true),independent=http(),fetched=await createSanofiChineseSourceFetch({http:async r=>({...await main(r),capturedAt:at}),now:()=>new Date(at)})(p);
  const result=await runSourceCrawl(p,{fetch:async()=>fetched,isBaseline:false});expect(result.status).toBe("SUCCESS");
  const d=dom();d.observedAt=at;d.pages.forEach(page=>{page.capturedAt=at;});
  const capture=await captureSanofiChineseIndependent({dom:d,http:async r=>({...await independent(r),capturedAt:later}),now:()=>new Date(later)});
  const validation=createOfficialJsonRenderedTraversalValidation({sourceId:"source-sanofi-china-social",companyId:p.company.id,sourceConfigSha256:sourcePlanConfigSha256(p),
    surfaceIds:[p.source.surfaceId!],channelIds:p.expectedChannels!.map(c=>c.channelId),pages:capture.pages,observedAt:at,expiresAt:new Date(Date.parse(at)+30*60_000).toISOString()});
  result.fetchEvidence=bindSanofiChineseIndependentArtifact(p,result.fetchEvidence!,validation.artifactSha256);
  const planned=buildPendingRuntimeBatch(batchId,[p],identity,new Date(at)),pending=planned.sources[0]!,tuple={releaseCandidateId:candidate.id,batchId,sourceId:p.source.id,sourceResultId:pending.id};
  const workspaceRoot=await mkdtemp(join(tmpdir(),"sanofi-context-contract-"));dirs.push(workspaceRoot);
  const archive=await archiveSourceEvidence({workspaceRoot,...tuple,evidenceSubdirectory:"evidence",captureTool:result.fetchEvidence!.captureTool,
    artifacts:bindRuntimeEvidenceArtifactIds({...tuple,artifacts:result.fetchEvidence!.artifacts})});
  const source={plan:p,pending,identity,batchId,result,artifacts:archive.artifacts,completedAt:new Date(later),publicationPolicy:"SOURCE_ATOMIC_LAST_GOOD_V1" as const,
    independentTraversalValidation:validation,independentTraversalValidationExecution:"CURRENT_RUN" as const,independentTraversalValidationTrigger:"INITIAL_QUALIFICATION" as const};
  const commit=buildAtomicRuntimeCommit({...source,previousJobs:[],baselineCompletedBeforeCrawl:false});
  expect(commit.sourceResult.completenessState).toBe("VERIFIED");
  const locators=sanofiCertificateArtifactLocators(commit.sourceResult.completenessCertificate);
  const evidenceArtifacts=commit.artifacts.filter(a=>locators.includes(a.extractorLocator)).map(a=>({...tuple,kind:a.kind,extractorLocator:a.extractorLocator,sha256:a.sha256}));
  const row=JSON.parse(JSON.stringify({...commit.sourceResult,evidenceArtifacts,observations:[{id:batchId+"-observation",...commit.observationProvenance,
    successful:true,crawledAt:later}]}));
  return {source,planned,commit,row};
}
let first:Awaited<ReturnType<typeof captured>>,next:Awaited<ReturnType<typeof captured>>;
let compiler:typeof import("../../src/db/cloudPilotSqlControl");
beforeAll(async()=>{
  vi.stubEnv("JOBFINDER_CLOUD_SOURCE_ID",p.source.id);vi.resetModules();compiler=await import("../../src/db/cloudPilotSqlControl");
  first=await captured("sanofi-first-synthetic","2026-10-04T17:00:00Z","2026-10-04T17:01:00Z");
  next=await captured("sanofi-next-synthetic","2026-10-04T17:05:00Z","2026-10-04T17:06:00Z");
},30000);
afterAll(async()=>{vi.useRealTimers();vi.unstubAllEnvs();vi.resetModules();await Promise.all(dirs.map(dir=>rm(dir,{recursive:true,force:true})));});
const context=(row:Record<string,unknown>|null=first.row)=>({checkedAt:"2026-10-04T17:06:00.000Z",sourceId:p.source.id,sourceConfigSha256:sourcePlanConfigSha256(p),jobs:[],
  firstAccepted:row,latestAccepted:row,candidateRow,sourceRow,companyRow});

describe("Sanofi publisher artifact context through next-run compilation",()=>{
  it("keeps the pre-first-B null context and uses only the exact persisted tuple/locator seven-field projection",async()=>{
    expect((await loadPilotContext(context(null),p,true)).baselineCompletedBeforeCrawl).toBe(false);
    const sql=compiler.compileCloudPilotPublicationContextSql(common);
    for(const key of ["releaseCandidateId","batchId","sourceResultId","sourceId","kind","extractorLocator","sha256"])expect(sql).toContain("'"+key+"'");
    expect(sql).toContain('a."releaseCandidateId"=r."releaseCandidateId" AND a."batchId"=r."batchId" AND a."sourceResultId"=r.id AND a."sourceId"=r."sourceId"');
    expect(sql).toContain("SANOFI_CN_FOREIGN_HEADER_NATIVE_AUTHORITY");expect(sql).not.toMatch(/a\."?(body|path|requestedUrl)"?/u);
  });
  it("accepts the first persisted B at PRE_CAPTURE and compiles the next B with the same locked re-read projection",async()=>{
    const snapshot=context(),loaded=await loadPilotContext(snapshot,p,true);expect(loaded.baselineCompletedBeforeCrawl).toBe(true);
    expect(loaded.trustedCompletenessBaseline?.sourceResultId).toBe(first.row.id);
    vi.useFakeTimers({toFake:["Date"]});vi.setSystemTime(new Date("2026-10-04T17:06:01Z"));
    try{
      const {compileDbStartedCloudSourcePublication}=await import("../../src/db/ingestionRepository");
      const packet=await compileDbStartedCloudSourcePublication({source:next.source,control:{...common,planned:next.planned,context:snapshot}});
      expect(packet.commit.sourceResult.completenessState).toBe("VERIFIED");
      expect(packet.sql).toContain(compiler.compileCloudPilotPublicationContextSql(common).slice(0,-1));
      expect(packet.sql).toContain('public."CrawlObservation",public."EvidenceArtifact" IN SHARE ROW EXCLUSIVE MODE');
      expect(packet.sql).toContain("PILOT_CONTEXT_CHANGED");expect(packet.sql).toContain('"evidenceArtifacts"');
    }finally{vi.useRealTimers();}
  });
  it.each(["missing","wrong-tuple","hash","locator","kind","duplicate"])("rejects %s metadata before another capture or publication compile",async kind=>{
    const row=structuredClone(first.row),a=row.evidenceArtifacts.find((a:any)=>a.kind==="ORACLE_RESULT");
    if(kind==="missing")delete row.evidenceArtifacts;if(kind==="wrong-tuple")a.batchId="other-batch";if(kind==="hash")a.sha256="f".repeat(64);
    if(kind==="locator")a.extractorLocator="other";if(kind==="kind")a.kind="ATS_PAGE";if(kind==="duplicate")row.evidenceArtifacts.push({...a});
    await expect(loadPilotContext(context(row),p,true)).rejects.toThrow();
  });
  it("validates first and latest baseline commitments independently",async()=>{
    const snapshot={...context(),latestAccepted:next.row};expect((await loadPilotContext(snapshot,p,true)).trustedCompletenessBaseline?.sourceResultId).toBe(next.row.id);
    const bad=structuredClone(snapshot);delete bad.firstAccepted!.evidenceArtifacts;await expect(loadPilotContext(bad,p,true)).rejects.toThrow();
  });
  it.each(["source-bayer-healthcare-social","source-cttq-social"])("does not add Sanofi artifact reads to %s",async source=>{
    vi.resetModules();vi.stubEnv("JOBFINDER_CLOUD_SOURCE_ID",source);
    try{const other=await import("../../src/db/cloudPilotSqlControl"),sql=other.compileCloudPilotPublicationContextSql(common);
      expect(sql).not.toContain("EvidenceArtifact");expect(sql).not.toContain("sanofi-cn-module-anomalies-v2");
      expect(sql.includes("CrawlObservation")).toBe(source==="source-bayer-healthcare-social");
    }finally{vi.stubEnv("JOBFINDER_CLOUD_SOURCE_ID",p.source.id);}
  });
});

it.skipIf(!process.env.SANOFI_CONTEXT_PGLITE_MODULE)("executes only the generated context SELECT in an isolated in-memory PostgreSQL fixture",async()=>{
  const modulePath=process.env.SANOFI_CONTEXT_PGLITE_MODULE!,{PGlite}=await import(/* @vite-ignore */pathToFileURL(resolve(modulePath)).href);
  const {pgcrypto}=await import(/* @vite-ignore */pathToFileURL(resolve(modulePath,"../contrib/pgcrypto.js")).href);
  const pg=await PGlite.create({extensions:{pgcrypto}});
  const quote=(s:string)=>'"'+s.replaceAll('"','""')+'"';
  async function table(name:string,row:Record<string,unknown>){
    const type=(key:string,v:unknown)=>v!==null&&typeof v==="object"?"jsonb":typeof v==="boolean"?"boolean":typeof v==="number"?"integer":/At$|^observedFrom$|^observedTo$/u.test(key)?"timestamp":"text";
    await pg.exec(`CREATE TABLE ${quote(name)} (${Object.entries(row).map(([k,v])=>quote(k)+" "+type(k,v)).join(",")})`);
  }
  async function insert(name:string,row:Record<string,unknown>){const cols=Object.keys(row).map(quote).join(",");await pg.query(`INSERT INTO ${quote(name)} (${cols}) SELECT ${cols} FROM jsonb_populate_record(NULL::${quote(name)},$1::jsonb)`,[JSON.stringify(row)]);}
  try{
    await pg.exec('CREATE SCHEMA extensions; CREATE EXTENSION pgcrypto WITH SCHEMA extensions;');
    const {observations,evidenceArtifacts,...row}=first.row;
    await table("CrawlBatchSourceResult",row);await table("CrawlObservation",observations[0]);
    await table("EvidenceArtifact",{id:"",...evidenceArtifacts[0]});
    await pg.exec('CREATE TABLE "CrawlBatch" (id text,kind text); CREATE TABLE "RecruitmentSource" (id text,"companyId" text,"atsKind" text,kind text,status text,"officialEntryUrl" text,"officialChainEvidenceUrl" text); CREATE TABLE "Company" (id text,"officialChineseName" text); CREATE TABLE "ReleaseCandidate" (id text); CREATE TABLE "Job" ("dedupeKey" text,"companyId" text,"sourceId" text,"sourceJobId" text,"officialTitle" text,"auxiliaryChineseTitle" text,"officialUrl" text,"listUrl" text,"locationRaw" text,city text,cities text[],category text,"officialPublishedAt" timestamp,"firstSeenAt" timestamp,"lastSeenAt" timestamp,"missingSuccessCount" int,"lifecycleStatus" text);');
    const sql=compiler.compileCloudPilotPublicationContextSql(common),read=async()=>(await pg.query(sql)).rows[0].context;
    expect((await read()).firstAccepted).toBeNull();
    for(const f of [first,next]){
      const {observations,evidenceArtifacts,...r}=f.row;await insert("CrawlBatch",{id:r.batchId,kind:"SCHEDULED"});await insert("CrawlBatchSourceResult",r);await insert("CrawlObservation",observations[0]);
      for(const [i,a] of evidenceArtifacts.entries())await insert("EvidenceArtifact",{id:r.id+"-"+i,...a});
      for(const field of ["batchId","releaseCandidateId","sourceResultId","sourceId","extractorLocator"])await insert("EvidenceArtifact",{id:r.id+"-decoy-"+field,...evidenceArtifacts[0],[field]:"wrong"});
      const s=await read();expect(s.latestAccepted.evidenceArtifacts).toHaveLength(2);
      expect(Object.keys(s.latestAccepted.evidenceArtifacts[0]).sort()).toEqual(["batchId","extractorLocator","kind","releaseCandidateId","sha256","sourceId","sourceResultId"]);
      expect((await loadPilotContext(s,p,true)).baselineCompletedBeforeCrawl).toBe(true);
    }
    const current=await read();expect(current.firstAccepted.id).toBe(first.row.id);expect(current.latestAccepted.id).toBe(next.row.id);
    await pg.query('UPDATE "EvidenceArtifact" SET sha256=$1 WHERE "sourceResultId"=$2 AND kind=\'ORACLE_RESULT\' AND "extractorLocator"=\'sanofi-cn-module-anomalies-v2\'',['f'.repeat(64),next.row.id]);
    const changed=await read();expect(changed).not.toEqual(current);await expect(loadPilotContext(changed,p,true)).rejects.toThrow("SANOFI_CN_PERSISTED_ARTIFACT_COMMITMENT_MISMATCH");
  }finally{await pg.close();}
},30000);
