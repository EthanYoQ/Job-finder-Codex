/** Executes only the generated disabled API, never an installer or LIVE body. */
import fs from 'node:fs';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
const source=fs.readFileSync(new URL('./functions-entry.js',import.meta.url),'utf8');let calls=0;
const tools=new Proxy({}, {get(){return ()=>{calls++;throw Error('DISABLED_TOOL_CALL');};}});
const api=new Function('tools',source)(tools);assert.deepEqual(Object.keys(api),['runLiveRound']);assert.equal(Object.isFrozen(api),true);
const result=await api.runLiveRound();assert.deepEqual(result,{status:'DISABLED',reason:'LIVE_DEPLOYMENT_NOT_ACTIVATED',realToolCalls:0,productionQualified:false});assert.equal(calls,0);
await assert.rejects(api.runLiveRound('source-biogen-china-social'),/FIXED_ENTRY_NO_ARGUMENTS/);assert.equal(calls,0);
assert(source.includes("SOURCE='source-hengrui-social'"));assert(source.includes('hengrui-run-with-owned-publication-pipe.mjs')===false); // Runner lives in the separately pinned preimport CLI.
console.log(JSON.stringify({kind:'HENGRUI_GENERATED_DISABLED_ENTRY',passed:true,cases:8,sha256:createHash('sha256').update(source).digest('hex'),toolCalls:calls,productionQualified:false}));
