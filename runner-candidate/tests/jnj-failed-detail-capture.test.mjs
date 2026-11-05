import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,readdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {createJnjDomRuntime} from '../src/crawler/local-browser/jnj-browser-runtime.mjs';
import {sourceFetchDiagnostic} from '../src/crawler/sourceFetchDiagnostics.ts';

const listUrl='https://www.careers.jnj.com/en/jobs/?country=China&origin=global#results';
const detailUrl='https://www.careers.jnj.com/en/jobs/r-123456/synthetic-role/';
const marker='PRIVATE_DOM_SYNTHETIC_MARKER';
function fixture(directory,{applyFailure=false,captureFailure=false,readFailures,wrongIdentity=false,accessProbe,onDetailClose,onNavigate,onReadyWait}={}) {
  const error=Object.assign(Error('locator.waitFor: Timeout 30000ms exceeded.'),{name:'TimeoutError'});
  const navigationError=Error('locator.evaluateAll: Execution context was destroyed, most likely because of a navigation');
  let reads=0,navigations=0,diagnosticReads=0;
  const readyWaits=[];
  const list={async goto(url){assert.equal(url,listUrl);},async close(){},async url(){return listUrl;},playwright:{
    locator:()=>({async waitFor(){},async evaluate(){return {html:'synthetic',htmlLength:9,items:[{text:'Synthetic role',links:[{title:'Synthetic role',url:detailUrl}]}]};},
      async evaluateAll(){return ['team','subteam','country','state','location','type','pattern'].map(name=>({name,selectedOptions:name==='country'?[{text:'China',value:'China'}]:[]}));}}),
    getByRole:role=>({async waitFor(){},async innerText(){return 'Displaying 1 to 1 of 1 matching jobs';},async evaluateAll(){return [];}}),
    async domSnapshot(){return 'synthetic list';}}};
  const detail={async close(){await onDetailClose?.();},async url(){return detailUrl;},
    ...(accessProbe?{async navigationInfo(){return {httpStatus:200};}}:{}),
    async goto(url){navigations++;assert.equal(url,detailUrl);await onNavigate?.();return {status:()=>200};},async getAXState(){throw Error('Unused ARIA snapshot must not run');},
    playwright:{locator:()=>({async waitFor(){readyWaits.push('detail');await onReadyWait?.('detail');if(readFailures===undefined&&!applyFailure)throw error;},async innerText(){return wrongIdentity?'Different role':'Synthetic role';},async evaluate(){return {html:'synthetic',htmlLength:9,text:'Synthetic role'};}}),
      getByRole:()=>({async waitFor(){readyWaits.push('apply');await onReadyWait?.('apply');if(readFailures===undefined)throw error;},async evaluateAll(){if(++reads<=readFailures)throw navigationError;return [{text:'Apply now',href:'https://careers.jnj.com.cn/jnj/apply?exid=R-123456&m=1'}];}}),
      async domSnapshot(){return 'synthetic detail';},
      async evaluate(_fn,selector){if(selector==='#js-job-detail')return accessProbe();
        diagnosticReads++;if(captureFailure)throw Error(marker);return {url:detailUrl+'?private='+marker,title:'Synthetic failure page',readyState:'complete',detailCount:0,applyLinks:[],html:'<body>'+marker+'</body>'};}}};
  let tabIndex=0;
  const runtime=createJnjDomRuntime({async createBrowserTab(){return tabIndex++===0?list:detail;}},{failureDirectory:directory});
  return {error,navigationError,readyWaits,get reads(){return reads;},get navigations(){return navigations;},get diagnosticReads(){return diagnosticReads;},
    close:()=>runtime.close(),async run(overallDeadline){await runtime.start(overallDeadline);await runtime.readList();return runtime.readDetail(0);}};
}

test('a hung readiness probe expires without queuing browser work and is settled by cleanup',async t=>{
  t.mock.timers.enable({apis:['Date','setTimeout'],now:Date.UTC(2026,10,5)});
  const directory=await mkdtemp(join(tmpdir(),'jnj-ready-deadline-'));
  t.after(()=>rm(directory,{recursive:true,force:true}));
  let started,rejectProbe,pending=false,probes=0;
  const probeStarted=new Promise(resolve=>{started=resolve;});
  const setup=fixture(directory,{readFailures:0,accessProbe:async()=>{
    probes++;pending=true;started();
    try {await new Promise((_,reject)=>{rejectProbe=reject;});}finally{pending=false;}
  },onDetailClose:()=>{rejectProbe(Error('Target page closed'));}});
  t.after(()=>setup.close());
  let failure;
  const rejected=assert.rejects(setup.run(),error=>{failure=error;return error.message==='JNJ_DETAIL_READY_DEADLINE';});
  await probeStarted;t.mock.timers.tick(60000);await rejected;
  assert.equal(pending,true);assert.equal(probes,1);assert.equal(setup.reads,0);assert.equal(setup.diagnosticReads,0);
  assert.equal(failure.sourceFetchStage,'JNJ_DETAIL_READY');assert.equal(failure.sourceJobId,'r-123456');
  const saved=JSON.parse(await readFile(join(directory,failure.privateCapture.file),'utf8'));
  assert.equal(saved.readinessDeadlineExceeded,true);assert.deepEqual(saved.observation,{captureUnavailable:true});
  await setup.close();assert.equal(pending,false);assert.equal(setup.navigations,1);
});

