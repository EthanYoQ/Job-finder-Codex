// @vitest-environment node
import { afterEach,describe,expect,it,vi } from "vitest";
import { mkdtemp,readdir,readFile,rm,writeFile } from "node:fs/promises";
import { setTimeout } from "node:timers/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prepareHansohGraceDomResponse } from "../../scripts/p0-hansoh-grace-dom-response";
import { candidateCompanies } from "../../src/data/companyRegistry";
import { buildStagedSourceCrawlPlans,getPlanBySourceId,sourcePlanConfigSha256 } from "../../src/crawler/sourcePlan";
import { buildJobDedupeKey } from "../../src/crawler/normalizedJob";
import type { JobSnapshot } from "../../src/crawler/lifecycle";
import { runSourceCrawl } from "../../src/crawler/runSourceCrawl";
import { SOURCE_QUALITY_POLICY_ID,createOwnedSourceQualityFetch,issueSourceQualityAdmission } from "../../src/crawler/sourceQualityAdmission";
import { archiveSourceEvidence } from "../../src/crawler/artifactArchive";
import { bindRuntimeEvidenceArtifactIds,buildPendingRuntimeBatch,buildAtomicRuntimeCommit,verifyAtomicRuntimeCommitForPersistence } from "../../src/crawler/runtimeAtomicEvidence";
import { buildSourceQualityJobCommands } from "../../src/crawler/sourceQualityPublication";
import { hansohGraceDigest,hansohDomHash,replayHansohGraceDom,type HansohGraceRequest } from "../../src/crawler/hansohGraceDomEvidence";
import { validateStrictHansohNativeWindowEvidence } from "../../src/crawler/hansohNativeWindowEvidence";
const FIRST="2026-09-30T10:00:00.000Z",NOW="2026-10-02T11:00:00.000Z";
const dirs:string[]=[];
afterEach(async()=>{vi.useRealTimers();vi.unstubAllGlobals();await Promise.all(dirs.splice(0).map(p=>rm(p,{recursive:true,force:true})));});
const plan=getPlanBySourceId(buildStagedSourceCrawlPlans(candidateCompanies),"source-hansoh-social")!;
const raw=(n:number)=>({Id:`00000000-0000-4000-8000-${String(n).padStart(12,"0")}`,JobAdId:n,JobAdName:`测试工程师(J${19000+n})`,LocNames:["上海市"],Category:"社会招聘",CategoryId:"1",Kind:"全职",Status:1,PostDate:"2026-09-20T12:00:00"});
// Synthetic public DOM only. No diagnostic originals or real job IDs are fixtures.
function dom(t:HansohGraceRequest["targets"][number]){return `<html><head><title>豪森</title><script>var BSGlobal = ${JSON.stringify({tenantInfo:{Id:604317,Name:"hspharm",Domain:"hspharm",Abbreviation:"豪森",Alias:"江苏豪森药业集团有限公司"}})};</script></head><body><div class="STJobNameLeft-editor">${t.officialTitle}</div><div class="STJobInfoLeft-editor"><span class="STJobTabInner-editor">社会招聘</span><span class="STJobTabInner-editor">${t.locationRaw}</span></div><div class="STDutyContainer-editor"><div class="STDutyTitle-editor">工作职责</div><div class="STDutyContent-editor">负责开发与验证生产工艺，记录每次实验结果，认真执行生产质量管理规范。配合团队完成技术转移与生产现场问题分析，并按要求提交完整的质量报告。</div></div><div class="STDutyContainer-editor"><div class="STDutyTitle-editor">任职资格</div><div class="STDutyContent-editor">具有化学或药学相关专业本科及以上学历，熟悉实验室操作规范与生产质量要求。具备良好沟通能力，能够独立完成试验记录并与团队协作解决技术问题。</div></div><div class="STDeliverBtn-editor">立即投递</div></body></html>`;}
async function setup(at:string,ids:number[],previousJobs:JobSnapshot[]=[],mutate?:(r:any)=>void){
  vi.useFakeTimers({toFake:["Date"]});vi.setSystemTime(new Date(at));
  vi.stubGlobal("fetch",vi.fn(async(url:string)=>({status:200,url:String(url),headers:new Headers({"content-type":"application/json"}),text:async()=>JSON.stringify({Code:200,Count:ids.length,Data:ids.map(raw)})})));
  const root=await mkdtemp(join(tmpdir(),"hansoh-grace-test-"));dirs.push(root);
  const identity={releaseCandidateId:"hansoh-synthetic",commitSha:"a".repeat(40),rosterSha256:"a".repeat(64),sourcePlanSha256:"a".repeat(64),sourceConfigSha256:"a".repeat(64),adapterBundleSha256:"a".repeat(64),batchKind:"SCHEDULED" as const,ownerId:"hansoh-test",expectedPlannedSourceIds:[plan.source.id],expectedPlannedSourceSetSha256:"a".repeat(64),expectedPlannedSourceCount:1};
  const runtimePending=buildPendingRuntimeBatch(`batch-${Date.parse(at)}`,[plan],identity,new Date(at)).sources[0]!;
  const binding={releaseCandidateId:"hansoh-synthetic",batchId:`batch-${Date.parse(at)}`,sourceResultId:runtimePending.id,sourceId:"source-hansoh-social" as const,sourceConfigSha256:sourcePlanConfigSha256(plan),adapterVersion:runtimePending.adapterVersion};
  const options=previousJobs.length?{hansohGraceDom:{directory:root,binding,previousJobs,visibilityFloor:FIRST}}:{};
  const pending=runSourceCrawl(plan,{fetch:createOwnedSourceQualityFetch(options),isBaseline:false}).then(result=>({result,error:undefined}),error=>({result:undefined,error}));
  if(previousJobs.length){
    let path:string|undefined;
    for(let i=0;i<500;i++){const name=(await readdir(root)).find(n=>n.endsWith(".request.json"));if(name){path=join(root,name);break;}await setTimeout(2);}
    if(!path)throw Error("Synthetic request missing");
    const request:HansohGraceRequest=JSON.parse(await readFile(path,"utf8"));
    const response={schemaVersion:1,kind:"BROWSER_UI_DOM_OBSERVATION_NOT_HTTP",captureTool:{name:"dot-cloud-browser-dom",version:"1"},requestSha256:hansohGraceDigest(request),captures:request.targets.map(t=>{const html=dom(t);return {requestedUrl:t.officialUrl,finalUrl:t.officialUrl,capturedAt:at,documentHtml:html,documentHtmlSha256:hansohDomHash(html)};})};
    if(mutate){mutate(response);await writeFile(path.replace(".request.json",".response.json"),JSON.stringify(response));}
    else{const rawPath=join(root,"browser-observations.json");await writeFile(rawPath,JSON.stringify(response.captures.map(({documentHtmlSha256,...c})=>c)));await prepareHansohGraceDomResponse(path,rawPath);await expect(prepareHansohGraceDomResponse(path,rawPath)).rejects.toThrow();}
  }
  const outcome=await pending;if(outcome.error)throw outcome.error;const result=outcome.result!;
  if(!result.fetchEvidence)return {plan,result,binding,identity,pending:runtimePending,archive:{workspaceRoot:root,evidenceSubdirectory:"quality/evidence",artifacts:[]}};
  const archive=await archiveSourceEvidence({workspaceRoot:root,...binding,evidenceSubdirectory:"quality/evidence",captureTool:result.fetchEvidence.captureTool,artifacts:bindRuntimeEvidenceArtifactIds({...binding,artifacts:result.fetchEvidence.artifacts})});
  return {plan,result,binding,identity,pending:runtimePending,archive:{workspaceRoot:root,evidenceSubdirectory:"quality/evidence",artifacts:archive.artifacts}};
}
async function prior(n=2){const p=await setup(FIRST,[1,n]),admission=await issueSourceQualityAdmission(p);if(admission.status!=="ACCEPTED")throw Error(JSON.stringify(admission));
  const record=p.result.jobs.find(j=>j.officialTitle===raw(n).JobAdName)!;
  const previous:JobSnapshot={record,dedupeKey:buildJobDedupeKey(record),lifecycleStatus:"ACTIVE",missingSuccessfulCrawlCount:1,firstSeenAt:FIRST,lastSeenAt:FIRST};
  return {previous,reference:{receipt:admission.receipt,receiptSha256:admission.receiptSha256,expectedBinding:admission.receipt.binding}};
}
async function positive(n=2){const p=await prior(n),input=await setup(NOW,[1],[p.previous]),admission=await issueSourceQualityAdmission(input);expect(admission.status).toBe("ACCEPTED");
  const publication={...input,admission,previousJobs:[p.previous],firstAcceptedCurrentPolicyReceipt:p.reference,baselineCompletedBeforeCrawl:true};
  const commit=buildAtomicRuntimeCommit({...publication,pending:input.pending,identity:input.identity,batchId:input.binding.batchId,artifacts:input.archive.artifacts,sourceAdmissionPolicy:SOURCE_QUALITY_POLICY_ID,sourceQualityAdmission:admission});
  await verifyAtomicRuntimeCommitForPersistence(commit);
  return {...p,...input,admission,publication,commit};
}
function rebody(evidence:any,change:(e:any)=>void){const a=evidence.artifacts.at(-1),e=JSON.parse(a.body);change(e);a.body=JSON.stringify(e);}

