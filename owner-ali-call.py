#!/usr/bin/env python3
"""One exact official CLI submission or exact result query. Never auto retries."""
import argparse,base64,datetime,hashlib,json,os,re,selectors,signal,subprocess,sys,tempfile,time
from pathlib import Path
D=Path(__file__).resolve().parent
OUT=D/'owner-invocations';OUT.mkdir(mode=0o700,exist_ok=True)
CLI='/workspace/shared/aliyun-cli/aliyun'
RELEASE='sanofi-pair-20261006T0057Z'
INSTANCE='09495b57b769406a95c0c718f22c9d13'
CONNECT_TIMEOUT=20;READ_TIMEOUT=45;PROCESS_TIMEOUT=75
COMMON=['--profile','dot-web-deploy','--RegionId','ap-northeast-2','--InstanceId',INSTANCE,'--connect-timeout',str(CONNECT_TIMEOUT),'--read-timeout',str(READ_TIMEOUT)]
READ_ONLY={
 'diagnostics/printf-transport-9415.sh':'26aa3c706d08137e5d6849603b5f35730b12a88871f7c414871663b274fb0296',
 'reconcile-bootstrap-readonly.sh':'a3bb763a92a83d56f75799a0a911af8277644d82911c34bce4dbf0009b0a2e82',
 'phases/needs.sh':'6d615d04799f0f9d4f4c978221cbf9dbfbddfaeb95084c85ed5109679355e895',
}
ERROR_CATEGORIES=['Forbidden','AccessDenied','InvalidAccessKeyId','SignatureDoesNotMatch','Client.Timeout','context deadline exceeded','TLS handshake timeout','no such host','connection refused','Unknown Flag','unknown flag']
class GuardBlocked(Exception):pass
class CliFailed(Exception):pass
class CliInterrupted(Exception):pass
def now():return datetime.datetime.now(datetime.timezone.utc).isoformat()
def digest(b):return hashlib.sha256(b).hexdigest()
def save(p,v):
 with p.open('x') as f:json.dump(v,f,indent=2);f.write('\n');f.flush();os.fsync(f.fileno())
 p.chmod(0o600)
def save_atomic(p,v):
 # Link publishes a complete fsynced record without replacing an existing result.
 fd,tmp=tempfile.mkstemp(prefix='.observation-',dir=p.parent)
 try:
  with os.fdopen(fd,'w') as f:json.dump(v,f,indent=2);f.write('\n');f.flush();os.fsync(f.fileno())
  os.link(tmp,p)
  dfd=os.open(p.parent,os.O_RDONLY|os.O_DIRECTORY)
  try:os.fsync(dfd)
  finally:os.close(dfd)
 finally:os.unlink(tmp)
def transport():return {'cliPath':CLI,'connectTimeoutSeconds':CONNECT_TIMEOUT,'readTimeoutSeconds':READ_TIMEOUT,'processTimeoutSeconds':PROCESS_TIMEOUT,'retryCount':0}
def read_record(p):
 if p.is_symlink() or not p.is_file():raise GuardBlocked('INVALID_RECORD')
 j=json.loads(p.read_text())
 if not isinstance(j,dict):raise GuardBlocked('INVALID_RECORD')
 return j
def guard_write(script):
 # This marker has no automatic unlock: preserve it and require separate review.
 unknown=OUT/'UNKNOWN_SUBMISSION.json'
 if os.path.lexists(unknown):
  read_record(unknown)
  raise GuardBlocked('UNKNOWN_SUBMISSION_PRESENT')
 for p in sorted(OUT.glob('*-intent.json')):
  old=read_record(p)
  if not all(isinstance(old.get(k),str) for k in ['script','targetInstance','payloadSha256']):raise GuardBlocked('INCOMPLETE_PRIOR_INTENT')
  # Pre-patch intents belong to this pinned release directory, even without releaseId.
  if old.get('releaseId',RELEASE)==RELEASE and old['targetInstance']==INSTANCE and old['script']==script:
   raise GuardBlocked('PRIOR_WRITE_INTENT')
def observe(phase):
 global observation_seq
 observation_seq+=1;call_meta['cliPhase']=phase
 save_atomic(OUT/(error_label+'-'+x.mode+'-observation-'+observation_id+'-'+str(observation_seq).zfill(4)+'.json'),{'at':now(),**call_meta})
def invoke_id(value):
 return isinstance(value,str) and re.fullmatch('t-[a-zA-Z0-9]{1,128}',value)
