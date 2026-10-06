// Entirely invented DOM bytes. Never reads a real capture or database.
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { jnjDomListUrl, type JnjDomUrlProfile } from "../../src/crawler/jnjCareersDomUrlProfile";
import { createJnjCareersDomSourceFetch } from "../../src/crawler/jnjCareersDomEvidence";
import { buildStagedSourceCrawlPlans } from "../../src/crawler/sourcePlan";
import { candidateCompanies } from "../../src/data/companyRegistry";
import { runSourceCrawl } from "../../src/crawler/runSourceCrawl";
import { sha256Bytes } from "../../src/crawler/sourceFetchEvidence";
import { archiveSourceEvidence } from "../../src/crawler/artifactArchive";
import { buildAtomicRuntimeCommit, buildPendingRuntimeBatch, bindRuntimeEvidenceArtifactIds } from "../../src/crawler/runtimeAtomicEvidence";
import type { RuntimeBatchIdentity } from "../../src/crawler/runtimeBatchIdentity";
export const syntheticJnjPlan=buildStagedSourceCrawlPlans(candidateCompanies).find(p=>p.source.id==="source-johnson-innovative-medicine-social")!;
export function syntheticJnjFixture(total=21, profile: JnjDomUrlProfile = "native-pagesize20-v2") {
  const url = (page: number) => jnjDomListUrl(profile, page);
  const ids=Array.from({length:total},(_,i)=>`r-${String(i+1).padStart(6,"0")}`),path=(id:string)=>`/en/jobs/${id}/role-${id}/`, title=(id:string)=>`Role ${id}`;
  const lists=Array.from({length:Math.ceil(total/20)},(_,i)=>{
    const jobs=ids.slice(i*20,(i+1)*20),count=`Displaying ${i*20+1} to ${Math.min((i+1)*20,total)} of ${total} matching jobs`;
    const html=`<ul id="js-job-search-results" data-results="${total}">${jobs.map(id=>`<li class="PageList-items-item card-job" data-id="${id}"><a href="${path(id)}">${title(id)}</a><div class="PagePromo-category">Pharmaceutical Sales</div><address class="PagePromo-location">Guiyang</address></li>`).join("")}</ul>`;
    return JSON.stringify({kind:"BROWSER_UI_DOM_OBSERVATION_NOT_HTTP",url:profile === "native-pagesize20-v2" && i === 0 ? "https://www.careers.jnj.com/en/jobs/?search=&country=China&pagesize=20#results" : url(i+1),observedAt:`2026-10-03T05:01:0${i}.000Z`,heading:count,
      fragment:{html,htmlLength:html.length,items:jobs.map(id=>({text:title(id),links:[{title:title(id),url:"https://www.careers.jnj.com"+path(id)}]}))},
      filters:["team","subteam","country","state","location","type","pattern"].map(name=>({id:`l-${name}`,name,selectedOptions:name==="country"?[{text:"China",value:"China"}]:[]})),
      pagination:[...(i?[{label:"Previous page",url:url(i)}]:[]),{label:`Page ${i+1}`,url:url(i+1)},...(profile === "native-pagesize20-v2" ? [{label:`Last page ${Math.ceil(total/20)}`,url:url(Math.ceil(total/20))}] : []),...(i+1<Math.ceil(total/20)?[{label:"Next page",url:url(i+2)}]:[])],
      dom:`- option "China" [selected]\n${count}\n${jobs.map(path).join("\n")}\n${i+1<Math.ceil(total/20)?'- link "Next page"':""}`});
  });
  const details=ids.map(id=>{
    const html=`<div id="js-job-detail" data-id="${id}" data-jobtitle="${title(id)}"><article class="RichTextBody"><ul class="job-meta"><li>Job title<span>${title(id)}</span></li><li>Function<span>Pharmaceutical Sales</span></li><li>Location<span>Guiyang / China</span></li><li>Requisition number<span>${id.toUpperCase()}</span></li></ul><h2>Description</h2><p>Job Description: ${"Responsibilities include scientific work and collaboration. ".repeat(6)}</p></article></div>`;
    const apply=`https://careers.jnj.com.cn/jnj/apply?exid=${id.toUpperCase()}&m=1`;
    return JSON.stringify({kind:"BROWSER_UI_DOM_OBSERVATION_NOT_HTTP",expectedUrl:"https://www.careers.jnj.com"+path(id),expectedTitle:title(id),url:"https://www.careers.jnj.com"+path(id),observedAt:"2026-10-03T05:00:00.000Z",heading:title(id),body:{html,htmlLength:html.length,text:`${id} Description and responsibilities`},applyLinks:[{text:"Apply now",href:apply}],dom:`${id}\n- link "Apply now":\n- /url: ${apply}`});
  });
  return {lists,details};
}

export const mutateSynthetic = (raw:string, fn:(o:any)=>void) => { const o=JSON.parse(raw);fn(o);return JSON.stringify(o); };
export async function syntheticJnjCommit(profile: JnjDomUrlProfile = "native-pagesize20-v2", total=21) {
  const plan=syntheticJnjPlan, input=syntheticJnjFixture(total,profile);
  const result=await runSourceCrawl(plan,{fetch:createJnjCareersDomSourceFetch(input)});
  if(!result.truth.completenessVerified || !result.fetchEvidence) throw Error("SYNTHETIC_CRAWL_REJECTED");
  const root=await mkdtemp(join(tmpdir(),"jnj-native-synthetic-")),h="a".repeat(64),batchId="jnj-native-test";
  const identity:RuntimeBatchIdentity={releaseCandidateId:"jnj-native-test",commitSha:h,rosterSha256:h,sourcePlanSha256:h,sourceConfigSha256:h,adapterBundleSha256:h,batchKind:"SCHEDULED",ownerId:"test",expectedPlannedSourceIds:[plan.source.id],expectedPlannedSourceSetSha256:sha256Bytes(Buffer.from(JSON.stringify([plan.source.id]))).sha256,expectedPlannedSourceCount:1};
  const pending=buildPendingRuntimeBatch(batchId,[plan],identity,new Date(result.jobs[0]!.evidence.capturedAt)).sources[0]!;
  const tuple={releaseCandidateId:identity.releaseCandidateId,batchId,sourceId:plan.source.id,sourceResultId:pending.id};
  try {
    const archive=await archiveSourceEvidence({workspaceRoot:root,evidenceSubdirectory:"synthetic-evidence",...tuple,captureTool:result.fetchEvidence.captureTool,artifacts:bindRuntimeEvidenceArtifactIds({...tuple,artifacts:result.fetchEvidence.artifacts})});
    const commit=buildAtomicRuntimeCommit({plan,pending,identity,batchId,result,artifacts:archive.artifacts,previousJobs:[],baselineCompletedBeforeCrawl:false,completedAt:new Date(Math.max(...result.fetchEvidence.artifacts.map(a=>Date.parse(a.capturedAt)))+60_000),publicationPolicy:"SOURCE_ATOMIC_LAST_GOOD_V1"});
    return {input,result,commit,plan};
  } finally { await rm(root,{recursive:true,force:true}); }
}
