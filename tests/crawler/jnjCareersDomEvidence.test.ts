import { acquirePortableCrawlLease } from "../../src/crawler/portableCrawlLease";
// @vitest-environment node
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { auditJnjCareersDomObservations, createJnjCareersDomSourceFetch, replayJnjCareersDomEvidence } from "../../src/crawler/jnjCareersDomEvidence";
import { JNJ_DOM_CAPTURE_TOOL, JNJ_DOM_CONFIG_SHA256 } from "../../src/crawler/jnjCareersDomContract";
import { buildStagedSourceCrawlPlans, sourcePlanConfigSha256 } from "../../src/crawler/sourcePlan";
import { candidateCompanies } from "../../src/data/companyRegistry";
import { runSourceCrawl } from "../../src/crawler/runSourceCrawl";
import { issueAGradeOfficialTotalCertificate } from "../../src/crawler/completenessCertificate";
import { parsePersistentSourceFetchEvidence, sha256Bytes } from "../../src/crawler/sourceFetchEvidence";
import { archiveSourceEvidence } from "../../src/crawler/artifactArchive";
import { buildAtomicRuntimeCommit, buildPendingRuntimeBatch, bindRuntimeEvidenceArtifactIds } from "../../src/crawler/runtimeAtomicEvidence";
import { hasBoundJnjDomOfficialArtifact } from "../../src/db/jnjDomEvidenceAdmission";
import { compilePortableAtomicSourceEvidenceSql } from "../../src/db/ingestionRepository";
import type { RuntimeBatchIdentity } from "../../src/crawler/runtimeBatchIdentity";

