import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {captureOfficialDom} from '../src/crawler/local-browser/official-dom.mjs';
import {sourceFetchDiagnostic} from '../src/crawler/sourceFetchDiagnostics.ts';

for(const stage of ['JNJ_RESULTS_READY','JNJ_HEADING_READY']) {
  test(`JNJ preserves original timeout and fixed ${stage} without exposing page data`,async()=>{
    const directory=await mkdtemp(join(tmpdir(),'jnj-list-private-')),previousRoot=process.env.JOBFINDER_STATE_ROOT;
    process.env.JOBFINDER_STATE_ROOT=directory;
    try {
    const secret='SYNTHETIC_PRIVATE_MARKER';
    const error=Object.assign(Error('locator.waitFor: Timeout 30000ms exceeded. '+secret),{name:'TimeoutError'});
    let closes=0,created=0;
    const tab={async close(){closes++;},async url(){return 'https://example.invalid/?private='+secret;},playwright:{
      locator:()=>({async waitFor(){if(stage==='JNJ_RESULTS_READY')throw error;}}),
      getByRole:()=>({async waitFor(){throw error;}}),async domSnapshot(){return secret;},
      async evaluate(){return {html:'<html>'+secret+'</html>',navigationStatus:200,resultCount:0};}}};
    const cua={async createBrowserTab(){created++;return tab;}};
    await assert.rejects(captureOfficialDom('source-johnson-innovative-medicine-social',cua),actual=>actual===error);
    assert.equal(created,2);assert.equal(closes,2);
    const report=sourceFetchDiagnostic('source-johnson-innovative-medicine-social',{error});
    assert.equal(report.stage,stage);assert.equal(report.exceptionType,'TimeoutError');assert.equal(report.reason,'BROWSER_WAIT_TIMEOUT');
    assert.equal(report.page,1);assert.match(report.privateCapture.file,/^jnj-list-1-/);
    const bytes=await readFile(join(directory,'diagnostics','jnj',report.privateCapture.file)),saved=JSON.parse(bytes);
    assert.equal(createHash('sha256').update(bytes).digest('hex'),report.privateCapture.sha256);
    assert.equal(saved.kind,'JNJ_FAILED_LIST_DIAGNOSTIC_NOT_PUBLICATION_EVIDENCE');
    assert.equal(saved.legacyObservation.dom,secret);assert.equal(saved.observation.html,'<html>'+secret+'</html>');
    assert.equal(saved.observation.navigationStatus,200);
    assert(!JSON.stringify(report).includes(secret));
    } finally {if(previousRoot===undefined)delete process.env.JOBFINDER_STATE_ROOT;else process.env.JOBFINDER_STATE_ROOT=previousRoot;}
  });
}
