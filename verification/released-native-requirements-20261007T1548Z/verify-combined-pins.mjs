// Local readonly runtime-file hashes plus temporary corrupted-file counterexamples.
// No supervisor start, capture, source HTTP, database, or active-state mutation.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdtempSync,realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import vm from 'node:vm';
import {createHash} from 'node:crypto';
const [fixedPath,reportPath]=process.argv.slice(2);
if(!fixedPath||!reportPath)throw Error('Usage: verify-combined-pins <unbound-template> <report>');
const q=s=>"'"+String(s).replaceAll("'","'\\''")+"'",results=[];
const block=path=>{const source=readFileSync(path,'utf8'),start=source.indexOf('const combinedPaths='),end=source.indexOf('const combinedIdentityCheck=');assert(start>=0&&end>start);return source.slice(start,end);};
const fixed=block(fixedPath);
const paths=JSON.parse(fixed.match(/const combinedPaths=(.*);\n/)[1]);
const supervisorHash=createHash('sha256').update(readFileSync(paths.supervisor)).digest('hex');
const stale=fixed.replace(supervisorHash,'0'.repeat(64));assert.notEqual(stale,fixed);
const run=async(code,replacement)=>{
 let calls=0;
 const context=vm.createContext({h:{q},tools:{exec_command:async args=>{
  calls++;assert(args.cmd.startsWith('sha256sum -- '));
  const cmd=replacement?args.cmd.replace(q(replacement.original),q(replacement.changed)):args.cmd;
  const r=spawnSync('/bin/bash',['-c',cmd],{encoding:'utf8'});
  let output=r.stdout+r.stderr;if(replacement)output=output.replaceAll(replacement.changed,replacement.original);
  return {exit_code:r.status,output};
 }}});
 const promise=vm.compileFunction('return(async()=>{'+code+'})()',[],{parsingContext:context})();
 if(replacement||code===stale)await assert.rejects(promise,/COMBINED_SOURCE_HASH_MISMATCH/);else await promise;
 assert.equal(calls,1);
};
await run(stale);results.push({name:'synthetic-stale-supervisor-pin-rejected-before-launch',passed:true});
await run(fixed);results.push({name:'fixed-pin-matches-all-four-actual-files',passed:true});
const tmp=mkdtempSync(join(tmpdir(),'synthetic-amgen-four-pins-'));
for(const name of ['sampler','supervisor','wrapper','inspector']){
 const original=paths[name],changed=join(tmp,name);writeFileSync(changed,Buffer.concat([readFileSync(original),Buffer.from('\nSYNTHETIC_TAMPERING_NEVER_EXECUTED\n')]));
 await run(fixed,{original,changed});results.push({name:name+'-byte-change-rejected',passed:true});
}
// The next readonly startup step resolves the actual new wrapper/Node/cwd tuple.
const cfg=JSON.parse(readFileSync(join(paths.base,'../host/host-config.json'),'utf8')),node=cfg.node;
const r=spawnSync(node,['--import',join(cfg.repo,'node_modules/tsx/dist/loader.mjs'),paths.inspector,'synthetic-combined-pin-check'],{cwd:cfg.repo,env:{...process.env,JOBFINDER_CLOUD_SOURCE_ID:cfg.sourceId,TSX_DISABLE_CACHE:'1',NODE_DISABLE_COMPILE_CACHE:'1'},encoding:'utf8'});
assert.equal(r.status,0,r.stderr);const parsed=JSON.parse(r.stdout);
assert.equal(parsed.nodePath,node);assert.equal(parsed.nodeRealPath,realpathSync(node));assert.equal(parsed.cwd,cfg.repo);assert.equal(parsed.cwdRealPath,cfg.repo);assert.equal(parsed.wrapperPath,paths.wrapper);assert.equal(parsed.wrapperRealPath,paths.wrapper);assert.match(parsed.controlRunId,/^jb-[a-f0-9]{64}$/);
results.push({name:'actual-readonly-normalization-step',passed:true});
const sums=spawnSync('sha256sum',['--',paths.sampler,paths.supervisor,paths.wrapper,paths.inspector],{encoding:'utf8'});assert.equal(sums.status,0);
const report={classification:'OFFLINE_ACTUAL_FILE_HASH_CHECKS_AND_SYNTHETIC_COUNTEREXAMPLES',passed:results.length,results,actualFourFileSha256sum:sums.stdout.trim(),noSupervisorStart:true,noCaptureLaunch:true,noHttp:true,noSql:true,boundStarterOrActivationModified:false};
writeFileSync(reportPath,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
