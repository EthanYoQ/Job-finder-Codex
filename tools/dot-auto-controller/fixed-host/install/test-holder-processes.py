"""Real installer process/PTY tests. Case-mapped scope only, zero network/DB.
Set INSTALL_TEST_PINS to an explicitly measured candidate JSON. No default pins.
"""
from pathlib import Path
import base64,contextlib,hashlib,importlib.util,json,os,pty,select,shutil,signal,subprocess,sys,tempfile,time,types,unittest
sys.dont_write_bytecode=True
HERE=Path(__file__).resolve().parent;HOST=HERE.parent;ROOT=HOST.parents[2]
EVIDENCE=ROOT/'evidence/install';CASES=EVIDENCE/'lifecycle-cases';CASES.mkdir(parents=True,exist_ok=True,mode=0o700)
PINS_PATH=Path(os.environ['INSTALL_TEST_PINS']).resolve()
PINS=json.loads(PINS_PATH.read_text())
NODE=PINS['nodePath'];sha=lambda x:hashlib.sha256(x).hexdigest()
spec=importlib.util.spec_from_file_location('lifecycle_render',HOST/'scripts/build-lifecycle-artifacts.py');build=importlib.util.module_from_spec(spec);spec.loader.exec_module(build)
FACTTURE=subprocess.check_output([NODE,'--input-type=module','-e',"import {expected,r,row} from "+json.dumps((HERE/'facts-fixture.mjs').as_uri())+";console.log(JSON.stringify({expected,r,row}));"],env={'PATH':'/usr/bin:/bin'})
BASE=json.loads(FACTTURE)
TREE=subprocess.check_output(['/usr/bin/git','rev-parse','HEAD^{tree}'],cwd=PINS['sourceRoot'],text=True).strip()
def prepare_case(reader=None):
 case=Path(tempfile.mkdtemp(prefix='case-',dir=CASES));control={'repo':'EthanYoQ/Job-finder-Codex','projectId':'yiopvxysxrtrnvqxwgbx','commitSha':PINS['commitSha'],'treeSha':TREE,'retiredCandidate':BASE['expected'],'expectedRow':{**BASE['row'],'commitSha':PINS['commitSha']},'deploymentBytes':'{}','readerExpected':reader or {'schemaVersion':1,'readers':{'main':{},'fallback':{}}}}
 binding={'schemaVersion':1,'scope':{'kind':'TEST_ONLY','parent':str(case),'target':'installed-disabled'},'measuredPins':PINS,'controlBinding':control}
 lifecycle=build.render_offline_module((HOST/'lifecycle/lifecycle_lock.py').read_text(),CASES).decode()
 values={'__FIXED_INSTALL_HOLDER_BINDING__':binding,'__FIXED_INSTALL_LIFECYCLE_SOURCE__':lifecycle,'__FIXED_INSTALL_STAGING_SOURCE__':(HERE/'staging.py.in').read_text(),'__FIXED_INSTALL_READER_SOURCE__':(HERE/'reader-helper.mjs').read_text(),'__FIXED_INSTALL_FACTS_SOURCE__':(HERE/'facts.mjs').read_text(),'__FIXED_INSTALL_BOUND_ARTIFACTS_SOURCE__':(HERE/'bound-artifacts.py.in').read_text() if (HERE/'bound-artifacts.py.in').exists() else ''}
 source=(HERE/'install-holder.py.in').read_text()
 for token,value in values.items():assert source.count(token)==1;source=source.replace(token,repr(value))
 return {'case':case,'control':control,'binding':binding,'source':source,'lifecycle':lifecycle,'owner':case/'.installed-disabled.lifecycle-owner','target':case/'installed-disabled'}
