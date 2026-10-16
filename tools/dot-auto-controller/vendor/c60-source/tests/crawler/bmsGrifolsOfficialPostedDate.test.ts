import { createHash } from "node:crypto";
import { deriveCanonicalPaginationEvidence, evaluatePaginationEvidence } from "../../src/crawler/paginationEvidence";
import { describe, expect, it } from "vitest";
import { candidateCompanies } from "../../src/data/companyRegistry";
import { createOfficialJsonSourceFetch } from "../../src/crawler/officialJsonSourceFetch";
import { createGrifolsChinaSourceFetch, validateStrictGrifolsChinaEvidence } from "../../src/crawler/grifolsChinaSourceFetch";
import { buildStagedSourceCrawlPlans, getPlanBySourceId, sourcePlanConfigSha256, type SourceCrawlPlan } from "../../src/crawler/sourcePlan";
import { runSourceCrawl, replayStrictSourceQualityEvidence } from "../../src/crawler/runSourceCrawl";
import { getSourceQualityPolicy } from "../../src/crawler/sourceQualityAdmission";

const capturedAt = "2026-10-01T10:00:00.000Z";
function sourcePlan(source: "bms" | "grifols") {
  const plan = getPlanBySourceId(buildStagedSourceCrawlPlans(candidateCompanies), `source-${source}-china-social`);
  if (plan?.adapterId !== "official-json") throw new Error("Missing plan");
  return plan;
}
function bmsRow(id = "one", postedTs: unknown = 1790208000) {
  return { id, name: `Role ${id}`, positionUrl: `/careers/job/${id}`, locations: ["Field - China"], standardizedLocations:["CN"], workLocationOption:"onsite", locationFlexibility:null, postedTs };
}
async function bms(rows = [bmsRow()], plan: SourceCrawlPlan = sourcePlan("bms"), transform = (body: string, _start: number) => body) {
  const fetched = await createOfficialJsonSourceFetch({allowBrowserFallback:false,now:()=>new Date(capturedAt),http:async request=>{
    const start = Number(new URL(request.url).searchParams.get("start"));
    return {status:200,finalUrl:request.url,contentType:"application/json",capturedAt,
      body:transform(JSON.stringify({status:200,data:{count:rows.length,positions:rows.slice(start,start+10)}}),start)};
  }})(plan);
  return { plan, fetched, result: await runSourceCrawl(plan,{fetch:async()=>fetched}) };
}
const grifolsUrl = (id: string) => `https://jobsearch.grifols.com/job/Shanghai-Role-${id}/${id}/`;
function grifolsList(dates: string[]) {
  return `<span class="paginationLabel">Results 1 – ${dates.length} of ${dates.length}</span>
  <table id="searchresults" aria-label="Page 1 of 1"><tbody>${dates.map((date,index)=>
    `<tr class="data-row"><td class="jobTitle hidden-phone"><a class="jobTitle-link" href="${grifolsUrl(String(index+1))}">Role ${index+1}</a></td>
    <td class="colLocation hidden-phone"><span class="jobLocation">Shanghai, CN</span></td>
    <td class="colDate hidden-phone"><span class="jobDate">${date}</span></td></tr>`).join("")}</tbody></table>`;
}
function grifolsDetail(index: number, date: string, extra = "", canonical = grifolsUrl(String(index+1))) {
  return `<link rel="canonical" href="${canonical}"><div class="jobDisplayShell">
  <meta itemprop="streetAddress" content="Shanghai, CN">${date ? `<meta itemprop="datePosted" content="${date}">` : ""}${extra}
  <div class="jobDisplay"><div class="content"><p><b>Location: APAC:China:Shanghai:Shangai</b></p></div></div></div>`;
}
async function grifols(options: {listDates?:string[];detailDates?:string[];extra?:string;canonical?:string;plan?:SourceCrawlPlan;transformDetail?:(body:string,index:number)=>string;transformList?:(body:string)=>string} = {}) {
  const plan = options.plan ?? sourcePlan("grifols");
  const listDates = options.listDates ?? ["Sep 3, 2026", "Sep 28, 2026"];
  const detailDates = options.detailDates ?? ["Thu Sep 03 00:00:00 UTC 2026", "Mon Sep 28 00:00:00 UTC 2026"];
  const fetched = await createGrifolsChinaSourceFetch({now:()=>new Date(capturedAt),http:async request=>{
    const index = detailDates.findIndex((_value,index)=>request.url === grifolsUrl(String(index+1)));
    if (request.url !== plan.source.officialEntryUrl && index < 0) throw new Error("Unexpected offline request");
    return {status:200,finalUrl:request.url,contentType:"text/html",capturedAt,body:index < 0 ? (options.transformList ?? ((body:string)=>body))(grifolsList(listDates)) :
      (options.transformDetail ?? ((body:string)=>body))(grifolsDetail(index,detailDates[index]!,options.extra,options.canonical),index)};
  }})(plan);
  return {plan,fetched,result:await runSourceCrawl(plan,{fetch:async()=>fetched})};
}