const plan=buildStagedSourceCrawlPlans(candidateCompanies).find(p=>p.source.id==="source-johnson-innovative-medicine-social")!;
const url=(page:number)=>`https://www.careers.jnj.com/en/jobs/?${page===1?"":`page=${page}&`}country=China&origin=global#results`;
function fixture(total=21) {
  const ids=Array.from({length:total},(_,i)=>`r-${String(i+1).padStart(6,"0")}`),path=(id:string)=>`/en/jobs/${id}/role-${id}/`, title=(id:string)=>`Role ${id}`;
  const lists=Array.from({length:Math.ceil(total/20)},(_,i)=>{
    const jobs=ids.slice(i*20,(i+1)*20),count=`Displaying ${i*20+1} to ${Math.min((i+1)*20,total)} of ${total} matching jobs`;
    const html=`<ul id="js-job-search-results" data-results="${total}">${jobs.map(id=>`<li class="PageList-items-item card-job" data-id="${id}"><a href="${path(id)}">${title(id)}</a><div class="PagePromo-category">Pharmaceutical Sales</div><address class="PagePromo-location">Guiyang</address></li>`).join("")}</ul>`;
    return JSON.stringify({kind:"BROWSER_UI_DOM_OBSERVATION_NOT_HTTP",url:url(i+1),observedAt:`2026-10-03T05:01:0${i}.000Z`,heading:count,
      fragment:{html,htmlLength:html.length,items:jobs.map(id=>({text:title(id),links:[{title:title(id),url:"https://www.careers.jnj.com"+path(id)}]}))},
      filters:["team","subteam","country","state","location","type","pattern"].map(name=>({id:`l-${name}`,name,selectedOptions:name==="country"?[{text:"China",value:"China"}]:[]})),
      pagination:[...(i?[{label:"Previous page",url:url(i)}]:[]),{label:`Page ${i+1}`,url:url(i+1)},...(i+1<Math.ceil(total/20)?[{label:"Next page",url:url(i+2)}]:[])],
      dom:`- option "China" [selected]\n${count}\n${jobs.map(path).join("\n")}\n${i+1<Math.ceil(total/20)?'- link "Next page"':""}`});
  });
  const details=ids.map(id=>{
    const html=`<div id="js-job-detail" data-id="${id}" data-jobtitle="${title(id)}"><article class="RichTextBody"><ul class="job-meta"><li>Job title<span>${title(id)}</span></li><li>Function<span>Pharmaceutical Sales</span></li><li>Location<span>Guiyang / China</span></li><li>Requisition number<span>${id.toUpperCase()}</span></li></ul><h2>Description</h2><p>Job Description: ${"Responsibilities include scientific work and collaboration. ".repeat(6)}</p></article></div>`;
    const apply=`https://careers.jnj.com.cn/jnj/apply?exid=${id.toUpperCase()}&m=1`;
    return JSON.stringify({kind:"BROWSER_UI_DOM_OBSERVATION_NOT_HTTP",expectedUrl:"https://www.careers.jnj.com"+path(id),expectedTitle:title(id),url:"https://www.careers.jnj.com"+path(id),observedAt:"2026-10-03T05:00:00.000Z",heading:title(id),body:{html,htmlLength:html.length,text:`${id} Description and responsibilities`},applyLinks:[{text:"Apply now",href:apply}],dom:`${id}\n- link "Apply now":\n- /url: ${apply}`});
  });
  return {lists,details};
}
function originalFixture(){const dir=process.env.JNJ_DOM_ORIGINAL_DIR!,files=readdirSync(dir);return {lists:files.filter(f=>/^jnj-list-page-\d+\.json$/.test(f)).sort((a,b)=>Number(a.match(/\d+/)![0])-Number(b.match(/\d+/)![0])).map(f=>readFileSync(join(dir,f),"utf8")),details:files.filter(f=>/^r-\d+\.json$/.test(f)).map(f=>readFileSync(join(dir,f),"utf8"))};}
const mutate=(raw:string,fn:(o:any)=>void)=>{const o=JSON.parse(raw);fn(o);return JSON.stringify(o);};
async function result(input=fixture()){return runSourceCrawl(plan,{fetch:createJnjCareersDomSourceFetch(input)});}
function issue(r:Awaited<ReturnType<typeof result>>,hash=sha256Bytes(Buffer.from(r.fetchEvidence!.artifacts[0]!.body as string)).sha256){
 return issueAGradeOfficialTotalCertificate({plan,transportSuccess:r.truth.transportSuccess,adapterSuccess:r.truth.adapterSuccess,evidence:r.fetchEvidence!,paginationEvaluation:r.paginationEvaluation!,reconciliation:r.reconciliation!,jobs:r.jobs,officialArtifactSha256:hash,
 binding:{releaseCandidateId:"test-jnj",batchId:"test-jnj",sourceResultId:"test-jnj",sourceConfigSha256:sourcePlanConfigSha256(plan)}});
}
it("replays raw DOM lists and each native detail into the existing A issuer without HTTP fields",async()=>{
 const f=fixture(),r=await result(f);expect(sourcePlanConfigSha256(plan)).toBe(JNJ_DOM_CONFIG_SHA256);expect(r.truth).toEqual({transportSuccess:true,adapterSuccess:true,completenessVerified:true});expect(r.jobs).toHaveLength(21);expect(issue(r).status).toBe("CERTIFIED");
 expect(r.fetchEvidence!.captureTool).toEqual(JNJ_DOM_CAPTURE_TOOL);expect(r.fetchEvidence!.artifacts[0]!.body).toBe(f.lists[0]);
 for(const a of r.fetchEvidence!.artifacts){expect(a.kind).toBe("COMMAND_OUTPUT");for(const field of ["httpStatus","contentType","requestedUrl","finalUrl"])expect(a).not.toHaveProperty(field);}
 expect(r.jobs[0]!.evidence.capturedAt).toBe("2026-10-03T05:00:00.000Z");expect(r.jobs[0]!.cities).toEqual(["贵阳"]);
 expect(issue(r,"0".repeat(64))).toMatchObject({status:"REJECTED",blockerCodes:expect.arrayContaining(["OFFICIAL_ARTIFACT_INVALID"])});
});
it("accepts the exact native empty-search page-one address while preserving original bytes and native pagination",async()=>{
 const f=fixture();f.lists[0]=mutate(f.lists[0]!,o=>o.url="https://www.careers.jnj.com/en/jobs/?search=&country=China&origin=global");
 const r=await result(f);expect(r.truth.completenessVerified).toBe(true);expect(issue(r).status).toBe("CERTIFIED");
 expect(r.fetchEvidence!.artifacts[0]!.body).toBe(f.lists[0]);expect(r.fetchEvidence!.pages[0]!.nextPageSignalAfter).toBe(url(2));
});
it.each([
 ["missing page",(f:ReturnType<typeof fixture>)=>f.lists.pop()],
 ["duplicate page",(f:ReturnType<typeof fixture>)=>f.lists[1]=f.lists[0]!],
 ["cross-page duplicate identity",(f:ReturnType<typeof fixture>)=>f.lists[1]=f.lists[1]!.replaceAll("r-000021","r-000001")],
 ["missing detail",(f:ReturnType<typeof fixture>)=>f.details.pop()],
 ["duplicate detail",(f:ReturnType<typeof fixture>)=>f.details[1]=f.details[0]!],
 ["wrong scope",(f:ReturnType<typeof fixture>)=>f.lists[0]=mutate(f.lists[0]!,o=>o.filters[2].selectedOptions[0].value="Japan")],
 ["extra business filter",(f:ReturnType<typeof fixture>)=>f.lists[0]=mutate(f.lists[0]!,o=>o.filters[0].selectedOptions=[{text:"MedTech",value:"MedTech"}])],
 ["nonempty search",(f:ReturnType<typeof fixture>)=>f.lists[0]=mutate(f.lists[0]!,o=>o.url="https://www.careers.jnj.com/en/jobs/?search=medical&country=China&origin=global")],
 ["extra query filter",(f:ReturnType<typeof fixture>)=>f.lists[0]=mutate(f.lists[0]!,o=>o.url="https://www.careers.jnj.com/en/jobs/?search=&country=China&origin=global&team=MedTech")],
 ["duplicate query",(f:ReturnType<typeof fixture>)=>f.lists[0]=mutate(f.lists[0]!,o=>o.url="https://www.careers.jnj.com/en/jobs/?search=&country=China&origin=global&country=China")],
 ["empty-search alias on later page",(f:ReturnType<typeof fixture>)=>f.lists[1]=mutate(f.lists[1]!,o=>o.url="https://www.careers.jnj.com/en/jobs/?search=&country=China&origin=global")],
 ["wrong query",(f:ReturnType<typeof fixture>)=>f.lists[0]=mutate(f.lists[0]!,o=>o.url=o.url.replace("China","Japan"))],
 ["total drift",(f:ReturnType<typeof fixture>)=>f.lists[1]=mutate(f.lists[1]!,o=>o.heading=o.heading.replace("of 21","of 22"))],
 ["missing next",(f:ReturnType<typeof fixture>)=>f.lists[0]=mutate(f.lists[0]!,o=>o.pagination=o.pagination.filter((x:any)=>x.label!=="Next page"))],
 ["false terminal",(f:ReturnType<typeof fixture>)=>f.lists[1]=mutate(f.lists[1]!,o=>o.pagination.push({label:"Next page",url:url(3)}))],
 ["detail id mismatch",(f:ReturnType<typeof fixture>)=>f.details[0]=mutate(f.details[0]!,o=>{o.body.html=o.body.html.replace('data-id="r-000001"','data-id="r-000002"');o.body.htmlLength=o.body.html.length;})],
 ["detail title mismatch",(f:ReturnType<typeof fixture>)=>f.details[0]=mutate(f.details[0]!,o=>o.heading="Different role")],
 ["foreign detail",(f:ReturnType<typeof fixture>)=>f.details[0]=mutate(f.details[0]!,o=>{o.body.html=o.body.html.replace("Guiyang / China","Osaka / Japan");o.body.htmlLength=o.body.html.length;})],
 ["missing apply",(f:ReturnType<typeof fixture>)=>f.details[0]=mutate(f.details[0]!,o=>o.applyLinks=[])],
 ["wrong apply identity",(f:ReturnType<typeof fixture>)=>f.details[0]=mutate(f.details[0]!,o=>o.applyLinks[0].href=o.applyLinks[0].href.replace("R-000001","R-000002"))],
 ["wrong apply host",(f:ReturnType<typeof fixture>)=>f.details[0]=mutate(f.details[0]!,o=>o.applyLinks[0].href=o.applyLinks[0].href.replace("careers.jnj.com.cn","attacker.example"))],
 ["new time outside window",(f:ReturnType<typeof fixture>)=>f.details[0]=mutate(f.details[0]!,o=>o.observedAt="2026-10-03T06:00:00.000Z")],
 ["forged HTTP field",(f:ReturnType<typeof fixture>)=>f.lists[0]=mutate(f.lists[0]!,o=>o.httpStatus=200)],
] as const)("rejects %s before publication",async(_,change)=>{const f=fixture();change(f);expect(await createJnjCareersDomSourceFetch(f)(plan)).toMatchObject({ok:false,failureReason:"JNJ_DOM_OBSERVATION_INVALID"});});
it("rejects evidence tampering and never expands another source's generic nonnetwork permission",async()=>{
 const r=await result(),e=r.fetchEvidence!;
 for(const change of [(x:any)=>x.artifacts[0].httpStatus=200,(x:any)=>x.artifacts[0].capturedAt="2026-10-03T05:02:00.000Z",(x:any)=>x.artifacts.at(-1).extractorLocator="unreviewed",(x:any)=>x.pages[0].validJobIds.pop()]){const copy=structuredClone(e);change(copy);expect(replayJnjCareersDomEvidence(plan,copy,r.jobs)).toBe(false);}
 expect(replayJnjCareersDomEvidence({...plan,source:{...plan.source,id:"other-source"}},e,r.jobs)).toBe(false);
 expect(replayJnjCareersDomEvidence(plan,e,r.jobs.map((j,i)=>i?j:{...j,category:"销售"}))).toBe(false);
 const generic=structuredClone(e);generic.captureTool.name="other";expect(()=>parsePersistentSourceFetchEvidence(generic)).toThrow(/network artifact/);
});
it("builds a genuinely bound atomic candidate and rejects nonnetwork mutation for other sources",async()=>{
 const r=await result(process.env.JNJ_DOM_ORIGINAL_DIR?originalFixture():fixture()),root=await mkdtemp(join(tmpdir(),"jnj-dom-")),h="a".repeat(64),batchId="jnj-dom-test";
 const identity:RuntimeBatchIdentity={releaseCandidateId:"jnj-dom-test",commitSha:h,rosterSha256:h,sourcePlanSha256:h,sourceConfigSha256:h,adapterBundleSha256:h,batchKind:"SCHEDULED",ownerId:"test",expectedPlannedSourceIds:[plan.source.id],expectedPlannedSourceSetSha256:sha256Bytes(Buffer.from(JSON.stringify([plan.source.id]))).sha256,expectedPlannedSourceCount:1};
 const pending=buildPendingRuntimeBatch(batchId,[plan],identity,new Date(r.jobs[0]!.evidence.capturedAt)).sources[0]!;
 const tuple={releaseCandidateId:identity.releaseCandidateId,batchId,sourceId:plan.source.id,sourceResultId:pending.id};
 try{
 const archive=await archiveSourceEvidence({workspaceRoot:root,evidenceSubdirectory:"test-evidence",...tuple,captureTool:r.fetchEvidence!.captureTool,artifacts:bindRuntimeEvidenceArtifactIds({...tuple,artifacts:r.fetchEvidence!.artifacts})});
 const commit=buildAtomicRuntimeCommit({plan,pending,identity,batchId,result:r,artifacts:archive.artifacts,previousJobs:[],baselineCompletedBeforeCrawl:false,completedAt:new Date(Math.max(...r.fetchEvidence!.artifacts.map(a=>Date.parse(a.capturedAt)))+60_000),publicationPolicy:"SOURCE_ATOMIC_LAST_GOOD_V1"});
 expect(commit.sourceResult.completenessState).toBe("VERIFIED");expect(hasBoundJnjDomOfficialArtifact(commit,commit.artifacts[0]!)).toBe(true);const lease=await acquirePortableCrawlLease({$transaction:work=>work({$queryRawUnsafe:async<T>(_sql:string,...values:unknown[])=>[{holderId:values[1]}] as T})}); const sql=await compilePortableAtomicSourceEvidenceSql(commit,lease); expect(sql).toContain("COMMAND_OUTPUT"); if(process.env.JNJ_ATOMIC_FIXTURE_PATH)await writeFile(process.env.JNJ_ATOMIC_FIXTURE_PATH,JSON.stringify(commit));
 for(const change of [(x:any)=>x.sourceResult.sourceId="other",(x:any)=>x.sourceResult.sourceConfigHash=h,(x:any)=>x.artifacts[0].httpStatus=200,(x:any)=>x.artifacts.pop(),(x:any)=>x.pagination[0].nextPageSignalAfter=null]){const copy=structuredClone(commit);change(copy);expect(hasBoundJnjDomOfficialArtifact(copy,copy.artifacts[0]!)).toBe(false);}
 }finally{await rm(root,{recursive:true,force:true});}
});
describe.skipIf(!process.env.JNJ_DOM_ORIGINAL_DIR)("real retained browser observations, no live network",()=>{
 it("replays every original hash-bound page and detail",async()=>{const dir=process.env.JNJ_DOM_ORIGINAL_DIR!,files=readdirSync(dir),f={lists:files.filter(f=>/^jnj-list-page-\d+\.json$/.test(f)).sort().map(f=>readFileSync(join(dir,f),"utf8")),details:files.filter(f=>/^r-\d+\.json$/.test(f)).map(f=>readFileSync(join(dir,f),"utf8"))};const a=auditJnjCareersDomObservations(f.lists,f.details),r=await result(f);expect(r.jobs.length).toBe(a.total);expect(r.jobs.length).toBe(107);expect(issue(r).status).toBe("CERTIFIED");});
});
