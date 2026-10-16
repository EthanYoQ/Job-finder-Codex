"""TEST_ONLY fixed-path compilation mapping. Source files remain untouched.
Actual measured source/native gates, production owner renderer, original reader
proof and original activation qualifier execute. Official observations synthetic.
"""
from pathlib import Path
import hashlib,importlib.util,json,os,shutil,subprocess,sys,time,types,unittest
PROFILE=Path(__file__).resolve().parent;HERE=PROFILE.parent/'install';HOST=HERE.parent;ROOT=HOST.parents[2]
spec=importlib.util.spec_from_file_location('actual_install_tests',HERE/'test-holder-processes.py');t=importlib.util.module_from_spec(spec);spec.loader.exec_module(t)
SOURCE=Path(t.PINS['sourceRoot'])/'tools/dot-auto-controller/fixed-host'
if os.environ.get('INSTALL_TEST_READER_FIXTURE'):
 READER=json.loads(Path(os.environ['INSTALL_TEST_READER_FIXTURE']).read_text())
else:
 readercase=t.EVIDENCE/'reader-cases'/('case-bound-'+__import__('uuid').uuid4().hex)
 READER=json.loads(subprocess.check_output([t.NODE,str(HERE/'test-reader-fixture.mjs'),str(readercase)],text=True,env={'PATH':'/usr/bin:/bin','INSTALL_TEST_EVIDENCE':str(t.EVIDENCE)}))
 (readercase/'fixture.json').write_text(json.dumps(READER))
LIVE='/workspace/scratch/5e9614251709/job-finder-fixed-live-controller-v1';PARENT='/workspace/scratch/5e9614251709';TARGET='job-finder-fixed-live-controller-v1'
def mapped(raw,f):
 s=raw.decode() if type(raw) is bytes else raw
 s=s.replace(LIVE,str(f['target'])).replace(repr(PARENT),repr(str(f['case']))).replace(json.dumps(PARENT),json.dumps(str(f['case']))).replace(repr(TARGET),repr('installed-disabled')).replace(json.dumps(TARGET),json.dumps('installed-disabled'))
 return s

