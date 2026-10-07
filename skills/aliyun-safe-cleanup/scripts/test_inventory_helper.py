"""Local subprocess-fixture tests; never executes the whole server inventory."""
import ast,hashlib,os,pathlib,selectors,signal,subprocess,sys,time,unittest
SOURCE=pathlib.Path(__file__).with_name('inventory-readonly.sh')
code=SOURCE.read_text().split("python3 - <<'PY'\n",1)[1].rsplit('\nPY\n',1)[0]
node=next(n for n in ast.parse(code).body if isinstance(n,ast.FunctionDef) and n.name=='run')
class CaptureTests(unittest.TestCase):
 def setUp(self):
  self.out={'errors':[]};ns={**globals(),'out':self.out};exec(compile(ast.Module(body=[node],type_ignores=[]),str(SOURCE),'exec'),ns);self.run_command=ns['run']
 def test_success(self):self.assertEqual(self.run_command([sys.executable,'-c','print("ok")']),'ok\n');self.assertEqual(self.out['errors'],[])
 def test_nonzero_keeps_stdout_redacts_stderr(self):
  result=self.run_command([sys.executable,'-c','import sys;print("partial");print("secret-canary",file=sys.stderr);sys.exit(7)'])
  self.assertEqual(result,'partial\n');self.assertEqual(self.out['errors'][0]['exit'],7);self.assertNotIn('secret-canary',str(self.out))
 def test_timeout_preserves_output(self):
  r=self.run_command([sys.executable,'-c','import time;print("partial",flush=True);time.sleep(5)'],timeout=.1)
  self.assertEqual(r,'partial\n');self.assertEqual(self.out['errors'][0]['timeout'],.1)
 def test_stdout_cap(self):
  r=self.run_command([sys.executable,'-c','print("x"*1000000)'],max_stdout=64)
  self.assertEqual(len(r),64);self.assertEqual(self.out['errors'][0]['stdoutLimitBytes'],64)
 def test_missing_program_preserves_report(self):
  self.out['previous']='retained';self.assertEqual(self.run_command(['/definitely/no/such/program']),'');self.assertEqual(self.out['previous'],'retained');self.assertTrue(self.out['errors'][0]['startFailed'])
 def test_closed_pipes_child_is_killed_and_reaped(self):
  start=time.monotonic()
  r=self.run_command([sys.executable,'-c','import os,time;print(os.getpid(),flush=True);os.close(1);os.close(2);time.sleep(5)'],timeout=.1)
  pid=int(r.strip());self.assertLess(time.monotonic()-start,1)
  with self.assertRaises(ProcessLookupError):os.kill(pid,0)
  self.assertEqual(self.out['errors'][0]['timeout'],.1);self.assertNotIn('childExitUnknown',self.out['errors'][0])
 def test_du_timeout_identifies_root(self):
  # The missing utility case tests scope recording without accessing a server path.
  ns={**globals(),'out':self.out};exec(compile(ast.Module(body=[node],type_ignores=[]),str(SOURCE),'exec'),ns)
  from unittest.mock import patch
  with patch.object(subprocess,'Popen',side_effect=FileNotFoundError(2,'missing')):ns['run'](['du','-x','/synthetic-root'])
  self.assertEqual(self.out['errors'][0]['scope'],'/synthetic-root')
if __name__=='__main__':unittest.main()
