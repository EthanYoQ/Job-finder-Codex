/** Actual Linux flock/owned holder and actual sequence loader, with a small
 * synthetic entry. This is not producer, SQL, browser, installed closure, or
 * production qualification. All case evidence, including UNKNOWN, is retained. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawn,spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const HERE=path.dirname(fileURLToPath(import.meta.url)),HOST=path.resolve(HERE,'../..');
const NODE='/workspace/scratch/5e9614251709/schema50-production-install-build-20261016T0340Z/pinned-runtime/node';
const EVIDENCE='/workspace/scratch/5e9614251709/two-source-sequence-evidence-20261016T0530Z/small-tests';
assert.equal(fs.realpathSync(process.execPath),fs.realpathSync(NODE),'Use the already pinned Node 22 runtime');
assert.match(process.versions.node,/^22\./);
const sources={lock:fs.readFileSync(path.join(HOST,'lifecycle/lifecycle_lock.py'),'utf8'),holder:fs.readFileSync(path.join(HOST,'sequence/holder.py.in'),'utf8'),loader:fs.readFileSync(path.join(HOST,'sequence/lifecycle-loader.template.js'),'utf8'),digest:fs.readFileSync(path.join(HOST,'functions/sha256.js'),'utf8')};
const hash=bytes=>createHash('sha256').update(bytes).digest('hex'),delay=ms=>new Promise(r=>setTimeout(r,ms));
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
const fixtureTool=path.join(HERE,'real-holder-fixture.py');
function prepare(entry){const p=spawnSync('/usr/bin/python3',['-I',fixtureTool,'prepare'],{input:JSON.stringify({entry,sources}),encoding:'utf8',env:{PATH:'/usr/bin:/bin'}});assert.equal(p.status,0,p.stderr);return JSON.parse(p.stdout);}
function writer(f){const p=spawnSync('/usr/bin/python3',['-I',fixtureTool,'writer',path.join(f.stable,'fixture.json')],{encoding:'utf8',env:{PATH:'/usr/bin:/bin'}});assert.ok([0,78].includes(p.status),p.stderr);return JSON.parse(p.stdout);}
const records=f=>fs.readdirSync(f.case).filter(n=>n.includes('.lifecycle-cycle-')&&n.endsWith('.json')).sort().map(name=>({name,path:path.join(f.case,name),bytes:fs.readFileSync(path.join(f.case,name),'utf8')}));
function ownerTools(f,hooks={}){
 let holder=null,next=100,events=[],commands=[];const sessions=new Map();
 async function collect(s){const until=Date.now()+3000;while(!s.output.includes('\n')&&s.code===undefined&&Date.now()<until)await delay(2);const output=s.output;s.output='';return {session_id:s.id,output,...s.code===undefined?{}:{exit_code:s.code}};}
 const tools={
  async exec_command(a){
   if(a.workdir!==f.stable){assert.match(a.cmd,/^SYNTHETIC_PHASE:/);const phase=a.cmd.slice('SYNTHETIC_PHASE:'.length);events.push({phase});await hooks.phase?.(phase);return {exit_code:0,output:''};}
   const child=spawn('/bin/bash',['-c',hooks.launchCommand?.(a.cmd)??a.cmd],{cwd:f.stable,env:{PATH:'/usr/bin:/bin'},stdio:['pipe','pipe','pipe']});
   const s={id:++next,child,output:'',stderr:'',code:undefined,signal:null,closed:deferred(),holderId:null};holder=s;sessions.set(s.id,s);
   child.stdout.on('data',b=>{s.output+=b.toString();});child.stderr.on('data',b=>{s.stderr+=b.toString();});child.stdin.on('error',()=>{});
   child.on('close',(code,signal)=>{s.code=code??137;s.signal=signal;s.closed.resolve();});
   const r=await collect(s);try{s.holderId=JSON.parse(r.output.trim()).holderId;}catch{}await hooks.started?.(s,r);return r;
  },
  async write_stdin(a){const s=sessions.get(a.session_id);assert.ok(s,'same original holder session');let cmd=null;if(a.chars){cmd=JSON.parse(a.chars);commands.push(cmd);}await hooks.beforeWrite?.(s,cmd,a);if(a.chars&&s.code===undefined)s.child.stdin.write(a.chars);const r=await collect(s);await hooks.afterRead?.(s,cmd,r);return r;},
  async apply_patch(){throw Error('SYNTHETIC_ENTRY_HAS_NO_FILE_TOOL');},
  async mcp__codex_apps__supabase_execute_sql(){throw Error('NO_DATABASE_CALLS');},
  async mcp__cua_repl__js(){throw Error('NO_BROWSER_CALLS');}
 };
 return {tools,events,commands,get holder(){return holder;},async stop(){for(const s of sessions.values()){if(s.code===undefined)s.child.kill('SIGKILL');await s.closed.promise;}},async kill(){assert.ok(holder);if(holder.code===undefined)holder.child.kill('SIGKILL');await holder.closed.promise;},sessions};
}
const load=(f,owner)=>new Function('tools','notify',fs.readFileSync(f.loader,'utf8'))(owner.tools,()=>{});
const release='a'.repeat(64);
const fact=p=>({kind:p==='takeda'?'KNOWN_NOT_DISPATCHED':'NOT_DUE',sourceId:'source-'+p+'-china-social',roundId:'round-'+(p==='takeda'?'1':'2').repeat(32),releaseSha256:'b'.repeat(64),factsSha256:'c'.repeat(64),synthetic:true});
const start=p=>`await lifecycleScope.sourceStarted('${p}','${release}');`;
const settle=p=>`await lifecycleScope.sourceSettled('${p}','${release}',${JSON.stringify(fact(p))});`;
const phase=p=>`await tools.exec_command({cmd:'SYNTHETIC_PHASE:${p}'});`;
const entry=code=>`// SMALL SYNTHETIC ENTRY: holder and loader primitives only.\nreturn Object.freeze({async runLiveRound(){lifecycleScope.assertOriginal();${code}}});\n`;
const stages=start('takeda')+phase('a-running')+settle('takeda')+phase('between')+start('biogen')+phase('b-running')+settle('biogen')+phase('before-close');
const good=entry(stages+`const result={status:'SYNTHETIC_TWO_SOURCE_COMPLETE',synthetic:true};lifecycleScope.closeCycle(result);${phase('after-close')}return result;`);
const tests=[],allOwners=[];
async function scenario(name,source,body){const f=prepare(source),owners=[];const own=hooks=>{const o=ownerTools(f,hooks);owners.push(o);allOwners.push(o);return o;};let error;
 try{await body(f,own);}
 catch(e){error=e;}
 finally{for(const o of owners)await o.stop();const rs=records(f);tests.push({name,passed:!error,error:error?String(error):null,case:f.case,activeRetained:fs.existsSync(f.active),recordCount:rs.length,records:rs.map(r=>({name:r.name,sha256:hash(r.bytes),bytes:Buffer.byteLength(r.bytes)})),holders:owners.map(o=>({exitCode:o.holder?.code,signal:o.holder?.signal,stderr:o.holder?.stderr})),sourceSha256:f.sourceSha256});}
 console.log(JSON.stringify({name,passed:!error,case:f.case,error:error?String(error):null}));if(error)throw error;
}
async function heldAfter(f,owner){if(owner.holder?.code===undefined)await owner.holder.closed.promise;assert.ok(fs.existsSync(f.active),'ACTIVE retained');assert.equal(writer(f).reason,'ACTIVE_OR_UNKNOWN_ROUND');}
async function run(){
 await scenario('original-SH-ACTIVE-span-two-sources-and-four-durable-records',good,async(f,own)=>{
  const observed=[];const o=own({phase(p){observed.push(p);assert.ok(fs.existsSync(f.active));assert.equal(writer(f).reason,'LIFECYCLE_BUSY');const count={'a-running':1,between:2,'b-running':3,'before-close':4,'after-close':4}[p];assert.equal(records(f).length,count);}});
  const result=await load(f,o).runPinnedRound();assert.equal(result.lifecycle.state,'ORIGINAL_ROUND_FINISHED');assert.equal(o.holder.code,0);assert.equal(o.holder.signal,null);assert.equal(fs.existsSync(f.active),false);assert.equal(writer(f).status,'IDLE');
  assert.deepEqual(observed,['a-running','between','b-running','before-close','after-close']);const rows=records(f).map(r=>JSON.parse(r.bytes)).sort((a,b)=>a.record.profile===b.record.profile?(a.phase==='source-start'?-1:1):a.record.profile==='takeda'?-1:1);
  assert.deepEqual(rows.map(r=>[r.phase,r.record.profile]),[['source-start','takeda'],['source-settle','takeda'],['source-start','biogen'],['source-settle','biogen']]);assert.equal(new Set(rows.map(r=>r.cycleId)).size,1);assert.ok(rows.every(r=>r.entrySha256===f.entrySha256&&r.record.releaseSha256===release));
 });
 await scenario('same-isolate-and-other-process-entry-rejected',good,async(f,own)=>{
  const reached=deferred(),resume=deferred();const o=own({async phase(p){if(p==='between'){reached.resolve();await resume.promise;}}}),api=load(f,o);const running=api.runPinnedRound();await reached.promise;
  await assert.rejects(api.runPinnedRound(),/LIFECYCLE_ROUND_IN_FLIGHT/);
  const second=spawnSync('/usr/bin/python3',['-I','-u',f.holder],{encoding:'utf8',env:{PATH:'/usr/bin:/bin'},timeout:3000});assert.equal(second.status,78);assert.match(second.stdout,/LIFECYCLE_HOLD/);assert.ok(fs.existsSync(f.active));assert.equal(records(f).length,2);
  const other=own();await assert.rejects(load(f,other).runPinnedRound(),/LIFECYCLE_/);assert.equal(records(f).length,2);assert.equal(writer(f).reason,'LIFECYCLE_BUSY');resume.resolve();assert.equal((await running).lifecycle.state,'ORIGINAL_ROUND_FINISHED');
 });
 for(const [name,code,reason,count] of [
  ['wrong-first-source-order',start('biogen'),/SEQUENCE_START_ORDER/,0],
  ['settle-without-original-start',settle('takeda'),/SEQUENCE_SETTLE_ORDER/,0],
  ['premature-close-cycle',"lifecycleScope.closeCycle({status:'SEQUENCE_VERIFIED'});",/SEQUENCE_ALL_ORIGINAL_SOURCES_CLOSED/,0],
  ['changed-release-after-A-close',start('takeda')+settle('takeda')+`await lifecycleScope.sourceStarted('biogen','${'d'.repeat(64)}');`,/SEQUENCE_START_ORDER/,2]
 ])await scenario(name,entry(code),async(f,own)=>{const o=own();await assert.rejects(load(f,o).runPinnedRound(),reason);await heldAfter(f,o);assert.equal(records(f).length,count);});
 await scenario('plain-success-result-is-not-close-authority',entry("return {status:'SEQUENCE_VERIFIED',safe:true,allSourcesClosed:true};"),async(f,own)=>{const o=own(),r=await load(f,o).runPinnedRound();assert.equal(r.lifecycle,undefined);await heldAfter(f,o);assert.equal(records(f).length,0);});
 await scenario('copied-close-result-cannot-complete',entry(stages+"const result={status:'SEQUENCE_VERIFIED'};lifecycleScope.closeCycle(result);return {...result};"),async(f,own)=>{const o=own(),r=await load(f,o).runPinnedRound();assert.equal(r.lifecycle,undefined);await heldAfter(f,o);assert.equal(records(f).length,4);});
 for(const [name,at,count] of [['crash-after-A-close-before-B-start','between',2],['crash-during-B','b-running',3]])await scenario(name,good,async(f,own)=>{
  const reached=deferred(),resume=deferred();const o=own({async phase(p){if(p===at){reached.resolve();await resume.promise;}}});const running=load(f,o).runPinnedRound(),rejected=assert.rejects(running,/LIFECYCLE_/);await reached.promise;await o.kill();assert.equal(records(f).length,count);assert.equal(writer(f).reason,'ACTIVE_OR_UNKNOWN_ROUND');resume.resolve();await rejected;await heldAfter(f,o);if(at==='between')assert.equal(o.events.filter(x=>x.phase==='b-running').length,0);
 });
 await scenario('crash-immediately-before-owned-finish',good,async(f,own)=>{let killed=false;const o=own({async beforeWrite(s,c){if(c?.op==='finish'){killed=true;s.child.kill('SIGKILL');await s.closed.promise;}}});await assert.rejects(load(f,o).runPinnedRound(),/LIFECYCLE_/);assert.equal(killed,true);await heldAfter(f,o);assert.equal(records(f).length,4);});
 await scenario('ack-loss-after-real-owned-finish-does-not-replay',good,async(f,own)=>{let lost=false;const o=own({async afterRead(s,c,r){if(c?.op==='finish'){assert.match(r.output,/LIFECYCLE_FINISHED/);await s.closed.promise;lost=true;throw Error('SYNTHETIC_FINISH_ACK_LOST');}}});await assert.rejects(load(f,o).runPinnedRound(),/SYNTHETIC_FINISH_ACK_LOST/);assert.equal(lost,true);assert.equal(o.holder.code,0);assert.equal(fs.existsSync(f.active),false);assert.equal(writer(f).status,'IDLE');assert.equal(records(f).length,4);});
 await scenario('durable-record-tamper-is-retained-and-HOLD',good,async(f,own)=>{let modified=null;const o=own({phase(p){if(p==='between'){modified=records(f).find(r=>JSON.parse(r.bytes).phase==='source-settle').path;fs.appendFileSync(modified,' ');}}});await assert.rejects(load(f,o).runPinnedRound(),/LIFECYCLE_HOLDER_HOLD/);await heldAfter(f,o);assert.equal(records(f).length,4);assert.ok(fs.readFileSync(modified,'utf8').endsWith('\n '));});
 await scenario('partial-next-durable-record-is-never-repaired',good,async(f,own)=>{let partial=null;const o=own({beforeWrite(s,c){if(c?.op==='source-settle'&&c.record.profile==='takeda'){partial=path.join(f.case,'.synthetic-two-source.lifecycle-cycle-'+s.holderId+'-'+c.serial+'.json');fs.writeFileSync(partial,'{"partial":',{flag:'wx',mode:0o600});}}});await assert.rejects(load(f,o).runPinnedRound(),/LIFECYCLE_HOLDER_HOLD/);await heldAfter(f,o);assert.equal(records(f).length,2);assert.equal(fs.readFileSync(partial,'utf8'),'{"partial":');});
 await scenario('same-byte-inode-replacement-before-source-close-ack-blocks-B',good,async(f,own)=>{
  // Out-of-band trace launcher for this fixture only. The actual holder file,
  // loader, and lifecycle module remain exact captured production source bytes.
  // The replaced original record is renamed aside and retained, never deleted.
  assert.equal(sources.holder.split('named=(domain.parent/leaf).lstat()').length,2);
  const traceFile=path.join(f.stable,'trace-holder.py'),notice=path.join(f.stable,'inode-replacement.json');
  const script=`import sys,os,pathlib,hashlib,linecache,json,runpy\nsys.dont_write_bytecode=True\np=${JSON.stringify(f.holder)}\nassert hashlib.sha256(pathlib.Path(p).read_bytes()).hexdigest()==${JSON.stringify(hash(fs.readFileSync(f.holder)))}\nchanged=False\ndef trace(frame,event,arg):\n global changed\n if not changed and event=='line' and frame.f_code.co_filename==p and linecache.getline(p,frame.f_lineno).strip()=='named=(domain.parent/leaf).lstat()' and frame.f_locals.get('phase')=='source-settle' and frame.f_locals.get('record',{}).get('profile')=='takeda':\n  changed=True\n  file=frame.f_locals['domain'].parent/frame.f_locals['leaf'];raw=file.read_bytes();before=file.stat();retained=file.with_name(file.name+'.original-inode-retained');os.rename(file,retained)\n  fd=os.open(file,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)\n  try:\n   os.write(fd,raw);os.fsync(fd)\n  finally:os.close(fd)\n  directory=os.open(file.parent,os.O_RDONLY|os.O_DIRECTORY)\n  try:os.fsync(directory)\n  finally:os.close(directory)\n  after=file.stat();assert (before.st_dev,before.st_ino)!=(after.st_dev,after.st_ino) and file.read_bytes()==retained.read_bytes()\n  evidence={'file':str(file),'retained':str(retained),'originalIdentity':[before.st_dev,before.st_ino],'replacementIdentity':[after.st_dev,after.st_ino],'sameBytes':True}\n  with open(${JSON.stringify(notice)},'x') as out:json.dump(evidence,out);out.flush();os.fsync(out.fileno())\n return trace\nsys.settrace(trace)\nrunpy.run_path(p,run_name='__main__')\n`;
  fs.writeFileSync(traceFile,script.replaceAll('\\n','\n'),{flag:'wx',mode:0o600});
  const o=own({launchCommand(){return '/usr/bin/python3 -I -u '+JSON.stringify(traceFile);}});
  await assert.rejects(load(f,o).runPinnedRound(),/LIFECYCLE_HOLDER_HOLD/);await heldAfter(f,o);
  const evidence=JSON.parse(fs.readFileSync(notice,'utf8'));assert.equal(evidence.sameBytes,true);assert.notDeepEqual(evidence.originalIdentity,evidence.replacementIdentity);assert.equal(fs.readFileSync(evidence.file,'utf8'),fs.readFileSync(evidence.retained,'utf8'));
  assert.equal(records(f).length,2);assert.equal(o.commands.filter(c=>c.op==='source-start'&&c.record.profile==='biogen').length,0);assert.equal(o.events.filter(e=>e.phase==='b-running').length,0);assert.equal(fs.statSync(evidence.file).mode&0o777,0o600);assert.equal(fs.statSync(evidence.retained).mode&0o777,0o600);
 });
 await scenario('actual-partial-record-write-failure-before-ack-blocks-B',good,async(f,own)=>{
  const traceFile=path.join(f.stable,'trace-partial-holder.py'),notice=path.join(f.stable,'partial-write.json');
  const script=`import sys,os,pathlib,hashlib,linecache,json,runpy\nsys.dont_write_bytecode=True\np=${JSON.stringify(f.holder)}\nassert hashlib.sha256(pathlib.Path(p).read_bytes()).hexdigest()==${JSON.stringify(hash(fs.readFileSync(f.holder)))}\nchanged=False\ndef trace(frame,event,arg):\n global changed\n if not changed and event=='line' and frame.f_code.co_filename==p and linecache.getline(p,frame.f_lineno).strip().startswith("with os.fdopen(os.dup(out),'wb') as stream:stream.write(evidence);") and frame.f_locals.get('phase')=='source-settle' and frame.f_locals.get('record',{}).get('profile')=='takeda':\n  changed=True\n  file=frame.f_locals['domain'].parent/frame.f_locals['leaf'];fd=frame.f_locals['out'];partial=b'{"partial":';os.write(fd,partial);os.fsync(fd)\n  with open(${JSON.stringify(notice)},'x') as note:json.dump({'file':str(file),'bytesWritten':len(partial),'originalOpenDescriptor':True},note);note.flush();os.fsync(note.fileno())\n  raise RuntimeError('SYNTHETIC_PARTIAL_RECORD_WRITE_FAILURE')\n return trace\nsys.settrace(trace)\nrunpy.run_path(p,run_name='__main__')\n`;
  fs.writeFileSync(traceFile,script.replaceAll('\\n','\n'),{flag:'wx',mode:0o600});const o=own({launchCommand(){return '/usr/bin/python3 -I -u '+JSON.stringify(traceFile);}});
  await assert.rejects(load(f,o).runPinnedRound(),/LIFECYCLE_HOLDER_HOLD/);await heldAfter(f,o);const evidence=JSON.parse(fs.readFileSync(notice,'utf8'));assert.equal(evidence.originalOpenDescriptor,true);assert.equal(fs.readFileSync(evidence.file,'utf8'),'{"partial":');assert.equal(records(f).length,2);assert.equal(o.commands.filter(c=>c.op==='source-start'&&c.record.profile==='biogen').length,0);
 });
 await scenario('holder-loss-before-entry-load-prevents-evaluation',good,async(f,own)=>{const o=own({async beforeWrite(s,c){if(c?.op==='read'){s.child.kill('SIGKILL');await s.closed.promise;}}});await assert.rejects(load(f,o).runPinnedRound(),/LIFECYCLE_/);await heldAfter(f,o);assert.equal(o.events.length,0);assert.equal(records(f).length,0);});
 await scenario('foreign-session-receipt-retains-ACTIVE',good,async(f,own)=>{let changed=false;const o=own({afterRead(s,c,r){if(c?.op==='read'&&!changed){r.session_id++;changed=true;}}});await assert.rejects(load(f,o).runPinnedRound(),/LIFECYCLE_FOREIGN_SESSION/);await o.stop();await heldAfter(f,o);assert.equal(o.events.length,0);});
 // Exercise holder checks independently of the loader's earlier gates.
 for(const [name,command] of [
  ['holder-rejects-B-before-A',{op:'source-start',record:{profile:'biogen',releaseSha256:release}}],
  ['holder-rejects-finish-without-four-records',{op:'finish'}],
  ['holder-rejects-caller-success-flag',{op:'finish',safe:true}]
 ])await scenario(name,good,async(f,own)=>{
  const o=own(),first=await o.tools.exec_command({cmd:'/usr/bin/python3 -I -u '+JSON.stringify(f.holder),workdir:f.stable});let serial=0,offset=0;
  const exchange=async c=>{const r=await o.tools.write_stdin({session_id:first.session_id,chars:JSON.stringify({...c,serial:++serial})+'\n'});return JSON.parse(r.output.trim());};
  while(offset<f.entryBytes)offset=(await exchange({op:'read'})).next;
  const response=await exchange(command);assert.equal(response.kind,'LIFECYCLE_HOLD');await o.holder.closed.promise;await heldAfter(f,o);assert.equal(records(f).length,0);
 });
}
let fatal=null;
try{await run();}catch(error){fatal=error;}finally{
 for(const o of allOwners)await o.stop();
 fs.mkdirSync(EVIDENCE,{recursive:true,mode:0o700});const report={kind:'SEQUENCE_REAL_LINUX_HOLDER_SMALL_SYNTHETIC_ENTRY',passed:!fatal,node:process.versions.node,nodePath:process.execPath,tests,caseCount:tests.length,sourceSha256:Object.fromEntries(Object.entries(sources).map(([k,v])=>[k,hash(v)])),evidenceRetained:true,unknownCasesDeleted:false,locksClearedByTest:false,permissionsRelaxed:false,transport:'REAL_CHILD_PROCESS_STDIN_STDOUT_PIPES',actualProducer:false,realDatabaseCalls:0,realBrowserCalls:0,networkCalls:0,productionActivated:false,error:fatal?String(fatal):null};
 const output=path.join(EVIDENCE,'real-holder-results-'+new Date().toISOString().replaceAll(/[:.]/g,'-')+'.json');fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});console.log(JSON.stringify({report:output,passed:report.passed,cases:tests.length}));
}
if(fatal)throw fatal;
