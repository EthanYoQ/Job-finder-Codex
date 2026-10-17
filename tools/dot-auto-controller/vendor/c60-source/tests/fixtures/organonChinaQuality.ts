export const organonBootstrap = {widgetApiEndpoint:"https://jobs.organon.com/widgets",country:"cn",deviceType:"desktop",locale:"zh_cn",refNum:"MECEUS",pageName:"search-results",pageId:"page18-ds"};
const locations = {
  Shanghai: {state:"Shanghai",chinese:"上海",latitude:"31.22222",longitude:"121.45806",workLocation:"CHN - Shanghai - Shanghai",address:"1901 Huashan Lu, One ITC, Shanghai, 200030 Shanghai, China"},
  Wenzhou: {state:"Zhejiang",chinese:"温州",latitude:"27.99942",longitude:"120.66682",workLocation:"CHN - Chengdu",address:"3 Xi Yu Jie, East Tower, Chengdu, 610041 Sichuan, China"}
};
export function organonRow(index = 1, city: keyof typeof locations = "Shanghai", overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const place = locations[city], location = `${city}, ${place.state}, China`, reqId = `R${700000+index}`;
  return {jobSeqNo:`MECEUS${reqId}ZHCN`,jobId:reqId,reqId,title:"Synthetic Manager",country:"China",city,state:place.state,
    cityState:`${city}, ${place.state}`,cityStateCountry:location,location,latitude:place.latitude,longitude:place.longitude,
    workLocation:place.workLocation,address:place.address,multi_location:[location],isMultiLocation:true,
    multi_location_array:[{country:"China",city,state:place.state,cityState:`${city}, ${place.state}`,location,
      cityCountry:`${city}, China`,cityStateCountry:location,mapQueryLocation:location,stateCountry:`${place.state}, China`,
      latitude:place.latitude,longitude:place.longitude,latlong:{lat:Number(place.latitude),lon:Number(place.longitude)}}],
    applyUrl:`https://organon.wd5.myworkdayjobs.com/SearchJobs/job/CHN---${place.state}---${city}/Synthetic-Manager_${reqId}-2/apply`,
    siteType:"external",visibilityType:"External",jobVisibility:["external"],externalApply:true,locale:"zh_CN",
    postedDate:"2026-09-24T00:00:00.000+0000",dateCreated:"2026-09-25T00:13:23.104+0000",
    descriptionTeaser:"Manage commercial teams.",ml_job_parser:{descriptionTeaser:"Manage commercial teams.",descriptionTeaser_ats:"岗位职责"},...overrides};
}

/** Synthetic fixtures only: no copied live job or response body. */
export function organonKeywordEntry(rows: Record<string,unknown>[], options: {bootstrap?:Record<string,unknown>;total?:number;keywords?:string} = {}): string {
  return `<script>var phApp=${JSON.stringify({...organonBootstrap,...options.bootstrap})};phApp.ddo = ${JSON.stringify({eagerLoadRefineSearch:{
    status:200,hits:rows.length,totalHits:options.total??rows.length,data:{keywords:options.keywords??"China",jobs:rows}}})};</script>`;
}
export function organonNativeHtml(raw: Record<string,unknown>, changes: Record<string,unknown> = {}, available = true): string {
  const date=new Date(String(raw.postedDate).replace(/([+-]\d{2})(\d{2})$/u,"$1:$2")).toISOString().slice(0,10);
  return `<script type="application/ld+json">${JSON.stringify({"@type":"JobPosting",identifier:{value:raw.reqId},title:raw.title,
    datePosted:date,description:"<p>Job Description: Manage the commercial team and deliver operational plans.</p>",
    jobLocation:{address:{addressCountry:"China",addressLocality:new URL(raw.applyUrl as string).pathname.split("/")[3]!.replaceAll("---"," - ")}},...changes})}</script>`+
    `<script>window.workday = window.workday || {tenant:"organon",siteId:"SearchJobs",postingAvailable:${available}};</script>`;
}
