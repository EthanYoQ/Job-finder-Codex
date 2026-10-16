"""Actual compiled CLI file primitive tests in tiny retained private cases.

Only the compile-fixed TEST root is mapped. No installer/runtime/dependencies,
source launch, database or activation. No failed case or old evidence is removed.
"""
from pathlib import Path
import hashlib,json,os,runpy,sys,tempfile,types,unittest
sys.dont_write_bytecode=True
HERE=Path(__file__).resolve().parents[1]
loaded=runpy.run_path(str(HERE/'tests/canonical.test.py'));b=loaded['b'];inputs=b.load_source_inputs()
EVIDENCE=Path(os.environ['SEQUENCE_TEST_EVIDENCE']).resolve()
assert EVIDENCE.is_relative_to(HERE.parents[3].parent) and not EVIDENCE.is_relative_to(HERE.parents[3])
CASES=EVIDENCE/'cli-fs-cases';CASES.mkdir(mode=0o700,parents=True,exist_ok=True)
reports=[]
class Durable(unittest.TestCase):
 def one(self,profile,scenario):
  case=Path(tempfile.mkdtemp(prefix='case-',dir=CASES));target=case/'test-release';target.mkdir(mode=0o700)
  old=b.LIVE_ROOT
  try:
   b.LIVE_ROOT=str(target);raw=b.render_cli(inputs,profile)['fixed-'+profile+'-preimport-launch.py']
  finally:b.LIVE_ROOT=old
  filename=str(case/'actual-compiled-cli.py');Path(filename).write_bytes(raw)
  m=types.ModuleType('compiled_cli');m.__file__=filename;exec(compile(raw,filename,'exec'),m.__dict__)
  folder=target/'sources'/profile;folder.mkdir(mode=0o700,parents=True);(target/'sources').chmod(0o700)
  destination=folder/'failure-receipt.json';data=b'{"failurePreserved":true}\n';changed=False
  def trace(frame,event,arg):
   nonlocal changed
   if event=='line' and frame.f_code.co_filename==filename and frame.f_code.co_name=='put' and 'written_identity' in frame.f_locals and not changed:
    line=raw.decode().splitlines()[frame.f_lineno-1]
    wanted=('require(before_dirs==directories(file)' in line and ('SEQUENCE_DURABLE_PARENT_CHANGED' in line if scenario=='replace-after-parent-fsync' else 'SEQUENCE_DURABLE_WRITE_CHANGED' in line))
    if scenario in ('replace-before-ack','replace-after-parent-fsync') and wanted:
     changed=True;os.replace(destination,folder/'preserved-original-receipt.json')
     fd=os.open(destination,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
     with os.fdopen(fd,'wb') as stream:stream.write(data);stream.flush();os.fsync(stream.fileno())
   return trace
  if scenario=='ordinary':
   result=m.put(destination,data);self.assertEqual(result,{'sha256':hashlib.sha256(data).hexdigest(),'bytes':len(data)})
   self.assertEqual(destination.read_bytes(),data)
  else:
   sys.settrace(trace)
   try:
    with self.assertRaisesRegex(RuntimeError,'SEQUENCE_DURABLE_'):m.put(destination,data)
   finally:sys.settrace(None)
   self.assertTrue(changed);self.assertEqual(destination.read_bytes(),data)
   self.assertNotEqual(destination.stat().st_ino,(folder/'preserved-original-receipt.json').stat().st_ino)
  reports.append({'profile':profile,'scenario':scenario,'case':str(case),'passed':True,'compiledCliSha256':hashlib.sha256(raw).hexdigest()})
 def test_four_original_compiled_cli_durable_primitives(self):
  for profile in b.ORDER:
   for scenario in ('ordinary','replace-before-ack','replace-after-parent-fsync'):
    with self.subTest(profile=profile,scenario=scenario):self.one(profile,scenario)
if __name__=='__main__':
 result=unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(Durable))
 out={'kind':'ACTUAL_COMPILED_CLI_PRIVATE_FILESYSTEM_PRIMITIVES','passed':result.wasSuccessful(),'cases':reports,'productionQualified':False,'realDatabaseCalls':0}
 (EVIDENCE/'cli-durable-results.json').write_text(json.dumps(out,indent=2)+'\n');sys.exit(0 if result.wasSuccessful() else 1)
