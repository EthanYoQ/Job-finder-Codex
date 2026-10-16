"""Small source-only tests. No installation, dependencies or external tools."""
from pathlib import Path
import copy,hashlib,json,subprocess,sys,types,unittest
sys.dont_write_bytecode=True
HERE=Path(__file__).resolve().parents[1]
p=HERE/'build-functions-entry.py';b=types.ModuleType('sequence_test_builder');b.__file__=str(p);exec(compile(p.read_bytes(),str(p),'exec'),b.__dict__)
def synthetic_release(inputs):
 row={k:'a'*64 for k in sorted(b.module(b.PROFILES['takeda']['builder'],inputs[b.PROFILES['takeda']['builder']]).ROW_KEYS)}
 row.update(id='sequence-offline-review-only',goalId='jobfinder-portable-required-40',version=900003,commitSha='c'*40,migrationVersion='20261014141000_v75_retired_candidate_fence',schemaHash='6709fcde7b1953fd1d817d61d3239023fb29ec0ae4fc481efc69ffddbfa13af7',minimumStableCompanyCount=41,status='BUILDING',oracleVersion='staged-official-source-v1')
 candidate={k:row[k] for k in ('id','goalId','version')};db={k:row[k] for k in ('migrationVersion','schemaHash','dbSnapshotHash')}
 build={'schemaVersion':2,'commitSha':row['commitSha'],'sourceTreeSha256':row['sourceTreeHash'],'runtimeTreeSha256':row['runtimeTreeHash']};build['contentSha256']=b.sha(b.encoded(build).encode())
 profiles={};artifacts={}
 for name in b.ORDER:
  p=b.PROFILES[name];cli=b.render_cli(inputs,name)
  profiles[name]={'schemaVersion':1,'kind':'LIVE_DEPLOYMENT','projectId':'yiopvxysxrtrnvqxwgbx','sourceId':p['sourceId'],'sourceConfigSha256':p['sourceConfigSha256'],'candidate':candidate,'databaseIdentity':db,'build':build,'expectedRow':row,'lockSha256':'d'*64,'packageManifestSha256':'e'*64,'preflightSha256':b.sha(cli['fixed-'+name+'-preflight.mjs']),'recoveryHelperSha256':b.sha(cli['fixed-'+name+'-recovery-helper.mts']),'fixturePreloadSha256':None}
  artifacts[name]={**{k:b.sha(v) for k,v in cli.items()},'stableCliSha256':b.sha(b.render_stable_cli(inputs,name))}
 return {'schemaVersion':1,'kind':'CLOSED_THREE_SOURCE_RELEASE','projectId':'yiopvxysxrtrnvqxwgbx','order':list(b.ORDER),'profiles':profiles,'artifacts':artifacts}