describe("BMS Unix-seconds preservation",()=>{
  it.each([
    ["Xi'an - CN","Xi'An, Shaanxi, CN","西安"], ["Chongqing - CN","Chongqing, Chongqing, CN","重庆"],
    ["Zhengzhou - CN","Zhengzhou, Henan, CN","郑州"], ["Shijiazhuang - CN","Shijiazhuang, Hebei, CN","石家庄"],
    ["Tianjin - CN","Tianjin, Tianjin, CN","天津"], ["Nanjing - CN","Nanjing, Jiangsu, CN","南京"],
    ["Qingdao - CN","Qingdao, Shandong, CN","青岛"], ["Hangzhou - CN","Hangzhou, Zhejiang, CN","杭州"],
    ["Shanghai - CN","Shanghai, Shanghai, CN","上海"]
  ])("requires both observed geographic fields for %s",async(location,standardized,city)=>{
    const {result}=await bms([{...bmsRow(),locations:[location],standardizedLocations:[standardized]}]);
    expect(result).toMatchObject({truth:{completenessVerified:true},jobs:[{locationRaw:location,cities:[city]}]});
  });
  it.each([
    {standardizedLocations:undefined}, {standardizedLocations:[]}, {standardizedLocations:["US"]},
    {standardizedLocations:["CN","US"]}, {standardizedLocations:["Shanghai, Shanghai, CN"]},
    {locations:["Field - China","Shanghai - CN"]}, {locations:["Shanghai - CN"]},
    {country:"US"}, {city:"Beijing"}, {countryCode:"CN"}, {workLocationOption:"remote"},
    {locationFlexibility:"Singapore"}, {locations:"Field - China"}
  ])("fails closed on missing or contradictory raw geography %j",async mutation=>{
    const {fetched,result}=await bms([{...bmsRow(),...mutation}] as ReturnType<typeof bmsRow>[]);
    expect(fetched).toMatchObject({ok:false,fetchEvidence:{fetchCounts:{rawCount:1,parsedCount:1,validCount:0,validationDiscardCount:1},fetchLosses:[{details:{code:"BMS_GEOGRAPHY_INVALID",pageSequence:0,recordIndex:0}}]}});
    expect(result.truth.completenessVerified).toBe(false);expect(result.jobs).toEqual([]);
  });

  it.each(["Field - China","Field - China - CN"])("maps only exact country-only BMS location %s",async location=>{
    const {fetched,result}=await bms([{...bmsRow(),locations:[location]}]);
    expect(result).toMatchObject({truth:{completenessVerified:true},jobs:[{locationRaw:location,cities:["中国"]}]});
    expect(fetched.fetchEvidence?.fetchLosses).toEqual([]);
  });
  it.each(["Field - China - HK","Field - China | Singapore","Field - China - Unknown"])("does not broaden unmatched label %s to country or nationwide",async location=>{
    const {result}=await bms([{...bmsRow(),locations:[location]}]);
    expect(result.truth.completenessVerified).toBe(false);expect(result.jobs).toEqual([]);
  });
  it("preserves known Shanghai and requires the exact new location policy",async()=>{
    const {result}=await bms([{...bmsRow(),locations:["Shanghai - CN"],standardizedLocations:["Shanghai, Shanghai, CN"]}]);expect(result.jobs[0]!.cities).toEqual(["上海"]);
    const plan=sourcePlan("bms");if(plan.adapterId!=="official-json")throw Error("BMS plan");
    delete (plan.officialJsonFetch as unknown as Record<string,unknown>).cityScopePolicy;
    expect((await bms(undefined,plan)).fetched.ok).toBe(false);
  });
  it("preserves exact seconds and keeps Field-China country-only",async()=>{
    const {plan,fetched,result} = await bms();
    expect(result).toMatchObject({truth:{completenessVerified:true},jobs:[{officialPublishedAt:"2026-09-24T00:00:00.000Z",cities:["中国"]}]});
    expect(fetched).toMatchObject({ok:true,fetchEvidence:{fetchCounts:{rawCount:1,parsedCount:1,validCount:1},fetchLosses:[]}});
    expect(getSourceQualityPolicy(plan)).toBe("PLAN_BOUND_SOURCE_QUALITY_V1");
    expect(sourcePlanConfigSha256(plan)).not.toBe("e727203e6231287e973f8469b729e2b9af477ee4e988947849cf21aec62693f9");
  });
  it.each([[-315619200,"1960-01-01T00:00:00.000Z"],[978327014,"2001-01-01T05:30:14.000Z"],[1790906401,"2026-10-02T02:00:01.000Z"],[4102444800,"2100-01-01T00:00:00.000Z"]])(
    "preserves legal old/future seconds %s without temporal loss",async(raw,expected)=>{
      const {fetched,result}=await bms([bmsRow("one",raw)]);
      expect(result).toMatchObject({truth:{completenessVerified:true},jobs:[{officialPublishedAt:expected}]});
      expect(fetched.fetchEvidence?.fetchLosses).toEqual([]);
    });
  it.each([undefined,null,"",0,-1,"1790208000",1790208000000,1790208000.5,Number.MAX_SAFE_INTEGER])(
    "retains evidence and fails invalid/sentinel postedTs %j",async value=>{
      const row = bmsRow(); row.postedTs = value;
      const {fetched,result}=await bms([row]);
      expect(fetched).toMatchObject({ok:false,fetchEvidence:{artifacts:[{}],fetchCounts:{rawCount:1,validCount:0},
        fetchLosses:[{details:{code:"BMS_POSTED_DATE_INVALID",field:"postedTs",pageSequence:0,recordIndex:0}}]}});
      expect(result.truth.completenessVerified).toBe(false);
    });
});