def persist_receipt(r):
 global receipt_saved
 if not isinstance(r,dict) or not invoke_id(r.get('InvokeId')):raise CliFailed()
 if receipt_saved:
  if call_meta['InvokeId']!=r['InvokeId']:raise CliFailed()
  return
 entry={'at':now(),'InvokeId':r['InvokeId'],'script':x.script,'payloadSha256':digest(payload)}
 request=r.get('RequestId')
 if isinstance(request,str) and re.fullmatch('[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}',request):entry['RequestId']=request
 save_atomic(receipt,entry);receipt_saved=True
 call_meta['InvokeId']=r['InvokeId']
 if 'RequestId' in entry:call_meta['RequestId']=entry['RequestId']
 observe('invoke-receipt-saved')
def interrupt_cli(signum,frame):raise CliInterrupted()
def call(argv):
 global call_meta
 hashes={name:hashlib.sha256() for name in ('stdout','stderr')};counts={'stdout':0,'stderr':0}
 output=bytearray();stderr_tail=b'';categories=set();p=None
 def snapshot():
  for name in counts:call_meta[name+'Bytes']=counts[name];call_meta[name+'Sha256']=hashes[name].hexdigest()
  call_meta['knownErrorCategories']=[v for v in ERROR_CATEGORIES if v in categories]
 def consume(name,chunk):
  nonlocal stderr_tail
  counts[name]+=len(chunk);hashes[name].update(chunk)
  if name=='stdout':output.extend(chunk)
  else:
   diagnostic=stderr_tail+chunk
   categories.update(v for v in ERROR_CATEGORIES if v.encode() in diagnostic)
   stderr_tail=diagnostic[-max(map(len,ERROR_CATEGORIES)):]
  snapshot()
  # Only complete UTF-8 JSON is accepted; CLI-side buffering cannot be observed.
  if name=='stdout' and x.mode=='submit' and not receipt_saved:
   try:r=json.loads(output.decode('utf-8'))
   except (ValueError,UnicodeError):pass
   else:
    if isinstance(r,dict) and invoke_id(r.get('InvokeId')):persist_receipt(r)
  observe('bytes-received')
 snapshot();observe('before-spawn')
 previous=signal.signal(signal.SIGTERM,interrupt_cli)
 selector=selectors.DefaultSelector();started=time.monotonic()
 try:
  p=subprocess.Popen([CLI,'swas-open']+argv,env=dict(os.environ,HOME='/workspace/shared/aliyun-cli/home'),stdout=subprocess.PIPE,stderr=subprocess.PIPE,bufsize=0)
  call_meta.update({'cliPid':p.pid,'cliStartedAt':now()});observe('cli-started')
  for name,stream in [('stdout',p.stdout),('stderr',p.stderr)]:
   os.set_blocking(stream.fileno(),False);selector.register(stream,selectors.EVENT_READ,name)
  while selector.get_map() or p.poll() is None:
   remaining=PROCESS_TIMEOUT-(time.monotonic()-started)
   if remaining<=0:raise subprocess.TimeoutExpired('aliyun',PROCESS_TIMEOUT)
   for key,_ in selector.select(min(remaining,0.1)):
    chunk=os.read(key.fd,65536)
    if chunk:consume(key.data,chunk)
    else:selector.unregister(key.fileobj)
  call_meta['exitCode']=p.wait();observe('cli-exited')
  if p.returncode:raise CliFailed()
  return json.loads(output.decode('utf-8'))
 except BaseException as exc:
  if p is not None:
   if p.poll() is None:p.kill()
   call_meta['exitCode']=p.wait()
  # These phases describe the local CLI only, never remote non-submission.
  observe('cli-timeout' if isinstance(exc,subprocess.TimeoutExpired) else ('cli-interrupted' if isinstance(exc,(KeyboardInterrupt,CliInterrupted)) else 'cli-failed'))
  raise
 finally:
  selector.close()
  if p is not None:
   for stream in (p.stdout,p.stderr):stream.close()
  signal.signal(signal.SIGTERM,previous)
