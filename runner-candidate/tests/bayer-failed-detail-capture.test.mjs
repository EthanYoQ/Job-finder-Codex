import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createCipheriv,createHash} from 'node:crypto';
import {captureBayerIndependentDetails} from '../src/crawler/bayerMokaRenderedTraversal.ts';
import {sourceFetchDiagnostic} from '../src/crawler/sourceFetchDiagnostics.ts';
const start='2026-11-02T17:00:00.000Z',id='00000000-0000-0000-0000-000000000001';
const dom={schemaVersion:'bayer-cua-dom-list-v1',observedAt:start,pages:[{url:'https://app.mokahr.com/social-recruitment/bayer/148387?locale=zh-CN#/jobs?283170[0]=Pharmaceuticals&283170[1]=Consumer%20Health&page=1',capturedAt:start,summaryText:'已选 1 条件 | 1 结果',pageNumber:1,pageSize:30,nextDisabled:true,selectedDivisions:['Pharmaceuticals','Consumer Health'],paginationHtml:'<button class="Pagination-forward" disabled></button><button class="Pagination-is-active">1</button>',rows:[{href:`#/job/${id}`,titleHtml:'Synthetic role',publishedHtml:'发布于 2026-11-02'}]}]};
const entry=`<input id="init-data" value='${JSON.stringify({org:{id:'bayer'},siteId:'148387',mode:'social',aesIv:'0123456789abcdef'})}'>`;
function transport(){
 const detail={id,orgId:'bayer',title:'Synthetic role',status:'open',publishedAt:'2026-11-02',locations:[],customFields:{'283170':{name:'Division',value:'Pharmaceuticals'},'290891':{name:'国家',value:'China'},'289157':{name:'城市',value:'Unreviewed locality'}}};
 const cipher=createCipheriv('aes-128-cbc',Buffer.from('0123456789abcdef'),Buffer.from('0123456789abcdef'));
 const body=JSON.stringify({necromancer:'0123456789abcdef',data:Buffer.concat([cipher.update(JSON.stringify({success:true,data:detail})),cipher.final()]).toString('base64')});
 return async({url,method})=>({status:200,finalUrl:url,capturedAt:start,body:method==='GET'?entry:body});
}
test('Bayer scope rejection retains acquired originals privately without changing rejection',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'bayer-failed-'));
 try {
  let error;await assert.rejects(captureBayerIndependentDetails({dom,http:transport(),now:()=>new Date(start),failureDirectory:directory}),e=>{error=e;return e.message==='Bayer missing location lacks a reviewed official city field';});
  const files=await readdir(directory);assert.equal(files.length,1);
  const bytes=await readFile(join(directory,files[0])),saved=JSON.parse(bytes);
  assert.equal(saved.observation.entry.body,entry);assert.equal(saved.observation.domRow.href,`#/job/${id}`);
  assert.equal(error.privateCapture.sha256,createHash('sha256').update(bytes).digest('hex'));
  const diagnostic=sourceFetchDiagnostic('source-bayer-healthcare-social',{error});
  assert.deepEqual(diagnostic.privateCapture,error.privateCapture);
  assert(!JSON.stringify(diagnostic).includes(entry));assert(!JSON.stringify(diagnostic).includes(directory));
 }finally{await rm(directory,{recursive:true,force:true});}
});