def make_fixture():
 f=t.prepare_case(READER['readerExpected'])
 derived=subprocess.check_output([sys.executable,'-B',str(PROFILE/'test-derive-release.py'),str(t.PINS_PATH),str(f['target'])],text=True)
 d=json.loads(derived);deployment=json.loads(d['deploymentBytes'])
 f['control'].update(deploymentBytes=json.dumps(deployment,separators=(',',':')),expectedRow=deployment['profiles']['takeda']['expectedRow'])
 f['binding']['scope']['kind']='FIXED_PRODUCTION';f['binding']['measuredPins']=t.PINS
 lifecycle=mapped(t.build.render_fixed_module((SOURCE/'lifecycle/lifecycle_lock.py').read_text()),f)
 f['lifecycle']=lifecycle
 bound=(SOURCE/'sequence/bound-artifacts.py.in').read_text()
 map_def='\ndef test_map_root(raw):\n s=raw.decode()\n s=s.replace('+repr(LIVE)+','+repr(str(f['target']))+').replace('+repr(repr(PARENT))+','+repr(repr(str(f['case'])))+').replace('+repr(json.dumps(PARENT))+','+repr(json.dumps(str(f['case'])))+').replace('+repr(repr(TARGET))+','+repr(repr('installed-disabled'))+').replace('+repr(json.dumps(TARGET))+','+repr(json.dumps('installed-disabled'))+')\n return s.encode()\n'
 bound+=map_def
 needle="require(len(raw)==entry['bytes'] and sha(raw)==entry['sha256'],'BOUND_MEASURED_SOURCE');return raw"
 assert bound.count(needle)==1
 bound=bound.replace(needle,"require(len(raw)==entry['bytes'] and sha(raw)==entry['sha256'],'BOUND_MEASURED_SOURCE');return test_map_root(raw) if relative in ('fixed-host/sequence/local-activation.py.in','fixed-host/scripts/build-lifecycle-artifacts.py','fixed-host/lifecycle/lifecycle_lock.py') else raw")
 values={'__FIXED_INSTALL_HOLDER_BINDING__':f['binding'],'__FIXED_INSTALL_LIFECYCLE_SOURCE__':lifecycle,'__FIXED_INSTALL_STAGING_SOURCE__':(SOURCE/'install/staging.py.in').read_text(),'__FIXED_INSTALL_READER_SOURCE__':READER['helperSource'],'__FIXED_INSTALL_FACTS_SOURCE__':(SOURCE/'install/facts.mjs').read_text(),'__FIXED_INSTALL_BOUND_ARTIFACTS_SOURCE__':bound}
 source=mapped((HERE/'install-holder.py.in').read_text(),f)
 source=source.replace("name in ('candidate/fixed-preimport-launch.py','candidate/fixed-preflight.mjs','candidate/fixed-recovery-helper.mts')","name in ('candidate/fixed-takeda-preimport-launch.py','candidate/fixed-takeda-preflight.mjs','candidate/fixed-takeda-recovery-helper.mts','candidate/fixed-biogen-preimport-launch.py','candidate/fixed-biogen-preflight.mjs','candidate/fixed-biogen-recovery-helper.mts')")
 for key,v in values.items():assert source.count(key)==1;source=source.replace(key,repr(v))
 # Root mapping hooks run only AFTER the original source hashes/default render
 # match. This is the same method as the prior independent actual-path harness.
 hooks='''
def test_remap_builder(obj):
 ns=obj if type(obj) is dict else obj.__dict__
 ns['LIVE_ROOT']=TEST_ROOT
 return obj
_original_test_module=module
def module(name,raw,namespace=None):
 m=_original_test_module(name,raw,namespace)
 if name=='install_bound_artifact_renderer':
  original_load=m.load
  def load(path,raw,name,values=None):
   v=original_load(path,raw,name,values)
   if name=='sequence_original_activation':
    original_inputs=v.source_inputs
    def inputs(p):
     result=original_inputs(p)
     test_remap_builder(result[0]);return result
    v.source_inputs=inputs
   return v
  m.load=load
 if name=='install_final_qualify':
  original_pinned=m.pinned_module
  def pinned(path,digest):
   result=original_pinned(path,digest)
   if pathlib.Path(path).name=='build-functions-entry.py':test_remap_builder(result)
   return result
  m.pinned_module=pinned
 return m
'''
 source=source.replace("if __name__=='__main__':",'TEST_ROOT='+repr(str(f['target']))+'\n'+hooks+"\nif __name__=='__main__':")
 source=source.replace("emit({'kind':'INSTALL_HOLD','reason':str(error)})","__import__('traceback').print_exc();emit({'kind':'INSTALL_HOLD','reason':str(error)})")
 f['source']=source;return f
