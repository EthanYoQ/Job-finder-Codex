import test from 'node:test';
import assert from 'node:assert/strict';
import {captureOfficialDom} from '../src/crawler/local-browser/official-dom.mjs';
import {sourceFetchDiagnostic} from '../src/crawler/sourceFetchDiagnostics.ts';

for(const stage of ['JNJ_RESULTS_READY','JNJ_HEADING_READY']) {
  test(`JNJ preserves original timeout and fixed ${stage} without exposing page data`,async()=>{
    const secret='SYNTHETIC_PRIVATE_MARKER';
    const error=Object.assign(Error('locator.waitFor: Timeout 30000ms exceeded. '+secret),{name:'TimeoutError'});
    let closes=0,created=0;
    const tab={async close(){closes++;},async url(){return 'https://example.invalid/?private='+secret;},playwright:{
      locator:()=>({async waitFor(){if(stage==='JNJ_RESULTS_READY')throw error;}}),
      getByRole:()=>({async waitFor(){throw error;}}),async domSnapshot(){return secret;}}};
    const cua={async createBrowserTab(){created++;return tab;}};
    await assert.rejects(captureOfficialDom('source-johnson-innovative-medicine-social',cua),actual=>actual===error);
    assert.equal(created,2);assert.equal(closes,2);
    const report=sourceFetchDiagnostic('source-johnson-innovative-medicine-social',{error});
    assert.equal(report.stage,stage);assert.equal(report.exceptionType,'TimeoutError');assert.equal(report.reason,'BROWSER_WAIT_TIMEOUT');
    assert(!JSON.stringify(report).includes(secret));
  });
}