describe("Grifols date-joined preservation",()=>{
  it("joins exact list/detail dates by canonical official ID",async()=>{
    const {plan,fetched,result}=await grifols();
    expect(result.truth.completenessVerified).toBe(true);
    expect(result.jobs.map(job=>[job.sourceJobId,job.officialPublishedAt])).toEqual([
      ["1","2026-09-03T00:00:00.000Z"],["2","2026-09-28T00:00:00.000Z"]]);
    expect(fetched).toMatchObject({ok:true,fetchEvidence:{fetchCounts:{rawCount:2,parsedCount:2,validCount:2},fetchLosses:[]}});
    expect(getSourceQualityPolicy(plan)).toBe("PLAN_BOUND_SOURCE_QUALITY_V1");
  });
  it.each([
    ["Jan 1, 2001","Mon Jan 01 05:54:14 UTC 2001","2001-01-01T05:54:14.000Z"],
    ["Oct 1, 2026","Thu Oct 01 10:00:01 UTC 2026","2026-10-01T10:00:01.000Z"],
    ["Feb 29, 2028","Tue Feb 29 23:59:59 UTC 2028","2028-02-29T23:59:59.000Z"]
  ])("preserves the supplied UTC clock without an age/future cutoff: %s",async(label,raw,expected)=>{
    const {fetched,result}=await grifols({listDates:[label],detailDates:[raw]});
    expect(result).toMatchObject({truth:{completenessVerified:true},jobs:[{officialPublishedAt:expected}]});
    expect(fetched.fetchEvidence?.fetchLosses).toEqual([]);
  });
  it.each([
    ["Sep 3, 2026",""], ["","Thu Sep 03 00:00:00 UTC 2026"],
    ["Sep 4, 2026","Thu Sep 03 00:00:00 UTC 2026"], ["Sep 3, 2026","Fri Sep 03 00:00:00 UTC 2026"],
    ["Feb 29, 2026","Sun Feb 29 00:00:00 UTC 2026"], ["Apr 31, 2026","Fri Apr 31 00:00:00 UTC 2026"],
    ["Jan 1, 0000","Sat Jan 01 00:00:00 UTC 0000"], ["Sep 3, 2026","Thu Sep 03 24:00:00 UTC 2026"],
    ["Sep 3, 2026","Thu Sep 03 00:00:00 2026"], ["Sep 3, 2026","Thu Sep 03 00:00:00 GMT 2026"],
    ["Sep 3, 2026","2026-09-03T00:00:00Z"]
  ])("fails date conflicts/malformed values with retained evidence: %s / %s",async(label,raw)=>{
    const {fetched,result}=await grifols({listDates:[label],detailDates:[raw]});
    expect(fetched).toMatchObject({ok:false,fetchEvidence:{artifacts:[{},{}],fetchCounts:{rawCount:1,validCount:0},
      fetchLosses:[{details:{code:"GRIFOLS_POSTED_DATE_INVALID",pageSequence:0,recordIndex:0}}]}});
    expect(result.truth.completenessVerified).toBe(false);
  });
  it.each(["Thu Sep 03 00:00:00 UTC 2026","Mon Sep 28 00:00:00 UTC 2026"])("rejects duplicate detail metadata %s",async date=>{
    const {fetched}=await grifols({extra:`<meta itemprop="datePosted" content="${date}">`});
    expect(fetched).toMatchObject({ok:false,fetchEvidence:{fetchLosses:[{details:{code:"GRIFOLS_POSTED_DATE_INVALID"}},{details:{code:"GRIFOLS_POSTED_DATE_INVALID"}}]}});
  });
  it("keeps canonical-ID failures",async()=>{
    expect((await grifols({canonical:grifolsUrl("999")})).fetched.ok).toBe(false);
  });
});

