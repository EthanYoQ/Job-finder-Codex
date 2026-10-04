import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { archiveSourceEvidence } from "../../src/crawler/artifactArchive";
import { bindRuntimeEvidenceArtifactIds } from "../../src/crawler/runtimeAtomicEvidence";
import { buildSourceQualityJobCommands } from "../../src/crawler/sourceQualityPublication";
import { createOfficialJsonSourceFetch } from "../../src/crawler/officialJsonSourceFetch";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { candidateCompanies } from "../../src/data/companyRegistry";
import { buildStagedSourceCrawlPlans, getPlanBySourceId, sourcePlanConfigSha256, type SourceCrawlPlan } from "../../src/crawler/sourcePlan";
import { createOwnedSourceQualityFetch, getSourceQualityPolicy, issueSourceQualityAdmission } from "../../src/crawler/sourceQualityAdmission";
import { runSourceCrawl, replayStrictSourceQualityEvidence } from "../../src/crawler/runSourceCrawl";
import { deriveCanonicalPaginationEvidence, evaluatePaginationEvidence } from "../../src/crawler/paginationEvidence";

const capturedAt = "2026-10-02T00:00:00.000Z";
const postedDate = "2026-09-29T12:05:11.334+0000";
const bootstrap = { widgetApiEndpoint: "https://careers.emdgroup.com/widgets", country: "us", deviceType: "desktop",
  locale: "en_us", refNum: "MQAEGZUS", pageName: "search-results", pageId: "page18-ds" };
export function merckRow(overrides: Record<string, unknown> = {}) {
  return { jobSeqNo: "MQAEGZUS304084EXTERNALENUS", jobId: "304084", reqId: "304084", title: "客户经理",
    jobVisibility: ["external", "internal"], visibilityType: "External", siteType: "external", externalApply: false,
    country: "China", city: "Shanghai", state: "Shanghai", location: "Shanghai, Shanghai, China",
    cityState: "Shanghai, Shanghai", cityStateCountry: "Shanghai, Shanghai, China", latitude: "31.22222", longitude: "121.45806",
    multi_location: ["Shanghai, Shanghai, China"], isMultiLocation: false,
    multi_location_array: [{ location: "Shanghai, Shanghai, China", latlong: { lat: 31.22222, lon: 121.45806 } }],
    applyUrl: "", postedDate, dateCreated: "2026-09-21T07:59:59.115+0000", ...overrides };
}
function plan() { return getPlanBySourceId(buildStagedSourceCrawlPlans(candidateCompanies), "source-merck-china-social")!; }
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
async function capture(rows = [merckRow()], options: { plan?: SourceCrawlPlan; pages?: unknown[][]; from?: number; total?: number; perPageTotals?: number[]; bootstrap?: object } = {}) {
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(capturedAt));
  const p = options.plan ?? plan(); let requests = 0;
  const pages = options.pages ?? [rows];
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    requests++;
    const index = requests - 2;
    if (requests > pages.length + 1) throw Error("Unexpected fixture request; no network fallback");
    const body = init.method === "POST" ? JSON.stringify({ refineSearch: { status: 200, hits: pages[index]!.length,
      totalHits: options.perPageTotals?.[index] ?? options.total ?? pages.flat().length, ...(options.from === undefined ? {} : { from: options.from }),
      data: { jobs: pages[index], aggregations: [] } } }) : `<script>var phApp=${JSON.stringify({ ...bootstrap, ...options.bootstrap })};</script>`;
    return { status: 200, url: String(url), headers: new Headers({ "content-type": init.method === "POST" ? "application/json" : "text/html" }), text: async () => body };
  });
  const result = await runSourceCrawl(p, { fetch: options.plan ? createOfficialJsonSourceFetch({allowBrowserFallback:false}) : createOwnedSourceQualityFetch(), isBaseline: true });
  return { plan: p, result, requests };
}
function replay(input: Awaited<ReturnType<typeof capture>>, jobs = input.result.jobs, evidence = input.result.fetchEvidence!) {
  return replayStrictSourceQualityEvidence({ plan: input.plan, evidence, jobs,
    paginationEvaluation: input.result.paginationEvaluation!, reconciliation: input.result.reconciliation!, capturedAt });
}