a=argparse.ArgumentParser();a.add_argument('mode',choices=['submit','query']);a.add_argument('label');a.add_argument('--script');a.add_argument('--publisher-paused',action='store_true');x=a.parse_args()
error_label=x.label if re.fullmatch('[a-z0-9-]{1,55}',x.label) else 'invalid-label'
receipt=OUT/(x.label+'-submit.json')
call_started=False;call_meta={};attempt_meta={};receipt_saved=False
observation_seq=0;observation_id=re.sub('[^0-9]','',now())
try:
 assert error_label==x.label,'INVALID_LABEL'
 if x.mode=='submit':
  assert x.script
  rel=Path(x.script);assert not rel.is_absolute() and '..' not in rel.parts
  matches=[]
  for f in [D/'SEALED_BOOTSTRAP.json',D/'SEALED_DELTA.json',D/'SEALED_READONLY_RECONCILE.json',D/'SEALED_READONLY_DIAGNOSTIC.json']:
   if f.exists():
    m=json.loads(f.read_text());matches.extend(e['sha256'] for k in ['commandFiles','phaseScripts'] for e in m.get(k,[]) if e['path']==x.script)
  assert matches and len(set(matches))==1,'SCRIPT_NOT_SEALED'
  raw=(D/rel).read_bytes();assert digest(raw)==matches[0],'SCRIPT_HASH_DRIFT'
  assert read_record(D/'manifest.json')['releaseId']==RELEASE,'RELEASE_MISMATCH'
  mutating_phase=x.script.startswith('phases/') and x.script!='phases/needs.sh'
  assert x.publisher_paused==mutating_phase,'PAUSE_ATTESTATION_MISMATCH'
  payload=raw
  if x.publisher_paused:
   state=json.loads((D.parents[1]/'PUBLISHER-ACTIVE-STATE.json').read_text());assert state.get('active') is None,'PUBLISHER_ACTIVE'
   payload=raw.replace(b'set -eu\n',b'set -eu\nexport JOBFINDER_PUBLISHER_PAUSED=sanofi-pair-20261006T0057Z\n',1)
  assert len(payload)<=12288 and not receipt.exists()
  write_action=READ_ONLY.get(x.script)!=digest(raw)
  key={'releaseId':RELEASE,'targetInstance':INSTANCE,'script':x.script}
  operation_key=digest(json.dumps(key,sort_keys=True,separators=(',',':')).encode())
  attempt_meta={**key,'commandName':'jf-pair-'+x.label,'operationKey':operation_key,'sourceSha256':digest(raw),'payloadSha256':digest(payload),'publisherPaused':x.publisher_paused,'writeAction':write_action,'payloadRawBytes':len(payload),'payloadBase64Bytes':len(base64.b64encode(payload)),'transport':transport()}
  intent={'at':now(),**attempt_meta}
  if write_action:
   guard_write(x.script)
  if write_action or x.script=='diagnostics/printf-transport-9415.sh':
   # Exclusive stable slot precedes the label file and the subprocess. It is never removed.
   save(OUT/('operation-'+operation_key+'.json'),intent)
  save(OUT/(x.label+'-intent.json'),intent)
  call_started=True
  r=call(['RunCommand']+COMMON+['--Name',attempt_meta['commandName'],'--Type','RunShellScript','--CommandContent',payload.decode(),'--Timeout','600','--retry-count','0'])
  persist_receipt(r)
  print(json.dumps({'state':'SUBMITTED','label':x.label,'InvokeId':r['InvokeId']}))
 else:
  r=read_record(receipt);assert invoke_id(r.get('InvokeId'));call_meta['InvokeId']=r['InvokeId'];call_started=True
  response=call(['DescribeInvocationResult']+COMMON+['--InvokeId',r['InvokeId'],'--retry-count','0']);j=response['InvocationResult']
  decoded=base64.b64decode(j.get('Output',''),validate=True).decode();stamp=now();entry={'at':stamp,'InvokeId':r['InvokeId'],'result':j,'decodedOutput':decoded}
  dest=OUT/(x.label+'-query-'+re.sub('[^0-9]','',stamp)+'.json');save(dest,entry)
  try:value=json.loads(decoded)
  except ValueError:value={'outputBytes':len(decoded.encode()),'outputSha256':digest(decoded.encode())}
  if j.get('InvocationStatus')=='Success' and j.get('ExitCode')==0:
   terminal=OUT/(x.label+'-success.json')
   if not terminal.exists():save(terminal,entry)
  print(json.dumps({'label':x.label,'InvokeId':r['InvokeId'],'status':j.get('InvocationStatus'),'exitCode':j.get('ExitCode'),'errorCode':j.get('ErrorCode'),'result':value,'localResult':str(dest)},ensure_ascii=False))
except BaseException as exc:
 # Catchable rejection/interruption leaves both intent files unchanged. SIGKILL cannot
 # write a terminal record; its surviving intent still prevents another write attempt.
 state='SUBMITTED_RECEIPT_SAVED_CLI_ERROR' if x.mode=='submit' and receipt_saved else ('SUBMISSION_UNKNOWN_DO_NOT_RESUBMIT' if x.mode=='submit' and call_started else ('SUBMISSION_BLOCKED_BEFORE_CALL' if x.mode=='submit' else 'QUERY_FAILED'))
 record={'at':now(),'state':state,'exceptionType':type(exc).__name__,'callStarted':call_started,'transport':transport(),**attempt_meta,**call_meta}
 try:save(OUT/(error_label+'-'+x.mode+'-error-'+re.sub('[^0-9]','',record['at'])+'.json'),record)
 except BaseException:record['errorRecordSaved']=False
 print(json.dumps(record));sys.exit(2)
