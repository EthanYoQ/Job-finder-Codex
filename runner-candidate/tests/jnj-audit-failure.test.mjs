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
const apply=`https://careers.jnj.com.cn/jnj/apply?exid=${id.toUpperCase()}&m=1`;
const marker='PRIVATE_AUDIT_OBSERVATION_MARKER';
function fixture() {
 const heading='Displaying 1 to 1 of 1 matching jobs';
 const html=`<ul id="js-job-search-results" data-results="1"><li class="PageList-items-item card-job" data-id="${id}"><a href="${url}">${title}</a><div class="PagePromo-category">Pharmaceutical Sales</div><address class="PagePromo-location">Guiyang</address></li></ul>`;
 const body=`<div id="js-job-detail" data-id="${id}" data-jobtitle="${title}"><article class="RichTextBody"><ul class="job-meta"><li>Job title<span>${title}</span></li><li>Function<span>Pharmaceutical Sales</span></li><li>Location<span>Guiyang / China</span></li><li>Requisition number<span>${id.toUpperCase()}</span></li></ul><h2>Description</h2><p>Job Description: ${'Scientific responsibilities and collaboration. '.repeat(8)}</p></article></div>`;
 const base={kind:'BROWSER_UI_DOM_OBSERVATION_NOT_HTTP',observedAt:'2026-11-04T23:00:00.000Z'};
 return {list:{...base,url:listUrl,heading,fragment:{html,htmlLength:html.length,items:[{text:title,links:[{title,url}]}]},
  filters:['team','subteam','country','state','location','type','pattern'].map(name=>({id:name,name,selectedOptions:name==='country'?[{text:'China',value:'China'}]:[]})),pagination:[{label:'Page 1',url:listUrl}],
  dom:`- option "China" [selected]\n${heading}\n${url}`},
 detail:{...base,url,expectedUrl:url,expectedTitle:title,heading:title,body:{html:body,htmlLength:body.length,text:id+' Description'},applyLinks:[{text:'Apply now',href:apply}],dom:`${id}\n- link "Apply now"\n${apply}`}};
}
for(const failure of ['list','detail','disk'])test(`JNJ audit ${failure} failure retains context without publishing or logging private DOM`,async()=>{
 const root=await mkdtemp(join(tmpdir(),'jnj-audit-')),input=fixture(),oldRoot=process.env.JOBFINDER_STATE_ROOT,originalLog=console.error,logs=[];
 if(failure==='list')input.list.url=listUrl.replace('country=China','country=Japan');
 else input.detail.heading='Different title';
 input.list.dom+=marker;input.detail.dom+=marker;
 const lists=[JSON.stringify(input.list)],details=[JSON.stringify(input.detail)];
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
  assert.equal(failure==='list'?diagnostic.page:diagnostic.sourceJobId,failure==='list'?1:id);
  const directory=join(root,'diagnostics','jnj'),files=await readdir(directory);assert.equal(files.length,1);
  assert.equal(diagnostic.privateCapture.file,files[0]);
  const saved=JSON.parse(await readFile(join(directory,files[0]),'utf8'));
  assert.equal(saved.kind,'JNJ_FAILED_AUDIT_DIAGNOSTIC_NOT_PUBLICATION_EVIDENCE');
  assert.deepEqual(saved.observation.lists,lists);
  assert.equal(saved.observation.failedObservation,failure==='list'?lists[0]:details[0]);
 } finally {console.error=originalLog;if(oldRoot===undefined)delete process.env.JOBFINDER_STATE_ROOT;else process.env.JOBFINDER_STATE_ROOT=oldRoot;}
});
test('valid synthetic JNJ observations retain successful audit behavior',async()=>{
 const input=fixture(),result=await createJnjCareersDomSourceFetch({lists:[JSON.stringify(input.list)],details:[JSON.stringify(input.detail)]})(plan);
 assert.equal(result.ok,true);assert.equal(result.completeness.expectedJobCount,1);
});