class Process:
 def __init__(self,f,trace=None,use_pty=False):
  self.f=f;self.buffer=b'';self.serial=0;self.stderr=b'';self.master=None
  filename='<fixed-install-holder>'
  prefix=''
  if trace:
   # Test-only Python tracing pauses actual unmodified source at a specified
   # line. The parent sends SIGKILL; no production hook or pass boolean exists.
   scope,needle=trace[:2];delay=trace[2] if len(trace)>2 else 120
   target=(f['source'] if scope=='holder' else (HERE/'staging.py.in').read_text()).splitlines()
   matches=[i+1 for i,l in enumerate(target) if needle in l];assert len(matches)==1,(needle,matches)
   targetfile=filename if scope=='holder' else '<fixed-embedded-embedded_install_staging>'
   condition=" and f.f_locals.get('label')=='before-rename'" if scope=='staging' and "verify_final_facts()" in needle else ""
   prefix="import sys,os,time\ndef trace(f,event,arg):\n if event=='line' and f.f_code.co_filename=="+repr(targetfile)+" and f.f_lineno=="+str(matches[0])+condition+":\n  os.write(2,b'TEST_PAUSED\\n');time.sleep("+str(delay)+")\n return trace\nsys.settrace(trace)\n"
  code=prefix+"exec(compile("+repr(f['source'])+","+repr(filename)+",'exec'),{'__name__':'__main__'})"
  # File holds only fixed test bootstrap bytes. Actual production renderer uses
  # the same-session pinned source streaming protocol tested separately.
  runner=f['case']/'test-runner.py';runner.write_text(code);runner.chmod(0o600)
  if use_pty:
   self.master,slave=pty.openpty();self.p=subprocess.Popen(['/usr/bin/python3','-I','-u',str(runner)],stdin=slave,stdout=slave,stderr=subprocess.PIPE,env={'PATH':'/usr/bin:/bin'});os.close(slave);self.fd=self.master
  else:
   self.p=subprocess.Popen(['/usr/bin/python3','-I','-u',str(runner)],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,env={'PATH':'/usr/bin:/bin'});self.fd=self.p.stdout.fileno()
 def read(self,timeout=180):
  until=time.monotonic()+timeout
  while b'\n' not in self.buffer:
   ready=select.select([self.fd,self.p.stderr.fileno()],[],[],max(0,until-time.monotonic()))[0]
   if self.p.stderr.fileno() in ready:self.stderr+=os.read(self.p.stderr.fileno(),65536)
   if self.fd in ready:
    try:b=os.read(self.fd,1024*1024)
    except OSError:b=b''
    if not b:raise RuntimeError('HOLDER_EXIT:'+self.stderr.decode())
    self.buffer+=b
   if time.monotonic()>=until:raise RuntimeError('HOLDER_TIMEOUT:'+self.stderr.decode())
  line,self.buffer=self.buffer.split(b'\n',1);return json.loads(line.rstrip(b'\r'))
 def send(self,op,payload=None):
  self.serial+=1;raw=json.dumps({'op':op,'serial':self.serial,'payload':payload},separators=(',',':')).encode()+b'\n'
  if self.master is not None:
   at=0
   while at<len(raw):at+=os.write(self.master,raw[at:at+2048])
  else:self.p.stdin.write(raw);self.p.stdin.flush()
  return len(raw)
 def paused(self):
  until=time.monotonic()+180
  while b'TEST_PAUSED' not in self.stderr:
   r=select.select([self.p.stderr.fileno()],[],[],max(0,until-time.monotonic()))[0]
   if not r:raise RuntimeError('PAUSE_TIMEOUT')
   raw=os.read(self.p.stderr.fileno(),65536)
   if not raw:raise RuntimeError('PAUSE_EXIT:'+self.stderr.decode())
   self.stderr+=raw
 def close(self):
  if self.p.poll() is None:self.p.kill()
  self.p.wait(timeout=10)
  if self.master is not None:os.close(self.master)
  for x in (self.p.stdin,self.p.stdout,self.p.stderr):
   if x:x.close()
def domain_for(f):
 m=types.ModuleType('test_probe_'+f['case'].name.replace('-','_'));sys.modules[m.__name__]=m;exec(compile(f['lifecycle'],'test-lifecycle','exec'),m.__dict__)
 lock=f['case']/'.installed-disabled.lifecycle.lock'
 return m,m.Domain(f['case'],'installed-disabled',m.identity(f['case'].stat()),m.identity(lock.stat()))