for (const source of ["bms","grifols"] as const) describe(`${source} independent date/ID replay`,()=>{
  async function fetchPair(){return source === "bms" ? bms([bmsRow("one"),bmsRow("two",1790553600)]) : grifols();}
  it.each([
    ["missing date",{officialPublishedAt:undefined}], ["changed date",{officialPublishedAt:"2026-09-29T00:00:00.000Z"}],
    ["changed ID",{sourceJobId:"changed"}], ["changed title",{title:"changed"}],
    ["changed URL",{officialUrl:"https://example.com/job"}], ["changed location",{locationRaw:"Beijing, China"}],
    ["changed cities",{cities:["北京"]}]
  ])("rejects %s in normalized output",async(_label,change)=>{
    const {plan,fetched}=await fetchPair();
    if (!fetched.ok || !("payload" in fetched)) throw new Error("Expected fetch");
    const jobs=(fetched.payload as {jobs:object[]}).jobs.map(job=>({...job,...change}));
    expect((await runSourceCrawl(plan,{fetch:async()=>({...fetched,payload:{jobs}})})).truth.completenessVerified).toBe(false);
  });
  it("rejects dates swapped between two genuine raw IDs and a duplicated output ID",async()=>{
    const {plan,fetched,result}=await fetchPair();
    if (!fetched.fetchEvidence || !fetched.paginationEvaluation || !result.reconciliation) throw new Error("Missing evidence");
    const input={plan,evidence:fetched.fetchEvidence,paginationEvaluation:fetched.paginationEvaluation,
      reconciliation:result.reconciliation,jobs:result.jobs,capturedAt};
    expect(replayStrictSourceQualityEvidence(input)).toBe(true);
    const swapped=result.jobs.map((job,index)=>({...job,officialPublishedAt:result.jobs[1-index]!.officialPublishedAt!}));
    expect(replayStrictSourceQualityEvidence({...input,jobs:swapped})).toBe(false);
    expect(replayStrictSourceQualityEvidence({...input,jobs:[result.jobs[0]!,result.jobs[0]!]})).toBe(false);
    if (source === "grifols") expect(validateStrictGrifolsChinaEvidence(plan,input.evidence,swapped)).toBe(false);
  });
  it.each(["policy","mapping","copied source"])("fails changed source-bound %s",async kind=>{
    const plan=sourcePlan(source);
    if(kind==="mapping") delete plan.json.fields.officialPublishedAt;
    if(kind==="copied source") plan.source.id="source-other-social";
    if(kind==="policy"){
      if(plan.officialJsonFetch?.kind==="eightfold-pcsx") delete (plan.officialJsonFetch as Record<string,unknown>).postedDatePolicy;
      if(plan.profileBoundSource?.kind==="grifols-china-detail-scope") delete (plan.profileBoundSource.config as unknown as Record<string,unknown>).postedDatePolicy;
    }
    const {fetched}=source==="bms" ? await bms(undefined,plan) : await grifols({plan});
    expect(fetched.ok).toBe(false);
  });
});


