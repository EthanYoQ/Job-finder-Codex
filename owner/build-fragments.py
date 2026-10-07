from pathlib import Path
import hashlib,json
base=Path(__file__).resolve().parent
owner_sha=hashlib.sha256((base/'publish-and-monitor-owner.js').read_bytes()).hexdigest()
manifest_sha=hashlib.sha256((base/'baseline-manifest.json').read_bytes()).hexdigest()
preload='''// functions.exec AsyncFunction body. Required parameter: sourceKey === 'novartisNext'.
// Run after the actual Novartis source loader has stored its verified next-runtime binding.
// Local code/binding reads only; no SQL, producer start or activation.
if(sourceKey!=='novartisNext')throw Error('OWNER_SOURCE_KEY');
const ns='proxyNode22:novartisNext:';
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const q=s=>"'"+String(s).replaceAll("'","'\\\\''")+"'";
const result=await tools.exec_command({cmd:'python3 - '+q('__BASE__')+' '+q(sourceKey)+" <<'PY_OWNER_LOAD'\\n"+
`from pathlib import Path
import hashlib,json,re,sys
p=Path(sys.argv[1]);source=sys.argv[2]
assert source=='novartisNext'
owner=(p/'publish-and-monitor-owner.js').read_bytes();manifest_bytes=(p/'baseline-manifest.json').read_bytes()
assert hashlib.sha256(owner).hexdigest()=='__OWNER_SHA__'
assert hashlib.sha256(manifest_bytes).hexdigest()=='__MANIFEST_SHA__'
m=json.loads(manifest_bytes);root=Path(m['hostRoot'])
assert m['sourceKey']=='novartisNext' and m['namespace']=='proxyNode22:novartisNext:'
assert m['sourceId']=='source-novartis-social'
assert m['producerCommit']=='0edb12df2ea9b466b25eb388eff1f230636bbd7e'
assert root==Path(m['runtimeRoot'])/'hosts'/'novartis-next'/'host'
names=['host-helper-functions.js','host-stage-functions.js','runtime/continuous-relay-v3-durable-monitor.js','relay-files.mjs','runtime/review-packet-envelope.mts']
assert set(m['files'])=={str(root/name) for name in names}
files={}
for name in names:
 path=root/name;data=path.read_bytes();assert hashlib.sha256(data).hexdigest()==m['files'][str(path)]['sha256']
 if name in names[:3]:files[name]=data.decode()
cfg=json.loads((root/'host-config.json').read_bytes());binding=json.loads((root/'activation.json').read_bytes());control=json.loads((root/'control-base.json').read_bytes())
assert cfg==m['hostConfig']
assert binding['status']=='REGISTERED_VERIFIED' and binding['build']==control['build']==m['build']
candidate=binding.get('candidate');assert isinstance(candidate,dict) and set(candidate)=={'id','goalId','version'}
assert type(candidate['version']) is int and candidate['version']>52 and candidate['goalId']=='jobfinder-portable-required-40'
assert isinstance(candidate['id'],str) and re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._-]{0,99}',candidate['id'])
assert candidate==control['candidate']==m['expectedCandidate']
db=binding.get('databaseIdentity');assert isinstance(db,dict) and set(db)=={'migrationVersion','schemaHash','dbSnapshotHash'}
assert db['migrationVersion']=='20261006172300_job_projection_delta_contract'
assert all(isinstance(db[k],str) and re.fullmatch(r'[a-f0-9]{64}',db[k]) for k in ['schemaHash','dbSnapshotHash'])
assert db==control['databaseIdentity']
assert binding['contextReadSha256']==hashlib.sha256((root/'context-read.sql').read_bytes()).hexdigest()
print(json.dumps({'ownerCode':owner.decode(),'ownerSha256':'__OWNER_SHA__','hostRoot':str(root),'hostConfig':cfg,'registeredBinding':binding,'files':files}))
`+'PY_OWNER_LOAD',max_output_tokens:22000,yield_time_ms:1000});
if(result.exit_code!==0||result.session_id)throw Error('OWNER_PRELOAD_LOCAL_READ_FAILED');
const p=JSON.parse(result.output);
if(p.ownerSha256!=='__OWNER_SHA__'||load(ns+'cloudPilotHostHelpers')!==p.files['host-helper-functions.js']||
 load(ns+'cloudPilotHostStages')!==p.files['host-stage-functions.js']||
 load(ns+'continuousPortableRelayCodeWithPoll')!==p.files['runtime/continuous-relay-v3-durable-monitor.js']||
 !same(load(ns+'cloudPilotHostConfig'),p.hostConfig)||p.hostConfig.root!==p.hostRoot||
 !same(load(ns+'registeredCandidateBinding'),p.registeredBinding))throw Error('OWNER_PRELOAD_STORED_BINDING_OR_CODE_MISMATCH');
store(ns+'publishMonitorPrepared',{ownerCode:p.ownerCode,ownerSha256:p.ownerSha256,
 helperCode:p.files['host-helper-functions.js'],stageCode:p.files['host-stage-functions.js'],
 monitorCode:p.files['runtime/continuous-relay-v3-durable-monitor.js'],hostRoot:p.hostRoot,
 hostConfig:p.hostConfig,registeredBinding:p.registeredBinding});
text({status:'OWNER_CODE_AND_ACTUAL_BINDING_PINNED_NO_LAUNCH',sourceKey,ownerSha256:p.ownerSha256,
 candidateId:p.registeredBinding.candidate.id,candidateVersion:p.registeredBinding.candidate.version});
'''.replace('__BASE__',str(base)).replace('__OWNER_SHA__',owner_sha).replace('__MANIFEST_SHA__',manifest_sha)
(base/'preload-owner.exec.js').write_text(preload)
entry='''// functions.exec AsyncFunction body. Required: sourceKey === 'novartisNext', ownerMode.
// publish: one new parent-reviewed original PUBLISH. resume: only after returned UNRESOLVED.
// A yielded/running cell continues with functions.wait; never duplicate its owner.
if(sourceKey!=='novartisNext'||!['publish','resume'].includes(ownerMode))throw Error('OWNER_ENTRY_ARGUMENT');
const ns='proxyNode22:novartisNext:',p=load(ns+'publishMonitorPrepared');
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
if(p?.ownerSha256!=='__OWNER_SHA__'||
 p.helperCode!==load(ns+'cloudPilotHostHelpers')||p.stageCode!==load(ns+'cloudPilotHostStages')||
 p.monitorCode!==load(ns+'continuousPortableRelayCodeWithPoll')||p.hostRoot!==load(ns+'cloudPilotHostConfig')?.root||
 !p.registeredBinding||!same(p.registeredBinding,load(ns+'registeredCandidateBinding'))||
 !same(p.hostConfig,load(ns+'cloudPilotHostConfig')))throw Error('OWNER_ENTRY_NOT_PINNED');
const A=Object.getPrototypeOf(async function(){}).constructor;
const stages=await new A(p.stageCode)();
const owner=await new A('env',p.ownerCode)({tools,load,store,notify,text});
const request=load(ns+'cloudPilotPublishRequest');
// Await the complete lifetime in THIS cell, without a reporting gap after PUBLISH.
await owner({sourceKey,stages,monitorCode:p.monitorCode,request,sql:request?.payload?.sql,mode:ownerMode});
'''.replace('__OWNER_SHA__',owner_sha)
(base/'publish-reviewed-and-monitor.exec.js').write_text(entry)
print(json.dumps({'ownerSha256':owner_sha,'baselineManifestSha256':manifest_sha},indent=2))
