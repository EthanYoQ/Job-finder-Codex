import { organonNativeDetail } from "../../src/crawler/organonChinaQuality";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { candidateCompanies } from "../../src/data/companyRegistry";
import { buildStagedSourceCrawlPlans, getPlanBySourceId, sourcePlanConfigSha256, type SourceCrawlPlan } from "../../src/crawler/sourcePlan";
import { createOfficialJsonSourceFetch } from "../../src/crawler/officialJsonSourceFetch";
import { runSourceCrawl, replayStrictSourceQualityEvidence } from "../../src/crawler/runSourceCrawl";
import { deriveCanonicalPaginationEvidence, evaluatePaginationEvidence } from "../../src/crawler/paginationEvidence";
import { createOwnedSourceQualityFetch, getSourceQualityPolicy, issueSourceQualityAdmission } from "../../src/crawler/sourceQualityAdmission";
import { archiveSourceEvidence } from "../../src/crawler/artifactArchive";
import { bindRuntimeEvidenceArtifactIds } from "../../src/crawler/runtimeAtomicEvidence";
import { buildSourceQualityJobCommands } from "../../src/crawler/sourceQualityPublication";
import { buildJobDedupeKey } from "../../src/crawler/normalizedJob";

const capturedAt = "2026-10-02T00:00:00.000Z";
import { organonBootstrap as bootstrap, organonRow as row, organonKeywordEntry, organonNativeHtml } from "../fixtures/organonChinaQuality";
const closedBody = (raw:Record<string,unknown>) => `<meta property="og:url" content="${raw.applyUrl}"><script>window.workday = window.workday || {tenant:"organon",siteId:"SearchJobs",postingAvailable:false};</script>`;
function plan() { return getPlanBySourceId(buildStagedSourceCrawlPlans(candidateCompanies),"source-organon-china-social")!; }
afterEach(()=>{vi.unstubAllGlobals();vi.useRealTimers();});
async function capture(rows: Record<string,unknown>[] = [row()], options: {plan?:SourceCrawlPlan;owned?:boolean;pages?:Record<string,unknown>[][];totals?:number[];offsets?:unknown[];bootstrap?:Record<string,unknown>;keywordRows?:Record<string,unknown>[];keywordTotal?:number;keywords?:string;nativeChanges?:Record<string,unknown>;nativeAvailable?:boolean;closedIds?:string[]} = {}) {
  vi.useFakeTimers({toFake:["Date"]});vi.setSystemTime(new Date(capturedAt));
  const p=options.plan??plan(),pages=options.pages??[rows];let requests=0;
  vi.stubGlobal("fetch",async(url:string,init:RequestInit)=>{
    const index=requests++-1;
    if (String(url).startsWith("https://organon.wd5.myworkdayjobs.com/SearchJobs/job/")) {
      const raw=pages.flat().find(row=>row.applyUrl===String(url));
      if(!raw || init.method!=="GET")throw Error("Unexpected native fixture request; no network fallback");
      return {status:200,url:String(url),headers:new Headers({"content-type":"text/html"}),
        text:async()=>options.closedIds?.includes(raw.reqId as string) ? closedBody(raw) : organonNativeHtml(raw,options.nativeChanges,options.nativeAvailable)};
    }
    if(index>=pages.length)throw Error("Unexpected fixture request; no network fallback");
    if(init.method==="POST"){
      expect(String(url)).toBe("https://jobs.organon.com/widgets");
      const body=JSON.parse(String(init.body));
      expect(body.from).toBe(index*50);expect(body.size).toBe(50);expect(body.selected_fields).toEqual({country:["China"]});
    }
    const body=init.method==="POST"?JSON.stringify({refineSearch:{status:200,hits:pages[index]!.length,totalHits:options.totals?.[index]??pages.flat().length,
      ...(options.offsets?.[index]===undefined?{}:{from:options.offsets[index]}),data:{jobs:pages[index],aggregations:[]}}}):organonKeywordEntry(options.keywordRows??pages.flat(),{bootstrap:options.bootstrap,total:options.keywordTotal,keywords:options.keywords});
    return {status:200,url:String(url),headers:new Headers({"content-type":init.method==="POST"?"application/json":"text/html"}),text:async()=>body};
  });
  const result=await runSourceCrawl(p,{fetch:options.owned?createOwnedSourceQualityFetch():createOfficialJsonSourceFetch({allowBrowserFallback:false}),isBaseline:true});
  return {plan:p,result,requests};
}
function replay(input:Awaited<ReturnType<typeof capture>>,jobs=input.result.jobs,evidence=input.result.fetchEvidence!){return replayStrictSourceQualityEvidence({plan:input.plan,evidence,jobs,paginationEvaluation:input.result.paginationEvaluation!,reconciliation:input.result.reconciliation!,capturedAt});}
async function archived(input:Awaited<ReturnType<typeof capture>>){
  const workspaceRoot=await mkdtemp(join(tmpdir(),"organon-quality-")),evidenceSubdirectory="evidence";
  const binding={releaseCandidateId:"organon-test",batchId:"organon-batch",sourceResultId:"organon-source",sourceConfigSha256:sourcePlanConfigSha256(input.plan),adapterVersion:"a".repeat(64)};
  const evidence=input.result.fetchEvidence!;
  const archive=await archiveSourceEvidence({workspaceRoot,...binding,sourceId:input.plan.source.id,evidenceSubdirectory,captureTool:evidence.captureTool,
    artifacts:bindRuntimeEvidenceArtifactIds({...binding,sourceId:input.plan.source.id,artifacts:evidence.artifacts})});
  return {...input,binding,archive:{workspaceRoot,evidenceSubdirectory,artifacts:archive.artifacts}};
}

