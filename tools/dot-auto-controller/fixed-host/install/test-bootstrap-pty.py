"""Real PTY test of the exact JS-generated bootstrap, no installation writes."""
import hashlib,json,os,pathlib,pty,select,subprocess,time,unittest
HERE=pathlib.Path(__file__).resolve().parent
NODE='/workspace/scratch/5e9614251709/job-finder-offline-runtime-20261009T1418Z/node-v22.23.3-linux-x64/bin/node'
class BootstrapTest(unittest.TestCase):
 def run_case(self,tamper=False):
  source=("# Synthetic transport padding; no qualification or filesystem writes.\n"*2200+"print('SYNTHETIC_SOURCE_EXECUTED',flush=True)\n").encode();self.assertGreater(len(source),128*1024)
  packet=json.loads(subprocess.check_output([NODE,str(HERE/'capture-bootstrap.mjs')],input=json.dumps({'source':source.decode()}).encode()))
  self.assertLess(len(packet['cmd']),10000)
  master,slave=pty.openpty();process=subprocess.Popen(['/bin/bash','-c',packet['cmd']],stdin=slave,stdout=slave,stderr=slave,cwd=HERE);os.close(slave);output=b''
  def read_until(predicate):
   nonlocal output
   end=time.monotonic()+10
   while not predicate(output):
    self.assertLess(time.monotonic(),end,'PTY timeout')
    ready,_,_=select.select([master],[],[],.1)
    if ready:
     try:chunk=os.read(master,65536)
     except OSError:break
     if not chunk:break
     output+=chunk
   return output
  try:
   read_until(lambda b:b'\n' in b);ready=json.loads(output.splitlines()[0]);self.assertEqual(ready,{'kind':'INSTALL_SOURCE_READY','serial':0,'sourceBytes':len(source),'sourceSha256':hashlib.sha256(source).hexdigest()});self.assertNotIn(b'SYNTHETIC_SOURCE_EXECUTED',output)
   sent=source if not tamper else b'!'+source[1:]
   for at in range(0,len(sent),2048):
    part=sent[at:at+2048]
    while part:n=os.write(master,part);part=part[n:]
   read_until(lambda b:b'SYNTHETIC_SOURCE_EXECUTED' in b or b'AssertionError' in b);code=process.wait(timeout=5)
   if tamper:self.assertNotEqual(code,0);self.assertNotIn(b'SYNTHETIC_SOURCE_EXECUTED',output)
   else:self.assertEqual(code,0);self.assertEqual(output.count(b'SYNTHETIC_SOURCE_EXECUTED'),1)
  finally:
   if process.poll() is None:process.kill();process.wait()
   os.close(master)
 def test_large_source_exact(self):self.run_case()
 def test_large_source_digest_mismatch_never_executes(self):self.run_case(True)
if __name__=='__main__':unittest.main()
