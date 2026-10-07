// functions.exec AsyncFunction body. Required parameter: sourceKey.
// Run once after the original source loader, before launch/review deadlines.
// This reads/pins local code only; it does not submit SQL or start a producer.
if(typeof sourceKey !== 'string' || sourceKey.length > 64 || sourceKey !== sourceKey.trim() || !/^(?:[a-z][a-z0-9]*|boehringer-ingelheim)$/.test(sourceKey))throw Error('OWNER_SOURCE_KEY');
const ns='proxyNode22:'+sourceKey+':';
const q=s=>"'"+String(s).replaceAll("'","'\\''")+"'";
const result=await tools.exec_command({cmd:'python3 - '+q('/workspace/scratch/5e9614251709/jb-incremental-proxy-runtime-20261007T0057Z/amgen-producer-runtime-1307Z/owner-adaptations/amgen-true-a-1313Z')+' '+q(sourceKey)+" <<'PY_OWNER_LOAD'\n"+
`from pathlib import Path
import hashlib,json,sys
p=Path(sys.argv[1]);source=sys.argv[2]
owner=(p/'publish-and-monitor-owner.js').read_bytes();manifest_bytes=(p/'baseline-manifest.json').read_bytes()
assert hashlib.sha256(owner).hexdigest()=='0417e06e511acb2ebb609b899e8704ac27a828d34e4eb65d2e69b12bdba8b33b'
assert hashlib.sha256(manifest_bytes).hexdigest()=='df4400e53fafdbd1687a76b7f1a8a0ac9a10f273bb5c2c4b5bac231628aa4b6f'
m=json.loads(manifest_bytes);root=Path(m['runtimeRoot'])/'hosts'/source/'host'
files={}
for name in ['host-helper-functions.js','host-stage-functions.js','runtime/continuous-relay-v3-durable-monitor.js','relay-files.mjs','runtime/review-packet-envelope.mts']:
 path=root/name;data=path.read_bytes();assert hashlib.sha256(data).hexdigest()==m['files'][str(path)]['sha256']
 if name in ['host-helper-functions.js','host-stage-functions.js','runtime/continuous-relay-v3-durable-monitor.js']:files[name]=data.decode()
print(json.dumps({'ownerCode':owner.decode(),'ownerSha256':'0417e06e511acb2ebb609b899e8704ac27a828d34e4eb65d2e69b12bdba8b33b','hostRoot':str(root),'files':files}))
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