describe("date-bearing failures retain diagnostic evidence",()=>{
  it("retains BMS conflicting duplicate postedTs keys",async()=>{
    const {fetched}=await bms(undefined,undefined,body=>body.replace('"postedTs":1790208000','"postedTs":1790208000,"postedTs":1790553600'));
    expect(fetched).toMatchObject({ok:false,fetchEvidence:{artifacts:[{}]}});
    expect(fetched.fetchEvidence?.artifacts[0]?.body).toContain('"postedTs":1790208000,"postedTs":1790553600');
  });
  it("keeps earlier invalid-date evidence when a later BMS page is malformed",async()=>{
    const rows=Array.from({length:11},(_value,index)=>bmsRow(String(index),index===0 ? null : 1790208000));
    const {fetched}=await bms(rows,undefined,(body,start)=>start===10 ? "{invalid-json" : body);
    expect(fetched).toMatchObject({ok:false,fetchEvidence:{artifacts:[{},{}],fetchLosses:[{details:{code:"BMS_POSTED_DATE_INVALID"}}]}});
  });
  it("keeps Grifols earlier date conflict when a later canonical ID is invalid",async()=>{
    const {fetched}=await grifols({detailDates:["Fri Sep 03 00:00:00 UTC 2026","Mon Sep 28 00:00:00 UTC 2026"],
      transformDetail:(body,index)=>index===1 ? body.replace(grifolsUrl("2"),grifolsUrl("999")) : body});
    expect(fetched).toMatchObject({ok:false,fetchEvidence:{artifacts:[{},{},{}]}});
    expect(fetched.fetchEvidence?.artifacts[1]?.body).toContain("Fri Sep 03");
  });
  it("rejects a coherent BMS raw status mutation after its fingerprint is recomputed",async()=>{
    const {plan,fetched}=await bms();
    if (!fetched.ok || !fetched.fetchEvidence) throw new Error("Missing evidence");
    const evidence=structuredClone(fetched.fetchEvidence);
    const artifact=evidence.artifacts[0]!;
    const raw=JSON.parse(artifact.body as string); raw.status=500; artifact.body=JSON.stringify(raw);
    evidence.pages[0]!.responseFingerprintSha256=createHash("sha256").update(artifact.body).digest("hex");
    const derived=deriveCanonicalPaginationEvidence({evidence,expectedChannelIds:[],filteredOutput:true});
    const evaluation=evaluatePaginationEvidence({evidence:derived,expectedChannelIds:[],filteredOutput:true});
    expect(evaluation.safeCompleteness).toBe(true);
    expect((await runSourceCrawl(plan,{fetch:async()=>({...fetched,fetchEvidence:derived,paginationEvaluation:evaluation})})).truth.completenessVerified).toBe(false);
  });
});


