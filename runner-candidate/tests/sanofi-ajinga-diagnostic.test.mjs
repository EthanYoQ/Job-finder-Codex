import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,readdir,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {captureSanofiChineseAjinga,replaySanofiChineseAjinga} from '../src/crawler/sanofiChineseAjinga.ts';
import {sourceFetchDiagnostic} from '../src/crawler/sourceFetchDiagnostics.ts';

const marker='PRIVATE_AJINGA_TOKEN_SYNTHETIC';
const start='2026-10-31T10:00:00.000Z',reqId='R1234567';
const detail={id:'123',reqId,title:'合成职位',countryScope:'MAINLAND',description:'本职位职责',
  applyUrl:`https://www.ajinga.com/ats/job-detail-new/13537/${reqId}/c/?aj_source=sanofi_careersite&aj_code=radancyjoblist`};
function transport(failure,title=detail.title){
  let count=0;
  return async({url})=>{
    count++;
    const info={code:200,data:{data:{is_in_china:true,company:{id:13537,root_company:{id:13537}},
      job:{id:42,root_company_id:13537,company:{id:13537},short_unique_id:'Synthetic42',
        i18n_name:`${reqId} ${title}`,
        description:`<p>${detail.description}</p>`,
        job_visibility:'E',job_locations:[{city:{cn_name:'上海'}}]},privateToken:marker}}};
    const status={code:200,data:{show_apply:failure==='PROJECTION'?0:1,normal_share_url:'https://www.ajinga.com/recruiting/company/13537/job/42/job-detail'}};
    return {status:failure===['ENTRY','INFO','STATUS'][count-1]?503:200,
      finalUrl:count===1?'https://www.ajinga.com/recruiting/company/13537/job/42/job-detail':url,
      contentType:count===1?'text/html':'application/json',capturedAt:start,
      body:count===1?`<html>${marker}</html>`:JSON.stringify(count===2?info:status)};
  };
}

for(const [failure,count] of [['ENTRY',1],['INFO',2],['STATUS',3],['PROJECTION',3]])
test(`Sanofi Ajinga ${failure} failure retains acquired originals privately without changing rejection`,async()=>{
  const directory=await mkdtemp(join(tmpdir(),'sanofi-ajinga-'));
  try {
    let error;
    await assert.rejects(captureSanofiChineseAjinga(detail,start,transport(failure),()=>{},
      {failureDirectory:directory,detailResponse:{body:`<html>${marker} original detail</html>`}}),value=>{
      error=value;return value.message==='SANOFI_CN_AJINGA_CHAIN_INVALID';
    });
    const files=await readdir(directory);assert.equal(files.length,1);
    const bytes=await readFile(join(directory,files[0]));
    const saved=JSON.parse(bytes);
    assert.equal(saved.stage,`SANOFI_AJINGA_${failure}`);
    assert.deepEqual(saved.observation.detail,detail);
    assert.equal(saved.observation.artifacts.length,count);
    assert(saved.observation.detailResponse.body.includes(marker));
    const diagnostic=sourceFetchDiagnostic('source-sanofi-china-social',{error});
    assert.equal(diagnostic.stage,`SANOFI_AJINGA_${failure}`);assert.equal(diagnostic.sourceJobId,reqId);
    assert.deepEqual(diagnostic.privateCapture,{file:files[0],sha256:createHash('sha256').update(bytes).digest('hex')});
    assert(!JSON.stringify(diagnostic).includes(marker));assert(!JSON.stringify(diagnostic).includes(directory));
  } finally {await rm(directory,{recursive:true,force:true});}
});

test('valid Sanofi Ajinga chain stays accepted and creates no failure file',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'sanofi-ajinga-'));
  try {
    const artifacts=await captureSanofiChineseAjinga(detail,start,transport(),()=>{},{failureDirectory:directory});
    assert.equal(artifacts.length,3);assert.deepEqual(await readdir(directory),[]);
  } finally {await rm(directory,{recursive:true,force:true});}
});

test('private file failure preserves the original rejection and reports unavailable capture',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'sanofi-ajinga-'));
  try {
    const file=join(directory,'file');await writeFile(file,'synthetic');
    await assert.rejects(captureSanofiChineseAjinga(detail,start,transport('ENTRY'),()=>{},{failureDirectory:file}),error=>{
      assert.equal(error.privateCaptureUnavailable,true);
      return error.message==='SANOFI_CN_AJINGA_CHAIN_INVALID';
    });
  } finally {await rm(directory,{recursive:true,force:true});}
});

test('Ajinga localized title uses the bound requisition without rewriting the official title',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'sanofi-ajinga-'));
  try {
    const artifacts=await captureSanofiChineseAjinga(detail,start,
      transport(undefined,'Synthetic  role'),()=>{},{failureDirectory:directory});
    assert.equal(artifacts.length,3);assert.deepEqual(await readdir(directory),[]);
  } finally {await rm(directory,{recursive:true,force:true});}
});

test('replacement characters allow the bound job without rewriting originals or field projections',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'sanofi-ajinga-'));
  try {
    const artifacts=await captureSanofiChineseAjinga(detail,start,transport(),()=>{},{failureDirectory:directory});
    const expected=replaySanofiChineseAjinga(detail,start,artifacts);
    for(const description of ['本职位职\uFFFD','官网其他段落含\uFFFD\uFFFD']) {
      const corrupt={...detail,description,datePosted:'2026-10-01',locationRaw:'温州'};
      const before=JSON.stringify({corrupt,artifacts});
      assert.deepEqual(replaySanofiChineseAjinga(corrupt,start,artifacts),expected);
      assert.equal(JSON.stringify({corrupt,artifacts}),before);
      assert.throws(()=>replaySanofiChineseAjinga({...corrupt,reqId:'R7654321'},start,artifacts));
      assert.throws(()=>replaySanofiChineseAjinga({...corrupt,countryScope:'OUTSIDE'},start,artifacts));
    }
    const corruptArtifacts=structuredClone(artifacts);
    const info=JSON.parse(corruptArtifacts[1].body);info.data.data.job.description='<p>职责\uFFFD</p>';
    corruptArtifacts[1].body=JSON.stringify(info);
    assert.equal(replaySanofiChineseAjinga(detail,start,corruptArtifacts).state,'PUBLISHING');
  } finally {await rm(directory,{recursive:true,force:true});}
});