test('a normal readiness probe completes within the existing deadline',async t=>{
  t.mock.timers.enable({apis:['Date','setTimeout'],now:Date.UTC(2026,10,5)});
  const directory=await mkdtemp(join(tmpdir(),'jnj-ready-normal-'));t.after(()=>rm(directory,{recursive:true,force:true}));
  let probes=0;
  const setup=fixture(directory,{readFailures:0,accessProbe:async()=>{probes++;return false;}});t.after(()=>setup.close());
  assert.equal(JSON.parse((await setup.run()).raw).expectedUrl,detailUrl);
  t.mock.timers.tick(60000);
  assert.equal(probes,1);assert.equal(setup.reads,1);assert.deepEqual(await readdir(directory),[]);
});

test('an expired readiness deadline never starts the probe',async t=>{
  t.mock.timers.enable({apis:['Date','setTimeout'],now:Date.UTC(2026,10,5)});
  const directory=await mkdtemp(join(tmpdir(),'jnj-ready-expired-'));t.after(()=>rm(directory,{recursive:true,force:true}));
  let probes=0;
  const setup=fixture(directory,{readFailures:0,accessProbe:async()=>{probes++;return false;},onNavigate:()=>t.mock.timers.tick(1000)});
  t.after(()=>setup.close());
  await assert.rejects(setup.run(Date.now()+1000),/JNJ_DETAIL_READY_DEADLINE/);
  assert.equal(probes,0);assert.equal(setup.reads,0);assert.equal(setup.diagnosticReads,0);
});

test('a navigation failure preserves its original error before the readiness probe',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'jnj-ready-navigation-'));t.after(()=>rm(directory,{recursive:true,force:true}));
  const navigationError=Error('page.goto: Timeout 30000ms exceeded.');let probes=0;
  const setup=fixture(directory,{readFailures:0,accessProbe:async()=>{probes++;return false;},onNavigate:()=>{throw navigationError;}});
  t.after(()=>setup.close());
  await assert.rejects(setup.run(),error=>error===navigationError);
  assert.equal(navigationError.sourceFetchStage,'JNJ_DETAIL_NAVIGATION');
  assert.equal(probes,0);assert.equal(setup.diagnosticReads,1);assert.equal(setup.navigations,1);
});

for(const stage of ['detail','apply'])for(const elapsed of [59999,60000,60001])for(const outcome of ['return','reject'])
test(`${stage} readiness ${outcome} at ${elapsed}ms respects the existing deadline`,async t=>{
  t.mock.timers.enable({apis:['Date','setTimeout'],now:Date.UTC(2026,10,5)});
  const directory=await mkdtemp(join(tmpdir(),'jnj-ready-boundary-'));t.after(()=>rm(directory,{recursive:true,force:true}));
  const waitError=Object.assign(Error('locator.waitFor: Timeout 30000ms exceeded.'),{name:'TimeoutError'});
  const setup=fixture(directory,{readFailures:0,onReadyWait:current=>{
    if(current===stage){t.mock.timers.tick(elapsed);if(outcome==='reject')throw waitError;}
  }});
  t.after(()=>setup.close());
  if(elapsed<60000&&outcome==='return'){
    assert.equal(JSON.parse((await setup.run()).raw).expectedUrl,detailUrl);
    assert.deepEqual(setup.readyWaits,['detail','apply']);assert.equal(setup.reads,1);
    assert.deepEqual(await readdir(directory),[]);
  }else{
    let failure;
    await assert.rejects(setup.run(),error=>{failure=error;return elapsed<60000?error===waitError:error.message==='JNJ_DETAIL_READY_DEADLINE';});
    assert.equal(failure.sourceFetchStage,stage==='detail'?'JNJ_DETAIL_READY':'JNJ_APPLY_READY');
    assert.deepEqual(setup.readyWaits,stage==='detail'?['detail']:['detail','apply']);
    assert.equal(setup.reads,0);assert.equal(setup.diagnosticReads,elapsed<60000?1:0);assert.equal(setup.navigations,1);
    const saved=JSON.parse(await readFile(join(directory,failure.privateCapture.file),'utf8'));
    if(elapsed<60000){assert.equal(saved.readinessDeadlineExceeded,undefined);assert(saved.observation.html.includes(marker));}
    else {assert.equal(saved.readinessDeadlineExceeded,true);assert.deepEqual(saved.observation,{captureUnavailable:true});}
  }
});

test('navigation during detail read rereads once on the same tab without another navigation',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'jnj-read-navigation-')),setup=fixture(directory,{readFailures:1});
 const captured=JSON.parse((await setup.run()).raw);
 assert.equal(captured.expectedUrl,detailUrl);assert.equal(captured.heading,'Synthetic role');
 assert.equal(setup.reads,2);assert.equal(setup.navigations,1);assert.deepEqual(await readdir(directory),[]);
});

test('persistent navigation still fails and retains the original diagnostic',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'jnj-read-navigation-')),setup=fixture(directory,{readFailures:2});
 await assert.rejects(setup.run(),error=>error===setup.navigationError);
 assert.equal(setup.reads,2);assert.equal(setup.navigations,1);
 assert.equal(sourceFetchDiagnostic('source-johnson-innovative-medicine-social',{error:setup.navigationError}).reason,'BROWSER_NAVIGATION_DURING_DOM_READ');
 assert.equal((await readdir(directory)).length,1);
});

test('a detail identity mismatch is not retried',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'jnj-read-identity-')),setup=fixture(directory,{readFailures:0,wrongIdentity:true});
 await assert.rejects(setup.run(),/JNJ_DOM_DETAIL_IDENTITY/);assert.equal(setup.reads,1);assert.equal(setup.navigations,1);
});
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
