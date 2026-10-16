// Synthetic connector/holder protocol tests. Real filesystem holder tests are
// separate; no official tool or LIVE filesystem is used here.
import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {expected,wrap,r,row,b as gitBinding,commit,tree} from './facts-fixture.mjs';
import {canonical} from './facts.mjs';
const read=n=>fs.readFileSync(new URL(n,import.meta.url),'utf8');
const shaSource=read('../functions/sha256.js'),digest=new Function(shaSource+'\nreturn responseDigest;')();
const factsSource=read('./facts.mjs').replace(/^export \{[^\n]+\};\n?$/m,'');
const template=read('./install.functions.template.js');
const nonce='11111111-2222-4333-8444-555555555555';
function setup(fault=null){
 let publishes=0,stage=false,finished=false,abandoned=false,officialCalls=0,source='';
 const expectedRow={...row,status:'BUILDING',commitSha:gitBinding.commitSha};const readers={main:{role:'main',readerFileHashes:{fixture:'a'}},fallback:{role:'fallback',readerFileHashes:{fixture:'b'}}};
 const bind={schemaVersion:1,repo:'EthanYoQ/Job-finder-Codex',projectId:'yiopvxysxrtrnvqxwgbx',...gitBinding,holderSource:'# Synthetic fixture only',holderSha256:digest('# Synthetic fixture only').sha256,retirementSql:'SYNTHETIC_FIXED_RETIREMENT',registrationSql:'SYNTHETIC_FIXED_CANDIDATE',retiredCandidate:expected,expectedRow,readerExpected:{schemaVersion:1,readers}};
 const binding={...bind,bindingSha256:digest(canonical(bind)).sha256};
 const timestamp=()=>new Date(Date.now()-(fault==='stale'?61000:1)).toISOString();
 const tools={
  exec_command:async()=>({session_id:17,...(fault==='bootstrap-is-error'?{isError:true}:{}),output:JSON.stringify({kind:'INSTALL_SOURCE_READY',serial:0,sourceBytes:bind.holderSource.length+(fault==='source-length'?1:0),sourceSha256:fault==='source-digest'?'0'.repeat(64):bind.holderSha256})+'\n'}),
  write_stdin:async({session_id,chars})=>{assert.equal(session_id,17);if(source.length<bind.holderSource.length){source+=chars;assert.equal(source,bind.holderSource.slice(0,source.length));return {session_id:17,output:source.length===bind.holderSource.length?JSON.stringify({kind:'INSTALL_READY',serial:0,nonce})+'\n':''};}const cmd=JSON.parse(chars);let v;
   if(cmd.op==='stage'){stage=true;v={kind:'INSTALL_RESULT',result:{kind:'INSTALL_STAGED',nonce}};}
   else if(cmd.op==='reader'){v={kind:'INSTALL_RESULT',result:{kind:'INSTALL_READER_VERIFIED',nonce,identity:{schemaVersion:1,projectId:bind.projectId,readers:fault==='reader'?{}:readers,checkedAt:timestamp(),processes:{main:{},fallback:{}}}}};}
   else if(cmd.op==='publish'){publishes++;assert.equal(cmd.payload.nonce,nonce);for(const p of Object.values(cmd.payload.facts))assert.equal(digest(p.rawBytes).sha256,p.rawSha256);v={kind:'INSTALL_RESULT',result:{kind:'FIXED_CONTROLLER_INSTALLED_DISABLED',nonce,commitSha:bind.commitSha,activationEnabled:false}};}
   else if(cmd.op==='finish'){finished=fault!=='finish-refused';v={kind:fault==='finish-refused'?'INSTALL_HOLD':'INSTALL_FINISHED'};}
   else if(cmd.op==='abandon'){abandoned=true;v={kind:'INSTALL_UNKNOWN'};}
   else throw Error('UNEXPECTED_OP');
   return {session_id:fault==='wrong-session'&&cmd.op==='publish'?99:17,output:JSON.stringify({...v,serial:cmd.serial})+'\n',...(fault==='success-is-error'&&cmd.op==='publish'?{isError:true}:{}),...((finished||abandoned||fault==='holder-lost'&&stage||fault==='publish-death'&&cmd.op==='publish')?{exit_code:finished&&fault!=='finish-nonzero'?0:78}:{})};
  },
  mcp__codex_apps__github_fetch_commit:async args=>{assert(stage);officialCalls++;assert.deepEqual(args,{repo_full_name:bind.repo,commit_sha:bind.commitSha});return fault==='tool-error'?{isError:true}:structuredClone(commit);},
  mcp__codex_apps__github_fetch:async args=>{assert(stage);officialCalls++;assert.equal(args.url,'https://api.github.com/repos/EthanYoQ/Job-finder-Codex/git/commits/'+bind.commitSha);const t=structuredClone(tree);if(fault==='tree')t.structuredContent.content=JSON.stringify({...JSON.parse(t.structuredContent.content),sha:'0'.repeat(40)});return t;},
  mcp__codex_apps__supabase_execute_sql:async args=>{assert(stage);officialCalls++;assert.equal(args.project_id,bind.projectId);if(args.query===bind.retirementSql)return wrap({retirement_reconciliation:{...r,observedAt:timestamp()}});assert.equal(args.query,bind.registrationSql);return wrap({candidate:{...expectedRow,createdAt:timestamp(),finalizedAt:null,releaseQaEvidenceSha256:null,...(fault==='candidate'?{status:'INVALIDATED'}:{})},checkedAt:timestamp()});}
 };
 if(fault==='non-promise')tools.mcp__codex_apps__github_fetch_commit=()=>structuredClone(commit);
 const rendered=template.replace('__FIXED_INSTALL_BINDING__',JSON.stringify(binding)).replace('__FIXED_SHA256_SOURCE__',JSON.stringify(shaSource)).replace('__FIXED_FACTS_SOURCE__',JSON.stringify(factsSource));
 return {api:new Function('tools',rendered)(tools),stats:()=>({publishes,finished,abandoned,officialCalls})};
}
test('synthetic complete fixed caller captures original four Promises after stage',async()=>{const x=setup();const r=await x.api.installFixedController();assert.equal(r.activationEnabled,false);assert.deepEqual(x.stats(),{publishes:1,finished:true,abandoned:false,officialCalls:4});await assert.rejects(x.api.installFixedController(),/ALREADY_ATTEMPTED/);});
for(const fault of ['tool-error','tree','stale','reader','candidate','non-promise','holder-lost'])test('caller '+fault+' rejects before publish',async()=>{const x=setup(fault);await assert.rejects(x.api.installFixedController());assert.equal(x.stats().publishes,0);assert.equal(x.stats().finished,false);});
test('no arguments accepted',async()=>{const x=setup();await assert.rejects(x.api.installFixedController({fake:true}),/NO_ARGUMENTS/);assert.equal(x.stats().officialCalls,0);});

for(const fault of ['finish-refused','finish-nonzero','publish-death','wrong-session','success-is-error'])test('post-publication '+fault+' never returns success',async()=>{const x=setup(fault);await assert.rejects(x.api.installFixedController());assert.equal(x.stats().publishes,1);await assert.rejects(x.api.installFixedController(),/ALREADY_ATTEMPTED/);});

for(const fault of ['bootstrap-is-error','source-length','source-digest'])test('bootstrap '+fault+' refuses source/official reads',async()=>{const x=setup(fault);await assert.rejects(x.api.installFixedController());assert.equal(x.stats().publishes,0);assert.equal(x.stats().officialCalls,0);});
