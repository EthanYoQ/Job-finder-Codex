// functions.exec AsyncFunction body. Required parameter: sourceKey.
// Run once after the original source loader, before launch/review deadlines.
// This reads/pins local code only; it does not submit SQL or start a producer.
if(typeof sourceKey !== 'string' || sourceKey.length > 64 || sourceKey !== sourceKey.trim() || !/^(?:[a-z][a-z0-9]*|boehringer-ingelheim)$/.test(sourceKey))throw Error('OWNER_SOURCE_KEY');
const ns='proxyNode22:'+sourceKey+':';
const q=s=>"'"+String(s).replaceAll("'","'\\''")+"'";
const result=await tools.exec_command({cmd:'python3 - '+q('/workspace/scratch/5e9614251709/jb-incremental-proxy-runtime-20261007T0057Z/gsk-producer-runtime-1529Z/owner-adaptations/gsk-true-a-1537Z')+' '+q(sourceKey)+" <<'PY_OWNER_LOAD'\n"+
`from pathlib import Path
import hashlib,json,sys
p=Path(sys.argv[1]);source=sys.argv[2]
owner=(p/'publish-and-monitor-owner.js').read_bytes();manifest_bytes=(p/'baseline-manifest.json').read_bytes()
assert hashlib.sha256(owner).hexdigest()=='f50afb91e8006b14a1336e09fc917606d834220aec5e8980d9c71697ae8bf344'
assert hashlib.sha256(manifest_bytes).hexdigest()=='430be8c3a1e42ba9bc0abed11c0aab31bf5d453fab2b54678afc843160b97115'
m=json.loads(manifest_bytes);root=Path(m['runtimeRoot'])/'hosts'/source/'host'
files={}
for name in ['host-helper-functions.js','host-stage-functions.js','runtime/continuous-relay-v3-durable-monitor.js','relay-files.mjs','runtime/review-packet-envelope.mts']:
 path=root/name;data=path.read_bytes();assert hashlib.sha256(data).hexdigest()==m['files'][str(path)]['sha256']
 if name in ['host-helper-functions.js','host-stage-functions.js','runtime/continuous-relay-v3-durable-monitor.js']:files[name]=data.decode()
print(json.dumps({'ownerCode':owner.decode(),'ownerSha256':'f50afb91e8006b14a1336e09fc917606d834220aec5e8980d9c71697ae8bf344','hostRoot':str(root),'files':files}))
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
