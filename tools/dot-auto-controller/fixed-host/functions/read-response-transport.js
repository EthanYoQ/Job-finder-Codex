// External caller transport only. No database or network operation exists here.
// Original helper SQL dispatch/classification is retained; only READ_* response CLI scheduling is combined.
return async function batchedReadResponse(r,dir,result,diagnostic,{cfg,responseDigest}) {
 const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
 const keys=(x,expected)=>object(x)&&Object.keys(x).sort().join(',')===expected.slice().sort().join(',');
 if(!object(r)||!['READ_CONTEXT','READ_PUBLICATION_CONTEXT','READ_OUTCOME'].includes(r.kind))throw Error('BATCH_READ_RESPONSE_KIND');
 if(typeof dir!=='string'||!object(cfg)||!['TAKEDA_PORTABLE_CONNECTOR_V1','NATIVE_PORTABLE_CONNECTOR_V1'].includes(cfg.mode)||!/^source-[a-z0-9-]+$/.test(cfg.sourceId??'')||! /^[a-f0-9]{64}$/.test(cfg.bindingSha256??'')||! /^[a-f0-9]{64}$/.test(r.requestSha256??'')||! /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(r.requestId??'')||typeof cfg.repo!=='string'||typeof cfg.root!=='string'||typeof responseDigest!=='function')throw Error('BATCH_READ_RESPONSE_SHAPE');
 if(r.kind==='READ_CONTEXT'){
  if(!object(result)||typeof result.checkedAt!=='string'||!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+]00:00)$/.test(result.checkedAt)||!Number.isFinite(Date.parse(result.checkedAt)))throw Error('BATCH_READ_CONTEXT_RESULT_SHAPE');
 }else if(!(keys(result,['status','rows'])&&result.status==='SUCCEEDED'&&Array.isArray(result.rows))&&!(keys(result,['status','outcome','code'])&&result.status==='FAILED'&&result.outcome==='UNKNOWN'&&result.code==='UNKNOWN'))throw Error('BATCH_READ_SQL_RESULT_SHAPE');
 const suffix='/runtime-checkout/tools/dot-auto-controller/vendor/c60-source';
 if(!cfg.repo.endsWith(suffix)||cfg.root!==cfg.repo+'/ops/cloud-pilot-host'||cfg.project!=='yiopvxysxrtrnvqxwgbx')throw Error('BATCH_READ_RESPONSE_CONFIG');
 const base=cfg.repo.slice(0,-suffix.length);
 if(!/^round-[a-f0-9]{32}$/.test(cfg.roundId??'')||cfg.taskRoot!==base+'/rounds/'+cfg.roundId+'/connector-host-task'||cfg.relayDirectory!==cfg.taskRoot+'/relay')throw Error('BATCH_FIXED_ROUND_SCOPE');
 const task=cfg.taskRoot;
 if(dir!==task+'/relay'||! /^[0-9a-f-]{36}$/.test(r.requestId))throw Error('BATCH_READ_RESPONSE_SCOPE');
 const packet={requestId:r.requestId,requestSha256:r.requestSha256,result,...diagnostic?{diagnostic}:{}},text=JSON.stringify(packet),digest=responseDigest(text),count=Math.ceil(text.length/16000);
 if(digest.byteCount>16*1024*1024||count>2048)throw Error('HOST_RESPONSE_TOO_LARGE');
 const input=task+'/transport-input-'+r.requestId+'.json';
 const meta={requestSha256:r.requestSha256,...digest,count};
 const q=s=>"'"+String(s).replaceAll("'","'\\''")+"'";
 const probe=await tools.exec_command({cmd:'test ! -e '+q(input)+' && test ! -L '+q(input),workdir:cfg.repo,max_output_tokens:1000,yield_time_ms:10000});
 if(probe.exit_code!==0||probe.session_id)throw Error('BATCH_INPUT_ALREADY_EXISTS');
 const saved=await tools.apply_patch('*** Begin Patch\n*** Add File: '+input+'\n+'+text+'\n*** End Patch');if(saved?.isError)throw Error('BATCH_INPUT_SAVE');
 const settings={cfg,input,dir,requestId:r.requestId,meta};
 const script=String.raw`import os,json,pathlib,hashlib,subprocess,time,datetime,stat
X=json.loads(__SETTINGS__)
cfg=X['cfg'];p=pathlib.Path(X['input']);relay=pathlib.Path(X['dir']);rid=X['requestId'];meta=X['meta'];dest=relay/(rid+'.host-result.json');expectedRequest=relay/(rid+'.request.json')
assert p.parent==relay.parent and p.name=='transport-input-'+rid+'.json'
s=p.lstat();assert stat.S_ISREG(s.st_mode) and not p.is_symlink() and s.st_nlink==1 and s.st_uid==os.getuid();os.chmod(p,0o600)
fd=os.open(p,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
try:
 before=os.fstat(fd);raw=os.read(fd,16*1024*1024+2);after=os.fstat(fd);assert (before.st_ino,before.st_size,before.st_mtime_ns)==(after.st_ino,after.st_size,after.st_mtime_ns)
finally:os.close(fd)
# apply_patch adds one trailing newline; JSON packet digest covers exactly the original helper bytes.
assert raw.endswith(b'\n');data=raw[:-1];assert len(data)==meta['byteCount'] and hashlib.sha256(data).hexdigest()==meta['sha256']
text=data.decode('utf-8');utf16=text.encode('utf-16-le');assert len(utf16)//2==meta['charCount'];packet=json.loads(text);assert packet['requestId']==rid and packet['requestSha256']==meta['requestSha256']
# Every executable and operation below is fixed, never selected by response content.
env={**os.environ,'JOBFINDER_CONNECTOR_HOST_SHA256':cfg['bindingSha256'],'JOBFINDER_CLOUD_SOURCE_ID':cfg['sourceId'],'JOBFINDER_CONNECTOR_ROUND_ID':cfg['roundId']}
launcher=['/usr/bin/python3','-I',cfg['root']+'/connector-host-launch.py'];steps=[];start=time.monotonic();startedAt=datetime.datetime.now(datetime.timezone.utc).isoformat()
def js(value):return json.dumps(value,ensure_ascii=True,separators=(',',':'))
def cli(file,op,*args):
 t=time.monotonic();p=subprocess.run(launcher+[file,op,*args],cwd=cfg['repo'],env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
 if p.returncode:raise RuntimeError(json.dumps({'operation':op,'returncode':p.returncode,'stderr':p.stderr.decode()}))
 out=json.loads(p.stdout);steps.append({'operation':op,'seconds':time.monotonic()-t});return out
for index in range(meta['count']):
 # Slice JavaScript UTF-16 code units exactly, including a surrogate pair split at a 16000-unit boundary.
 partText=utf16[index*32000:(index+1)*32000].decode('utf-16-le',errors='surrogatepass')
 part={**meta,'index':index,'text':partText};assert cli('host-files.mts','connector-save-part',str(dest),js(part))=={'stored':True,'index':index}
for op in ['connector-save-assemble','connector-save-finalize']:
 assert cli('host-files.mts',op,str(dest),js(meta))=={'sha256':meta['sha256'],'byteCount':meta['byteCount']}
assert cli('relay-files.mjs','respond',str(relay),str(dest))=={'written':True,'requestId':rid,'kind':__KIND__}
assert dest.read_bytes()==data
response=json.loads((relay/(rid+'.response.json')).read_text());assert response['requestId']==rid and response['requestSha256']==meta['requestSha256'] and response['result']==packet['result']
receipt={'status':'PASS_ORIGINAL_CLI_BATCHED_RESPONSE','requestId':rid,'kind':__KIND__,'startedAt':startedAt,'finishedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'seconds':time.monotonic()-start,'byteCount':len(data),'charCount':meta['charCount'],'sha256':hashlib.sha256(data).hexdigest(),'partCount':meta['count'],'originalCliCalls':len(steps),'steps':steps,'databaseOrNetworkCalls':0}
out=relay.parent/('transport-receipt-'+rid+'.json');fd=os.open(out,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600);os.write(fd,(json.dumps(receipt,indent=2)+'\n').encode());os.close(fd);print(json.dumps({k:v for k,v in receipt.items() if k!='steps'}))`;
 const python=script.replace('__SETTINGS__',JSON.stringify(JSON.stringify(settings))).replaceAll('__KIND__',JSON.stringify(r.kind));
 const execution=await tools.exec_command({cmd:"/usr/bin/python3 -I - <<'BATCH_READ_RESPONSE_PY'\n"+python+"\nBATCH_READ_RESPONSE_PY",workdir:cfg.repo,max_output_tokens:2500,yield_time_ms:1000});
 const completeOutput=await drainOriginalCommand(execution,2500,1000);
 const receipt=JSON.parse(completeOutput.trim());if(receipt.status!=='PASS_ORIGINAL_CLI_BATCHED_RESPONSE'||receipt.requestId!==r.requestId||receipt.sha256!==digest.sha256||receipt.byteCount!==digest.byteCount)throw Error('BATCH_READ_RESPONSE_RECEIPT');
 return receipt;
};
