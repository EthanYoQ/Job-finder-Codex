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
