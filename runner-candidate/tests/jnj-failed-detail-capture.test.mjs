import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,readdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {createJnjDomRuntime} from '../src/crawler/local-browser/jnj-browser-runtime.mjs';
import {sourceFetchDiagnostic} from '../src/crawler/sourceFetchDiagnostics.ts';

const listUrl='https://www.careers.jnj.com/en/jobs/?country=China&origin=global#results';
const detailUrl='https://www.careers.jnj.com/en/jobs/r-123456/synthetic-role/';
const marker='PRIVATE_DOM_SYNTHETIC_MARKER';
function fixture(directory,{applyFailure=false,captureFailure=false}={}) {
  const error=Object.assign(Error('locator.waitFor: Timeout 30000ms exceeded.'),{name:'TimeoutError'});
  const list={async close(){},async url(){return listUrl;},playwright:{
    locator:()=>({async waitFor(){},async evaluate(){return {html:'synthetic',htmlLength:9,items:[{text:'Synthetic role',links:[{title:'Synthetic role',url:detailUrl}]}]};},
      async evaluateAll(){return ['team','subteam','country','state','location','type','pattern'].map(name=>({name,selectedOptions:name==='country'?[{text:'China',value:'China'}]:[]}));}}),
    getByRole:role=>({async waitFor(){},async innerText(){return 'Displaying 1 to 1 of 1 matching jobs';},async evaluateAll(){return [];}}),
    async domSnapshot(){return 'synthetic list';}}};
  const detail={async close(){},async goto(url){assert.equal(url,detailUrl);return {status:()=>200};},async getAXState(){},
    playwright:{locator:()=>({async waitFor(){if(!applyFailure)throw error;}}),getByRole:()=>({async waitFor(){throw error;}}),
      async evaluate(){if(captureFailure)throw Error(marker);return {url:detailUrl+'?private='+marker,title:'Synthetic failure page',readyState:'complete',detailCount:0,applyLinks:[],html:'<body>'+marker+'</body>'};}}};
  let tabIndex=0;
  const runtime=createJnjDomRuntime({async createBrowserTab(){return tabIndex++===0?list:detail;}},{failureDirectory:directory});
  return {error,async run(){await runtime.start();await runtime.readList();await runtime.readDetail(0);}};
}
for(const applyFailure of [false,true])test(`failed ${applyFailure?'apply':'detail'} readiness saves private DOM and preserves unknown source failure`,async()=>{
  const directory=await mkdtemp(join(tmpdir(),'jnj-private-capture-')),setup=fixture(directory,{applyFailure});
  await assert.rejects(setup.run(),error=>error===setup.error);
  const files=await readdir(directory);assert.equal(files.length,1);
  const bytes=await readFile(join(directory,files[0])),saved=JSON.parse(bytes);
  assert.equal(saved.kind,'JNJ_FAILED_DETAIL_DIAGNOSTIC_NOT_PUBLICATION_EVIDENCE');assert.equal(saved.sourceJobId,'r-123456');
  assert.equal(saved.detailIndex,0);assert.equal(saved.completedDetails,0);assert.equal(saved.total,1);
  assert.equal(saved.navigationStatus,200);
  assert(saved.observation.html.includes(marker));assert(!Object.hasOwn(saved,'applicationState'));
  const diagnostic=sourceFetchDiagnostic('source-johnson-innovative-medicine-social',{error:setup.error});
  assert.equal(diagnostic.stage,applyFailure?'JNJ_APPLY_READY':'JNJ_DETAIL_READY');assert.equal(diagnostic.sourceJobId,'r-123456');
  assert.equal(diagnostic.privateCapture.file,files[0]);assert.equal(diagnostic.privateCapture.sha256,createHash('sha256').update(bytes).digest('hex'));
  assert(!JSON.stringify(diagnostic).includes(marker));assert(!JSON.stringify(diagnostic).includes(directory));
});
test('browser capture failure still saves metadata and disk failure never replaces the original source error',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'jnj-private-capture-')),setup=fixture(directory,{captureFailure:true});
  await assert.rejects(setup.run(),error=>error===setup.error);
  const saved=JSON.parse(await readFile(join(directory,(await readdir(directory))[0]),'utf8'));
  assert.deepEqual(saved.observation,{captureUnavailable:true});
  const blocked=join(directory,'ordinary-file');await writeFile(blocked,'synthetic');
  const noDisk=fixture(blocked);await assert.rejects(noDisk.run(),error=>error===noDisk.error);
  assert.equal(sourceFetchDiagnostic('source-johnson-innovative-medicine-social',{error:noDisk.error}).privateCaptureUnavailable,true);
});
