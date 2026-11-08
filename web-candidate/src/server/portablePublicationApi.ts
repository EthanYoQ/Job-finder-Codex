import { PortableSearchRequestSchema } from "../domain/search";
import { isCityPendingJob, matchesPortableSearchCity, publicSearchCities, publicSearchCityProvince, publicSearchProvinces, CITY_PENDING, NATIONWIDE } from "../domain/jobLocation";
import type { PortablePublicSnapshot } from "../db/portablePublicSnapshotRepository";
import type { DatabaseSearchResult } from "./jobSearchService";
import type { CoverageRequest, CoverageResult, CoverageCompany } from "./coverageService";
import { candidateCompanies } from "../data/companyRegistry";
import { classifyJob, matchesJobCategory } from "../domain/jobClassification";

// Scope labels describe the reviewed entry, never a live count or publication
// decision. Counts and visibility still come only from the verified snapshot.
function sourceScopeNote(sourceIds: readonly string[], snapshot: PortablePublicSnapshot): { sourceScopeNote?: string } {
  const notes: Record<string, string> = {
    "source-novo-nordisk-china-social": "诺和诺德中国站指定招聘入口；仅覆盖该入口已核实职位，全球招聘站补充职位未并入。",
    "source-cspc-social": "石药官网的“集团官网”招聘频道（人工 D36 指定入口）；仅覆盖该频道，不代表集团及子公司全量。",
    "source-servier-china-social": "施维雅中国 Moka 社会招聘门户（47734）；门户职位总量与已确认中国工作地的职位数量分开核验，未披露工作地的职位保持未知。"
  };
  const sanofi = snapshot.sources.find(source => source.sourceId === "source-sanofi-china-social");
  if (sanofi?.selectedSourceResultId && sanofi.policyId === "STRICT_PLAN_BOUND_OFFICIAL_TOTAL_REPLAY_V1") {
    notes["source-sanofi-china-social"] = "赛诺菲上一版已核验快照（英文官网中国范围清单，原采集时间保留）；中文官网完整清单及对应中文官方申请页核验完成后更新。";
  } else if (sanofi?.selectedSourceResultId && sanofi.policyId === "STRICT_PLAN_BOUND_INDEPENDENT_TRAVERSAL_REPLAY_V2") {
    notes["source-sanofi-china-social"] = "赛诺菲中文官网指定入口的完整岗位清单；通过对应中文官方申请页核验正文、实际工作地和招聘状态，明确境外或已关闭的岗位不计入在招岗位。";
  }
  const servier = snapshot.sources.find(source => source.sourceId === "source-servier-china-social" && source.state === "PUBLISHING")?.sourceScopeSummary;
  if (servier) notes["source-servier-china-social"] = `施维雅中国 Moka 社会招聘门户（47734）：门户职位 ${servier.portalJobCount} 个，明确中国工作地 ${servier.verifiedChinaJobCount} 个，国家待核 ${servier.unknownCountryJobCount} 个（官方标记在招，未计入中国职位）；仅覆盖此门户。`;
  const note = sourceIds.flatMap(id => notes[id] ? [notes[id]] : []).join(" ");
  return note ? { sourceScopeNote: note } : {};
}

export interface PortableCoverageSummary {requiredCompanyCount:number;publishingCompanyCount:number;excludedCompanyCount:number;degradedCompanyCount:number}
export function portableCoverageSummary(snapshot:PortablePublicSnapshot):PortableCoverageSummary {
  return {requiredCompanyCount:snapshot.coverage.requiredCompanyCount,
    publishingCompanyCount:snapshot.companies.filter(c=>c.required&&c.publishingSourceIds.length>0).length,
    excludedCompanyCount:snapshot.coverage.excludedCompanyCount,
    degradedCompanyCount:snapshot.companies.filter(c=>c.required&&c.health==="DEGRADED").length};
}
export interface PublishedJobSummary {
  /** All required, currently publishing jobs in the verified snapshot, before search filters. */
  totalJobs: number;
  cityPendingJobs: number;
}

/** Filter only the reader's already verified, membership-bound projection. Never
 * re-query mutable Job flags or fall back to legacy rows when the snapshot is empty. */