async function admissionInput(input: Awaited<ReturnType<typeof capture>>) {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "merck-quality-"));
  const binding = {releaseCandidateId:"merck-test",batchId:"merck-batch",sourceResultId:"merck-batch-source",sourceConfigSha256:sourcePlanConfigSha256(input.plan),adapterVersion:"a".repeat(64)};
  const evidenceSubdirectory="evidence", evidence=input.result.fetchEvidence!;
  const archive=await archiveSourceEvidence({workspaceRoot,...binding,sourceId:input.plan.source.id,evidenceSubdirectory,
    captureTool:evidence.captureTool,artifacts:bindRuntimeEvidenceArtifactIds({...binding,sourceId:input.plan.source.id,artifacts:evidence.artifacts})});
  return {...input,binding,archive:{workspaceRoot,evidenceSubdirectory,artifacts:archive.artifacts}};
}

describe("Merck China source-specific raw date and geography proof", () => {
  it("preserves the official instant on the owned route and pins only its reviewed code configuration", async () => {
    const input = await capture();
    expect(input.result.truth.completenessVerified).toBe(true);
    expect(input.result.jobs).toMatchObject([{ cities: ["上海"], officialPublishedAt: "2026-09-29T12:05:11.334Z" }]);
    expect(input.result.fetchEvidence?.fetchLosses).toEqual([]);
    expect(replay(input)).toBe(true);
    expect(getSourceQualityPolicy(input.plan)).toBe("PLAN_BOUND_SOURCE_QUALITY_V1");
    expect(sourcePlanConfigSha256(input.plan)).toBe("3bce85185c99c4513a907f87fe3da9e8297392a8e0b9b1c52f57da09f2fe7d38");
  });
  it("normalizes the supported Suzhou/Jiangsu pair to the city only", async () => {
    const input = await capture([merckRow({city:"Suzhou",state:"Jiangsu",location:"Suzhou, Jiangsu, China",cityState:"Suzhou, Jiangsu",
      cityStateCountry:"Suzhou, Jiangsu, China",multi_location:["Suzhou, Jiangsu, China"],latitude:"31.30408",longitude:"120.59538",
      multi_location_array:[{location:"Suzhou, Jiangsu, China",latlong:{lat:31.30408,lon:120.59538}}]})]);
    expect(input.result.truth.completenessVerified).toBe(true); expect(input.result.jobs[0]?.cities).toEqual(["苏州"]);
  });
  it.each([
    {country:"United States"},{country:"China / Singapore"},{city:"Boston"},{city:"NotShanghai"},{state:"Guangdong"},
    {location:"Shanghai, Atlantis, China"},{cityState:"Shanghai, Boston"},{cityStateCountry:"Boston, Massachusetts, United States"},
    {multi_location:["Shanghai, Shanghai, China","Boston, Massachusetts, United States"]},
    {multi_location_array:[{location:"Shanghai, Shanghai, China",country:"United States",latlong:{lat:31.22222,lon:121.45806}}]},
    {workLocations:[{city:"Boston",country:"United States"}]},{workLocations:[]},{locations:["Boston"]},{countryCode:"US"},
    {multi_location_array:[{location:"Boston, Massachusetts, United States",latlong:{lat:31.22222,lon:121.45806}}]},
    {multi_location_array:[{location:"Shanghai, Shanghai, China",latlong:{lat:42.3601,lon:121.45806}}]},
    {multi_location_array:[{location:"Shanghai, Shanghai, China",latlong:{lat:31.22222,lon:-71.0589}}]},
    {multi_location_array:[{location:"Shanghai, Shanghai, China",latlong:{lat:31.22222,lon:121.45806,city:"Boston"}}]},
    {isMultiLocation:true},{latitude:"42.3601"},{longitude:"-71.0589"},{city:null},{city:["Shanghai"]},{province:"Jiangsu"},{futureUnknownField:"unknown"}
  ])("rejects contradictory or unknown geography through owned acquisition: %j", async mutation => {
    const input = await capture([merckRow(mutation)]);
    expect(input.result.truth.completenessVerified).toBe(false); expect(input.result.jobs).toEqual([]);
    expect(input.result.fetchEvidence?.artifacts).toHaveLength(2);
  });
  it.each([undefined,null,"",42,"2026-09-29","2026-09-29T12:05:11.334","2026-02-29T12:05:11.334+0000"])("rejects missing or invalid official postedDate %j on the owned route", async value => {
    const input = await capture([merckRow({postedDate:value})]);
    expect(input.result.truth.completenessVerified).toBe(false); expect(input.result.jobs).toEqual([]);
    expect(input.result.fetchEvidence?.fetchLosses).toMatchObject([{details:{code:"MERCK_POSTED_DATE_INVALID"}}]);
  });
  it("preserves an old official date despite recent dateCreated without imposing a new age cutoff", async () => {
    const input = await capture([merckRow({postedDate:"2001-01-01T05:54:14.123+0800",dateCreated:"2026-09-29T12:05:11.334+0000"})]);
    expect(input.result.truth.completenessVerified).toBe(true); expect(input.result.jobs[0]?.officialPublishedAt).toBe("2000-12-31T21:54:14.123Z");
  });
  it.each([{officialPublishedAt:undefined},{officialPublishedAt:"2026-09-21T07:59:59.115Z"},{cities:["上海","江苏"]},{locationRaw:"Boston, US"},{officialUrl:"https://careers.emdgroup.com/us/en/job/999999"}])("rejects normalized output detached from raw evidence %j",async mutation=>{
    const input=await capture(); expect(replay(input,input.result.jobs.map(job=>({...job,...mutation})))).toBe(false);
  });
  it.each([{city:"Boston"},{workLocations:[{country:"US"}]},{postedDate:"2026-09-28T12:05:11.334+0000"}])("rejects coherent raw body tampering after fingerprints are recomputed %j",async mutation=>{
    const input=await capture(),evidence=structuredClone(input.result.fetchEvidence!);
    const artifact=evidence.artifacts.find(a=>a.logicalKey==="phenom-page-0000")!;
    const body=JSON.parse(artifact.body as string);Object.assign(body.refineSearch.data.jobs[0],mutation);artifact.body=JSON.stringify(body);
    evidence.pages[0]!.responseFingerprintSha256=createHash("sha256").update(artifact.body).digest("hex");
    const coherent=deriveCanonicalPaginationEvidence({evidence,expectedChannelIds:[],filteredOutput:true});
    const evaluation=evaluatePaginationEvidence({evidence:coherent,expectedChannelIds:[],filteredOutput:true});
    expect(evaluation.safeCompleteness).toBe(true);
    expect(replayStrictSourceQualityEvidence({plan:input.plan,evidence:coherent,paginationEvaluation:evaluation,reconciliation:input.result.reconciliation!,jobs:input.result.jobs,capturedAt})).toBe(false);
  });
  it("binds two omitted-offset pages to full request cardinalities and unique raw IDs",async()=>{
    const rows=Array.from({length:55},(_,i)=>merckRow({reqId:String(304084+i),jobId:String(304084+i),jobSeqNo:`MQAEGZUS${304084+i}EXTERNALENUS`}));
    const input=await capture(rows,{pages:[rows.slice(0,50),rows.slice(50)]});
    expect(input.result.truth.completenessVerified).toBe(true);expect(input.result.jobs).toHaveLength(55);expect(replay(input)).toBe(true);
  });
  it("rejects underfilled first pages even when the same total can eventually close",async()=>{
    const rows=Array.from({length:55},(_,i)=>merckRow({reqId:String(304084+i),jobId:String(304084+i),jobSeqNo:`MQAEGZUS${304084+i}EXTERNALENUS`}));
    const input=await capture(rows,{pages:[rows.slice(0,49),rows.slice(49)]});expect(input.result.truth.completenessVerified).toBe(false);
  });
  it.each(["postedDatePolicy","cityScopePolicy","publicVisibilityPolicy"])("rejects a removed source-specific policy %s",async field=>{
    const changed=structuredClone(plan()); if(changed.adapterId!=="official-json"||changed.officialJsonFetch?.kind!=="phenom")throw Error("plan");
    delete (changed.officialJsonFetch as Record<string,unknown>)[field];expect((await capture(undefined,{plan:changed})).result.truth.completenessVerified).toBe(false);
  });
  it.each(["country","city","state","location","cityState","cityStateCountry","latitude","longitude","multi_location","multi_location_array","isMultiLocation"])("rejects missing redundant geography field %s",async field=>{
    const row:Record<string,unknown>=merckRow();delete row[field];const input=await capture([row as ReturnType<typeof merckRow>]);
    expect(input.result.truth.completenessVerified).toBe(false);expect(input.result.jobs).toEqual([]);
  });
  it.each(["country","locale","refNum","pageId"])("rejects changed effective bootstrap %s",async field=>{
    expect((await capture(undefined,{bootstrap:{[field]:"unknown"}})).result.truth.completenessVerified).toBe(false);
  });
  it("rejects returned offset mismatch and duplicate official identities",async()=>{
    expect((await capture(undefined,{from:50})).result.truth.completenessVerified).toBe(false);
    expect((await capture([merckRow(),merckRow()])).result.truth.completenessVerified).toBe(false);
  });
  it("preserves an explicit empty China response without inventing a date",async()=>{
    const input=await capture([]);expect(input.result.truth.completenessVerified).toBe(true);expect(input.result.jobs).toEqual([]);expect(replay(input)).toBe(true);
  });
  it("rejects swapped date-to-ID assignments and a relabeled observation time",async()=>{
    const input=await capture([merckRow(),merckRow({reqId:"304085",jobId:"304085",jobSeqNo:"MQAEGZUS304085EXTERNALENUS",postedDate:"2026-09-28T12:05:11.334+0000"})]);
    const jobs=input.result.jobs.map((job,index)=>({...job,officialPublishedAt:input.result.jobs[1-index]!.officialPublishedAt}));
    expect(replay(input,jobs)).toBe(false);
    expect(replayStrictSourceQualityEvidence({plan:input.plan,evidence:input.result.fetchEvidence!,jobs:input.result.jobs,paginationEvaluation:input.result.paginationEvaluation!,reconciliation:input.result.reconciliation!,capturedAt:"2026-10-03T00:00:00.000Z"})).toBe(false);
  });

  it("issues an archived owned receipt preserving the raw date and exact city",async()=>{
    const input=await admissionInput(await capture());
    try {
      const admission=await issueSourceQualityAdmission(input);expect(admission.status).toBe("ACCEPTED");
      const commands=buildSourceQualityJobCommands({...input,admission,previousJobs:[],firstAcceptedCurrentPolicyReceipt:null,baselineCompletedBeforeCrawl:true}).jobCommands;
      expect(commands).toHaveLength(1);expect(commands[0]!.record).toMatchObject({cities:["上海"],officialPublishedAt:"2026-09-29T12:05:11.334Z"});
      expect(await issueSourceQualityAdmission({...input,result:structuredClone(input.result)})).toMatchObject({status:"REJECTED",codes:["OWNED_ACQUISITION_REQUIRED"]});
    } finally {await rm(input.archive.workspaceRoot,{recursive:true,force:true});}
  });
  it.each([{workLocations:[{country:"United States"}]},{postedDate:undefined}])("refuses an owned invalid row with no publication commands %j",async mutation=>{
    const input=await admissionInput(await capture([merckRow(mutation)]));
    try {
      const admission=await issueSourceQualityAdmission(input);expect(admission.status).toBe("REJECTED");
      expect(buildSourceQualityJobCommands({...input,admission,previousJobs:[],firstAcceptedCurrentPolicyReceipt:null,baselineCompletedBeforeCrawl:true}).jobCommands).toEqual([]);
    } finally {await rm(input.archive.workspaceRoot,{recursive:true,force:true});}
  });
  it.each([undefined,"2026-09-21T07:59:59.115Z"])("refuses discarded or replaced output dates at owned admission %j",async officialPublishedAt=>{
    const input=await admissionInput(await capture());
    try {input.result.jobs[0]!.officialPublishedAt=officialPublishedAt;expect((await issueSourceQualityAdmission(input)).status).toBe("REJECTED");}
    finally {await rm(input.archive.workspaceRoot,{recursive:true,force:true});}
  });

  it("rejects total drift and repeated omitted-offset pages on the owned route",async()=>{
    const rows=Array.from({length:55},(_,i)=>merckRow({reqId:String(304084+i),jobId:String(304084+i),jobSeqNo:`MQAEGZUS${304084+i}EXTERNALENUS`}));
    expect((await capture(rows,{pages:[rows.slice(0,50),rows.slice(50)],perPageTotals:[55,56]})).result.truth.completenessVerified).toBe(false);
    expect((await capture(rows,{pages:[rows.slice(0,50),rows.slice(0,5)]})).result.truth.completenessVerified).toBe(false);
  });
  it("rejects a changed request-contract locator despite unchanged valid raw rows",async()=>{
    const input=await capture(),evidence=structuredClone(input.result.fetchEvidence!);
    evidence.artifacts.find(a=>a.logicalKey==="phenom-page-0000")!.extractorLocator += "-modified";
    expect(replay(input,input.result.jobs,evidence)).toBe(false);
  });
  it.each(["source","country filter","page size","category filter","date output","copied policy"])("refuses altered plan binding %s",async field=>{
    const changed=structuredClone(plan());if(changed.adapterId!=="official-json"||changed.officialJsonFetch?.kind!=="phenom")throw Error("plan");
    if(field==="source")changed.source.companyId="company-other";
    if(field==="country filter")changed.officialJsonFetch.countryFilter="Singapore";
    if(field==="page size")changed.officialJsonFetch.pageSize=100;
    if(field==="category filter")changed.officialJsonFetch.facetScope={countryIncludeDescriptor:"China",categoryExcludeDescriptors:["Student"]};
    if(field==="date output")delete changed.json.fields.officialPublishedAt;
    if(field==="copied policy")changed.source.id="source-other-social";
    expect(getSourceQualityPolicy(changed)).toBeNull();
    expect((await capture(undefined,{plan:changed})).result.truth.completenessVerified).toBe(false);
  });

  it.each(["区域客户经理-济南/青岛/郑州","医学顾问-内分泌-北京/上海","医药代表-心血管与代谢-天津","医药代表-心血管与代谢-深圳","高级客户专员-生殖-中山","高级医药代表-肿瘤-柳州"])("preserves positively China rows with a conflicting title suffix as city pending: %s",async title=>{
    const row=merckRow({title,city:"Beijing",state:"Beijing",location:"Beijing, Beijing, China",cityState:"Beijing, Beijing",cityStateCountry:"Beijing, Beijing, China",latitude:"39.9075",longitude:"116.39723",multi_location:["Beijing, Beijing, China"],multi_location_array:[{location:"Beijing, Beijing, China",latlong:{lat:39.9075,lon:116.39723}}],reqId:"999999",jobId:"999999",jobSeqNo:"MQAEGZUS999999EXTERNALENUS"});
    const input=await capture([row]);expect(input.result.truth.completenessVerified).toBe(true);
    expect(input.result.jobs[0]).toMatchObject({officialTitle:title,locationRaw:"Beijing, Beijing, China",cities:["城市待核"],officialPublishedAt:"2026-09-29T12:05:11.334Z",officialUrl:"https://careers.emdgroup.com/us/en/job/999999"});
    expect(replay(input)).toBe(true);expect(replay(input,input.result.jobs.map(job=>({...job,cities:["北京"]})))).toBe(false);
    expect(replay(input,input.result.jobs.map(job=>({...job,cities:["北京","城市待核"]})))).toBe(false);
  });
  it.each(["上海","北京","广州","深圳","苏州","南通","济南","青岛","郑州","天津","中山","柳州"])("classifies only positively known mainland title label %s",async city=>{
    const input=await capture([merckRow({title:`区域经理-${city}`})]);expect(input.result.truth.completenessVerified).toBe(true);
    expect(input.result.jobs[0]?.cities).toEqual(city==="上海"?["上海"]:["城市待核"]);
  });
  it.each(["Regional Manager - Singapore","Regional Manager - Boston","Regional Manager - Atlantis","区域经理-北京/Singapore","区域经理-未审核城市","Location: Boston","工作地点：深圳","Regional Manager based in Boston","Remote Medical Advisor","区域经理-北京/北京"])("holds foreign, unknown or unreviewed explicit title location %s",async title=>{
    const input=await capture([merckRow({title})]);expect(input.result.truth.completenessVerified).toBe(false);expect(input.result.jobs).toEqual([]);
  });
  it.each(["Location: Boston","工作地点：深圳","Office location: Singapore","Remote role based in Singapore"])("holds explicit work location outside reviewed teaser grammar %s",async descriptionTeaser=>{
    const input=await capture([merckRow({descriptionTeaser})]);expect(input.result.truth.completenessVerified).toBe(false);expect(input.result.jobs).toEqual([]);
  });
  it.each(["高级专家，客户服务AI及数字化解决方案","Enablement Lead - Data & AI Solution Enablement","高级工艺开发科学家-上游","应用销售专家-Protein and Cell Biology","技术销售专员-生物安全检测","高级技术服务专员-生物工艺解决方案","Senior Commercial Project Manager - Upstream"])("keeps reviewed non-location title suffix separate from geography: %s",async title=>{
    const input=await capture([merckRow({title})]);expect(input.result.truth.completenessVerified).toBe(true);expect(input.result.jobs[0]?.cities).toEqual(["上海"]);
  });
  it("never lets a recognized mainland title override foreign structured country",async()=>{
    const input=await capture([merckRow({title:"区域经理-北京",country:"Singapore"})]);expect(input.result.truth.completenessVerified).toBe(false);
  });

  it("issues an owned receipt and publication command for a pending-city row without guessing cities",async()=>{
    const input=await admissionInput(await capture([merckRow({title:"区域经理-北京/上海"})]));
    try {
      const admission=await issueSourceQualityAdmission(input);expect(admission.status).toBe("ACCEPTED");
      const commands=buildSourceQualityJobCommands({...input,admission,previousJobs:[],firstAcceptedCurrentPolicyReceipt:null,baselineCompletedBeforeCrawl:true}).jobCommands;
      expect(commands).toHaveLength(1);expect(commands[0]!.record).toMatchObject({cities:["城市待核"],locationRaw:"Shanghai, Shanghai, China",officialPublishedAt:"2026-09-29T12:05:11.334Z"});
    }finally{await rm(input.archive.workspaceRoot,{recursive:true,force:true});}
  });
  it("independently replays a coherent changed raw title and rejects its formerly known-city output",async()=>{
    const input=await capture(),evidence=structuredClone(input.result.fetchEvidence!);
    const artifact=evidence.artifacts.find(a=>a.logicalKey==="phenom-page-0000")!,body=JSON.parse(artifact.body as string);
    body.refineSearch.data.jobs[0].title="区域经理-北京";artifact.body=JSON.stringify(body);
    evidence.pages[0]!.responseFingerprintSha256=createHash("sha256").update(artifact.body).digest("hex");
    const coherent=deriveCanonicalPaginationEvidence({evidence,expectedChannelIds:[],filteredOutput:true}),paginationEvaluation=evaluatePaginationEvidence({evidence:coherent,expectedChannelIds:[],filteredOutput:true});
    const jobs=input.result.jobs.map(job=>({...job,officialTitle:"区域经理-北京"}));
    expect(replayStrictSourceQualityEvidence({plan:input.plan,evidence:coherent,paginationEvaluation,reconciliation:input.result.reconciliation!,jobs,capturedAt})).toBe(false);
  });

  it("marks an explicit nested official Shanghai/Beijing location as pending without changing the title",async()=>{
    const snippet="Job Title: (Senior) Product Manager. Location: Shanghai/Beijing, China. Your role. Product management.";
    const input=await capture([merckRow({title:"(高级)产品经理",ml_job_parser:{descriptionTeaser_keyword:snippet,descriptionTeaser_first200:snippet}})]);
    expect(input.result.truth.completenessVerified).toBe(true);expect(input.result.jobs[0]).toMatchObject({officialTitle:"(高级)产品经理",cities:["城市待核"],locationRaw:"Shanghai, Shanghai, China"});expect(replay(input)).toBe(true);
  });
  it.each([
    ["Shanghai","Shanghai",["上海"]],["Shanghai","Beijing",["城市待核"]],["Shanghai/Beijing","Beijing/Shanghai",["城市待核"]]
  ] as const)("reconciles mutually mainland labeled surfaces %s / %s",async(first,second,cities)=>{
    const input=await capture([merckRow({ml_job_parser:{descriptionTeaser_keyword:`Location: ${first}, China.`,descriptionTeaser_first200:`Location: ${second}, China.`}})]);
    expect(input.result.truth.completenessVerified).toBe(true);expect(input.result.jobs[0]?.cities).toEqual(cities);
  });
  it.each(["Location: Shanghai/Boston, China.","Location: Shanghai/Beijing, Singapore.","Location: Shanghai/Atlantis, China.","Location: Shanghai//Beijing, China.","Location: Shanghai/Beijing, China", "Office Location: Shanghai/Beijing, China."])("holds malformed or foreign labeled official snippet %s",async snippet=>{
    const input=await capture([merckRow({ml_job_parser:{descriptionTeaser_keyword:snippet}})]);expect(input.result.truth.completenessVerified).toBe(false);expect(input.result.jobs).toEqual([]);
  });
  it.each(["Location: Shanghai/Boston, China.","Location: Shanghai/Beijing, Singapore.","Location: Shanghai//Beijing, China."])("rejects coherently rehashed foreign or malformed nested location %s",async snippet=>{
    const input=await capture(),evidence=structuredClone(input.result.fetchEvidence!),artifact=evidence.artifacts.find(a=>a.logicalKey==="phenom-page-0000")!;
    const body=JSON.parse(artifact.body as string);body.refineSearch.data.jobs[0].ml_job_parser={descriptionTeaser_keyword:snippet};artifact.body=JSON.stringify(body);
    evidence.pages[0]!.responseFingerprintSha256=createHash("sha256").update(artifact.body).digest("hex");
    const coherent=deriveCanonicalPaginationEvidence({evidence,expectedChannelIds:[],filteredOutput:true}),paginationEvaluation=evaluatePaginationEvidence({evidence:coherent,expectedChannelIds:[],filteredOutput:true});
    expect(replayStrictSourceQualityEvidence({plan:input.plan,evidence:coherent,paginationEvaluation,reconciliation:input.result.reconciliation!,jobs:input.result.jobs.map(job=>({...job,cities:["城市待核"]})),capturedAt})).toBe(false);
  });

  it.each([{jobVisibility:["internal"]},{jobVisibility:["expired"]},{jobVisibility:[]},{jobVisibility:undefined},{visibilityType:"Internal"},{visibilityType:"Expired"},{visibilityType:undefined},{siteType:"internal"},{siteType:"expired"},{siteType:undefined},{externalApply:true},{externalApply:undefined}])("holds contrary or unreviewed public visibility/application routing %j",async mutation=>{
    const input=await capture([merckRow(mutation)]);expect(input.result.truth.completenessVerified).toBe(false);expect(input.result.jobs).toEqual([]);
  });
  it.each([{jobVisibility:["internal"]},{visibilityType:"Expired"},{siteType:"internal"}])("rejects coherently rehashed nonpublic status %j",async mutation=>{
    const input=await capture(),evidence=structuredClone(input.result.fetchEvidence!),artifact=evidence.artifacts.find(a=>a.logicalKey==="phenom-page-0000")!;
    const body=JSON.parse(artifact.body as string);Object.assign(body.refineSearch.data.jobs[0],mutation);artifact.body=JSON.stringify(body);
    evidence.pages[0]!.responseFingerprintSha256=createHash("sha256").update(artifact.body).digest("hex");
    const coherent=deriveCanonicalPaginationEvidence({evidence,expectedChannelIds:[],filteredOutput:true}),paginationEvaluation=evaluatePaginationEvidence({evidence:coherent,expectedChannelIds:[],filteredOutput:true});
    expect(replayStrictSourceQualityEvidence({plan:input.plan,evidence:coherent,paginationEvaluation,reconciliation:input.result.reconciliation!,jobs:input.result.jobs,capturedAt})).toBe(false);
  });
  it.each([undefined,"Full-time","Part-time"])("does not reinterpret employment type %j as current status or introduce an employment filter",async type=>{
    const input=await capture([merckRow({type})]);expect(input.result.truth.completenessVerified).toBe(true);
  });

  it.each([["external"],["internal","external"],["external","internal"]])("treats visibility membership as an unordered public set %j",async (...labels)=>{
    const input=await capture([merckRow({jobVisibility:labels})]);expect(input.result.truth.completenessVerified).toBe(true);expect(replay(input)).toBe(true);
  });
  it.each([{jobVisibility:["external","external"]},{jobVisibility:["external","unknown"]},{jobVisibility:"external"},{jobVisibility:null}])("holds malformed or unknown visibility membership %j",async mutation=>{
    const input=await capture([merckRow(mutation)]);expect(input.result.truth.completenessVerified).toBe(false);
  });

});
