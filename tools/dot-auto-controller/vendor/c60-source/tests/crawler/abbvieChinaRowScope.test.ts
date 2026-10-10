import {describe,expect,it} from "vitest";
import {reviewedAbbvieCity,validateAbbvieChinaRowScope} from "../../src/crawler/abbvieChinaRowScope";
import {validateStrictHtmlCompletenessProof} from "../../src/crawler/strictHtmlCompletenessProof";
import {buildStagedSourceCrawlPlans,getPlanBySourceId} from "../../src/crawler/sourcePlan";
import {candidateCompanies} from "../../src/data/companyRegistry";
import {createHttpHtmlSourceFetch} from "../../src/crawler/httpHtmlSourceFetch";
import {runSourceCrawl} from "../../src/crawler/runSourceCrawl";
const capturedAt="2026-10-01T10:00:00.000Z";
const plan=(()=>{const value=getPlanBySourceId(buildStagedSourceCrawlPlans(candidateCompanies),"source-abbvie-china-social");
if(value?.adapterId!=="html-table")throw Error("Missing canonical AbbVie plan");return value;})();
const row=`<div class="attrax-vacancy-tile">
<a class="attrax-vacancy-tile__title" href="/zh-hans/job/territory-supervisor-in-shenzhen-guangdong-province-jid-32148">Territory Supervisor</a>
<div class="attrax-vacancy-tile__location-freetext"><p class="attrax-vacancy-tile__item-value">Shenzhen, Guangdong Province</p></div>
<div class="attrax-vacancy-tile__option-location attrax-vacancy-tile__option-location--china"><p class="attrax-vacancy-tile__item-value">China</p></div>
<div class="attrax-vacancy-tile__option-job-type"><p class="attrax-vacancy-tile__item-value">Full-time</p></div>
<p class="attrax-vacancy-tile__expiry-value">01/01/0001</p></div>`;
const html=(value=row)=>`<span class="attrax-pagination__results-of--2" data-total-pages="1"></span><span class="attrax-pagination__total-results">1</span>${value}`;
async function execute(body:string){const fetch=createHttpHtmlSourceFetch({now:()=>new Date(capturedAt),http:async request=>({status:200,body,finalUrl:request.url,contentType:"text/html",capturedAt})});const fetched=await fetch(plan);if(!fetched.ok||!fetched.fetchEvidence)throw Error('Missing fixture capture');return {fetched,result:await runSourceCrawl(plan,{fetch:async()=>fetched,isBaseline:true})};}
const attacks:Record<string,(s:string)=>string>={
 "foreign location despite China option":s=>s.replace('Shenzhen, Guangdong Province','Boston, Massachusetts, United States'),
 "foreign locality under a China province":s=>s.replace('Shenzhen, Guangdong Province','Boston, Guangdong Province'),
 "mismatched Chinese province":s=>s.replace('Shenzhen, Guangdong Province','Shenzhen, Shanghai'),
 "opaque multi-location":s=>s.replace('Shenzhen, Guangdong Province','2 Locations'),
 "country-only location":s=>s.replace('Shenzhen, Guangdong Province','China'),
 "unknown reviewed city":s=>s.replace('Shenzhen, Guangdong Province','Unknown, Guangdong Province'),
 "conflicting option country":s=>s.replace('>China<','>United States<'),
 "conflicting option city":s=>s.replace('>China<','>Shanghai<').replace('--china','--shanghai'),
 "contradictory option class":s=>s.replace('--china','--united-states'),
 "second option class":s=>s.replace('--china','--china attrax-vacancy-tile__option-location--united-states'),
 "missing option":s=>s.replace('attrax-vacancy-tile__option-location ','not-location '),
 "unreviewed job type":s=>s.replace('Full-time','Internship'),
 "new real expiry":s=>s.replace('01/01/0001','03/20/2026'),
 "new visible posted date":s=>s.replace('</a>','</a><p class="attrax-vacancy-tile__date-posted">2020-01-01</p>'),
 "structured posted date":s=>s.replace('</a>','</a><time datetime="2020-01-01">Posted</time>'),
 "extra location value":s=>s.replace('Shenzhen, Guangdong Province</p>','Shenzhen, Guangdong Province</p><p class="attrax-vacancy-tile__item-value">Boston, US</p>'),
 "new contradictory country field":s=>s.replace('</a>','</a><div class="attrax-vacancy-tile__country">United States</div>'),
 "structured country field":s=>s.replace('</a>','</a><span itemprop="addressCountry">United States</span>'),
 "new geographic metadata":s=>s.replace('</a>','</a><div data-country="US"></div>'),
 "new structured job data":s=>s.replace('</a>','</a><script type="application/ld+json">{"addressCountry":"US"}</script>'),
 "duplicate option field":s=>s.replace('>China</p>','>China</p><p class="attrax-vacancy-tile__item-value">China</p>')
};
describe('AbbVie raw-row source scope',()=>{
 it('keeps the list record and honestly unknown date when exact row fields agree',async()=>{const {fetched,result}=await execute(html());expect(validateStrictHtmlCompletenessProof(plan,fetched.fetchEvidence!)).toBe(true);expect(result.truth.completenessVerified).toBe(true);expect(result.jobs).toHaveLength(1);expect(result.jobs[0]).toMatchObject({locationRaw:"Shenzhen, Guangdong Province",cities:["深圳"]});expect(result.jobs[0]?.officialPublishedAt??null).toBeNull();});
 it('accepts a consistent reviewed city option instead of inventing a country field',async()=>{const changed=row.replaceAll('Shenzhen, Guangdong Province','Shanghai, Shanghai').replace('--china','--shanghai').replace('>China<','>Shanghai<');expect((await execute(html(changed))).result.truth.completenessVerified).toBe(true);});
 for(const [name,mutate] of Object.entries(attacks))it(`blocks ${name} through actual main replay`,async()=>{const changed=mutate(row);expect(changed).not.toBe(row);expect(validateAbbvieChinaRowScope(changed)).toBe(false);const {fetched,result}=await execute(html(changed));expect(validateStrictHtmlCompletenessProof(plan,fetched.fetchEvidence!)).toBe(false);expect(result.truth.completenessVerified).toBe(false);});
 it.each([
  ["Hohhot, Inner Mongolia","呼和浩特"],["Ürümqi, Xinjiang","乌鲁木齐"],
  ["Shijiazhuang, Hebei","石家庄"],["Zhanjiang, Guangdong Province","湛江"],
  ["Xi'An, Shaanxi","西安"],["Shanghai, Shanghai","上海"],["Beijing, Beijing","北京"]
 ])('maps the reviewed city only while preserving its raw province: %s',(raw,city)=>{
  expect(reviewedAbbvieCity(raw)).toBe(city);
 });
 it('never turns foreign, province-only, or mismatched values into a city',()=>{
  for(const raw of ['Boston, Guangdong Province','Guangdong Province','Shenzhen, Shanghai','China','2 Locations'])expect(reviewedAbbvieCity(raw)).toBeUndefined();
 });
 it('does not infer official zero from the absence of a valid reviewed row',()=>{expect(validateAbbvieChinaRowScope('')).toBe(false);});
 it('requires the exact reviewed plan rather than a changed location selector',async()=>{const {fetched}=await execute(html());const changed=structuredClone(plan);changed.table.fields.locationRaw={value:'Shanghai'};expect(validateStrictHtmlCompletenessProof(changed,fetched.fetchEvidence!)).toBe(false);});
});
