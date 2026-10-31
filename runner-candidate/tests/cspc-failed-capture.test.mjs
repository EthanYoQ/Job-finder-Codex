import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {captureOfficialDom} from '../src/crawler/local-browser/official-dom.mjs';
import {sourceFetchDiagnostic} from '../src/crawler/sourceFetchDiagnostics.ts';

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
