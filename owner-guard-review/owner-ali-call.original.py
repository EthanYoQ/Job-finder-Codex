#!/usr/bin/env python3
"""One exact official CLI submission or exact result query. Never auto retries."""
import argparse,base64,datetime,hashlib,json,os,re,subprocess,sys
from pathlib import Path
D=Path(__file__).resolve().parent
OUT=D/'owner-invocations';OUT.mkdir(mode=0o700,exist_ok=True)
CLI='/workspace/shared/aliyun-cli/aliyun'
COMMON=['--profile','dot-web-deploy','--RegionId','ap-northeast-2','--InstanceId','09495b57b769406a95c0c718f22c9d13','--connect-timeout','20','--read-timeout','45']
def now():return datetime.datetime.now(datetime.timezone.utc).isoformat()
def digest(b):return hashlib.sha256(b).hexdigest()
def save(p,v):
 with p.open('x') as f:json.dump(v,f,indent=2);f.write('\n');f.flush();os.fsync(f.fileno())
 p.chmod(0o600)
def call(argv):
 try:p=subprocess.run([CLI,'swas-open']+argv,env=dict(os.environ,HOME='/workspace/shared/aliyun-cli/home'),stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=75)
 except subprocess.TimeoutExpired:
  record={'at':now(),'state':'CLI_TIMEOUT_UNKNOWN_DO_NOT_RESUBMIT'}
  save(OUT/(x.label+'-'+x.mode+'-error-'+re.sub('[^0-9]','',record['at'])+'.json'),record)
  raise RuntimeError('CLI_TIMEOUT_UNKNOWN_DO_NOT_RESUBMIT')
 if p.returncode:
  # Never print authentication-bearing CLI diagnostics.
  categories=['Forbidden','AccessDenied','InvalidAccessKeyId','SignatureDoesNotMatch','Client.Timeout','context deadline exceeded','TLS handshake timeout','no such host','connection refused','Unknown Flag','unknown flag']
  record={'at':now(),'state':'CLI_ERROR_UNKNOWN_DO_NOT_RESUBMIT','exitCode':p.returncode,'stdoutSha256':digest(p.stdout),'stderrSha256':digest(p.stderr),'knownErrorCategories':[v for v in categories if v in p.stderr.decode(errors='replace')]}
  save(OUT/(x.label+'-'+x.mode+'-error-'+re.sub('[^0-9]','',record['at'])+'.json'),record)
  print(json.dumps(record));sys.exit(2)
 return json.loads(p.stdout)
a=argparse.ArgumentParser();a.add_argument('mode',choices=['submit','query']);a.add_argument('label');a.add_argument('--script');a.add_argument('--publisher-paused',action='store_true');x=a.parse_args()
assert re.fullmatch('[a-z0-9-]{1,55}',x.label)
receipt=OUT/(x.label+'-submit.json')
if x.mode=='submit':
 assert x.script
 rel=Path(x.script);assert not rel.is_absolute() and '..' not in rel.parts
 matches=[]
 for f in [D/'SEALED_BOOTSTRAP.json',D/'SEALED_DELTA.json',D/'SEALED_READONLY_RECONCILE.json']:
  if f.exists():
   m=json.loads(f.read_text());matches.extend(e['sha256'] for k in ['commandFiles','phaseScripts'] for e in m.get(k,[]) if e['path']==x.script)
 assert matches and len(set(matches))==1,'SCRIPT_NOT_SEALED'
 raw=(D/rel).read_bytes();assert digest(raw)==matches[0],'SCRIPT_HASH_DRIFT'
 mutating_phase=x.script.startswith('phases/') and x.script!='phases/needs.sh'
 assert x.publisher_paused==mutating_phase,'PAUSE_ATTESTATION_MISMATCH'
 payload=raw
 if x.publisher_paused:
  state=json.loads((D.parents[1]/'PUBLISHER-ACTIVE-STATE.json').read_text());assert state.get('active') is None,'PUBLISHER_ACTIVE'
  payload=raw.replace(b'set -eu\n',b'set -eu\nexport JOBFINDER_PUBLISHER_PAUSED=sanofi-pair-20261006T0057Z\n',1)
 assert len(payload)<=12288 and not receipt.exists()
 save(OUT/(x.label+'-intent.json'),{'at':now(),'script':x.script,'sourceSha256':digest(raw),'payloadSha256':digest(payload),'publisherPaused':x.publisher_paused,'targetInstance':'09495b57b769406a95c0c718f22c9d13'})
 r=call(['RunCommand']+COMMON+['--Name','jf-pair-'+x.label,'--Type','RunShellScript','--CommandContent',payload.decode(),'--Timeout','600','--retry-count','0'])
 assert re.fullmatch('t-[a-zA-Z0-9]+',r['InvokeId'])
 save(receipt,{'at':now(),'InvokeId':r['InvokeId'],'RequestId':r.get('RequestId'),'script':x.script,'payloadSha256':digest(payload)})
 print(json.dumps({'state':'SUBMITTED','label':x.label,'InvokeId':r['InvokeId']}))
else:
 r=json.loads(receipt.read_text());response=call(['DescribeInvocationResult']+COMMON+['--InvokeId',r['InvokeId'],'--retry-count','0']);j=response['InvocationResult']
 decoded=base64.b64decode(j.get('Output',''),validate=True).decode();stamp=now();entry={'at':stamp,'InvokeId':r['InvokeId'],'result':j,'decodedOutput':decoded}
 dest=OUT/(x.label+'-query-'+re.sub('[^0-9]','',stamp)+'.json');save(dest,entry)
 try:value=json.loads(decoded)
 except ValueError:value={'outputBytes':len(decoded.encode()),'outputSha256':digest(decoded.encode())}
 if j.get('InvocationStatus')=='Success' and j.get('ExitCode')==0:
  terminal=OUT/(x.label+'-success.json')
  if not terminal.exists():save(terminal,entry)
 print(json.dumps({'label':x.label,'InvokeId':r['InvokeId'],'status':j.get('InvocationStatus'),'exitCode':j.get('ExitCode'),'errorCode':j.get('ErrorCode'),'result':value,'localResult':str(dest)},ensure_ascii=False))
