import os,json,subprocess,hashlib,datetime,pathlib,sys,base64,zlib,re
BASE=pathlib.Path(__file__).resolve().parent
CLI='/workspace/scratch/5e9614251709/jb-workspace-recovery-20261006T1136Z/tools/aliyun-cli-3.5.1/aliyun'
INSTANCE='09495b57b769406a95c0c718f22c9d13'
env=os.environ.copy();env['HOME']='/workspace/shared/aliyun-cli/home'
def now():return datetime.datetime.now(datetime.timezone.utc).isoformat()
def digest(b):return hashlib.sha256(b).hexdigest()
def save(name,obj):
 with (BASE/name).open('x') as f:json.dump(obj,f,ensure_ascii=False,indent=2);f.flush();os.fsync(f.fileno())
def call(api,args,label):
 argv=[CLI,'swas-open',api,'--profile','dot-web-deploy','--RegionId','ap-northeast-2','--InstanceId',INSTANCE]+args+['--retry-count','0','--connect-timeout','20','--read-timeout','45']
 p=subprocess.Popen(argv,env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
 save(label+'-cli-start.json',{'at':now(),'pid':p.pid,'api':api})
 timedout=False
 try:out,err=p.communicate(timeout=75)
 except subprocess.TimeoutExpired:p.kill();out,err=p.communicate();timedout=True
 safe={'at':now(),'cliExitCode':p.returncode,'timedOut':timedout,'stdoutSha256':digest(out),'stderrSha256':digest(err),'stderrBytes':len(err),'knownErrorCategories':[v for v in ['Forbidden','AccessDenied','InvalidAccessKeyId','SignatureDoesNotMatch','Client.Timeout','context deadline exceeded','TLS handshake timeout','Unknown Flag'] if v in err.decode(errors='replace')]}
 save(label+'-cli-exit.json',safe)
 try:data=json.loads(out) if p.returncode==0 else None
 except json.JSONDecodeError:data=None
 return safe,data
if sys.argv[1]=='submit':
 intent=json.loads((BASE/'AGENT_LOG_INTENT.json').read_text());body=(BASE/'read-agent-logs.sh').read_bytes();assert digest(body)==intent['scriptSha256']
 save('submit-attempt.json',{'at':now(),'name':intent['commandName'],'scriptSha256':digest(body),'api':'RunCommand','readOnly':True,'retryCount':0})
 meta,data=call('RunCommand',['--Name',intent['commandName'],'--Type','RunShellScript','--Timeout','60','--CommandContent',body.decode()],'submit')
 if data:
  for key in ['InvokeId','RequestId']:meta[key]=data.get(key)
 meta['submissionState']='ACCEPTED' if meta.get('InvokeId') else 'UNKNOWN_DO_NOT_RETRY'
 save('submission.json',meta);print(json.dumps(meta))
elif sys.argv[1]=='query':
 invoke=json.loads((BASE/'submission.json').read_text())['InvokeId'];assert re.fullmatch(r't-[A-Za-z0-9]+',invoke)
 tag=sys.argv[2];assert tag.isdigit()
 meta,data=call('DescribeInvocationResult',['--InvokeId',invoke],'query-'+tag);meta['InvokeId']=invoke
 if data:
  meta['requestId']=data.get('RequestId');ir=data.get('InvocationResult',{})
  for key in ['InvocationStatus','ExitCode','StartTime','FinishedTime','ErrorCode']:meta[key]=ir.get(key)
  encoded=ir.get('Output','')
  try:output=base64.b64decode(encoded,validate=True)
  except Exception:output=encoded.encode();meta['outputEncodingFallback']='plain'
  meta['decodedSha256']=digest(output);meta['decodedBytes']=len(output)
  rows=dict(line.split('=',1) for line in output.decode('utf-8','replace').splitlines() if line.startswith(('AUDIT_SHA256=','AUDIT_ZLIB_BASE64=')))
  if 'AUDIT_ZLIB_BASE64' in rows:
   raw=zlib.decompress(base64.b64decode(rows['AUDIT_ZLIB_BASE64']));assert digest(raw)==rows['AUDIT_SHA256'];audit=json.loads(raw)
   save('audit.json',audit);meta['auditSha256']=digest(raw);meta['auditBytes']=len(raw)
  else:
   try:audit=json.loads(output);save('audit.json',audit)
   except Exception:pass
 save('query-'+tag+'.json',meta);print(json.dumps(meta))
