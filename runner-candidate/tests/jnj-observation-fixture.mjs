const title='Synthetic role';
const listUrl='https://www.careers.jnj.com/en/jobs/?country=China&origin=global#results';
export function fixture(count=1) {
 const rows=Array.from({length:count},(_,i)=>{const id=`r-${String(i+1).padStart(6,'0')}`;return {id,url:`https://www.careers.jnj.com/en/jobs/${id}/synthetic-role/`,apply:`https://careers.jnj.com.cn/jnj/apply?exid=${id.toUpperCase()}&m=1`};});
 const heading=`Displaying 1 to ${count} of ${count} matching jobs`;
 const html=`<ul id="js-job-search-results" data-results="${count}">${rows.map(({id,url})=>`<li class="PageList-items-item card-job" data-id="${id}"><a href="${url}">${title}</a><div class="PagePromo-category">Pharmaceutical Sales</div><address class="PagePromo-location">Guiyang</address></li>`).join('')}</ul>`;
 const base={kind:'BROWSER_UI_DOM_OBSERVATION_NOT_HTTP',observedAt:'2026-11-04T23:00:00.000Z'};
 const details=rows.map(({id,url,apply})=>{
  const body=`<div id="js-job-detail" data-id="${id}" data-jobtitle="${title}"><article class="RichTextBody"><ul class="job-meta"><li>Job title<span>${title}</span></li><li>Function<span>Pharmaceutical Sales</span></li><li>Location<span>Guiyang / China</span></li><li>Requisition number<span>${id.toUpperCase()}</span></li></ul><h2>Description</h2><p>Job Description: ${'Scientific responsibilities and collaboration. '.repeat(8)}</p></article></div>`;
  return {...base,url,expectedUrl:url,expectedTitle:title,heading:title,body:{html:body,htmlLength:body.length,text:id+' Description'},applyLinks:[{text:'Apply now',href:apply}],dom:`${id}\n- link "Apply now"\n${apply}`};
 });
 return {list:{...base,url:listUrl,heading,fragment:{html,htmlLength:html.length,items:rows.map(({url})=>({text:title,links:[{title,url}]}))},
  filters:['team','subteam','country','state','location','type','pattern'].map(name=>({id:name,name,selectedOptions:name==='country'?[{text:'China',value:'China'}]:[]})),pagination:[{label:'Page 1',url:listUrl}],
  dom:`- option "China" [selected]\n${heading}\n${rows.map(row=>row.url).join('\n')}`},detail:details[0],details};
}
