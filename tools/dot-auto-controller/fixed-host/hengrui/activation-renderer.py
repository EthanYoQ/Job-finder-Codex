#!/usr/bin/python3
"""Pure external deployment artifact renderer. Never writes to or creates LIVE.

The release owner must independently obtain and review the official remote
commit fact, then pin these rendered artifacts before loading either one.
The fact JSON is provenance data, not runtime permission or remote proof.
"""
from pathlib import Path
import hashlib,json,re,sys
HERE=Path(__file__).resolve().parent
LIVE_ROOT='/workspace/scratch/5e9614251709/job-finder-fixed-live-controller-v1'
# No historical identity may be reused for this new candidate.
SOURCE_MANIFEST_SHA=BUILDER_SHA=CANONICAL_DEFAULT_SHA=None
def measured_pins():
 global SOURCE_MANIFEST_SHA,BUILDER_SHA,CANONICAL_DEFAULT_SHA
 # Injected by the private installer only after original source/native closed-
 # set verification. Each executable hash is taken from that pinned manifest.
 pins=ACTIVATION_PINS
 require(type(pins) is dict and set(pins)=={'sourceManifestSha256','builderSha256','canonicalDefaultSha256'},'ACTIVATION_MEASUREMENTS_FIELDS')
 require(all(type(v) is str and SHA.fullmatch(v) for v in pins.values()),'ACTIVATION_MEASUREMENTS_PIN')
 SOURCE_MANIFEST_SHA=pins['sourceManifestSha256'];BUILDER_SHA=pins['builderSha256'];CANONICAL_DEFAULT_SHA=pins['canonicalDefaultSha256']
 return pins
ROW_KEYS=['id','goalId','version','commitSha','migrationVersion','schemaHash','dbSnapshotHash','rosterHash','sourcePlanHash','sourceConfigHash','adapterBundleHash','sourceTreeHash','runtimeTreeHash','oracleVersion','minimumStableCompanyCount','status']
SHA=re.compile('[a-f0-9]{64}')
def require(ok,code):
 if not ok:raise RuntimeError(code)
def sha(b):return hashlib.sha256(b).hexdigest()
def js(x):return json.dumps(x,ensure_ascii=True,separators=(',',':'))
def canonical(x):return json.dumps(x,ensure_ascii=True,sort_keys=True,separators=(',',':'))
def source_inputs(package):
 measured_pins()
 package=Path(package).resolve()
 p=package/'fixed-host/hengrui/build-functions-entry.py'
 b=p.read_bytes();require(sha(b)==BUILDER_SHA,'ACTIVATION_CANONICAL_BUILDER_PIN')
 module=type(sys)('activation_canonical_builder');module.__file__=str(p)
 exec(compile(b,str(p),'exec'),module.__dict__)
 inputs=module.load_source_inputs()
 require(sha(module.render_entry(inputs))==CANONICAL_DEFAULT_SHA,'ACTIVATION_CANONICAL_DEFAULT_PIN')
 helper=inputs['fixed-host/functions/host-helper.js'].decode()
 drain=helper[:helper.index('const loaded=')]
 rows=next(line for line in helper.splitlines() if line.startswith('function rows('))
 query=inputs['fixed-host/functions/bootstrap-query.sql.template'].decode()
 return module,inputs,drain,rows,query
def enable_exact(disabled,deployment_sha):
 before=('const ACTIVATION=Object.freeze('+js({'enabled':False,'mode':'LIVE','deploymentSha256':deployment_sha})+');\n').encode()
 after=before.replace(b'"enabled":false',b'"enabled":true',1)
 require(disabled.startswith(before) and disabled.count(b'const ACTIVATION=')==1,'ACTIVATION_EXACT_PREFIX')
 enabled=after+disabled[len(before):]
 require(enabled[len(after):]==disabled[len(before):] and len(enabled)==len(disabled)-1,'ACTIVATION_SINGLE_BOOLEAN_DELTA')
 return enabled
