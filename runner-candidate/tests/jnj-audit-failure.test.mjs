import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readdir,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createJnjCareersDomSourceFetch} from '../src/crawler/jnjCareersDomEvidence.ts';
import {loadDirectPlans} from '../scripts/direct-round.ts';

const plan=(await loadDirectPlans()).find(row=>row.sourceId==='source-johnson-innovative-medicine-social').plan;
const id='r-000001',title='Synthetic role',url=`https://www.careers.jnj.com/en/jobs/${id}/synthetic-role/`;
const listUrl='https://www.careers.jnj.com/en/jobs/?country=China&origin=global#results';
const marker='PRIVATE_AUDIT_OBSERVATION_MARKER';
function fixture(count=1) {
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
for(const failure of ['list','detail','detail-later','decode','disk','duplicate','schema','unlisted','expected-unlisted','expected-other','missing','missing-extra','missing-extra-multiple','extra','extra-first','extra-multiple'])test(`JNJ audit ${failure} failure retains context without publishing or logging private DOM`,async()=>{
 const root=await mkdtemp(join(tmpdir(),'jnj-audit-')),input=fixture(['duplicate','expected-other','decode','detail-later'].includes(failure)||failure.startsWith('missing')?2:1),oldRoot=process.env.JOBFINDER_STATE_ROOT,originalLog=console.error,logs=[];
 const surplus=failure.startsWith('extra');
 if(failure==='list')input.list.url=listUrl.replace('country=China','country=Japan');
 else if(failure==='detail'||failure==='disk')input.detail.heading='Different title';
 else if(failure==='detail-later')input.details[1].heading='Different title';
 else if(failure==='schema'||failure==='unlisted'){
  input.detail.applyLinks=[];
  if(failure==='unlisted')input.detail.expectedUrl=url.replace(id,'r-999999');
 }
 else if(failure==='expected-unlisted')input.detail.expectedUrl=url.replace(id,'r-999999');
 else if(failure==='expected-other')input.detail.expectedUrl=input.details[1].expectedUrl;
 else if(failure==='duplicate'){
  input.details[1]=structuredClone(input.details[0]);input.details[1].dom+=' REJECTED_DUPLICATE_ONLY';
 }
 else if(failure.startsWith('missing')){
  input.details.shift();
  if(failure!=='missing')input.details.push(...fixture(failure==='missing-extra-multiple'?4:3).details.slice(2));
 }
 else if(surplus){
  const extra=fixture(failure==='extra-multiple'?3:2).details.slice(1);
  if(failure==='extra-first')input.details.unshift(...extra);else input.details.push(...extra);
 }
 input.list.dom+=marker;for(const detail of input.details)detail.dom+=marker;
 const lists=[JSON.stringify(input.list)],details=input.details.map(detail=>JSON.stringify(detail));
 if(failure==='decode')details[1]='{"private":"'+marker+'"';
 if(failure==='disk')await writeFile(join(root,'ordinary-file'),'synthetic');
 process.env.JOBFINDER_STATE_ROOT=failure==='disk'?join(root,'ordinary-file'):root;
 console.error=value=>logs.push(JSON.parse(value));
 try {
  const result=await createJnjCareersDomSourceFetch({lists,details})(plan);
  assert.equal(result.ok,false);assert.equal(result.failureReason,'JNJ_DOM_OBSERVATION_INVALID');
  assert.equal(result.fetchEvidence,undefined);assert.equal(result.payload,undefined);
  assert.equal(logs.length,1);const diagnostic=logs[0];assert.equal(diagnostic.stage,'JNJ_DOM_AUDIT');
  assert(diagnostic.locations.some(value=>value.includes('jnjCareersDomEvidence.ts:')));
  assert(!JSON.stringify(diagnostic).includes(marker));assert(!JSON.stringify(diagnostic).includes(root));
  if(failure==='disk'){assert.equal(diagnostic.privateCaptureUnavailable,true);return;}
  if(failure==='unlisted'||failure==='expected-unlisted'||failure==='decode')assert.equal(diagnostic.sourceJobId,undefined);
  else if(failure==='expected-other'||failure==='detail-later')assert.equal(diagnostic.sourceJobId,'r-000002');
  else if(!surplus)assert.equal(failure==='list'?diagnostic.page:diagnostic.sourceJobId,failure==='list'?1:id);
  const directory=join(root,'diagnostics','jnj'),files=await readdir(directory);assert.equal(files.length,1);
  assert.equal(diagnostic.privateCapture.file,files[0]);
  const saved=JSON.parse(await readFile(join(directory,files[0]),'utf8'));
  assert.equal(saved.kind,'JNJ_FAILED_AUDIT_DIAGNOSTIC_NOT_PUBLICATION_EVIDENCE');
  assert.deepEqual(saved.observation.lists,lists);
  assert.deepEqual(saved.observation.details,details);
  if(failure.startsWith('missing'))assert.deepEqual(saved.observation.failedObservation,{kind:'MISSING_DETAIL_OBSERVATION',sourceJobId:id,expectedUrl:url,...(failure==='missing'?{}:{surplusObservations:details.slice(1)})});
  else if(surplus)assert.deepEqual(saved.observation.failedObservation,{kind:'SURPLUS_DETAIL_OBSERVATIONS',observations:failure==='extra-first'?details.slice(0,-1):details.slice(1)});
  else assert.equal(saved.observation.failedObservation,failure==='list'?lists[0]:['duplicate','decode','detail-later'].includes(failure)?details[1]:details[0]);
 } finally {console.error=originalLog;if(oldRoot===undefined)delete process.env.JOBFINDER_STATE_ROOT;else process.env.JOBFINDER_STATE_ROOT=oldRoot;}
});
for(const count of [1,2])test(`valid ${count}-job synthetic JNJ observations retain successful audit behavior`,async()=>{
 const input=fixture(count),result=await createJnjCareersDomSourceFetch({lists:[JSON.stringify(input.list)],details:input.details.map(detail=>JSON.stringify(detail))})(plan);
 assert.equal(result.ok,true);assert.equal(result.completeness.expectedJobCount,count);
});
