import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { finalizeOfficialJsonEvidenceBundle } from "../../src/crawler/officialJsonEvidence";
import type { NormalizedJobRecord } from "../../src/crawler/normalizedJob";
import { candidateCompanies } from "../../src/data/companyRegistry";
import { buildStagedSourceCrawlPlans, type SourceCrawlPlan } from "../../src/crawler/sourcePlan";
import { createOfficialJsonSourceFetch } from "../../src/crawler/officialJsonSourceFetch";
import { runSourceCrawl } from "../../src/crawler/runSourceCrawl";
import { validateStrictSourceScopeExclusionProof } from "../../src/crawler/strictSourceScopeExclusionProof";

// Synthetic business rows; no retained live responses or credentials in this suite.
const NOW = "2026-10-01T10:00:00.000Z";
function plan() {
  return buildStagedSourceCrawlPlans(candidateCompanies).find(p=>p.source.id === "source-fosun-pharma-social") as Extract<SourceCrawlPlan,{adapterId:"official-json"}>;
}
function row(n:number, locations:unknown = ["上海市"]) {
  return { Id:`00000000-0000-4000-8000-${String(n).padStart(12,"0")}`, JobAdId:n,
    JobAdName:`职位 ${n}`, LocNames:locations, CategoryId:"1", Category:"社会招聘", Kind:"全职" };
}
async function collect(rows:unknown[] = [row(1),row(2,["香港特别行政区"])]) {
  const p=plan(); const fetched=await createOfficialJsonSourceFetch({now:()=>new Date(NOW),http:async request=>({
    status:200,body:JSON.stringify({Code:200,Count:rows.length,PageIndex:0,Data:rows}),
    finalUrl:request.url,contentType:"application/json",capturedAt:NOW
  })})(p);
  const result=await runSourceCrawl(p,{fetch:async()=>fetched});
  return {plan:p,result,fetched};
}