describe("Hansoh same-run full DOM protects only existing grace",()=>{
  it.each([2,47])("preserves prior body/times/missing1 for dynamic absent ID %s, without changing native count or current set",async n=>{
    const f=await positive(n),out=buildSourceQualityJobCommands(f.publication);expect(out.jobCommands).toHaveLength(2);
    expect(out.jobCommands.find(j=>j.dedupeKey===f.previous.dedupeKey)).toEqual({type:"UPSERT_JOB",...f.previous,isNew:false,visibleInFrontend:true});
    expect(f.result.jobs).toHaveLength(1);expect(f.result.fetchEvidence!.fetchCounts.rawCount).toBe(1);
    expect(f.admission.status==="ACCEPTED"&&f.admission.receipt.counts.finalUniqueJobCount).toBe(1);
    expect(f.result.fetchEvidence!.artifacts.at(-1)).not.toHaveProperty("httpStatus");
    expect(f.commit.sourceResult).toMatchObject({completenessState:"VERIFIED",atomicCommitState:"COMMITTED",dedupeOutputCount:1});
    if(n===2&&process.env.HANSOH_GRACE_COMPAT_FIXTURE)await writeFile(process.env.HANSOH_GRACE_COMPAT_FIXTURE,JSON.stringify({plan,commit:f.commit,previous:f.previous,reference:f.reference,commands:out.jobCommands},null,2));
  });
  it("emits no auxiliary request when every previous grace job reappears in the native list",async()=>{
    const p=await prior(),base=await setup(NOW,[1,2]),directory=base.archive.workspaceRoot;
    const result=await runSourceCrawl(plan,{fetch:createOwnedSourceQualityFetch({hansohGraceDom:{directory,binding:base.binding,previousJobs:[p.previous],visibilityFloor:FIRST}}),isBaseline:false});
    expect(result.truth.completenessVerified).toBe(true);expect((await readdir(directory)).some(n=>n.endsWith(".request.json"))).toBe(false);
  });
  it("cancels an unanswered browser stage without registering a successful acquisition",async()=>{
    const p=await prior(),base=await setup(NOW,[1]),controller=new AbortController();controller.abort();
    await expect(runSourceCrawl(plan,{fetch:createOwnedSourceQualityFetch({hansohGraceDom:{directory:base.archive.workspaceRoot,binding:base.binding,previousJobs:[p.previous],visibilityFloor:FIRST,signal:controller.signal}}),isBaseline:false})).rejects.toThrow();
  });
  it("uses normal CURRENT when list reappears, and never protects missing0, offline or legacy rows",async()=>{
    const p=await prior(),input=await setup(NOW,[1,2]),admission=await issueSourceQualityAdmission(input);
    const out=buildSourceQualityJobCommands({...input,admission,previousJobs:[p.previous],firstAcceptedCurrentPolicyReceipt:p.reference,baselineCompletedBeforeCrawl:true});
    expect(out.jobCommands.find(j=>j.dedupeKey===p.previous.dedupeKey)).toMatchObject({missingSuccessfulCrawlCount:0,lastSeenAt:NOW,isNew:false});
    for(const missing of [0,2,3]){const absent=await setup(NOW,[1]),a=await issueSourceQualityAdmission(absent),previous={...p.previous,missingSuccessfulCrawlCount:missing,lifecycleStatus:(missing===0?"ACTIVE":missing===2?"SUSPECTED_OFFLINE":"OFFLINE") as JobSnapshot["lifecycleStatus"]};
      const o=buildSourceQualityJobCommands({...absent,admission:a,previousJobs:[previous],firstAcceptedCurrentPolicyReceipt:p.reference,baselineCompletedBeforeCrawl:true});expect(o.jobCommands.find(j=>j.dedupeKey===previous.dedupeKey)?.missingSuccessfulCrawlCount).toBe(missing+1);}
    const old={...p.previous,firstSeenAt:"2026-09-01T00:00:00.000Z",lastSeenAt:"2026-09-01T00:00:00.000Z"},absent=await setup(NOW,[1]),a=await issueSourceQualityAdmission(absent);
    expect(buildSourceQualityJobCommands({...absent,admission:a,previousJobs:[old],firstAcceptedCurrentPolicyReceipt:p.reference,baselineCompletedBeforeCrawl:true}).jobCommands).toHaveLength(1);
  });
  it("holds missing evidence, preserves rejected-run lifecycle, and rejects publication-time context drift",async()=>{
    const p=await prior(),input=await setup(NOW,[1]),admission=await issueSourceQualityAdmission(input),publication={...input,admission,previousJobs:[p.previous],firstAcceptedCurrentPolicyReceipt:p.reference,baselineCompletedBeforeCrawl:true};
    expect(()=>buildSourceQualityJobCommands(publication)).toThrow("HANSOH_GRACE_FRESH_DOM_REQUIRED");
    expect(buildSourceQualityJobCommands({...publication,admission:{status:"REJECTED",codes:["UNKNOWN"]}}).jobCommands).toEqual([]);
    const f=await positive();f.publication.previousJobs[0]={...f.previous,lastSeenAt:"2026-09-30T11:00:00.000Z"};expect(()=>buildSourceQualityJobCommands(f.publication)).toThrow("HANSOH_GRACE_CONTEXT_DRIFT");
  });
  it.each(["wrong-id","wrong-url","company","shell","login","404","apply-only","closed","expired","disabled","disabled-root","jsonld","hidden","body-hash","old","future","cross-request","empty"])("rejects %s cloud DOM response without publishing",async field=>{
    const p=await prior();await expect(setup(NOW,[1],[p.previous],r=>{
      const c=r.captures[0];
      if(field==="wrong-id")c.documentHtml=c.documentHtml.replace(/J19002/g,"J19099");
      if(field==="wrong-url")c.finalUrl=c.finalUrl.replace(/002$/,"099");
      if(field==="company")c.documentHtml=c.documentHtml.replace(/hspharm/g,"other");
      if(field==="shell")c.documentHtml="<html><title>豪森</title><body><div id='root'></div></body></html>";
      if(field==="login")c.documentHtml="<html><body>请登录后查看职位<input type='password'></body></html>";
      if(field==="404")c.documentHtml=c.documentHtml.replace("</body>","404 Not Found</body>");
      if(field==="apply-only")c.documentHtml="<html><body>立即投递</body></html>";
      if(field==="closed")c.documentHtml=c.documentHtml.replace("</body>","职位已关闭</body>");
      if(field==="expired")c.documentHtml=c.documentHtml.replace("</body>","职位已过期</body>");
      if(field==="disabled")c.documentHtml=c.documentHtml.replace("立即投递","<button disabled>立即投递</button>");
      if(field==="disabled-root")c.documentHtml=c.documentHtml.replace('class="STDeliverBtn-editor"','class="STDeliverBtn-editor" aria-disabled="true"');
      if(field==="jsonld")c.documentHtml=c.documentHtml.replace("</head>",'<script type="application/ld+json">{"@type":"JobPosting","status":"closed"}</script></head>');
      if(field==="hidden")c.documentHtml=c.documentHtml.replace('class="STDutyContainer-editor"','hidden class="STDutyContainer-editor"');
      if(field==="old")c.capturedAt=FIRST;
      if(field==="future")c.capturedAt="2026-10-02T11:00:01.000Z";
      if(field==="cross-request")r.requestSha256="f".repeat(64);
      if(field==="empty")r.captures=[];
      if(field!=="body-hash")c.documentHtmlSha256=hansohDomHash(c.documentHtml);else c.documentHtmlSha256="f".repeat(64);
    })).rejects.toThrow();
  });
  it.each(["unknown-artifact","batch","target","body","count","list-hash"])("rejects coherently rehashed %s at semantic/owned boundary",async field=>{
    const f=await positive(),e=f.result.fetchEvidence!,copy=structuredClone(e);
    if(field==="unknown-artifact")copy.artifacts.push({...copy.artifacts.at(-1)!,id:"unknown",logicalKey:"unknown"});
    else if(field==="count")copy.fetchCounts.rawCount++;
    else rebody(copy,x=>{if(field==="batch")x.request.binding.batchId="another-batch";if(field==="target")x.request.targets[0].sourceJobId="wrong";if(field==="body")x.response.captures[0].documentHtml+="changed";if(field==="list-hash")x.request.listEvidenceSha256="f".repeat(64);x.response.requestSha256=hansohGraceDigest(x.request);});
    if(field==="batch")expect(()=>replayHansohGraceDom(plan,copy,f.result.jobs,f.binding)).toThrow("HANSOH_GRACE_BINDING_MISMATCH");
    else expect(validateStrictHansohNativeWindowEvidence(plan,copy,f.result.jobs)).toBe(false);
    Object.assign(e,copy);expect((await issueSourceQualityAdmission(f)).status).toBe("REJECTED");
  });
  it("refuses stale admission, cross-batch rebinding and archived DOM tampering",async()=>{
    const f=await positive();expect((await issueSourceQualityAdmission({...f,binding:{...f.binding,batchId:"different"}})).status).toBe("REJECTED");
    vi.setSystemTime(new Date(Date.parse(NOW)+30*60_000+1));expect((await issueSourceQualityAdmission(f)).status).toBe("REJECTED");
    vi.setSystemTime(new Date(NOW));await writeFile(join(f.archive.workspaceRoot,f.archive.artifacts.at(-1)!.path),"{}");await expect(verifyAtomicRuntimeCommitForPersistence(f.commit)).rejects.toThrow();expect((await issueSourceQualityAdmission(f)).status).toBe("REJECTED");
  });
});
