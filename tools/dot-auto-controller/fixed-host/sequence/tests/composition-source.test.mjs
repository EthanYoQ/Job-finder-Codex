/** Pure source construction checks only. Does not execute a native fixture or business round. */
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {withKnownNotDispatchedScenarios} from '../../tests/source-seal-harness.mjs';
const driver=fs.readFileSync(new URL('./generated-composition.test.mjs',import.meta.url),'utf8');
const originalHarness=fs.readFileSync(new URL('../../tests/full-composition-v8-harness.js',import.meta.url),'utf8');
const start=driver.indexOf('function replaceOnce('),end=driver.indexOf('const portFactory=');assert(start>0&&end>start);
const IDS={takeda:'source-takeda-china-social',biogen:'source-biogen-china-social',hengrui:'source-hengrui-social',ucb:'source-ucb-china-social',viatris:'source-viatris-social'};
const factory=new Function('assert','withKnownNotDispatchedScenarios','originalHarness','release','IDS',driver.slice(start,end)+'\nreturn sourcePortCode;')(assert,withKnownNotDispatchedScenarios,originalHarness,{profiles:{takeda:{candidate:{id:'SYNTHETIC_SOURCE_CONSTRUCTION_ONLY'}}}},IDS);
const AF=Object.getPrototypeOf(async function(){}).constructor;
for(const source of Object.keys(IDS))test('constructs exact existing harness for '+source+' without running native fixture',()=>{const code=factory(source);assert.doesNotThrow(()=>new AF('fixtureData','digestSource','mode','deploymentInfo','profile','scenarioName','externalPending',code));assert(code.includes(IDS[source]));if(source==='viatris'){assert(code.includes('JOBFINDER_VIATRIS_PUBLIC_UI_V1'));assert(code.includes('companyPresent:true,jobs:jobs.map'));assert(!code.includes('biibhr.wd3'));assert(!code.includes('sourceJobId:p.officialUrl.slice'));}});
test('driver includes five native fixture inputs and UCB-to-Viatris and Viatris tail barriers',()=>{for(const label of ['FIVE_SOURCE_FIXTURE_PATHS_REQUIRED','ucb-original-publication-promise-before-viatris','ucb-original-service-after-terminal-before-viatris','viatris-original-publication-promise-before-close','viatris-original-service-after-terminal-before-close','create_viatris','ACTUAL_FIVE_SOURCE_GENERATED_ENTRY_SYNTHETIC_PORT_COMPOSITION'])assert(driver.includes(label));});
