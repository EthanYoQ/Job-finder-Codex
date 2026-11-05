import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {captureOfficialDom} from '../src/crawler/local-browser/official-dom.mjs';
import {sourceFetchDiagnostic} from '../src/crawler/sourceFetchDiagnostics.ts';
import {createCspcDomRuntime} from '../src/crawler/local-browser/cspc-browser-runtime.mjs';
import {runInNewContext} from 'node:vm';

for(const mode of ['present','missing','inaccessible'])test(`CSPC failure keeps private root evidence with ${mode} iframe`,async()=>{
 const marker='SYNTHETIC_PRIVATE_IFRAME',error=Error('SYNTHETIC_NAVIGATION_FAILURE');let closed=0;
 const href='https://example.invalid/list?configId=fixture',view={location:{href,origin:'https://example.invalid'},performance:{getEntriesByType:()=>[
   {name:'https://example.invalid/api/jobs?token=SYNTHETIC_QUERY_SECRET',initiatorType:'xmlhttprequest',responseStatus:500,duration:12},
   {name:'https://example.invalid/api/unknown',initiatorType:'fetch',duration:3},
   {name:'https://other.invalid/jobs',initiatorType:'fetch',responseStatus:200},
   {name:'https://example.invalid/script.js',initiatorType:'script',responseStatus:200}
  ]}},frame={readyState:'complete',documentElement:{outerHTML:marker},defaultView:view};
 const context={URL,location:view.location,document:{title:'Synthetic',readyState:'complete',documentElement:{outerHTML:'root'},
  querySelector(){if(mode==='inaccessible')throw Error(marker);return mode==='present'?{contentDocument:frame}:null;}}};
 const tab={async goto(){throw error;},async close(){closed++;},async url(){return href;},
  playwright:{async evaluate(fn){return runInNewContext('('+fn.toString()+')()',context);},async domSnapshot(){return 'snapshot';}}};
 const runtime=createCspcDomRuntime({async createBrowserTab(){return tab;}});
 try{
  await assert.rejects(runtime.start({runStartedAt:new Date().toISOString(),dispatchBefore:new Date(Date.now()+60000).toISOString()}),actual=>actual===error);
  const state=await runtime.failureState();assert.equal(state.page.html,'root');assert.equal(state.domSnapshot,'snapshot');
  const captured=JSON.parse(JSON.stringify(state.page.frame));
  if(mode==='present'){
   assert.equal(captured.html,marker);assert.equal(captured.readyState,'complete');
   assert.deepEqual(captured.requests,[{path:'/api/jobs',status:500,duration:12},{path:'/api/unknown',status:null,duration:3}]);
   assert(!JSON.stringify(captured.requests).includes('SYNTHETIC_QUERY_SECRET'));
  }else{assert.deepEqual(captured,{captureUnavailable:true});}
 }finally{await runtime.close();}
 assert.equal(closed,1);
});

test('CSPC navigation failure saves private page evidence without replacing the original error',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'cspc-private-')),previous=process.env.JOBFINDER_STATE_ROOT;
  const marker='SYNTHETIC_PRIVATE_CSPC_MARKER',error=Error(marker);let closed=0;
  process.env.JOBFINDER_STATE_ROOT=directory;
  try {
    const tab={async goto(){throw error;},async close(){closed++;},async url(){return 'https://example.invalid';},
      async navigationInfo(){return {httpStatus:503};},playwright:{async evaluate(){return {html:marker};},async domSnapshot(){return marker;}}};
    await assert.rejects(captureOfficialDom('source-cspc-social',{async createBrowserTab(){return tab;}}),actual=>actual===error);
    assert.equal(closed,1);
    const report=sourceFetchDiagnostic('source-cspc-social',{error});
    assert.equal(report.stage,'CSPC_DOM_CAPTURE');assert(!JSON.stringify(report).includes(marker));
    const saved=JSON.parse(await readFile(join(directory,'diagnostics','cspc',report.privateCapture.file),'utf8'));
    assert.equal(saved.observation.page.html,marker);assert.equal(saved.observation.navigation.httpStatus,503);
  } finally {if(previous===undefined)delete process.env.JOBFINDER_STATE_ROOT;else process.env.JOBFINDER_STATE_ROOT=previous;}
});