export function searchPortableSnapshot(request:unknown,snapshot:PortablePublicSnapshot):DatabaseSearchResult & {coverageSummary:PortableCoverageSummary;publishedJobSummary:PublishedJobSummary;cityFacets:Array<{city:string;province:string|null;jobCount:number}>;provinceFacets:Array<{province:string;jobCount:number;cityPendingJobs:number}>} {
  const q=PortableSearchRequestSchema.parse(request),keyword=q.keyword?.toLocaleLowerCase("zh-CN")??"";
  const date=(s:string|null)=>s===null?Number.NEGATIVE_INFINITY:Date.parse(s);
  const seenJobIds=new Set<string>();
  const publishedCompanies=snapshot.companies.filter(c=>c.required&&c.publishingSourceIds.length>0).map(c=>({...c,jobs:c.jobs.filter(j=>{if(seenJobIds.has(j.id))return false;seenJobIds.add(j.id);return true;}).map(({categoryManuallyCorrected,...job})=>{
    const classification=classifyJob(job);
    return categoryManuallyCorrected&&classification.category!==job.category?job:{...job,...classification};
  })}));
  const publishedJobs=publishedCompanies.flatMap(c=>c.jobs);
  const cityCounts=new Map<string,{province:string|null;jobCount:number}>();
  const provinceCounts=new Map<string,{jobCount:number;cityPendingJobs:number}>();
  for(const job of publishedJobs){
    for(const city of publicSearchCities(job)){
      const province=publicSearchCityProvince(job,city), previous=cityCounts.get(city);
      cityCounts.set(city,{province:previous&&previous.province!==province?null:province,jobCount:(previous?.jobCount??0)+1});
    }
    for(const province of publicSearchProvinces(job)){
      const previous=provinceCounts.get(province);
      provinceCounts.set(province,{jobCount:(previous?.jobCount??0)+1,cityPendingJobs:(previous?.cityPendingJobs??0)+(isCityPendingJob(job)?1:0)});
    }
  }
  const cityFacets=[...cityCounts].map(([city,data])=>({city,...data})).sort((a,b)=>a.city.localeCompare(b.city,"zh-CN"));
  cityFacets.push({city:NATIONWIDE,province:null,jobCount:publishedJobs.filter(j=>matchesPortableSearchCity(j,NATIONWIDE)).length},{city:CITY_PENDING,province:null,jobCount:publishedJobs.filter(isCityPendingJob).length});
  const provinceFacets=[...provinceCounts].map(([province,data])=>({province,...data})).sort((a,b)=>a.province.localeCompare(b.province,"zh-CN"));
  const publishedJobSummary={totalJobs:publishedJobs.length,cityPendingJobs:publishedJobs.filter(isCityPendingJob).length};
  const companies=publishedCompanies.filter(c=>!q.companyIds.length||q.companyIds.includes(c.id)).map(c=>({
    id:c.id,companyName:c.companyName,pinyin:c.pinyin,...sourceScopeNote(c.publishingSourceIds,snapshot),jobs:c.jobs.filter(j=>
      matchesPortableSearchCity(j,q.city,q.province)&&
      matchesJobCategory(j,q.categories)&&(!q.newWithinDays||j.isNew)&&
      (!keyword||[j.title,j.officialTitle,j.category,j.subcategory??"",c.companyName,c.pinyin].some(text=>text.toLocaleLowerCase("zh-CN").includes(keyword))))
      .map(j=>({...j,cityPending:isCityPendingJob(j)}))
      .sort((a,b)=>(date(b.officialPublishedAt)-date(a.officialPublishedAt)||0)||a.title.localeCompare(b.title)||a.id.localeCompare(b.id))
  })).filter(c=>c.jobs.length>0);
  companies.sort((a,b)=>{
    if(q.sort==="MATCHING_JOB_COUNT_DESC"&&a.jobs.length!==b.jobs.length)return b.jobs.length-a.jobs.length;
    if(q.sort==="LATEST_POSTED"){const delta=date(b.jobs[0]!.officialPublishedAt)-date(a.jobs[0]!.officialPublishedAt);if(delta&&!Number.isNaN(delta))return delta;}
    return a.pinyin.localeCompare(b.pinyin)||a.id.localeCompare(b.id);
  });
  return {companies,totalJobs:companies.reduce((n,c)=>n+c.jobs.length,0),lastUpdatedAt:snapshot.lastUpdatedAt,coverageSummary:portableCoverageSummary(snapshot),publishedJobSummary,cityFacets,provinceFacets};
}
export function coverageFromPortableSnapshot(request:CoverageRequest,snapshot:PortablePublicSnapshot):CoverageResult & {coverageSummary:PortableCoverageSummary} {
  const keyword=request.keyword.trim().toLocaleLowerCase("zh-CN"),offset=request.offset??0,limit=request.limit??41;
  const companies=snapshot.companies.filter(c=>!keyword||c.companyName.toLocaleLowerCase("zh-CN").includes(keyword)||c.pinyin.toLocaleLowerCase("zh-CN").includes(keyword))
    .sort((a,b)=>a.pinyin.localeCompare(b.pinyin)||a.id.localeCompare(b.id)).map((c):CoverageCompany=>{
      const canonical=candidateCompanies.find(row=>row.id===c.id)!;
      const times=snapshot.sources.filter(s=>s.companyId===c.id).map(s=>s.lastSuccessAt).filter((v):v is string=>v!==null).sort();
      return {id:c.id,companyName:c.companyName,...sourceScopeNote(c.sourceIds,snapshot),officialWebsiteUrl:canonical.officialWebsiteUrl??null,
        officialCareersUrl:canonical.sources.find(s=>c.sourceIds.includes(s.id))?.officialEntryUrl??null,category:c.category,
        state:!c.required?"USER_AUTHORIZED_PHASE1_EXCLUSION":c.publishingSourceIds.length?"PUBLISHING":"VERIFYING",
        health:!c.required||c.health==="UNVERIFIED"?"NOT_APPLICABLE":c.health=== "HEALTHY"?"HEALTHY":"DEGRADED",
        lastSuccessAt:times.at(-1)??null};
    });
  return {companies:companies.slice(offset,offset+limit),offset,limit,hasMore:offset+limit<companies.length,coverageSummary:portableCoverageSummary(snapshot)};
}