class FullTests(unittest.TestCase):
 def setUp(self):self.f=make_fixture();self.ps=[]
 def tearDown(self):
  for p in self.ps:p.close()
  # Preserve success, partial and UNKNOWN cases for independent review.
  pass
 def start(self,**kw):p=t.Process(self.f,**kw);self.ps.append(p);return p
 def staged_reader(self,p):
  ready=p.read();self.assertEqual(ready.get('kind'),'INSTALL_READY',(ready,p.stderr.decode()));p.send('stage');r=p.read()
  self.assertEqual(r.get('kind'),'INSTALL_RESULT',(r,p.stderr.decode()));self.assertEqual(r.get('result',{}).get('kind'),'INSTALL_STAGED',(r,p.stderr.decode()));p.send('reader');r=p.read()
  self.assertEqual(r.get('kind'),'INSTALL_RESULT',(r,p.stderr.decode()));self.assertEqual(r.get('result',{}).get('kind'),'INSTALL_READER_VERIFIED',(r,p.stderr.decode()));return t.facts(self.f,r['result']['identity'],ready['nonce'])
 def assert_unknown(self):
  m,d=t.domain_for(self.f)
  for mode in ('SH','EX'):
   with self.assertRaisesRegex(m.Hold,'ACTIVE_OR_UNKNOWN_MUTATION'):d.acquire(mode)
  p=self.start();self.assertEqual(p.read()['reason'],'INSTALL_EXISTING_OR_UNKNOWN')
 def test_actual_bound_install_and_strict_disabled_entry(self):
  p=self.start(use_pty=True);payload=self.staged_reader(p);self.assertGreater(p.send('publish',payload),16384);r=p.read();self.assertEqual(r['kind'],'INSTALL_RESULT',(r,p.stderr.decode()));self.assertEqual(r['result']['kind'],'FIXED_CONTROLLER_INSTALLED_DISABLED');p.send('finish');self.assertEqual(p.read()['kind'],'INSTALL_FINISHED');p.p.wait(timeout=10)
  m,d=t.domain_for(self.f)
  with m.exclusive_transaction(d) as lease:lease.finish_mutation_from_owned_transaction()
  manifest=json.loads((self.f['owner']/'OWNER_MANIFEST.json').read_text());self.assertGreater(len(manifest['files']),5);self.assertGreater(len(manifest['targetFiles']),5);self.assertFalse((self.f['target']/'candidate/functions-entry.enabled.js').exists())
  # Run the actual rendered stable functions loader and actual holder. No fake
  # inner entry: strict DISABLED performs the original native preflight.
  code="import fs from 'node:fs';import {holderTools} from "+json.dumps((HOST/'tests/lifecycle-bridge.test.mjs').as_uri())+";const f={stable:"+json.dumps(str(self.f['owner']))+"};const owner=holderTools(f,{});try{const api=new Function('tools',fs.readFileSync(f.stable+'/functions-loader.js','utf8'))(owner.tools);console.log(JSON.stringify(await api.runPinnedRound()));}finally{await owner.stop();}"
  result=subprocess.run([t.NODE,'--input-type=module','-e',code],capture_output=True,text=True,timeout=120,env={'PATH':'/usr/bin:/bin'});self.assertEqual(result.returncode,0,result.stderr);out=json.loads(result.stdout);self.assertEqual(out['reason'],'COMPLETE_NEVER_ACTIVATED_INSTALL');self.assertFalse((self.f['case']/d.active_name).exists())
  with m.exclusive_transaction(d) as lease:lease.finish_mutation_from_owned_transaction()
  (t.EVIDENCE/'bound-success-case.json').write_text(json.dumps({'case':str(self.f['case']),'owner':str(self.f['owner']),'target':str(self.f['target']),'result':r,'disabled':out,'syntheticFacts':True},indent=2)+'\n')
  spec=importlib.util.spec_from_file_location('actual_stable_exercise',PROFILE/'test-exercise-bound.py');exercise=importlib.util.module_from_spec(spec);spec.loader.exec_module(exercise)
  detailed=exercise.exercise(self.f['case'],evidence=t.EVIDENCE);self.assertTrue(detailed['passed'])
  (self.f['case']/'strict-disabled-activation-result.json').write_text(json.dumps(detailed,indent=2)+'\n')
  spec=importlib.util.spec_from_file_location('final_installed_prepare_probe',PROFILE/'test-installed-prepare.py');probe=importlib.util.module_from_spec(spec);spec.loader.exec_module(probe)
  final_probe=probe.probe(self.f['case'],t.EVIDENCE);self.assertTrue(final_probe['passed']);self.assertTrue(final_probe['globalActiveRetained']);self.assertFalse(final_probe['cycleCompleted'])
if __name__=='__main__':unittest.main()