describe("Grifols existing foreign-scope exclusions",()=>{
  it.each(["", "Fri Sep 03 00:00:00 UTC 2026"])("keeps proven foreign exclusion with an irrelevant missing/conflicting date: %s",async date=>{
    const {fetched,result}=await grifols({listDates:["", "Sep 28, 2026"],detailDates:[date,"Mon Sep 28 00:00:00 UTC 2026"],
      transformList:body=>body.replace("Shanghai, CN","Home Office, CN"),
      transformDetail:(body,index)=>index===0 ? body.replace("Shanghai, CN","Home Office, CN")
        .replace("APAC:China:Shanghai:Shangai","APAC:Hong Kong:Home Office:Hong Kong") : body});
    expect(fetched).toMatchObject({ok:true,fetchEvidence:{fetchCounts:{rawCount:2,parsedCount:2,validCount:1,validationDiscardCount:1},
      fetchLosses:[{details:{code:"VERIFIED_DETAIL_OUT_OF_MAINLAND_SCOPE",recordIndex:0}}]}});
    expect(result).toMatchObject({truth:{completenessVerified:true},jobs:[{sourceJobId:"2",officialPublishedAt:"2026-09-28T00:00:00.000Z"}]});
  });
});


describe("BMS raw geography replay",()=>{
  it.each([{standardizedLocations:["US"]},{standardizedLocations:["Shanghai, Shanghai, CN"]},{country:"US"},{city:"Beijing"}])("rejects coherently rehashed raw geography %j",async mutation=>{
    const {plan,fetched,result}=await bms();if(!fetched.fetchEvidence||!fetched.paginationEvaluation||!result.reconciliation)throw Error("Evidence missing");
    const evidence=structuredClone(fetched.fetchEvidence),artifact=evidence.artifacts[0]!;
    const body=JSON.parse(artifact.body as string);Object.assign(body.data.positions[0],mutation);artifact.body=JSON.stringify(body);
    evidence.pages[0]!.responseFingerprintSha256=createHash("sha256").update(artifact.body).digest("hex");
    const coherent=deriveCanonicalPaginationEvidence({evidence,expectedChannelIds:[],filteredOutput:true});
    const paginationEvaluation=evaluatePaginationEvidence({evidence:coherent,expectedChannelIds:[],filteredOutput:true});
    expect(paginationEvaluation.safeCompleteness).toBe(true);
    expect(replayStrictSourceQualityEvidence({plan,evidence:coherent,paginationEvaluation,reconciliation:result.reconciliation,jobs:result.jobs,capturedAt})).toBe(false);
  });
  it("rejects relabeling country-only output as nationwide",async()=>{
    const {plan,fetched,result}=await bms();if(!fetched.fetchEvidence||!fetched.paginationEvaluation||!result.reconciliation)throw Error("Evidence missing");
    const jobs=structuredClone(result.jobs);jobs[0]!.cities=["全国"];
    expect(replayStrictSourceQualityEvidence({plan,evidence:fetched.fetchEvidence,paginationEvaluation:fetched.paginationEvaluation,reconciliation:result.reconciliation,jobs,capturedAt})).toBe(false);
  });
});
