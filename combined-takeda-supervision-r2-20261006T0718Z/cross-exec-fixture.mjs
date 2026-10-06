// Synthetic start and request deliberately run in different tool exec sessions.
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdtempSync, mkdirSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { paths } from './create-combined-starter.mjs';
import { buildCombinedCommand } from './build-combined-command.mjs';
const q=s=>"'"+s.replaceAll("'","'\\''")+"'";
const receipt=process.argv[3];
if(!receipt || !isAbsolute(receipt))throw Error('EXPLICIT_UNIQUE_ABSOLUTE_TEST_RECEIPT_REQUIRED');
mkdirSync(dirname(receipt),{recursive:true,mode:0o700});
mkdirSync(join(paths.base,'verification'),{recursive:true,mode:0o700});
const events=p=>readFileSync(p,'utf8').trim().split('\n').map(JSON.parse);
const mode=process.argv[2];
if(mode==='start') {
  const root=mkdtempSync(join(paths.base,'verification/cross-exec-'));
  const m={root,controlDirectory:join(root,'control'),controlRunId:'jb-'+createHash('sha256').update(root).digest('hex'),diagnostics:join(root,'diagnostics'),ready:join(root,'ready.json'),outputDir:join(root,'memory')};
  writeFileSync(receipt,JSON.stringify(m)+'\n',{flag:'wx',mode:0o600});
  const command='env TSX_DISABLE_CACHE=1 NODE_DISABLE_COMPILE_CACHE=1 node scripts/run-with-http-diagnostics.mjs '+q(m.diagnostics)+' 20000 -- node --max-old-space-size=256 '+q(join(paths.base,'fixture-inner.mjs'))+' graceful '+q(m.ready);
  const combined=buildCombinedCommand(command,{...m,nodePath:process.execPath,supervisorPath:paths.supervisor,wrapperPath:paths.wrapper,samplerPath:paths.sampler,label:'SYNTHETIC_ONLY/cross-exec/includes-supervisor'},q);
  const child=spawn('bash',['-c',combined.observedCommand],{cwd:join(paths.r2,'producer42'),stdio:'inherit'});
  child.once('close',(code,signal)=>{writeFileSync(join(m.root,'tool-child-terminal.json'),JSON.stringify({code,signal})+'\n');process.exitCode=code??1;});
} else if(mode==='request') {
  const m=JSON.parse(readFileSync(receipt,'utf8'));
  const deadline=Date.now()+4000;
  while(!existsSync(m.ready)||!existsSync(join(m.controlDirectory,'descriptor.json'))) {if(Date.now()>deadline)throw Error('CROSS_EXEC_FIXTURE_NOT_READY');await new Promise(r=>setTimeout(r,25));}
  assert.equal(existsSync(join(m.controlDirectory,'cancel.json')),false);
  const result=spawnSync(process.execPath,[paths.supervisor,'request',m.controlDirectory,m.controlRunId],{encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);console.log(result.stdout.trim());
} else if(mode==='verify') {
  const m=JSON.parse(readFileSync(receipt,'utf8'));
  const wrapper=events(join(m.diagnostics,'process.jsonl')),supervisor=events(join(m.controlDirectory,'supervisor.jsonl'));
  const terminal=JSON.parse(readFileSync(join(m.root,'tool-child-terminal.json'),'utf8'));
  assert.equal(terminal.code,42);
  assert.equal(wrapper.filter(e=>e.event==='SIGNAL_RECEIVED'&&e.signal==='SIGTERM').length,1);
  assert.equal(wrapper.find(e=>e.event==='CHILD_EXIT').wrapperExitCode,42);
  assert.equal(supervisor.at(-1).supervisorExitCode,42);
  const memory=JSON.parse(readFileSync(join(m.outputDir,'summary.json'),'utf8'));
  const descriptor=JSON.parse(readFileSync(join(m.controlDirectory,'descriptor.json'),'utf8'));
  assert.equal(memory.root.pid,descriptor.supervisorPid);assert.equal(memory.status,'TARGET_TREE_EXITED');
  assert.ok(!memory.processLifetimes.some(p=>p.pid===memory.samplerPid));
  const report={status:'PASS_CROSS_EXEC_SYNTHETIC_CANCEL',checkedAt:new Date().toISOString(),wrapperExit:42,supervisorExit:42,shellExit:42,oneSigterm:true,wrapperTerminalPersisted:true,memoryRoot:'supervisor',observedProcessCount:memory.processLifetimes.length,sampleCount:memory.sampleCount,samplerExcluded:true,realRunTouched:false};
  writeFileSync(join(dirname(receipt),'CROSS_EXEC_RESULT.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report));
} else throw Error('Use start, request, or verify for this synthetic fixture only');