describe("Fosun independently replayed Hong Kong exclusions",()=>{
  it("qualifies mainland output with exact Hong Kong losses without changing raw totals",async()=>{
    const {plan:p,result}=await collect();
    expect(result.truth.completenessVerified).toBe(true);
    expect(result.fetchEvidence?.fetchCounts).toEqual({rawCount:2,parsedCount:2,validCount:1,parseDiscardCount:0,validationDiscardCount:1});
    expect(result.fetchEvidence?.pages[0]?.declaredTotal).toBe(2);
    expect(result.fetchEvidence?.declaredCompleteness?.kind).toBe("COMPLETE_PAGE_TRAVERSAL");
    expect(result.jobs).toHaveLength(1);
    expect(result.observation.expectedJobCount).toBeUndefined();
    expect(validateStrictSourceScopeExclusionProof(p,result.fetchEvidence!,result.jobs)).toBe(true);
  });
  it("does not pin observed job IDs or counts",async()=>{
    const {result}=await collect([row(13),row(42),row(71,["香港"]),row(99,["Hong Kong"])]);
    expect(result.truth.completenessVerified).toBe(true);expect(result.jobs).toHaveLength(2);
  });
  it.each(["美国","澳门","台湾","火星","上海 / 香港","香港 / 美国"])("does not certify an exclusion for %s",async location=>{
    const {plan:p,result}=await collect([row(1),row(2,[location])]);
    expect(result.truth.completenessVerified).toBe(false);
    expect(validateStrictSourceScopeExclusionProof(p,result.fetchEvidence!,result.jobs)).toBe(false);
  });
  it("rejects conflicting country and alternate location fields",async()=>{
    for(const extra of [{Country:"美国"},{CountryName:"中国"},{City:"上海"},{LocationName:"美国"},{LocName:"未知城市"}]){
      const {plan:p,result}=await collect([row(1),{...row(2,["香港特别行政区"]),...extra}]);
      expect(validateStrictSourceScopeExclusionProof(p,result.fetchEvidence!,result.jobs)).toBe(false);
    }
  });
  it("rejects malformed job losses even when Hong Kong is mentioned",async()=>{
    const bad={...row(2,["香港"]),JobAdName:""};const {plan:p,result}=await collect([row(1),bad]);
    expect(result.truth.completenessVerified).toBe(false);
    expect(validateStrictSourceScopeExclusionProof(p,result.fetchEvidence!,result.jobs)).toBe(false);
  });
  it.each([
    {City:"香港"},{LocationName:"美国"},{LocName:{evil:true}},
    {Country:"中国",CountryName:"火星"},{Country:"中国",CountryName:42}
  ])("rejects conflicting or malformed accepted-row shadow geography %j",async extra=>{
    const {plan:p,result}=await collect([{...row(1),...extra},row(2,["香港"])]);
    expect(result.truth.completenessVerified).toBe(false);
    expect(validateStrictSourceScopeExclusionProof(p,result.fetchEvidence!,result.jobs)).toBe(false);
  });
  it.each([{JobAdName:undefined},{JobAdName:""},{Category:"校园招聘"},{CategoryId:"2"},{Kind:"校园"}])
    ("rejects coherently relabelled invalid HK row %j",async extra=>{
      const {plan:p,fetched}=await collect();const forged=structuredClone(fetched) as any;const e=forged.fetchEvidence;
      const body=JSON.parse(e.artifacts[0].body);Object.assign(body.Data[1],extra);e.artifacts[0].body=JSON.stringify(body);
      e.fetchLosses[0].rawLocator=`${e.artifacts[0].logicalKey}#record:1#sha256:${createHash("sha256").update(JSON.stringify([1,body.Data[1]])).digest("hex")}`;
      e.pages[0].responseFingerprintSha256=createHash("sha256").update(e.artifacts[0].body).digest("hex");
      const finalized=finalizeOfficialJsonEvidenceBundle({...e,allowMissingReturnedPage:true});
      forged.fetchEvidence=finalized.evidence;forged.paginationEvaluation=finalized.evaluation;
      expect((await runSourceCrawl(p,{fetch:async()=>forged})).truth.completenessVerified).toBe(false);
    });
  it.each(["火星","APAC","上海·香港","上海 / 火星"])("rejects coherently forged accepted geography %s",async location=>{
    const {plan:p,fetched}=await collect();const forged=structuredClone(fetched) as any;const e=forged.fetchEvidence;
    const body=JSON.parse(e.artifacts[0].body);body.Data[0].LocNames=[location];e.artifacts[0].body=JSON.stringify(body);
    Object.assign(forged.payload.jobs[0],{locationRaw:location,cities:[...new Set(location.split(/[/,，;；、]/u).map(segment=>segment.trim()).filter(Boolean).map(segment=>segment.split("·").map(part=>part.trim()).filter(Boolean).at(-1)!))]});
    e.pages[0].responseFingerprintSha256=createHash("sha256").update(e.artifacts[0].body).digest("hex");
    const finalized=finalizeOfficialJsonEvidenceBundle({...e,allowMissingReturnedPage:true});
    forged.fetchEvidence=finalized.evidence;forged.paginationEvaluation=finalized.evaluation;
    expect((await runSourceCrawl(p,{fetch:async()=>forged})).truth.completenessVerified).toBe(false);
  });
  it("supports reviewed mainland locations beyond the captured sample",async()=>{
    const {result}=await collect([{...row(1,["湖北省·武汉市"]),City:"武汉",Country:"中国"},row(2,["重庆市"]),row(3,["香港"])]);
    expect(result.truth.completenessVerified).toBe(true);expect(result.jobs).toHaveLength(2);
  });
  it.each(["source","company","entry","chain","pageSize","maxPages","date","display","json"])("rejects changed %s binding",async field=>{
    const {plan:p,result}=await collect();const changed=structuredClone(p) as any;
    if(field==="source")changed.source.id="source-other-social";
    if(field==="company")changed.company.id="company-other";
    if(field==="entry")changed.source.officialEntryUrl+="/jobs";
    if(field==="chain")changed.source.officialChainEvidenceUrl="https://example.com/";
    if(field==="pageSize")changed.officialJsonFetch.pageSize=15;
    if(field==="maxPages")changed.officialJsonFetch.maxPages=100;
    if(field==="date")changed.officialJsonFetch.changedWithinDays=183;
    if(field==="display")changed.officialJsonFetch.displayFields=[];
    if(field==="json")changed.json.fields.officialTitle="other";
    expect(validateStrictSourceScopeExclusionProof(changed,result.fetchEvidence!,result.jobs)).toBe(false);
  });
  it.each(["missing","duplicate","locator","index","reason","body","request"])("rejects %s loss/evidence forgery",async field=>{
    const {plan:p,result}=await collect();const e=structuredClone(result.fetchEvidence!);
    if(field==="missing")e.fetchLosses=[];
    if(field==="duplicate")e.fetchLosses.push({...e.fetchLosses[0]!});
    if(field==="locator")e.fetchLosses[0]!.rawLocator+="tamper";
    if(field==="index")e.fetchLosses[0]!.details.recordIndex=0;
    if(field==="reason")e.fetchLosses[0]!.reason="Other exclusion";
    if(field==="body")e.artifacts[0]!.body=String(e.artifacts[0]!.body).replace("香港特别行政区","上海市");
    if(field==="request")e.artifacts[0]!.extractorLocator+="tamper";
    expect(validateStrictSourceScopeExclusionProof(p,e,result.jobs)).toBe(false);
  });
  it.each([undefined,"中国"])("rejects a coherently relabelled Hong Kong row with country %s as mainland output",async country=>{
    const {plan:p,result}=await collect();const e=structuredClone(result.fetchEvidence!);
    const jobs=structuredClone(result.jobs) as NormalizedJobRecord[];
    const id=row(2).Id;const hash=(value:unknown)=>createHash("sha256").update(JSON.stringify(value)).digest("hex");
    const sourceJobId=`official-json:sha256:${hash(id)}`;
    const url=new URL(jobs[0]!.officialUrl);url.searchParams.set("jobAdId",id);
    jobs.push({...jobs[0]!,sourceJobId,officialUrl:url.toString(),officialTitle:"职位 2",locationRaw:"香港特别行政区",cities:["香港特别行政区"]});
    if(country){const body=JSON.parse(String(e.artifacts[0]!.body));body.Data[1].Country=country;e.artifacts[0]!.body=JSON.stringify(body);}
    e.fetchLosses=[];e.fetchCounts.validCount=2;e.fetchCounts.validationDiscardCount=0;
    e.pages[0]!.validJobIds.push(`sha256:${hash(sourceJobId)}`);
    expect(validateStrictSourceScopeExclusionProof(p,e,jobs)).toBe(false);
  });
  it.each(["missing","duplicate","id","title","url","location","cities"])("rejects %s output tampering",async field=>{
    const {plan:p,result}=await collect();const jobs=structuredClone(result.jobs) as NormalizedJobRecord[];
    if(field==="missing")jobs.pop();
    if(field==="duplicate")jobs.push({...jobs[0]!});
    if(field==="id")jobs[0]!.sourceJobId="forged";
    if(field==="title")jobs[0]!.officialTitle="forged";
    if(field==="url")jobs[0]!.officialUrl="https://fosunpharma.zhiye.com/social/detail?jobAdId=forged";
    if(field==="location")jobs[0]!.locationRaw="北京";
    if(field==="cities")jobs[0]!.cities=["北京"];
    expect(validateStrictSourceScopeExclusionProof(p,result.fetchEvidence!,jobs)).toBe(false);
  });
});
