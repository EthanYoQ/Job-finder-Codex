"""Final TEST_ONLY installed wiring probe. Leaves the original global HOLD.

The original holder keeps SH/ACTIVE while the three exact installed stable CLIs
are independently invoked with only prepare. No business entry is evaluated,
no child is launched, no bootstrap SQL is called, and no cycle is completed.
Do not reuse this retained case as a fresh cycle after this final probe.
"""
from pathlib import Path
import hashlib,json,os,select,subprocess,sys,types
sys.dont_write_bytecode=True
sha=lambda raw:hashlib.sha256(raw).hexdigest()
SOURCE_IDS={'takeda':'source-takeda-china-social','biogen':'source-biogen-china-social','hengrui':'source-hengrui-social'}
REPORT_KIND='ACTUAL_INSTALLED_THREE_STABLE_CLI_PREPARE_ONLY_FINAL_HOLD'
def validate_prepared_identities(results):
 # Pure checks over the actual probe results; this never creates authority or
 # fabricates a receipt. Every individual identity must be distinct three ways.
 assert type(results) is list and [r['profile'] for r in results]==['takeda','biogen','hengrui']
 for r in results:
  assert r['prepared']['seed']['sourceId']==SOURCE_IDS[r['profile']]
  assert r['prepared']['cfg']['sourceId']==SOURCE_IDS[r['profile']]
 assert len({r['prepared']['roundId'] for r in results})==3
 assert len({r['stateRoot'] for r in results})==3
 for field in ('batchId','launchChallenge'):
  assert len({r['prepared']['seed'][field] for r in results})==3
def probe(case,evidence):
 case=Path(case).resolve();evidence=Path(evidence).resolve()
 assert case.parent==evidence/'lifecycle-cases' and case.name.startswith('case-')
 assert 'job-finder-fixed-live-controller-v1' not in case.parts
 owner=case/'.installed-disabled.lifecycle-owner';target=case/'installed-disabled'
 manifest=json.loads((owner/'OWNER_MANIFEST.json').read_bytes());binding=json.loads((owner/'binding.json').read_bytes())
 activation=case/'strict-disabled-activation-result.json'
 assert json.loads(activation.read_bytes())['passed'] is True
 assert (target/'candidate/functions-entry.enabled.js').is_file()
 assert set(binding['profiles'])=={'takeda','biogen','hengrui'}
 for name in ('holder.py','cli-takeda.py','cli-biogen.py','cli-hengrui.py','lifecycle_lock.py'):
  assert sha((owner/name).read_bytes())==manifest['files'][name]['sha256']
 active=case/'.installed-disabled.lifecycle-active.json';assert not active.exists()
 before={'activationResultSha256':sha(activation.read_bytes()),'ownerManifestSha256':sha((owner/'OWNER_MANIFEST.json').read_bytes()),'normalInstallActivationPassedBeforeProbe':True}
 (case/'before-final-prepare-probe.json').write_text(json.dumps(before,indent=2)+'\n')
 process=subprocess.Popen(['/usr/bin/python3','-I','-u',str(owner/'holder.py')],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,env={'PATH':'/usr/bin:/bin','PYTHONDONTWRITEBYTECODE':'1'})
 results=[]
 try:
  assert select.select([process.stdout],[],[],30)[0],'ORIGINAL_HOLDER_TIMEOUT'
  ready=json.loads(process.stdout.readline());assert ready['kind']=='LIFECYCLE_READY';assert active.exists()
  # The original holder has not received read: executable business bytes are
  # never evaluated. These calls test only independently installed wiring.
  for profile in ('takeda','biogen','hengrui'):
   env={'PATH':'/usr/bin:/bin','LANG':'C.UTF-8','PYTHONDONTWRITEBYTECODE':'1','JOBFINDER_FIXED_LOCAL_MODE':'LIVE','JOBFINDER_FIXED_DEPLOYMENT_SHA256':binding['profiles'][profile]['deploymentSha256']}
   run=subprocess.run(['/usr/bin/python3','-I',str(owner/('cli-'+profile+'.py')),'prepare'],capture_output=True,timeout=120,env=env)
   (case/('prepare-'+profile+'.stdout')).write_bytes(run.stdout);(case/('prepare-'+profile+'.stderr')).write_bytes(run.stderr)
   assert run.returncode==0,(profile,run.stdout,run.stderr)
   value=json.loads(run.stdout);assert value['kind']=='FIXED_PREFLIGHT'
   root=target/'sources'/profile;round_root=root/'rounds'/value['roundId'];task=round_root/'connector-host-task'
   assert value['seed']['sourceId']==SOURCE_IDS[profile]
   assert value['cfg']['sourceId']==value['seed']['sourceId'] and value['cfg']['taskRoot']==str(task)
   assert value['cfg']['relayDirectory']==str(task/'relay') and sha(value['bootstrap']['query'].encode())==value['bootstrap']['querySha256']
   assert (root/'active-round.json').is_file() and (task/'prepared.json').is_file()
   assert not (task/'launch-intent.json').exists() and list((task/'relay').iterdir())==[]
   assert process.poll() is None and active.exists()
   results.append({'profile':profile,'prepared':value,'stateRoot':str(root),'launchIntentAbsent':True,'relayEmpty':True,'nativeConnectorValidatePassed':True})
  validate_prepared_identities(results)
 finally:
  if process.stdin:process.stdin.close()
  try:process.wait(timeout=15)
  except subprocess.TimeoutExpired:process.kill();process.wait(timeout=15)
  (case/'prepare-probe-holder.stderr').write_bytes(process.stderr.read())
  process.stdout.close();process.stderr.close()
 assert process.returncode==78 and active.exists(),'ORIGINAL_HOLDER_ABANDONMENT_MUST_RETAIN_ACTIVE'
 m=types.ModuleType('installed_probe_lock');m.__file__=str(owner/'lifecycle_lock.py');sys.modules[m.__name__]=m
 raw=Path(m.__file__).read_bytes();assert sha(raw)==binding['moduleSha256'];exec(compile(raw,m.__file__,'exec'),m.__dict__)
 domain=m.Domain.from_json(json.dumps(binding['domain']))
 try:
  with m.exclusive_transaction(domain):raise AssertionError('UNKNOWN_PROBE_UNEXPECTEDLY_ALLOWED_EX')
 except m.Hold as error:assert str(error)=='ACTIVE_OR_UNKNOWN_ROUND'
 report={'kind':REPORT_KIND,'passed':True,'before':before,'sources':results,'originalHolderExit':process.returncode,'globalActiveRetained':True,'caseReusableForFreshCycle':False,'businessEntryEvaluated':False,'sourceChildLaunches':0,'officialSqlCalls':0,'realExternalNetworkCalls':0,'cycleCompleted':False,'productionQualified':False}
 (case/'final-prepare-probe-HOLD.json').write_text(json.dumps(report,indent=2)+'\n')
 return report
if __name__=='__main__':
 assert len(sys.argv)==3;print(json.dumps(probe(sys.argv[1],sys.argv[2])))
