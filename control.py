import os,json,subprocess,hashlib,datetime,pathlib,sys,base64,zlib
BASE=pathlib.Path(__file__).resolve().parent
CLI='/workspace/scratch/5e9614251709/jb-workspace-recovery-20261006T1136Z/tools/aliyun-cli-3.5.1/aliyun'
INSTANCE='09495b57b769406a95c0c718f22c9d13'
ENV=os.environ.copy();ENV['HOME']='/workspace/shared/aliyun-cli/home'
def now(): return datetime.datetime.now(datetime.timezone.utc).isoformat()
def digest(b): return hashlib.sha256(b).hexdigest()
def save(name,value):
 with open(str(BASE/name),'x') as f: json.dump(value,f,ensure_ascii=False,indent=2)
def call(api,args):
 command=[CLI,'swas-open',api,'--profile','dot-web-deploy','--RegionId','ap-northeast-2','--InstanceId',INSTANCE]+args+['--retry-count','0','--connect-timeout','20','--read-timeout','45']
 try:
  p=subprocess.run(command,env=ENV,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=75)
  meta={'at':now(),'exitCode':p.returncode,'stdoutSha256':digest(p.stdout),'stderrSha256':digest(p.stderr),'stderrBytes':len(p.stderr)}
  data=json.loads(p.stdout) if p.returncode==0 else None
  return meta,data
 except subprocess.TimeoutExpired as e:
  return {'at':now(),'submissionState':'UNKNOWN' if api=='RunCommand' else 'QUERY_TIMEOUT','stdoutSha256':digest(e.stdout or b''),'stderrSha256':digest(e.stderr or b'')},None
if sys.argv[1]=='submit':
 intent=json.loads((BASE/'intent.json').read_text());body=(BASE/'read-schedules.sh').read_bytes()
 assert digest(body)==intent['scriptSha256']
 save('submit-attempt.json',{'at':now(),'commandName':intent['commandName'],'scriptSha256':digest(body),'retryCount':0})
 meta,data=call('RunCommand',['--Name',intent['commandName'],'--Type','RunShellScript','--Timeout','60','--CommandContent',body.decode()])
 if data:
  for k in ['InvokeId','RequestId']: meta[k]=data.get(k)
  meta['submissionState']='ACCEPTED' if meta.get('InvokeId') else 'UNKNOWN'
 else: meta.setdefault('submissionState','UNKNOWN')
 save('submission.json',meta);print(json.dumps(meta))
elif sys.argv[1]=='query':
 sub=json.loads((BASE/'submission.json').read_text());invoke=sub.get('InvokeId');assert invoke
 tag=sys.argv[2];assert tag.isdigit()
 meta,data=call('DescribeInvocationResult',['--InvokeId',invoke]);meta['InvokeId']=invoke
 if data:
  save('query-'+tag+'-raw.json',data)
  meta['requestId']=data.get('RequestId')
  ir=data.get('InvocationResult',data)
  for k in ['InvocationStatus','ExitCode','StartTime','FinishedTime','ErrorCode','ErrorInfo']: meta[k]=ir.get(k)
  output=base64.b64decode(ir.get('Output','')).decode('utf-8','replace')
  meta['decodedOutputSha256']=digest(output.encode())
  rows=dict(x.split('=',1) for x in output.splitlines() if x.startswith(('AUDIT_SHA256=','AUDIT_ZLIB_BASE64=')))
  if 'AUDIT_ZLIB_BASE64' in rows:
   b=zlib.decompress(base64.b64decode(rows['AUDIT_ZLIB_BASE64']));assert digest(b)==rows['AUDIT_SHA256']
   audit=json.loads(b);save('audit.json',audit);meta['auditSha256']=digest(b);meta['auditBytes']=len(b)
 save('query-'+tag+'.json',meta);print(json.dumps(meta))
