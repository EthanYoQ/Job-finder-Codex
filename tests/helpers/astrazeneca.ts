import { candidateCompanies } from '../../src/data/companyRegistry';
import { buildStagedSourceCrawlPlans } from '../../src/crawler/sourcePlan';
import { createHttpHtmlSourceFetch } from '../../src/crawler/httpHtmlSourceFetch';

export const AZ_NOW = '2026-10-02T00:00:00.000Z';
export const azPlan = () => structuredClone(buildStagedSourceCrawlPlans(candidateCompanies).find(p => p.source.id === 'source-astrazeneca-social')!);
export interface AzRow { sourceJobId: string; officialTitle: string; locationRaw: string; officialUrl: string }
export function azRow(id = '100033677408', title = 'Senior Director', location = 'Multiple locations'): AzRow {
  return {sourceJobId:id,officialTitle:title,locationRaw:location,officialUrl:`https://job-search.astrazeneca.cn/%e5%b7%a5%e4%bd%9c/test/role/12977/${id}`};
}
export function azList(rows: AzRow[], page = 1, total = rows.length): string {
  return `<section data-filter-id="2"><input type="checkbox" id="country-filter-0" data-facet-type="2" data-id="1814991" data-count="${total}" data-display="中国"><label for="country-filter-0"><b class="filter">中国</b><b>${total}</b></label></section>
  <section id="search-results" data-total-job-results="${total}" data-total-results="${total}" data-total-pages="${Math.max(1,Math.ceil(total/15))}" data-current-page="${page}" data-records-per-page="15"><section id="search-results-list"><ul>${rows.map(r=>`<li><a class="search-results-link" data-job-id="${r.sourceJobId}" href="${r.officialUrl}"><h2>${r.officialTitle}</h2></a><span class="job-location">${r.locationRaw}</span></li>`).join('')}</ul></section></section>`;
}
export function azDetail(row: AzRow, options: {date?:string;visibleDate?:string;city?:string;region?:string;country?:string;visibleCity?:string;visibleRegion?:string;visibleCountry?:string;padding?:number} = {}): string {
  const city=options.city??'Wuxi',region=options.region??'Jiangsu',country=options.country??'CN';
  const ld={'@context':'http://schema.org','@type':'JobPosting',identifier:'TP24605',title:row.officialTitle,url:row.officialUrl,datePosted:options.date??'2026-9-1',description:'<p>Official job description</p>',hiringOrganization:{'@type':'Organization',name:'Astrazeneca'},jobLocation:[{'@type':'Place',address:{'@type':'PostalAddress',addressLocality:city,addressRegion:region,addressCountry:country}}]};
  return `<html><head><link rel="canonical" href="${row.officialUrl}"><meta name="job-ats-req-id" content="TP24605"><script type="application/ld+json">${JSON.stringify(ld)}</script></head><body><section class="job-description-title" data-org-id="12977" data-job-id="${row.sourceJobId}"><h1>${row.officialTitle}</h1></section><section class="job-description" data-org-id="12977" data-job-id="${row.sourceJobId}"><span class="job-locations"><span>${options.visibleCity??'无锡市'}, </span><span>${options.visibleRegion??'江苏'}, </span><span>${options.visibleCountry??'中国'}</span></span><span class="job-id job-info"><b>职位 ID</b> TP24605</span><span class="job-date job-info"><b>发布日期</b> ${options.visibleDate??'09/01/2026'}</span><a class="job-apply" data-job-id="${row.sourceJobId}" href="https://careersite.tupu360.com/astrazeneca/position/detail?positionId=test">申请</a><div class="ats-description">Official job description</div></section><!--${'x'.repeat(options.padding??0)}--></body></html>`;
}
export async function azListCapture(rows: AzRow[]) {
  const plan=azPlan();
  const fetched=await createHttpHtmlSourceFetch({now:()=>new Date(AZ_NOW),http:async request=>({status:200,body:azList(rows.slice((Number(new URL(request.url).searchParams.get('p'))-1)*15,Number(new URL(request.url).searchParams.get('p'))*15),Number(new URL(request.url).searchParams.get('p')),rows.length),finalUrl:request.url,contentType:'text/html; charset=utf-8',capturedAt:AZ_NOW})})(plan);
  if(!fetched.ok||!fetched.fetchEvidence)throw Error('synthetic list fetch failed');
  return {plan,fetched};
}
export function azResponse(url: string, body: string, status=200) {
  const response=new Response(body,{status,headers:{'content-type':'text/html; charset=utf-8'}});
  Object.defineProperty(response,'url',{value:url});return response;
}
