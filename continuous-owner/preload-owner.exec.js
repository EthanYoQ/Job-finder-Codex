// functions.exec AsyncFunction body. Required parameter: sourceKey === 'gileadNext'.
// Run after the actual Gilead source loader has stored its verified next-runtime binding.
// Local code/binding reads only; no SQL, producer start or activation.
if(sourceKey!=='gileadNext')throw Error('OWNER_SOURCE_KEY');
const ns='proxyNode22:gileadNext:';
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const q=s=>"'"+String(s).replaceAll("'","'\\''")+"'";
const result=await tools.exec_command({cmd:'python3 - '+q('/workspace/scratch/5e9614251709/jb-incremental-proxy-runtime-20261007T0057Z/verification/gilead-producer-runtime-0551Z/continuous-owner')+' '+q(sourceKey)+" <<'PY_OWNER_LOAD'\n"+
`from pathlib import Path
import hashlib,json,re,sys
p=Path(sys.argv[1]);source=sys.argv[2]
assert source=='gileadNext'
owner=(p/'publish-and-monitor-owner.js').read_bytes();manifest_bytes=(p/'baseline-manifest.json').read_bytes()
assert hashlib.sha256(owner).hexdigest()=='b5d8e549f9165bd7122526c799cf8a2c6e4585104cb2078059586dc65113da70'
assert hashlib.sha256(manifest_bytes).hexdigest()=='aadf8c163059d7902fdfbca1e6c308eb6a05cc5e48cf11f4938152d04d5f06e9'
m=json.loads(manifest_bytes);root=Path(m['hostRoot'])
assert m['sourceKey']=='gileadNext' and m['namespace']=='proxyNode22:gileadNext:'
assert m['sourceId']=='source-gilead-china-social'
assert m['producerCommit']=='d6190919d17c8ba4ee721daa2087d3c09bded7fa'
assert root==Path(m['runtimeRoot'])/'hosts'/'gilead'/'host'
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
assert type(candidate['version']) is int and candidate['version']>51 and candidate['goalId']=='jobfinder-portable-required-40'
assert isinstance(candidate['id'],str) and re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._-]{0,99}',candidate['id'])
assert candidate==control['candidate']==m['expectedCandidate']
db=binding.get('databaseIdentity');assert isinstance(db,dict) and set(db)=={'migrationVersion','schemaHash','dbSnapshotHash'}
assert db['migrationVersion']=='20261006172300_job_projection_delta_contract'
assert all(isinstance(db[k],str) and re.fullmatch(r'[a-f0-9]{64}',db[k]) for k in ['schemaHash','dbSnapshotHash'])
assert db==control['databaseIdentity']
assert binding['contextReadSha256']==hashlib.sha256((root/'context-read.sql').read_bytes()).hexdigest()
print(json.dumps({'ownerCode':owner.decode(),'ownerSha256':'b5d8e549f9165bd7122526c799cf8a2c6e4585104cb2078059586dc65113da70','hostRoot':str(root),'hostConfig':cfg,'registeredBinding':binding,'files':files}))
`+'PY_OWNER_LOAD',max_output_tokens:22000,yield_time_ms:1000});
if(result.exit_code!==0||result.session_id)throw Error('OWNER_PRELOAD_LOCAL_READ_FAILED');
const p=JSON.parse(result.output);
if(p.ownerSha256!=='b5d8e549f9165bd7122526c799cf8a2c6e4585104cb2078059586dc65113da70'||load(ns+'cloudPilotHostHelpers')!==p.files['host-helper-functions.js']||
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
