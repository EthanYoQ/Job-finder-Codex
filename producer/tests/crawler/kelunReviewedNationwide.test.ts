// @vitest-environment node
/** Synthetic page bodies/transport only. The three public identity triples are
 * the explicitly approved policy inputs; no captured detail HTML is embedded. */
import {afterEach,describe,expect,it} from "vitest";
import {mkdtemp,rm} from "node:fs/promises";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {captureSyntheticKelunQuality,buildSyntheticKelunAtomicFixture,syntheticKelunRow,syntheticKelunPage as page} from "../helpers/kelunQualityFixture";
import {classifyKelunLocation,inspectKelunScopeRows,kelunScopeCounts,KELUN_CONFIG_SHA256} from "../../src/crawler/kelunMainlandScope";
import {sourcePlanConfigSha256} from "../../src/crawler/sourcePlan";
import {issueSourceQualityAdmission,verifySourceQualityAtomicCommit} from "../../src/crawler/sourceQualityAdmission";
import {buildSourceQualityJobCommands} from "../../src/crawler/sourceQualityPublication";
import {buildJobDedupeKey} from "../../src/crawler/normalizedJob";
import {replayStrictSourceQualityEvidence} from "../../src/crawler/runSourceCrawl";
const approved=[
 {id:"230783266",title:"科伦博泰-区域市场经理（北区或南区）(J12400)"},
 {id:"230690782",title:"科伦嘉讯-省区经理(J11794)"},
 {id:"230685318",title:"科伦嘉讯-业务经理(J11762)"}
] as const;
const row=(id:string,title:string,location="全国",visible=location)=>syntheticKelunRow(id,location,visible).replace(`合成职位 ${id}`,title);
const dirs:string[]=[];
afterEach(async()=>{await Promise.all(dirs.splice(0).map(p=>rm(p,{recursive:true,force:true})));});
async function capture(bodies:string[]){const p=await mkdtemp(join(tmpdir(),"kelun-approved-nationwide-synthetic-"));dirs.push(p);return captureSyntheticKelunQuality(p,bodies);}
function replay(input:Awaited<ReturnType<typeof capture>>,evidence=input.result.fetchEvidence!,jobs=input.result.jobs){
 return replayStrictSourceQualityEvidence({plan:input.plan,evidence,jobs,reconciliation:input.result.reconciliation!,paginationEvaluation:input.result.paginationEvaluation!,capturedAt:input.result.observation.crawledAt.toISOString()});
}
describe("Kelun exactly reviewed nationwide identities",()=>{
 it("keeps nationwide location unchanged and admits only the three approved identity/title pairs",async()=>{
  const input=await capture([page(approved.map(v=>row(v.id,v.title)))]);
  expect(input.requests).toHaveLength(1);expect(sourcePlanConfigSha256(input.plan)).toBe(KELUN_CONFIG_SHA256);
  expect(input.result.truth.completenessVerified).toBe(true);
  expect(input.result.jobs.map(j=>({id:j.sourceJobId,title:j.officialTitle,location:j.locationRaw,cities:j.cities}))).toEqual(approved.map(v=>({id:v.id,title:v.title,location:"全国",cities:["全国"]})));
  expect(classifyKelunLocation("全国")).toBe("UNKNOWN");
  expect(kelunScopeCounts(inspectKelunScopeRows(input.plan,input.result.fetchEvidence!))).toEqual({rawCount:3,mainlandCount:3,outsideCount:0,unknownCount:0});
  const {admission,commit}=await buildSyntheticKelunAtomicFixture(input);
  expect(admission.receipt.counts).toMatchObject({rawCount:3,validCount:3,finalUniqueJobCount:3,validationDiscardCount:0});
  expect(() => verifySourceQualityAtomicCommit({plan:input.plan,commit})).not.toThrow();expect(replay(input)).toBe(true);
 });
 it("keeps all original rows and exclusions across pages without an expected target count",async()=>{
  const first=page([row(approved[0].id,approved[0].title),row("990200001","合成内地岗位","上海市")],2);
  const second=page([row(approved[1].id,approved[1].title),row(approved[2].id,approved[2].title),row("990200002","合成域外岗位","香港")],2)
   .replaceAll(/href="\/job_show\/(\d+)"/g,'href="/job_show/$1?r=&p=1%5E2&c=&d=&k=&PageIndex=2"');
  const input=await capture([first,second]);expect(input.result.truth.completenessVerified).toBe(true);expect(input.requests).toHaveLength(2);
  expect(input.result.fetchEvidence!.artifacts.map(a=>a.body)).toEqual([first,second]);
  expect(input.result.fetchEvidence!.fetchCounts).toMatchObject({rawCount:5,validCount:4,validationDiscardCount:1});
  expect(input.result.fetchEvidence!.fetchLosses[0]!.rawLocator).toContain('row:2;id:990200002;');
  expect(input.result.jobs).toHaveLength(4);expect(replay(input)).toBe(true);
  const missing=structuredClone(input.result.fetchEvidence!);missing.artifacts.pop();missing.pages.pop();expect(replay(input,missing)).toBe(false);
 });
 it.each(["idMismatch","titleSubjectChanged","requisitionChanged","roleChanged","unknownLocation","mixedOutside","visibleConflict","nationwideOutsideThree","trailingTitleClaim"])("returns to explicit rules or UNKNOWN for %s",async mutation=>{
  let id:string=approved[0].id,title:string=approved[0].title,location="全国",visible=location;
  if(mutation==="idMismatch"||mutation==="nationwideOutsideThree")id="990201001";
  if(mutation==="titleSubjectChanged")title=title.replace("科伦博泰","其他公司");
  if(mutation==="requisitionChanged")title=title.replace("J12400","J99999");
  if(mutation==="roleChanged")title=title.replace("区域市场经理","国际业务经理");
  if(mutation==="unknownLocation")location="待定";
  if(mutation==="mixedOutside")location="全国,香港";
  if(mutation==="visibleConflict")visible="香港";
  if(mutation==="trailingTitleClaim")title+="（香港办公）";
  if(mutation!=="visibleConflict")visible=location;
  const input=await capture([page([row(id,title,location,visible)])]);
  expect(input.result.truth.completenessVerified).toBe(false);expect((await issueSourceQualityAdmission(input)).status).toBe("REJECTED");
  expect(input.result.fetchEvidence!.fetchLosses[0]!.details.code).toBe("KELUN_GEOGRAPHY_UNKNOWN");
 });
 it.each(["香港","澳门","台湾","美国"])("never overrides explicit outside geography %s for an approved ID",async location=>{
  const v=approved[1],input=await capture([page([row(v.id,v.title,location)])]);
  expect(input.result.truth.completenessVerified).toBe(true);expect(input.result.jobs).toEqual([]);
  expect(input.result.fetchEvidence!.fetchCounts).toMatchObject({rawCount:1,validCount:0,validationDiscardCount:1});
  expect(input.result.fetchEvidence!.fetchLosses[0]!.details.code).toBe("KELUN_EXPLICIT_OUTSIDE_MAINLAND");
 });
 it("accepts typography normalization only, with original title and location retained",async()=>{
  const v=approved[0],title=v.title.normalize("NFKC"),input=await capture([page([row(v.id,title,"全国")])]);
  expect(input.result.truth.completenessVerified).toBe(true);expect(input.result.jobs[0]!.officialTitle).toBe(title);
 });
 it("rejects duplicate approved identities even with different titles or locations",async()=>{
  const v=approved[0],input=await capture([page([row(v.id,v.title),row(v.id,v.title,"上海市")])]);
  expect(input.result.truth.completenessVerified).toBe(false);expect((await issueSourceQualityAdmission(input)).status).toBe("REJECTED");
 });
 it("does not mutate prior ACTIVE/GRACE rows when one reviewed identity has a new unknown claim",async()=>{
  const v=approved[0],good=await capture([page([row(v.id,v.title),row("990202001","合成内地岗位","上海市")])]);
  const previousJobs=good.result.jobs.map((record,i)=>({dedupeKey:buildJobDedupeKey(record),record,lifecycleStatus:"ACTIVE" as const,missingSuccessfulCrawlCount:i?1:0,firstSeenAt:"2026-01-01T00:00:00.000Z",lastSeenAt:"2026-01-02T00:00:00.000Z"}));
  const input=await capture([page([row(v.id,v.title,"全国,香港")])]),before=structuredClone(previousJobs),admission=await issueSourceQualityAdmission(input);
  expect(admission.status).toBe("REJECTED");expect(buildSourceQualityJobCommands({...input,admission,previousJobs,firstAcceptedCurrentPolicyReceipt:null,baselineCompletedBeforeCrawl:true}).jobCommands).toEqual([]);expect(previousJobs).toEqual(before);
 });
 it("rejects post-capture raw identity changes and post-admission normalized location changes",async()=>{
  const v=approved[0],input=await capture([page([row(v.id,v.title)])]);
  const mutated=structuredClone(input.result.fetchEvidence!);mutated.artifacts[0]!.body=String(mutated.artifacts[0]!.body).replace(v.title,"其他主体全国岗位(J12400)");
  expect(replay(input,mutated)).toBe(false);
  const {admission}=await buildSyntheticKelunAtomicFixture(input);input.result.jobs[0]!.locationRaw="香港";
  expect(()=>buildSourceQualityJobCommands({...input,admission,previousJobs:[],firstAcceptedCurrentPolicyReceipt:null,baselineCompletedBeforeCrawl:true})).toThrow();
 });
});
