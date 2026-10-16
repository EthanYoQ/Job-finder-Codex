/** Executes generated disabled APIs only, with zero external calls. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const tools = new Proxy({}, {get(){return () => {throw Error('DISABLED_TOOL_CALL');};}});
for (const [file, method, expected] of [
  ['functions-entry.js','runLiveRound',{status:'DISABLED',reason:'LIVE_DEPLOYMENT_NOT_ACTIVATED',realToolCalls:0,productionQualified:false}],
  ['functions-loader.js','runPinnedRound',{status:'DISABLED',reason:'LIFECYCLE_BINDING_UNQUALIFIED',realToolCalls:0,productionQualified:false}],
  ['functions-activate.js','activateFixedDeployment',{status:'DISABLED',reason:'LIFECYCLE_ACTIVATION_UNQUALIFIED',artifactWrites:0}],
]) {
  test(file + ' is standalone, frozen and default disabled', async () => {
    const source=fs.readFileSync(new URL(file,import.meta.url),'utf8');
    const api=new Function('tools',source)(tools);
    assert.deepEqual(Object.keys(api),[method]);assert.equal(Object.isFrozen(api),true);
    assert.deepEqual(await api[method](),expected);
    await assert.rejects(api[method]('source-ucb-china-social'),/NO_ARGUMENTS/);
  });
}
test('entry binds only Viatris and cannot choose a caller source or deployment',()=>{
  const source=fs.readFileSync(new URL('functions-entry.js',import.meta.url),'utf8');
  assert(source.includes("SOURCE='source-viatris-social'"));
  assert(!source.includes('ucb-run-with-owned-publication-pipe.mjs'));
  assert(!source.includes('viatris-run-with-owned-publication-pipe.mjs'));
  assert(source.startsWith('const ACTIVATION=Object.freeze({"enabled":false,"mode":"LIVE","deploymentSha256":"'+'0'.repeat(64)+'"});'));
});
