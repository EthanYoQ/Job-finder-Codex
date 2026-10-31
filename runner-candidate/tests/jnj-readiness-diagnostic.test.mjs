import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {captureOfficialDom} from '../src/crawler/local-browser/official-dom.mjs';
import {sourceFetchDiagnostic} from '../src/crawler/sourceFetchDiagnostics.ts';
import {createJnjDomRuntime} from '../src/crawler/local-browser/jnj-browser-runtime.mjs';

for(const status of [403,429])test(`navigation timeout retains known HTTP ${status} without retrying`,async()=>{
  const directory=await mkdtemp(join(tmpdir(),'jnj-navigation-access-'));
  let navigations=0,closes=0;
  const tab={async goto(){navigations++;throw Object.assign(Error('page.goto: Timeout 30000ms exceeded.'),{name:'TimeoutError'});},
    async url(){return 'https://www.careers.jnj.com/en/jobs/';},async navigationInfo(){return {httpStatus:status,retryAfter:'120'};},
    async close(){closes++;},playwright:{async evaluate(){return {capture:'synthetic'};}}};
  const runtime=createJnjDomRuntime({async createBrowserTab(){return tab;}},{failureDirectory:directory});
  try {await assert.rejects(runtime.start(),error=>{
    assert.equal(error.message,`JNJ_HTTP_${status}`);
    assert.equal(error.transportFailure.code,status===429?'OFFICIAL_HTTP_429':'OFFICIAL_BROWSER_SESSION_ERROR');
    assert.equal(error.transportFailure.retryAfterMs,status===429?120000:undefined);
    assert(error.privateCapture);return true;
  });}finally{await runtime.close();}
  assert.equal(navigations,1);assert.equal(closes,1);
});

for(const stage of ['JNJ_LIST_NAVIGATION','JNJ_RESULTS_READY','JNJ_HEADING_READY']) {
  test(`JNJ preserves original timeout and fixed ${stage} without exposing page data`,{timeout:2000},async()=>{
    const directory=await mkdtemp(join(tmpdir(),'jnj-list-private-')),previousRoot=process.env.JOBFINDER_STATE_ROOT;
    process.env.JOBFINDER_STATE_ROOT=directory;
    try {
    const secret='SYNTHETIC_PRIVATE_MARKER';
    const error=Object.assign(Error('locator.waitFor: Timeout 30000ms exceeded. '+secret),{name:'TimeoutError'});
    let closes=0,created=0;
    const tab={async goto(){if(stage==='JNJ_LIST_NAVIGATION')throw error;},async close(){closes++;},async url(){return 'https://example.invalid/?private='+secret;},playwright:{
      locator:()=>({async waitFor(){if(stage==='JNJ_RESULTS_READY')throw error;}}),
      getByRole:()=>({async waitFor(){throw error;}}),async domSnapshot(){return new Promise(()=>{});},
      async evaluate(){return {html:'<html>'+secret+'</html>',navigationStatus:200,resultCount:0};}}};
    const cua={async createBrowserTab(){created++;return tab;}};
    await assert.rejects(captureOfficialDom('source-johnson-innovative-medicine-social',cua),actual=>actual===error);
    assert.equal(created,stage==='JNJ_LIST_NAVIGATION'?1:2);assert.equal(closes,created);
    const report=sourceFetchDiagnostic('source-johnson-innovative-medicine-social',{error});
    assert.equal(report.stage,stage);assert.equal(report.exceptionType,'TimeoutError');assert.equal(report.reason,'BROWSER_WAIT_TIMEOUT');
    assert.equal(report.page,1);assert.match(report.privateCapture.file,/^jnj-list-1-/);
    const bytes=await readFile(join(directory,'diagnostics','jnj',report.privateCapture.file)),saved=JSON.parse(bytes);
    assert.equal(createHash('sha256').update(bytes).digest('hex'),report.privateCapture.sha256);
    assert.equal(saved.kind,'JNJ_FAILED_LIST_DIAGNOSTIC_NOT_PUBLICATION_EVIDENCE');
    if(stage!=='JNJ_LIST_NAVIGATION')assert(!Object.hasOwn(saved.legacyObservation,'dom'));
    assert.equal(saved.observation.html,'<html>'+secret+'</html>');
    assert.equal(saved.observation.navigationStatus,200);
    if(stage==='JNJ_LIST_NAVIGATION'){assert.equal(saved.errorMessage,error.message);assert(saved.url.includes(secret));}
    assert(!JSON.stringify(report).includes(secret));
    } finally {if(previousRoot===undefined)delete process.env.JOBFINDER_STATE_ROOT;else process.env.JOBFINDER_STATE_ROOT=previousRoot;}
  });
}