describe("Organon China exact raw source quality",()=>{
  it("requires a complete equal original keyword set before native requests",async()=>{
    for(const options of [{keywordRows:[]},{keywordRows:[row(2)]},{keywordTotal:2},{keywords:"Shanghai"}]) {
      const input=await capture([row()],options);
      expect(input.result.truth.completenessVerified).toBe(false);expect(input.result.jobs).toEqual([]);expect(input.requests).toBe(2);
    }
  });
  it.each([{identifier:{value:"R999999"}},{title:"Another job"},{datePosted:"2026-01-01"},{description:"<p> </p>"},
    {jobLocation:{address:{addressCountry:"Singapore",addressLocality:"CHN - Shanghai - Shanghai"}}}])("rejects native proof detached from the listed job %j",async nativeChanges=>{
    const input=await capture([row()],{nativeChanges});expect(input.result.truth.completenessVerified).toBe(false);expect(input.result.jobs).toEqual([]);
  });
  it("rejects duplicate or overwritten native availability",()=>{
    const raw=row(),body=organonNativeHtml(raw);
    for(const html of [body.replace("postingAvailable:true",'postingAvailable:true,"postingAvailable":false'),
      body.replace(";</script>",';window.workday.postingAvailable=false;</script>')]){
      expect(organonNativeDetail(raw,{id:`organon-detail-${raw.reqId}`,logicalKey:`organon-detail-${raw.reqId}`,kind:"OFFICIAL_COMPANY_PAGE",requestedUrl:raw.applyUrl as string,
        finalUrl:raw.applyUrl as string,httpStatus:200,contentType:"text/html",capturedAt,body:html,extractorLocator:"organon-workday-jobposting-v1"},capturedAt)).toBeUndefined();
    }
  });
  it("keeps contradictory unavailable status plus JobPosting on HOLD",async()=>{
    const input=await capture([row()],{nativeAvailable:false});expect(input.result.truth.completenessVerified).toBe(false);expect(input.result.jobs).toEqual([]);
  });
  it("requires a same-URL closed shell and keeps unbound or contradictory status UNKNOWN",()=>{
    const raw=row(),body=closedBody(raw),artifact={id:`organon-detail-${raw.reqId}`,logicalKey:`organon-detail-${raw.reqId}`,kind:"OFFICIAL_COMPANY_PAGE" as const,
      requestedUrl:raw.applyUrl as string,finalUrl:raw.applyUrl as string,httpStatus:200,contentType:"text/html",capturedAt,
      body,extractorLocator:"organon-workday-jobposting-v1"};
    expect(organonNativeDetail(raw,artifact,capturedAt)).toBe("CLOSED");
    for(const changed of [body.replace("og:url","og:unbound"),body.replace(String(raw.applyUrl),String(raw.applyUrl).replace("R700001","R999999")),
      body.replace('tenant:"organon"','tenant:"other"'),body.replace("postingAvailable:false",'postingAvailable:"false"'),
      body+`<meta property="og:url" content="${raw.applyUrl}">`,body+'<script type="application/ld+json">{}</script>',
      body.replace(";</script>",';window.workday.postingAvailable=true;</script>')])
      expect(organonNativeDetail(raw,{...artifact,body:changed},capturedAt)).toBeUndefined();
  });
  it("replays exact CLOSED losses and removes a previously visible closed ID without grace",async()=>{
    const rows=[row(),row(2)],prior=await archived(await capture(rows,{owned:true}));
    const current=await archived(await capture(rows,{owned:true,closedIds:[rows[1]!.reqId as string]}));
    try{
      const priorAdmission=await issueSourceQualityAdmission(prior),admission=await issueSourceQualityAdmission(current);
      expect(priorAdmission.status).toBe("ACCEPTED");expect(admission.status).toBe("ACCEPTED");
      if(priorAdmission.status!=="ACCEPTED"||admission.status!=="ACCEPTED")throw Error("admission");
      expect(current.result.observation.expectedJobCount).toBe(2);expect(current.result.jobs).toHaveLength(1);
      expect(current.result.fetchEvidence!.fetchCounts).toEqual({rawCount:2,parsedCount:2,validCount:1,parseDiscardCount:0,validationDiscardCount:1});
      expect(current.result.fetchEvidence!.fetchLosses).toMatchObject([{details:{code:"ORGANON_OFFICIAL_APPLICATION_CLOSED",pageSequence:0,recordIndex:1}}]);
      expect(replay(current)).toBe(true);
      const altered=structuredClone(current.result.fetchEvidence!);altered.fetchLosses[0]!.details!.recordIndex=0;
      expect(replay(current,current.result.jobs,altered)).toBe(false);
      const revived=structuredClone(current.result.fetchEvidence!);revived.artifacts.find(a=>a.logicalKey===`organon-detail-${rows[1]!.reqId}`)!.body=organonNativeHtml(rows[1]!);
      expect(replay(current,current.result.jobs,revived)).toBe(false);
      const previousJobs=prior.result.jobs.map(record=>({dedupeKey:buildJobDedupeKey(record),record,lifecycleStatus:"ACTIVE" as const,
        missingSuccessfulCrawlCount:0,firstSeenAt:priorAdmission.receipt.issuedAt,lastSeenAt:priorAdmission.receipt.issuedAt}));
      const firstAcceptedCurrentPolicyReceipt={receipt:priorAdmission.receipt,receiptSha256:priorAdmission.receiptSha256,expectedBinding:priorAdmission.receipt.binding};
      const commands=buildSourceQualityJobCommands({...current,admission,previousJobs,firstAcceptedCurrentPolicyReceipt,baselineCompletedBeforeCrawl:true}).jobCommands;
      expect(commands).toHaveLength(1);expect(commands[0]!.record.sourceJobId).toBe(prior.result.jobs[0]!.sourceJobId);
      expect(commands[0]!.missingSuccessfulCrawlCount).toBe(0);
    }finally{await rm(prior.archive.workspaceRoot,{recursive:true,force:true});await rm(current.archive.workspaceRoot,{recursive:true,force:true});}
  });
  it("preserves a shared-reviewed additional mainland city as city pending",async()=>{
    const r=row(),nested={country:"China",city:"Tianjin",state:"Tianjin",cityState:"Tianjin, Tianjin",location:"Tianjin, Tianjin, China",
      cityCountry:"Tianjin, China",cityStateCountry:"Tianjin, Tianjin, China",mapQueryLocation:"Tianjin, Tianjin, China",stateCountry:"Tianjin, China",
      latitude:"39.142222",longitude:"117.176667",latlong:{lat:39.142222,lon:117.176667}};
    (r.multi_location as string[]).push(nested.location);(r.multi_location_array as unknown[]).push(nested);
    const input=await capture([r]);expect(input.result.truth.completenessVerified).toBe(true);expect(input.result.jobs[0]!.cities).toEqual(["城市待核"]);expect(replay(input)).toBe(true);
    for(const mutation of [{state:"Guangdong"},{country:"Taiwan"},{latitude:"91"},{latlong:{lat:0,lon:117.176667}}]){
      const bad=structuredClone(r);Object.assign((bad.multi_location_array as Record<string,unknown>[])[1]!,mutation);
      expect((await capture([bad])).result.truth.completenessVerified).toBe(false);
    }
  });
  it("independently rejects missing native evidence and keyword/native rewrites",async()=>{
    const input=await capture();
    for(const field of ["missing","keyword","native"]){
      const evidence=structuredClone(input.result.fetchEvidence!);
      if(field==="missing")evidence.artifacts.pop();
      if(field==="keyword")evidence.artifacts[0]!.body=String(evidence.artifacts[0]!.body).replace('"keywords":"China"','"keywords":"Shanghai"');
      if(field==="native")evidence.artifacts[2]!.body=String(evidence.artifacts[2]!.body).replace('postingAvailable:true','postingAvailable:false');
      expect(replay(input,input.result.jobs,evidence)).toBe(false);
    }
  });
  it("preserves official dates and keeps a positively mainland city conflict pending",async()=>{
    const input=await capture([row(),row(2,"Wenzhou")]);
    expect(input.result.truth.completenessVerified).toBe(true);
    expect(input.result.jobs).toMatchObject([{cities:["上海"],officialPublishedAt:"2026-09-24T00:00:00.000Z"},{cities:["城市待核"],locationRaw:"Wenzhou, Zhejiang, China",officialPublishedAt:"2026-09-24T00:00:00.000Z"}]);
    expect(input.result.fetchEvidence?.fetchLosses).toEqual([]);expect(replay(input)).toBe(true);
    expect(input.result.fetchEvidence?.pages[0]).toMatchObject({requestedOffset:0,returnedOffset:null});
  });
  it.each([
    {country:"Singapore"},{country:"Unknown"},{country:"China / Singapore"},{city:"Boston"},{state:"Unknown"},{countryCode:"US"},
    {workLocation:"USA - Boston"},{workLocation:"CHN - Unknown"},{address:"3 Xi Yu Jie, Chengdu, 610041 Sichuan, Singapore"},
    {cityState:"Shanghai, Boston"},{cityStateCountry:"Shanghai, Shanghai, China / Singapore"},{location:"Hong Kong, China"},
    {multi_location:["Shanghai, Shanghai, China","Boston, Massachusetts, United States"]},{workLocations:[{country:"US"}]},
    {locations:[]},{futureUnknownField:{country:"US"}},{latitude:"42.3601"},{longitude:"-71.0589"},
    {ml_job_parser:{descriptionTeaser:"Manager",workLocation:"Singapore"}},
    {title:"Manager based in Singapore"},{title:"工作地点：新加坡"},
    {descriptionTeaser:"Amsterdam-based role."},{descriptionTeaser:"Boston-based position."},{descriptionTeaser:"办公室：巴西圣保罗"},
    {descriptionTeaser:"Job base: Amsterdam, Netherlands."},{descriptionTeaser:"Workplace: Amsterdam, Netherlands."},
    {descriptionTeaser:"办公地：巴西"},
    {descriptionTeaser:"The role is in Boston, Massachusetts."},{descriptionTeaser:"This position will work in Brazil."},
    {descriptionTeaser:"Office: Amsterdam, Netherlands."},{descriptionTeaser:"工作地址：波士顿"},
    {badge:"Work location: Singapore."},{ml_skills:["Work location: Singapore."]},
    {multi_category_array:[{category:"Office: Amsterdam, Netherlands."}]},
    {descriptionTeaser:"This role is based in Singapore."},{descriptionTeaser:"Work location: Boston, USA."},
    {ml_job_parser:{descriptionTeaser_ats:"办公地点：香港"}},
    {reqId:"R999999"},{jobSeqNo:"OTHER700001"},{jobId:"R999999"},{locale:"en_US"},{externalApply:false},
    {siteType:"internal"},{visibilityType:"Internal"},{jobVisibility:["internal"]},{jobVisibility:["external","unknown"]},
    {applyUrl:"https://organon.wd5.myworkdayjobs.com/SearchJobs/job/USA---Boston/Manager_R700001-2/apply"},
    {applyUrl:"https://organon.wd5.myworkdayjobs.com/SearchJobs/job/CHN---Shanghai---Shanghai/Manager_R999999-2/apply"},
    {applyUrl:"https://jobs.organon.com/cn/zh/job/R700001"},{applyUrl:"https://organon.wd5.myworkdayjobs.com/SearchJobs/job/CHN---Shanghai---Shanghai/Manager_R700001-2/apply?country=US"}
  ])("rejects foreign, unknown, shadow, identity and visibility mutation %j",async mutation=>{
    const input=await capture([row(1,"Shanghai",mutation)]);expect(input.result.truth.completenessVerified).toBe(false);expect(input.result.jobs).toEqual([]);expect(input.result.fetchEvidence?.artifacts).toHaveLength(2);
  });
  it.each(["country","city","state","cityState","cityStateCountry","mapQueryLocation","stateCountry","cityCountry","latitude","longitude"])("rejects nested geography mutation %s",async key=>{
    const r=row();(r.multi_location_array as Record<string,unknown>[])[0]![key]="Singapore";
    const input=await capture([r]);expect(input.result.truth.completenessVerified).toBe(false);expect(input.result.jobs).toEqual([]);
  });
  it("rejects added nested coordinates or category/skill object shadows",async()=>{
    for(const mutation of [{multi_category_array:[{category:"Sales",country:"Singapore"}]},{ml_skills:[{country:"Singapore"}]}])expect((await capture([row(1,"Shanghai",mutation)])).result.truth.completenessVerified).toBe(false);
    const r=row();((r.multi_location_array as Record<string,unknown>[])[0]!.latlong as Record<string,unknown>).country="US";expect((await capture([r])).result.truth.completenessVerified).toBe(false);
  });
  it.each([undefined,null,"",0,"2026-09-24","2026-09-24T00:00:00.000","2026-02-29T00:00:00.000+0000","2026-09-24T00:00:00.000+2400"])("rejects malformed or missing postedDate %j",async postedDate=>{
    const input=await capture([row(1,"Shanghai",{postedDate})]);expect(input.result.truth.completenessVerified).toBe(false);expect(input.result.fetchEvidence?.fetchLosses).toMatchObject([{details:{code:"ORGANON_POSTED_DATE_INVALID"}}]);
  });
  it("keeps old and future official instants without substituting recent dateCreated",async()=>{
    const input=await capture([row(1,"Shanghai",{postedDate:"2001-01-01T05:54:14.123+0800"}),row(2,"Shanghai",{postedDate:"2030-01-01T05:54:14.123-0130"})]);
    expect(input.result.truth.completenessVerified).toBe(true);expect(input.result.jobs.map(j=>j.officialPublishedAt)).toEqual(["2000-12-31T21:54:14.123Z","2030-01-01T07:24:14.123Z"]);
  });
  it.each([{title:"Manager - 成都"},{descriptionTeaser:"Location: Chengdu, China."},{ml_job_parser:{descriptionTeaser:"工作地点：成都。"}}])("keeps reviewed mainland textual ambiguity pending %j",async mutation=>{
    const input=await capture([row(1,"Shanghai",mutation)]);expect(input.result.truth.completenessVerified).toBe(true);expect(input.result.jobs[0]?.cities).toEqual(["城市待核"]);expect(replay(input)).toBe(true);
  });
  it.each(["country","city","state","location","cityState","cityStateCountry","latitude","longitude","multi_location","multi_location_array","isMultiLocation","address","workLocation","jobVisibility","reqId","jobSeqNo","jobId"])("rejects missing audited field %s",async key=>{
    const r=row();delete r[key];expect((await capture([r])).result.truth.completenessVerified).toBe(false);
  });
  it("proves dynamic multi-page totals and IDs with omitted or explicit offsets",async()=>{
    const rows=Array.from({length:53},(_,i)=>row(i));
    for(const offsets of [undefined,[0,50]]){const input=await capture(rows,{pages:[rows.slice(0,50),rows.slice(50)],...(offsets?{offsets}:{})});expect(input.result.truth.completenessVerified).toBe(true);expect(input.result.jobs).toHaveLength(53);expect(replay(input)).toBe(true);}
  });
  it("refuses offset drift, null, underfilled pages, repeated IDs, changing totals and page limit truncation",async()=>{
    const rows=Array.from({length:53},(_,i)=>row(i));
    for(const options of [{offsets:[50]},{offsets:[null]},{pages:[rows.slice(0,49),rows.slice(49)]},{pages:[rows.slice(0,50),rows.slice(0,3)]},{pages:[rows.slice(0,50),rows.slice(50)],totals:[53,54]},{pages:[rows.slice(0,50)],totals:[251]}])expect((await capture(rows,options)).result.truth.completenessVerified).toBe(false);
    expect((await capture([row(),row()])).result.truth.completenessVerified).toBe(false);
  });
  it("keeps an explicit empty China result truthful",async()=>{const input=await capture([]);expect(input.result.truth.completenessVerified).toBe(true);expect(replay(input)).toBe(true);});
  it.each(["country","locale","refNum","pageId","widgetApiEndpoint"])("rejects changed effective bootstrap %s",async key=>{expect((await capture(undefined,{bootstrap:{[key]:"unknown"}})).result.truth.completenessVerified).toBe(false);});
  it.each(["postedDatePolicy","cityScopePolicy","publicVisibilityPolicy","requestBoundOmittedOffsetPolicy"])("refuses removed exact policy %s",async key=>{
    const p=structuredClone(plan());if(p.adapterId!=="official-json")throw Error("plan");delete (p.officialJsonFetch as unknown as Record<string,unknown>)[key];expect((await capture(undefined,{plan:p})).result.truth.completenessVerified).toBe(false);
  });
  it.each([{cities:["温州"]},{cities:["成都"]},{cities:["全国"]},{cities:["上海","城市待核"]},{officialPublishedAt:undefined},{officialPublishedAt:"2026-09-25T00:13:23.104Z"},{officialTitle:"Changed"},{officialUrl:"https://jobs.organon.com/cn/zh/job/R700001"},{locationRaw:"Chengdu, Sichuan, China"}])("refuses output detached from original raw evidence %j",async mutation=>{
    const input=await capture([row(1,"Wenzhou")]);expect(replay(input,input.result.jobs.map(j=>({...j,...mutation})))).toBe(false);
  });
  it.each([{workLocation:"USA - Boston"},{postedDate:"2026-09-23T00:00:00.000+0000"},{descriptionTeaser:"Work location: Singapore."}])("replays raw body after coherent fingerprint tampering %j",async mutation=>{
    const input=await capture(),evidence=structuredClone(input.result.fetchEvidence!);const artifact=evidence.artifacts.find(a=>a.logicalKey==="phenom-page-0000")!;
    const body=JSON.parse(artifact.body as string);Object.assign(body.refineSearch.data.jobs[0],mutation);artifact.body=JSON.stringify(body);evidence.pages[0]!.responseFingerprintSha256=createHash("sha256").update(artifact.body).digest("hex");
    const coherent=deriveCanonicalPaginationEvidence({evidence,expectedChannelIds:[],filteredOutput:true}),evaluation=evaluatePaginationEvidence({evidence:coherent,expectedChannelIds:[],filteredOutput:true});
    expect(evaluation.safeCompleteness).toBe(true);expect(replayStrictSourceQualityEvidence({plan:input.plan,evidence:coherent,paginationEvaluation:evaluation,reconciliation:input.result.reconciliation!,jobs:input.result.jobs,capturedAt})).toBe(false);
  });
  it("refuses altered request proof, fabricated returned zero, swapped dates and observation clock",async()=>{
    const input=await capture([row(),row(2,"Shanghai",{postedDate:"2026-09-23T00:00:00.000+0000"})]);
    const evidence=structuredClone(input.result.fetchEvidence!);evidence.artifacts[1]!.extractorLocator+="modified";expect(replay(input,input.result.jobs,evidence)).toBe(false);
    const offsets=structuredClone(input.result.fetchEvidence!);offsets.pages[0]!.returnedOffset=0;expect(replay(input,input.result.jobs,offsets)).toBe(false);
    expect(replay(input,input.result.jobs.map((j,i)=>({...j,officialPublishedAt:input.result.jobs[1-i]!.officialPublishedAt})))).toBe(false);
    expect(replayStrictSourceQualityEvidence({plan:input.plan,evidence:input.result.fetchEvidence!,jobs:input.result.jobs,paginationEvaluation:input.result.paginationEvaluation!,reconciliation:input.result.reconciliation!,capturedAt:"2026-10-03T00:00:00.000Z"})).toBe(false);
  });
  it.each([
    {requestedUrl:"https://jobs.organon.com/cn/zh/home",finalUrl:"https://jobs.organon.com/cn/zh/home"},
    {requestedUrl:"https://jobs.organon.com/widgets",finalUrl:"https://jobs.organon.com/widgets"},
    {extractorLocator:"unrelated-bootstrap"},{capturedAt:"2001-01-01T00:00:00.000Z"},
    {capturedAt:"2026-10-03T00:00:00.000Z"},{httpStatus:500},{contentType:"application/json"},{kind:"ATS_API_RESPONSE"}
  ])("binds raw entry metadata to the source and acquisition window %j",async mutation=>{
    const input=await capture(),evidence=structuredClone(input.result.fetchEvidence!);Object.assign(evidence.artifacts[0]!,mutation);expect(replay(input,input.result.jobs,evidence)).toBe(false);
  });
  it.each([{httpStatus:500},{contentType:"text/html"},{kind:"ATS_API_RESPONSE"},{capturedAt:"2001-01-01T00:00:00.000Z"},
    {requestedUrl:"https://jobs.organon.com/cn/zh/home",finalUrl:"https://jobs.organon.com/cn/zh/home"}])("binds page transport provenance %j",async mutation=>{
    const input=await capture(),evidence=structuredClone(input.result.fetchEvidence!);Object.assign(evidence.artifacts[1]!,mutation);expect(replay(input,input.result.jobs,evidence)).toBe(false);
  });
  it("refuses a changed page locator prefix with unchanged request hash",async()=>{
    const input=await capture(),evidence=structuredClone(input.result.fetchEvidence!);evidence.artifacts[1]!.extractorLocator=evidence.artifacts[1]!.extractorLocator.replace(/^phenom-page-v1[^|]*/u,"unrelated-page");expect(replay(input,input.result.jobs,evidence)).toBe(false);
  });
  it.each(["listUrl","officialEntryUrl","officialChainEvidenceUrl"])("binds normalized source evidence %s",async field=>{
    const input=await capture(),jobs=structuredClone(input.result.jobs);
    if(field==="listUrl")jobs[0]!.listUrl="https://example.com/";else (jobs[0]!.evidence as Record<string,unknown>)[field]="https://example.com/";
    expect(replay(input,jobs)).toBe(false);
  });

  it("pins the reviewed exact local configuration and admits owned archived dated pending jobs",async()=>{
    expect(getSourceQualityPolicy(plan())).toBe("PLAN_BOUND_SOURCE_QUALITY_V1");
    expect(sourcePlanConfigSha256(plan())).toBe("d56e212c03224c44b0be11afc07709ae9b2fbfd2a69c24ce773c0f192fa603d2");
    const input=await archived(await capture([row(),row(2,"Wenzhou")],{owned:true}));
    try{
      const admission=await issueSourceQualityAdmission(input);expect(admission.status).toBe("ACCEPTED");
      const commands=buildSourceQualityJobCommands({...input,admission,previousJobs:[],firstAcceptedCurrentPolicyReceipt:null,baselineCompletedBeforeCrawl:true}).jobCommands;
      expect(commands).toHaveLength(2);expect(commands.map(command=>command.record)).toEqual(expect.arrayContaining([expect.objectContaining({cities:["城市待核"],officialPublishedAt:"2026-09-24T00:00:00.000Z"})]));
      expect(await issueSourceQualityAdmission({...input,result:structuredClone(input.result)})).toMatchObject({status:"REJECTED",codes:["OWNED_ACQUISITION_REQUIRED"]});
    }finally{await rm(input.archive.workspaceRoot,{recursive:true,force:true});}
  });
  it.each([{countryCode:"SG"},{workLocation:"USA - Boston"},{descriptionTeaser:"This position will work in Brazil."},{postedDate:undefined}])("rejects invalid owned rows without publication commands %j",async mutation=>{
    const input=await archived(await capture([row(1,"Shanghai",mutation)],{owned:true}));
    try{const admission=await issueSourceQualityAdmission(input);expect(admission.status).toBe("REJECTED");expect(buildSourceQualityJobCommands({...input,admission,previousJobs:[],firstAcceptedCurrentPolicyReceipt:null,baselineCompletedBeforeCrawl:true}).jobCommands).toEqual([]);}
    finally{await rm(input.archive.workspaceRoot,{recursive:true,force:true});}
  });
  it("cannot turn imported retained bytes into owned acquisition by setting truth flags",async()=>{
    const input=await archived(await capture());
    try{expect(await issueSourceQualityAdmission(input)).toMatchObject({status:"REJECTED",codes:["OWNED_ACQUISITION_REQUIRED"]});}
    finally{await rm(input.archive.workspaceRoot,{recursive:true,force:true});}
  });
  it.each([{cities:["温州"]},{cities:["全国"]},{officialPublishedAt:undefined},{officialPublishedAt:"2026-09-25T00:13:23.104Z"}])("refuses output alteration at owned archive admission %j",async mutation=>{
    const input=await archived(await capture([row(1,"Wenzhou")],{owned:true}));
    try{Object.assign(input.result.jobs[0]!,mutation);expect((await issueSourceQualityAdmission(input)).status).toBe("REJECTED");}
    finally{await rm(input.archive.workspaceRoot,{recursive:true,force:true});}
  });
  it.each(["company","source","country filter","page size","page limit","apply origin","date output","copied policy","facet"])("rejects altered Organon exact binding %s",async field=>{
    const p=structuredClone(plan());if(p.adapterId!=="official-json"||p.officialJsonFetch?.kind!=="phenom")throw Error("plan");
    if(field==="company")p.company.id="company-other";
    if(field==="source")p.source.companyId="company-other";
    if(field==="country filter")p.officialJsonFetch.countryFilter="Singapore";
    if(field==="page size")p.officialJsonFetch.pageSize=100;
    if(field==="page limit")p.officialJsonFetch.maxPages=10;
    if(field==="apply origin")p.officialJsonFetch.allowedApplyOrigins=["https://example.com"];
    if(field==="date output")delete p.json.fields.officialPublishedAt;
    if(field==="copied policy")p.source.id="source-other-social";
    if(field==="facet")p.officialJsonFetch.facetScope={countryIncludeDescriptor:"China",categoryExcludeDescriptors:["Student"]};
    expect(getSourceQualityPolicy(p)).toBeNull();expect((await capture(undefined,{plan:p})).result.truth.completenessVerified).toBe(false);
  });

  it.each(["  Promotion   Manager  ","\tManager,\n Market   Access Strategy "," Sr.  Executive,\tCS&CA ","\n District\tManager "])("normalizes raw title whitespace while retaining its exact bytes: %j",async title=>{
    const input=await archived(await capture([row(1,"Shanghai",{title})],{owned:true}));
    try{
      const artifact=input.result.fetchEvidence!.artifacts[1]!,body=JSON.parse(artifact.body as string);
      expect(body.refineSearch.data.jobs[0].title).toBe(title);
      expect(input.result.fetchEvidence!.pages[0]!.responseFingerprintSha256).toBe(createHash("sha256").update(artifact.body).digest("hex"));
      expect(input.result.jobs[0]!.officialTitle).toBe(title.replace(/\s+/gu," ").trim());expect(replay(input)).toBe(true);
      expect((await issueSourceQualityAdmission(input)).status).toBe("ACCEPTED");
    }finally{await rm(input.archive.workspaceRoot,{recursive:true,force:true});}
  });
  it.each([{sourceKind:"CAMPUS"},{atsKind:"WORKDAY"},{officialChineseCompanyName:"Other"},{category:"销售"},{auxiliaryChineseTitle:"Other"},
    {unexpectedClaim:"China"},{unexpectedClaim:undefined}])("rejects complete normalized output metadata drift and extras %j",async mutation=>{
    const input=await capture();expect(replay(input,input.result.jobs.map(job=>({...job,...mutation})) as typeof input.result.jobs)).toBe(false);
  });
  it.each([{rawSnapshotRef:"invented"},{unexpectedClaim:"China"},{unexpectedClaim:undefined}])("rejects unexpected normalized evidence fields %j",async mutation=>{
    const input=await capture();expect(replay(input,input.result.jobs.map(job=>({...job,evidence:{...job.evidence,...mutation}})))).toBe(false);
  });

  it.each([
    {title:"Promotion Manager - Market Access"}, {title:"Manager - Singapore territory"}, {title:"Manager-Boston"},
    {descriptionTeaser:"Support customers in Singapore and Japan."},
    {descriptionTeaser:"Support customers based in Singapore."},
    {descriptionTeaser:"Support customers who work in Singapore."},
    {descriptionTeaser:"Support Singapore-based customers."},
    {descriptionTeaser:"The territory includes customers in Singapore."},
    {descriptionTeaser:"Work location: Shanghai, China. No relocation to Singapore is required."},
    {descriptionTeaser:"This role is based in Shanghai supporting customers in Singapore."},
    {descriptionTeaser:"This role is based in Shanghai, and Singapore is a key sales territory."},
    {descriptionTeaser:"工作区域：德国柏林"}, {descriptionTeaser:"Location: Atlantis, China."},
    {descriptionTeaser:"Future workplace details are still to be confirmed."}
  ])("keeps field-level descriptive uncertainty through owned acquisition without losing the source: %j",async mutation=>{
    const input=await archived(await capture([row(),row(2,"Shanghai",mutation)],{owned:true}));
    try{
      expect(input.result.truth.completenessVerified).toBe(true);expect(input.result.jobs).toHaveLength(2);
      expect(input.result.jobs[0]!.cities).toEqual(["上海"]);expect(input.result.jobs[1]!.cities).toEqual(["城市待核"]);
      expect(input.result.fetchEvidence!.fetchLosses).toEqual([]);expect(replay(input)).toBe(true);
      const raw=JSON.parse(input.result.fetchEvidence!.artifacts[1]!.body as string).refineSearch.data.jobs[1];expect(raw).toMatchObject(mutation);
      const admission=await issueSourceQualityAdmission(input);expect(admission.status).toBe("ACCEPTED");
      const commands=buildSourceQualityJobCommands({...input,admission,previousJobs:[],firstAcceptedCurrentPolicyReceipt:null,baselineCompletedBeforeCrawl:true}).jobCommands;
      expect(commands).toHaveLength(2);expect(commands.map(command=>command.record.cities)).toEqual(expect.arrayContaining([["上海"],["城市待核"]]));
    }finally{await rm(input.archive.workspaceRoot,{recursive:true,force:true});}
  });
  it.each([
    {descriptionTeaser:"This position will work in Singapore."},
    {descriptionTeaser:"This role is based in the Singapore office."},
    {descriptionTeaser:"This position will work in our Singapore office."},
    {descriptionTeaser:"This role is based in Shanghai and Singapore."}, {descriptionTeaser:"岗位驻地：新加坡"},
    {title:"Manager based in Singapore"}, {descriptionTeaser:"Based in Shanghai but work in Singapore."},
    {descriptionTeaser:"Based in Shanghai but based in Singapore."},
    {descriptionTeaser:"岗位驻地：上海，但工作地点：新加坡。"},
    {descriptionTeaser:"Support customers in Singapore; this role will work in Singapore."},
    {ml_job_parser:{descriptionTeaser_ats:"岗位驻地：新加坡"}}
  ])("rejects positive foreign workplace clauses through owned acquisition %j",async mutation=>{
    const input=await archived(await capture([row(),row(2,"Shanghai",mutation)],{owned:true}));
    try{expect(input.result.truth.completenessVerified).toBe(false);expect(input.result.jobs).toEqual([]);expect((await issueSourceQualityAdmission(input)).status).toBe("REJECTED");}
    finally{await rm(input.archive.workspaceRoot,{recursive:true,force:true});}
  });

});
