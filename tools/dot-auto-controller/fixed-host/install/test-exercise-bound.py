"""TEST_ONLY actual stable loader/activation wrapper on owned installed case.
All original source hashes remain checked before fixed-root builder mapping.
No original business entry is evaluated; observations are synthetic.
"""
from pathlib import Path
import importlib.util,json,os,subprocess,sys
HERE=Path(__file__).resolve().parent;HOST=HERE.parent;ROOT=HOST.parents[2]
PINS=json.loads(Path(os.environ['INSTALL_TEST_PINS']).read_text())
def exercise(case):
 case=Path(case).resolve();assert case.parent==ROOT/'evidence/install/lifecycle-cases' and case.name.startswith('case-');owner=case/'.installed-disabled.lifecycle-owner';target=case/'installed-disabled'
 tracer=case/'test-activation-trace.py'
 tracer.write_text('''import sys,pathlib
TARGET='''+repr(str(target))+'''
def trace(frame,event,arg):
 if event=='return' and frame.f_code.co_name=='pinned_module' and isinstance(arg,dict) and 'render_entry' in arg:
  arg['LIVE_ROOT']=pathlib.Path(TARGET)
  original=arg['load_pinned_module']
  def pinned(name,path,sources):
   value=original(name,path,sources)
   if pathlib.Path(path).name=='render-fixed-live-source.py':value.LIVE_ROOT=TARGET
   return value
  arg['load_pinned_module']=pinned
 return trace
code=sys.argv[1];sys.argv=['<fixed-activation-exec>'];sys.settrace(trace);exec(compile(code,'<original-fixed-activation-exec>','exec'),{'__name__':'__main__'})
''')
 code=r"""import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {holderTools} from __BRIDGE__;
const stable=__OWNER__,root=__TARGET__,caseRoot=__CASE__,trace=__TRACE__;const results=[];
async function runLoader(expect){const before=fs.existsSync(caseRoot+'/.installed-disabled.lifecycle-active.json');let business=0;const owner=holderTools({stable},{mcp__codex_apps__supabase_execute_sql(){business++;throw Error('UNEXPECTED BUSINESS');}});try{const api=new Function('tools',fs.readFileSync(stable+'/functions-loader.js','utf8'))(owner.tools);if(expect==='DISABLED'){const v=await api.runPinnedRound();assert.equal(v.reason,'COMPLETE_NEVER_ACTIVATED_INSTALL');}else await assert.rejects(api.runPinnedRound(),/LIFECYCLE_/);assert.equal(business,0);assert.equal(fs.existsSync(caseRoot+'/.installed-disabled.lifecycle-active.json'),before);}finally{await owner.stop();}}
await runLoader('DISABLED');results.push('normal-disabled');
for(const rel of ['runtime-checkout','connector-host-runtime','install.lock','candidate/functions-entry.js',...fs.readdirSync(root+'/deployments').filter(x=>x.endsWith('.json')).map(x=>'deployments/'+x)]){const p=root+'/'+rel,hold=caseRoot+'/temporarily-hidden';fs.renameSync(p,hold);try{await runLoader('HOLD');results.push('missing:'+rel);}finally{fs.renameSync(hold,p);}}
for(const rel of ['ACTIVATION_STARTED','OWNER_MANIFEST.json','COMPLETE']){const p=stable+'/'+rel,hold=caseRoot+'/temporarily-hidden';const existing=fs.existsSync(p);if(existing)fs.renameSync(p,hold);else fs.writeFileSync(p,'UNKNOWN',{mode:0o400,flag:'wx'});try{await runLoader('HOLD');results.push('history-or-missing:'+rel);}finally{if(existing)fs.renameSync(hold,p);else fs.unlinkSync(p);}}
const binding=JSON.parse(fs.readFileSync(stable+'/binding.json','utf8'));const markerNames=['.installed-disabled.lifecycle-active.json','.installed-disabled.lifecycle-mutation-active.json'];
for(const name of markerNames){const p=caseRoot+'/'+name;fs.writeFileSync(p,'UNKNOWN',{flag:'wx',mode:0o600});try{await runLoader('HOLD');results.push('unknown:'+name);}finally{fs.unlinkSync(p);}}
await runLoader('DISABLED');
let queries=0;const body=fs.readFileSync(stable+'/functions-activate.js','utf8');const line=body.split('\n').find(x=>x.startsWith('const ACTIVATION_LIFECYCLE='));const b=JSON.parse(line.slice('const ACTIVATION_LIFECYCLE='.length,-1));
const owner=holderTools({stable},{mcp__codex_apps__supabase_execute_sql(){queries++;return Promise.resolve({structuredContent:{result:'TEST_ONLY\n<untrusted-data-synthetic>\n'+JSON.stringify([{candidate:{...b.deploymentBinding.deployment.expectedRow,createdAt:new Date().toISOString(),finalizedAt:null,releaseQaEvidenceSha256:null},checkedAt:new Date().toISOString()}])+'\n</untrusted-data-synthetic>'}});}});
const original=owner.tools.exec_command;owner.tools.exec_command=args=>{assert.ok(args.cmd.startsWith('/usr/bin/python3 -I -u -c '));const quote=s=>"'"+s.replaceAll("'","'\\''")+"'";return original({...args,cmd:args.cmd.replace('/usr/bin/python3 -I -u -c ','/usr/bin/python3 -I -u '+quote(trace)+' ')});};
try{const api=new Function('tools',body)(owner.tools);const r=await api.activateFixedDeployment();assert.equal(r.kind,'FIXED_DEPLOYMENT_ACTIVATED');assert.equal(r.onlyActivationBooleanChanged,true);assert.equal(queries,1);results.push('actual-original-wrapper-qualify-commit-finish');}finally{await owner.stop();}
const history=JSON.parse(fs.readFileSync(stable+'/ACTIVATION_STARTED','utf8'));assert.deepEqual(history,{schemaVersion:1,deploymentSha256:b.deploymentBinding.deploymentSha256,enabledEntrySha256:b.deploymentBinding.enabledEntrySha256});
const disabled=fs.readFileSync(root+'/candidate/functions-entry.js','utf8'),enabled=fs.readFileSync(root+'/candidate/functions-entry.enabled.js','utf8');assert.equal(enabled,disabled.replace('"enabled":false','"enabled":true'));results.push('permanent-history-and-only-boolean-delta');
const ep=root+'/candidate/functions-entry.enabled.js',held=caseRoot+'/activated-entry-retained';fs.renameSync(ep,held);try{await runLoader('HOLD');results.push('enabled-deletion-history-hold');}finally{fs.renameSync(held,ep);}
console.log(JSON.stringify({passed:true,tests:results,realOriginalActivation:true,syntheticDatabase:true,realDatabaseCalls:0}));
"""
 for token,value in [('BRIDGE',(HOST/'tests/lifecycle-bridge.test.mjs').as_uri()),('OWNER',str(owner)),('TARGET',str(target)),('CASE',str(case)),('TRACE',str(tracer))]:code=code.replace("__"+token+"__",json.dumps(value))
 p=subprocess.run([PINS['nodePath'],'--input-type=module','-e',code],capture_output=True,text=True,timeout=180,env={'PATH':'/usr/bin:/bin'});assert p.returncode==0,(p.stdout,p.stderr);return json.loads(p.stdout)
if __name__=='__main__':print(json.dumps(exercise(sys.argv[1]),indent=2))