def verify_remote_fact(fact,commit):
 require(type(fact) is dict and set(fact)=={'kind','repository','commitSha','observedAt','responseSha256'},'ACTIVATION_REMOTE_FACT_FIELDS')
 require(fact['kind']=='OFFICIAL_GITHUB_COMMIT_READ' and fact['commitSha']==commit and re.fullmatch('[a-f0-9]{40}',commit),'ACTIVATION_REMOTE_COMMIT')
 require(type(fact['repository']) is str and re.fullmatch('[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+',fact['repository']) and type(fact['observedAt']) is str and re.fullmatch(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|\+00:00)',fact['observedAt']) and type(fact['responseSha256']) is str and SHA.fullmatch(fact['responseSha256']),'ACTIVATION_REMOTE_FACT_FORMAT')
def render(package,deployment_bytes=None,remote_fact=None):
 package=Path(package).resolve()
 module,inputs,drain,rows,query=source_inputs(package)
 binding=None;disabled=None;enabled=None
 if deployment_bytes is not None:
  require(type(deployment_bytes) is bytes and len(deployment_bytes)<65536,'ACTIVATION_DEPLOYMENT_INPUT')
  d=json.loads(deployment_bytes);selector=sha(deployment_bytes)
  cli_renderer=module.load_pinned_module('activation_cli_renderer',Path(package)/'fixed-host/hengrui/render-hengrui-source.py',inputs)
  templates={n:inputs['fixed-host/hengrui/'+n+'.in'] for n in cli_renderer.TEMPLATES}
  cli=cli_renderer.render_bytes(templates)
  module.validate_deployment(d,cli)
  require(set(d['expectedRow'])==set(ROW_KEYS) and d['expectedRow']['commitSha']==d['build']['commitSha'] and d['expectedRow']['sourceTreeHash']==d['build']['sourceTreeSha256'] and d['expectedRow']['runtimeTreeHash']==d['build']['runtimeTreeSha256'],'ACTIVATION_BUILD_ROW_BINDING')
  require(d['expectedRow']['status']=='BUILDING' and d['expectedRow']['minimumStableCompanyCount']==41 and not d['candidate']['id'].startswith('synthetic-') and d['build']['commitSha']!='1'*40 and not d['build']['commitSha'].startswith('d02f4f5') and d['databaseIdentity']['dbSnapshotHash']!='e'*64,'ACTIVATION_REAL_IDENTITY_REQUIRED')
  verify_remote_fact(remote_fact,d['build']['commitSha'])
  disabled=module.render_entry(inputs,d,selector);enabled=enable_exact(disabled,selector)
  require(disabled.isascii() and enabled.isascii(),'ACTIVATION_ASCII_ARTIFACT')
  binding={'schemaVersion':1,'sourceManifestSha256':SOURCE_MANIFEST_SHA,'canonicalDefaultSha256':CANONICAL_DEFAULT_SHA,'builderSha256':BUILDER_SHA,'deploymentSha256':selector,'deployment':d,'remoteCommit':remote_fact,'cliSha256':sha(cli['fixed-preimport-launch.py']),'disabledEntrySha256':sha(disabled),'disabledEntryBytes':len(disabled),'enabledEntrySha256':sha(enabled),'enabledEntryBytes':len(enabled)}
  binding['bindingSha256']=sha(canonical(binding).encode())
 else:require(remote_fact is None,'ACTIVATION_NULL_BINDING')
 local=(HERE/'local-activation.py.in').read_text().replace('__BINDING_PY__',repr(binding))
 require('__BINDING_PY__' not in local,'ACTIVATION_RENDER_TOKEN')
 query=query.replace('__JOBFINDER_CANDIDATE_ID__',binding['deployment']['candidate']['id'] if binding else 'UNQUALIFIED')
 prefix='const ACTIVATION=Object.freeze('+js({'enabled':True,'mode':'LIVE','deploymentSha256':binding['deploymentSha256'] if binding else '0'*64})+');\n'
 common='// External fixed deployment artifact. No caller configuration or ports.\n'
 common+='const BINDING='+js(binding)+';\nconst LOCAL_SOURCE='+js(local)+';\n'
 common+='const REGISTRATION_SQL='+js(query)+';\nconst ENABLED_PREFIX='+js(prefix)+';\n'
 common+='const ROW_KEYS='+js(ROW_KEYS)+';\n'
 common+=inputs['fixed-host/functions/sha256.js'].decode()+'\n'
 common+='const DRAIN_SOURCE='+js(drain)+';\nconst ROW_SOURCE='+js(rows)+';\n'
 common+=COMMON
 artifacts={name:(common+(HERE.parent/'install/templates'/template).read_text()).encode() for name,template in [('activate-deployment.functions.js','activate.functions.js.in'),('fixed-loader.functions.js','load.functions.js.in')]}
 return {'binding':binding,'artifacts':artifacts,'disabled':disabled,'enabled':enabled}
COMMON=r'''
const PROJECT='yiopvxysxrtrnvqxwgbx',BASE='/workspace/scratch/5e9614251709/job-finder-fixed-live-controller-v1',CHUNK_BYTES=8192;
const capturedTools=Object.freeze({exec_command:tools.exec_command,write_stdin:tools.write_stdin,apply_patch:tools.apply_patch,mcp__codex_apps__supabase_execute_sql:tools.mcp__codex_apps__supabase_execute_sql,mcp__cua_repl__js:tools.mcp__cua_repl__js});
const observationNotify=typeof notify==='function'?notify:null;
const requireFixed=(x,code)=>{if(!x)throw Error(code);};
const digest=s=>responseDigest(s).sha256;
const canonical=x=>x===null||typeof x!=='object'?JSON.stringify(x):Array.isArray(x)?'['+x.map(canonical).join(',')+']':'{'+Object.keys(x).sort().map(k=>JSON.stringify(k)+':'+canonical(x[k])).join(',')+'}';
const deepFreeze=x=>{if(x&&typeof x==='object'){Object.values(x).forEach(deepFreeze);Object.freeze(x);}return x;};deepFreeze(BINDING);
function bindingValid(){
 if(!BINDING||BINDING.schemaVersion!==1)return false;
 const {bindingSha256,...rest}=BINDING,d=BINDING.deployment,row=d?.expectedRow;
 return digest(canonical(rest))===bindingSha256&&d?.kind==='LIVE_DEPLOYMENT'&&d.fixturePreloadSha256===null&&d.projectId===PROJECT&&d.sourceId==='source-hengrui-social'&&row&&Object.keys(row).sort().join(',')===ROW_KEYS.slice().sort().join(',')&&row.commitSha===d.build.commitSha&&row.commitSha===BINDING.remoteCommit.commitSha&&BINDING.remoteCommit.kind==='OFFICIAL_GITHUB_COMMIT_READ'&&BINDING.enabledEntryBytes===BINDING.disabledEntryBytes-1&&['sourceManifestSha256','canonicalDefaultSha256','builderSha256','deploymentSha256','cliSha256','disabledEntrySha256','enabledEntrySha256','bindingSha256'].every(k=>/^[a-f0-9]{64}$/.test(BINDING[k]));
}
const drainOriginalCommand=new Function('tools','notify',DRAIN_SOURCE+'\nreturn drainOriginalCommand;')(capturedTools,observationNotify);
const originalRows=new Function(ROW_SOURCE+'\nreturn rows;')();
function registrationRows(raw){try{requireFixed(raw&&raw.isError!==true,'ACTIVATION_REGISTRATION_TOOL_ERROR');return originalRows(raw);}catch{throw Error('ACTIVATION_REGISTRATION_TOOL_ERROR');}}
const same16=row=>row&&ROW_KEYS.every(k=>Object.hasOwn(row,k)&&row[k]===BINDING.deployment.expectedRow[k]);
function fresh(s){const n=Date.parse(s);requireFixed(typeof s==='string'&&Number.isFinite(n)&&Date.now()>=n&&Date.now()-n<60000,'ACTIVATION_REGISTRATION_AGE');}
const quote=s=>"'"+String(s).replaceAll("'","'\\''")+"'";
async function localActivation(op,value){
 requireFixed(['qualify','commit','read'].includes(op),'ACTIVATION_OPERATION');
 const arg=op==='read'?value:0;
 requireFixed(Number.isSafeInteger(arg)&&arg>=0,'ACTIVATION_OFFSET');
 let cmd='/usr/bin/python3 -I -c '+quote(LOCAL_SOURCE)+' '+quote(op)+' '+arg;
 if(op==='commit'){
  const input=JSON.stringify(value)+'\n',delimiter='FIXED_ACTIVATION_'+digest(input);
  requireFixed(!input.includes('\n'+delimiter+'\n'),'ACTIVATION_DELIMITER');
  cmd+=' <<\''+delimiter+'\'\n'+input+delimiter;
 }
 const initial=await capturedTools.exec_command({cmd,workdir:BASE,max_output_tokens:10000,yield_time_ms:1000});
 const output=await drainOriginalCommand(initial,10000,1000);
 return JSON.parse(output);
}
function verifyQualification(q){requireFixed(q?.kind==='FIXED_ACTIVATION_QUALIFIED'&&q.bindingSha256===BINDING.bindingSha256&&q.disabledSha256===BINDING.disabledEntrySha256&&q.enabledSha256===BINDING.enabledEntrySha256&&q.enabledBytes===BINDING.enabledEntryBytes,'ACTIVATION_QUALIFICATION_RECEIPT');}
'''
def main():
 require(len(sys.argv) in (3,5) and sys.argv[1] in ('check-default','render-bound'),'ACTIVATION_RENDER_USAGE')
 if sys.argv[1]=='check-default':
  require(len(sys.argv)==3,'ACTIVATION_RENDER_USAGE');r=render(Path(sys.argv[2]))
  print(js({'kind':'DEFAULT_ACTIVATION_DISABLED','files':{n:{'sha256':sha(b),'bytes':len(b)} for n,b in r['artifacts'].items()},'createsLiveRoot':False}))
 else:
  require(len(sys.argv)==5,'ACTIVATION_RENDER_USAGE')
  r=render(Path(sys.argv[2]),Path(sys.argv[3]).read_bytes(),json.loads(Path(sys.argv[4]).read_bytes()))
  # Pure return of source. No filesystem emit, tool execution or registration.
  print(js({'binding':r['binding'],'artifacts':{n:b.decode() for n,b in r['artifacts'].items()},'createsLiveRoot':False,'remoteFactRequiresIndependentReview':True}))
if __name__=='__main__':main()