class Canonical(unittest.TestCase):
 @classmethod
 def setUpClass(cls):cls.inputs=b.load_source_inputs();cls.release=synthetic_release(cls.inputs)
 def test_default_exact_and_no_authority(self):
  for name,value in b.render_defaults(self.inputs).items():self.assertEqual(value,(HERE/name).read_bytes())
  raw=b.render_entry(self.inputs);self.assertEqual(raw,(HERE/'functions-entry.js').read_bytes());self.assertTrue(raw.startswith(b'const ACTIVATION=Object.freeze({"enabled":false'))
  script="const raw=require('fs').readFileSync(0,'utf8');let n=0;const api=new Function('tools',raw)(new Proxy({}, {get(){return ()=>{n++;throw Error('TOOL');};}}));(async()=>{if(Object.keys(api).join(',')!=='runLiveRound')throw Error('API');if((await api.runLiveRound()).status!=='DISABLED'||n)throw Error('DISABLED');try{await api.runLiveRound({source:'biogen'});throw Error('ARGUMENT_ACCEPTED');}catch(e){if(e.message!=='SEQUENCE_ENTRY_NO_ARGUMENTS')throw e;}})();"
  subprocess.run(['node','-e',script],input=raw,check=True)
 def test_closed_release_build(self):
  b.validate_release(self.inputs,self.release);raw=b.render_entry(self.inputs,self.release).decode()
  self.assertEqual(raw.count('const ACTIVATION='),1);self.assertEqual(raw.count('function create_takeda(sourceCycle)'),1);self.assertEqual(raw.count('function create_biogen(sourceCycle)'),1);self.assertEqual(raw.count('function create_hengrui(sourceCycle)'),1)
  for name in b.ORDER:self.assertIn("BASE+'/sources/"+name+"/rounds/'",raw);self.assertIn('.lifecycle-owner/cli-'+name+'.py',raw)
 def test_profile_cli_compiles_and_isolates_state(self):
  for name in b.ORDER:
   files=b.render_cli(self.inputs,name);cli=files['fixed-'+name+'-preimport-launch.py'].decode();compile(cli,'<sequence-cli>','exec');compile(b.render_stable_cli(self.inputs,name),'<stable-cli>','exec')
   self.assertIn("STATE=BASE/'sources'/"+repr(name),cli);self.assertNotIn("BASE/'active-round.json'",cli);self.assertIn("STATE/'active-round.json'",cli);self.assertIn("ROUNDS=STATE/'rounds'",cli);self.assertIn("BINDINGS=STATE/'connector-host-bindings'",cli)
   self.assertIn("JOBFINDER_FIXED_SEQUENCE_LAYOUT':'TAKEDA_BIOGEN_HENGRUI_V1'",cli)
 def test_release_cross_wires_rejected(self):
  variants=[]
  def changed(fn):r=copy.deepcopy(self.release);fn(r);variants.append(r)
  changed(lambda r:r['order'].reverse());changed(lambda r:r['profiles'].pop('biogen'));changed(lambda r:r['profiles'].pop('hengrui'))
  changed(lambda r:r['profiles']['biogen']['candidate'].update(id='other'))
  changed(lambda r:r['profiles']['biogen'].update(sourceConfigSha256='f'*64));changed(lambda r:r['profiles']['hengrui'].update(sourceConfigSha256=r['profiles']['biogen']['sourceConfigSha256']));changed(lambda r:r['profiles']['hengrui'].update(sourceId='source-hengrui-china-social'))
  changed(lambda r:r['artifacts']['biogen'].update(stableCliSha256='f'*64))
  changed(lambda r:r['profiles']['biogen'].update(preflightSha256=r['profiles']['takeda']['preflightSha256']))
  for r in variants:
   with self.assertRaises(RuntimeError):b.validate_release(self.inputs,r)
 def test_shared_and_source_native_paths(self):
  script="const p=await import("+json.dumps((b.PACKAGE/'vendor/c60-source/ops/cloud-pilot-host/connector-host-binding.mjs').as_uri())+");console.log(JSON.stringify({state:p.STATE_ROOT,task:p.TASK_ROOT}));"
  import os
  for name in b.ORDER:
   env={**os.environ,'JOBFINDER_FIXED_SEQUENCE_LAYOUT':'TAKEDA_BIOGEN_HENGRUI_V1','JOBFINDER_CLOUD_SOURCE_ID':b.PROFILES[name]['sourceId'],'JOBFINDER_CONNECTOR_ROUND_ID':'round-'+'a'*32}
   value=json.loads(subprocess.check_output(['node','--input-type=module','-e',script],env=env));self.assertTrue(value['state'].endswith('/sources/'+name));self.assertTrue(value['task'].endswith('/sources/'+name+'/rounds/round-'+'a'*32+'/connector-host-task'))
  env={**env,'JOBFINDER_CLOUD_SOURCE_ID':'source-lilly-china-social'}
  result=subprocess.run(['node','--input-type=module','-e',script],env=env,capture_output=True);self.assertNotEqual(result.returncode,0);self.assertIn(b'HOST_SEQUENCE_LAYOUT',result.stderr)
if __name__=='__main__':unittest.main()
