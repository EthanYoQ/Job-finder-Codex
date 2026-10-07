from pathlib import Path
import hashlib,json
base=Path(__file__).resolve().parent
owner_sha=hashlib.sha256((base/'publish-and-monitor-owner.js').read_bytes()).hexdigest()
manifest_sha=hashlib.sha256((base/'baseline-manifest.json').read_bytes()).hexdigest()
preload='''// functions.exec AsyncFunction body. Required parameter: sourceKey.
// Run once after the original source loader, before launch/review deadlines.
// This reads/pins local code only; it does not submit SQL or start a producer.
if(!/^[a-z][a-z0-9]*$/.test(sourceKey))throw Error('OWNER_SOURCE_KEY');
const ns='proxyNode22:'+sourceKey+':';
const q=s=>"'"+String(s).replaceAll("'","'\\\\''")+"'";
const result=await tools.exec_command({cmd:'python3 - '+q('__BASE__')+' '+q(sourceKey)+" <<'PY_OWNER_LOAD'\\n"+
`from pathlib import Path
import hashlib,json,sys
p=Path(sys.argv[1]);source=sys.argv[2]
owner=(p/'publish-and-monitor-owner.js').read_bytes();manifest_bytes=(p/'baseline-manifest.json').read_bytes()
assert hashlib.sha256(owner).hexdigest()=='__OWNER_SHA__'
assert hashlib.sha256(manifest_bytes).hexdigest()=='__MANIFEST_SHA__'
m=json.loads(manifest_bytes);root=Path(m['runtimeRoot'])/'hosts'/source/'host'
files={}
for name in ['host-helper-functions.js','host-stage-functions.js','runtime/continuous-relay-v3-durable-monitor.js','relay-files.mjs','runtime/review-packet-envelope.mts']:
 path=root/name;data=path.read_bytes();assert hashlib.sha256(data).hexdigest()==m['files'][str(path)]['sha256']
 if name in ['host-helper-functions.js','host-stage-functions.js','runtime/continuous-relay-v3-durable-monitor.js']:files[name]=data.decode()
print(json.dumps({'ownerCode':owner.decode(),'ownerSha256':'__OWNER_SHA__','hostRoot':str(root),'files':files}))
`+'PY_OWNER_LOAD',max_output_tokens:20000,yield_time_ms:1000});
if(result.exit_code!==0||result.session_id)throw Error('OWNER_PRELOAD_LOCAL_READ_FAILED');
const p=JSON.parse(result.output);
if(load(ns+'cloudPilotHostHelpers')!==p.files['host-helper-functions.js']||
 load(ns+'cloudPilotHostStages')!==p.files['host-stage-functions.js']||
 load(ns+'continuousPortableRelayCodeWithPoll')!==p.files['runtime/continuous-relay-v3-durable-monitor.js']||
 load(ns+'cloudPilotHostConfig')?.root!==p.hostRoot)throw Error('OWNER_PRELOAD_STORED_CODE_MISMATCH');
store(ns+'publishMonitorPrepared',{ownerCode:p.ownerCode,ownerSha256:p.ownerSha256,
 helperCode:p.files['host-helper-functions.js'],stageCode:p.files['host-stage-functions.js'],
 monitorCode:p.files['runtime/continuous-relay-v3-durable-monitor.js'],hostRoot:p.hostRoot});
text({status:'OWNER_CODE_PINNED_NO_LAUNCH',sourceKey,ownerSha256:p.ownerSha256});
'''.replace('__BASE__',str(base)).replace('__OWNER_SHA__',owner_sha).replace('__MANIFEST_SHA__',manifest_sha)
(base/'preload-owner.exec.js').write_text(preload)
entry='''// functions.exec AsyncFunction body. Required parameters: sourceKey, ownerMode.
// ownerMode='publish' only for a new, parent-reviewed original PUBLISH request.
// ownerMode='resume' only after this owner's prior cell returned UNRESOLVED.
// A yielded/running cell must be continued with functions.wait, never duplicated.
if(!/^[a-z][a-z0-9]*$/.test(sourceKey)||!['publish','resume'].includes(ownerMode))throw Error('OWNER_ENTRY_ARGUMENT');
const ns='proxyNode22:'+sourceKey+':',p=load(ns+'publishMonitorPrepared');
if(p?.ownerSha256!=='__OWNER_SHA__'||
 p.helperCode!==load(ns+'cloudPilotHostHelpers')||p.stageCode!==load(ns+'cloudPilotHostStages')||
 p.monitorCode!==load(ns+'continuousPortableRelayCodeWithPoll')||p.hostRoot!==load(ns+'cloudPilotHostConfig')?.root)throw Error('OWNER_ENTRY_NOT_PINNED');
const A=Object.getPrototypeOf(async function(){}).constructor;
const stages=await new A(p.stageCode)();
const owner=await new A('env',p.ownerCode)({tools,load,store,notify,text});
const request=load(ns+'cloudPilotPublishRequest');
// The complete lifetime is awaited in THIS cell. No promise is dropped at return.
await owner({sourceKey,stages,monitorCode:p.monitorCode,request,sql:request?.payload?.sql,mode:ownerMode});
'''.replace('__OWNER_SHA__',owner_sha)
(base/'publish-reviewed-and-monitor.exec.js').write_text(entry)
print(json.dumps({'ownerSha256':owner_sha,'baselineManifestSha256':manifest_sha},indent=2))