def facts(f,reader,nonce,pad=20000):
 stamp=time.strftime('%Y-%m-%dT%H:%M:%S',time.gmtime())+'.000Z';c=f['control'];base='https://api.github.com/repos/EthanYoQ/Job-finder-Codex';html='https://github.com/EthanYoQ/Job-finder-Codex'
 wrap=lambda row:{'isError':False,'structuredContent':{'result':'TEST_ONLY\n<untrusted-data-abcd-1234>\n'+json.dumps([row])+'\n</untrusted-data-abcd-1234>\n'}}
 r={**BASE['r'],'observedAt':stamp}
 raws={'githubCommit':{'structuredContent':{'commit':{'sha':c['commitSha'],'repository_full_name':c['repo'],'url':base+'/commits/'+c['commitSha'],'html_url':html+'/commit/'+c['commitSha'],'syntheticPadding':'x'*pad}}},'githubTree':{'structuredContent':{'url':base+'/git/commits/'+c['commitSha'],'content':json.dumps({'sha':c['commitSha'],'url':base+'/git/commits/'+c['commitSha'],'html_url':html+'/commit/'+c['commitSha'],'tree':{'sha':c['treeSha'],'url':base+'/git/trees/'+c['treeSha']}})}},'retirement':wrap({'retirement_reconciliation':r}),'candidate':wrap({'candidate':{**c['expectedRow'],'createdAt':stamp,'finalizedAt':None,'releaseQaEvidenceSha256':None},'checkedAt':stamp})}
 out={}
 for k,raw in raws.items():
  text=json.dumps(raw,separators=(',',':'));out[k]={'rawBytes':text,'rawSha256':sha(text.encode()),'startedAt':stamp,'finishedAt':stamp}
 return {'schemaVersion':1,'nonce':nonce,'facts':out,'readerIdentity':reader}
class BootstrapTests(unittest.TestCase):
 def setUp(self):self.f=prepare_case();self.ps=[]
 def tearDown(self):
  for p in self.ps:p.close()
  # Preserve every owned case, including failed/UNKNOWN originals.
  pass
 def start(self,**kw):p=Process(self.f,**kw);self.ps.append(p);return p
 def replay_holds(self):
  p=self.start();r=p.read();self.assertEqual(r['kind'],'INSTALL_HOLD');self.assertEqual(r['reason'],'INSTALL_EXISTING_OR_UNKNOWN')
 def test_owner_mkdir_death_rejects_unknown_replay(self):
  p=self.start(trace=('holder',"put(self.owner/'BOOTSTRAP_ACTIVE'"));p.paused();p.p.kill();p.p.wait();self.assertTrue(self.f['owner'].is_dir());self.assertFalse(self.f['target'].exists());self.replay_holds()
 def test_provision_to_EX_death_has_no_candidate_and_rejects_replay(self):
  p=self.start(trace=('holder','self.cm=self.lifecycle.exclusive_transaction'));p.paused();p.p.kill();p.p.wait();m,d=domain_for(self.f)
  with d.acquire('SH') as lease:
   with self.assertRaises(FileNotFoundError):m.check_complete_disabled(lease)
  self.replay_holds()
 def test_EX_ready_abandon_leaves_mutation_and_blocks_SH_EX(self):
  p=self.start();self.assertEqual(p.read()['kind'],'INSTALL_READY');p.send('abandon');self.assertEqual(p.read()['kind'],'INSTALL_UNKNOWN');p.p.wait();m,d=domain_for(self.f)
  for mode in ('SH','EX'):
   with self.assertRaisesRegex(m.Hold,'ACTIVE_OR_UNKNOWN_MUTATION'):d.acquire(mode)
  self.replay_holds()
 def test_preexisting_target_lock_owner_and_stage_rejected(self):
  for name in ('installed-disabled','.installed-disabled.lifecycle.lock','.installed-disabled.install-stage'):
   q=self.f['case']/name;q.write_bytes(b'UNKNOWN');p=self.start();self.assertEqual(p.read()['reason'],'INSTALL_EXISTING_OR_UNKNOWN');self.assertFalse(self.f['owner'].exists());q.unlink()
 def test_PTY_noncanonical_input_over_16KiB_is_not_truncated(self):
  p=self.start(use_pty=True);self.assertEqual(p.read()['kind'],'INSTALL_READY');n=p.send('publish',{'padding':'x'*20000});self.assertGreater(n,16384);r=p.read();self.assertEqual(r,{'kind':'INSTALL_HOLD','reason':'INSTALL_PUBLISH_ORDER'})
if __name__=='__main__':unittest.main()
