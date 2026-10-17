import{describe,it,expect}from"vitest";
import{createSanofiNativeSourceFetch,parseSanofiDetail}from"../../src/crawler/sanofiNativeQuality";
import{candidateCompanies}from"../../src/data/companyRegistry";
import{buildStagedSourceCrawlPlans}from"../../src/crawler/sourcePlan";
const time="2026-10-02T14:00:00.000Z";
const detailUrl=(cn:boolean,id:number)=>new URL(`https://jobs.sanofi.${cn?"cn":"com"}/${cn?"工作":"en/job"}/role/${cn?3036:2649}/${id}`).toString();
function detail(cn:boolean,id:number,req:string,country="China"){const url=detailUrl(cn,id);return `<script type="application/ld+json">${JSON.stringify({"@type":"JobPosting",identifier:{value:req},title:`Role ${req}`,url,datePosted:"2026-09-30",hiringOrganization:{name:cn?"General Medicines":"Sanofi"},description:`Role responsibilities ${req}`,jobLocation:[{address:{addressCountry:country,addressLocality:"Beijing"}}]})}</script><main id="content"><div class="job-description section7-title"><h1>Role ${req}</h1><a data-job-id="${id}" data-selector-name="job-apply-link" href="https://careersite.tupu360.com/sanofi/position/detail?exid=${req}">Apply</a></div><div class="job-description section7-details"><div class="ats-description">Role responsibilities ${req}</div></div></main>`;}
describe("Sanofi historical strict-parser regression and retired acquisition",()=>{
 it("preserves the Chinese larger universe and classifies official foreign locations",()=>{
  expect(parseSanofiDetail(detail(true,202,"R1000002","Taiwan"),detailUrl(true,202),"202")?.scope).toBe("OUTSIDE");
  expect(parseSanofiDetail(detail(true,200,"R1000000"),detailUrl(true,200),"200")?.scope).toBe("MAINLAND");
 });
 it("binds the apply button to its own requisition despite a stale footer link",()=>{
   const html=detail(true,200,"R1000000")+'<a data-selector-name="job-apply-link" href="https://careersite.tupu360.com/sanofi/position/detail?exid=R9999999">Apply</a>';
   expect(parseSanofiDetail(html,detailUrl(true,200),"200")?.applyUrl).toBe("https://careersite.tupu360.com/sanofi/position/detail?exid=R1000000");
 });
 it("rejects an English main apply link belonging to a different requisition",()=>{
   const html=detail(false,100,"R1000000").replace("exid=R1000000","exid=R9999999");
   expect(parseSanofiDetail(html,detailUrl(false,100),"100")).toBeUndefined();
 });
 it.each([
  ["foreign main title",(s:string)=>s.replace('<h1>Role R1000000</h1>','<h1>Other job</h1>')],
  ["foreign main JD",(s:string)=>s.replace('<div class="ats-description">Role responsibilities R1000000</div>','<div class="ats-description">Other job in France</div>')],
  ["wrong apply button ID",(s:string)=>s.replace('data-job-id="100"','data-job-id="999"')],
  ["wrong data apply URL",(s:string)=>s.replace('data-job-id="100"','data-job-id="100" data-apply-url="https://careersite.tupu360.com/sanofi/position/detail?exid=R9999999"')],
  ["duplicate main JD",(s:string)=>s.replace('</main>','<div class="job-description section7-details"><div class="ats-description">Role responsibilities R1000000</div></div></main>')],
  ["conflicting main body apply",(s:string)=>s.replace('</div></div></main>','</div><a data-job-id="999" data-selector-name="job-apply-link" href="https://careersite.tupu360.com/sanofi/position/detail?exid=R9999999">Apply</a></div></main>')]
 ])("rejects %s despite matching JSON-LD",(_name,mutate)=>{
  expect(parseSanofiDetail(mutate(detail(false,100,"R1000000")),detailUrl(false,100),"100")).toBeUndefined();
 });
 it("retires the dual English/Chinese acquisition policy from the current plan",async()=>{
   const plan=buildStagedSourceCrawlPlans(candidateCompanies).find(p=>p.source.id==="source-sanofi-china-social")!;
   let calls=0;
   const fetched=await createSanofiNativeSourceFetch({now:()=>new Date(time),http:async()=>{calls++;throw Error("unexpected historical fetch");}})(plan);
   expect(fetched).toMatchObject({ok:false,failureReason:"SANOFI_NATIVE_PLAN_INVALID"});
   expect(calls).toBe(0);
 });
});
