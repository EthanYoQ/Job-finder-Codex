/** Closed offline HTTP data only. Never installed in LIVE or original paths. */
'use strict';
if(process.env.JOBFINDER_FIXED_LOCAL_MODE!=='TEST_ONLY')throw Error('FIXED_FIXTURE_MODE');
globalThis.fetch=async function(url){
 const u=new URL(String(url));
 if(u.origin!=='https://jobs.takeda.com')throw Error('FIXED_FIXTURE_ORIGIN');
 let body,contentType;
 if(u.pathname==='/location/china-jobs/1113/1814991/2'){
  body='<div id="search-results" data-ajax-url="/search-results" data-total-pages="2" data-total-job-results="2" data-records-per-page="1" data-active-facet-id="0"></div><div id="search-filters"></div>';contentType='text/html';
 }else if(u.pathname==='/search-results'){
  const page=Number(u.searchParams.get('CurrentPage'));if(![1,2].includes(page))throw Error('FIXED_FIXTURE_PAGE');const id=10000+page;
  body=JSON.stringify({results:`<div id="search-results" data-current-page="${page}" data-total-pages="2" data-total-job-results="2" data-records-per-page="1"><ul id="search-results-list"><li><button class="js-save-job-btn" data-job-id="${id}"></button><h2 class="title">Role ${id}</h2><a href="https://jobs.takeda.com/job/beijing/role/1113/${id}">Role ${id}</a><span class="job-location location">Beijing, China</span></li></ul></div>`,filters:'<section id="search-filters"><input class="filter-checkbox"></section>',hasJobs:true,hasContent:false});contentType='application/json';
 }else throw Error('FIXED_FIXTURE_PATH');
 return {status:200,url:String(url),headers:new Headers({'content-type':contentType}),text:async()=>body};
};
