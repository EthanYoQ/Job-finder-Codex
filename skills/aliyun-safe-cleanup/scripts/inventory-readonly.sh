#!/bin/sh
set -eu
python3 - <<'PY'
import datetime,hashlib,json,os,pathlib,selectors,signal,subprocess,shutil,time
out={'status':'READ_ONLY_RESOURCE_INVENTORY','at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'errors':[]}
def run(argv,timeout=12,max_stdout=128*1024):
 scope=argv[-1] if argv[0]=='du' else argv[0]
 meta={'command':argv[0],'scope':scope};output=bytearray();errsha=hashlib.sha256();errbytes=0
 try:
  q=subprocess.Popen(argv,stdout=subprocess.PIPE,stderr=subprocess.PIPE,start_new_session=True,env={'PATH':'/opt/node22/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin','HOME':'/root','LC_ALL':'C'})
 except OSError as e:
  meta.update({'startFailed':True,'errno':e.errno});out['errors'].append(meta);return ''
 selector=selectors.DefaultSelector();selector.register(q.stdout,selectors.EVENT_READ,'stdout');selector.register(q.stderr,selectors.EVENT_READ,'stderr')
 deadline=time.monotonic()+timeout;killed=False
 try:
  while selector.get_map():
   if not killed and time.monotonic()>=deadline:
    meta['timeout']=timeout
    try:os.killpg(q.pid,signal.SIGKILL)
    except ProcessLookupError:pass
    killed=True;deadline=time.monotonic()+2
   if killed and time.monotonic()>=deadline:meta['pipeDrainIncomplete']=True;break
   for key,_ in selector.select(min(0.25,max(0,deadline-time.monotonic()))):
    chunk=os.read(key.fileobj.fileno(),65536)
    if not chunk:selector.unregister(key.fileobj);continue
    if key.data=='stderr':errsha.update(chunk);errbytes+=len(chunk);continue
    remaining=max_stdout-len(output);output.extend(chunk[:remaining])
    if len(chunk)>remaining and not killed:
     meta['stdoutLimitBytes']=max_stdout
     try:os.killpg(q.pid,signal.SIGKILL)
     except ProcessLookupError:pass
     killed=True;deadline=time.monotonic()+2
  try:code=q.wait(timeout=max(0.001,deadline-time.monotonic()))
  except subprocess.TimeoutExpired:
   meta['timeout']=timeout;killed=True
   try:os.killpg(q.pid,signal.SIGKILL)
   except ProcessLookupError:pass
   try:code=q.wait(timeout=2)
   except subprocess.TimeoutExpired:code=None;meta['childExitUnknown']=True;meta['unreapedPid']=q.pid
 finally:selector.close();q.stdout.close();q.stderr.close()
 if code or killed or code is None:
  meta.update({'exit':code,'partialStdoutBytes':len(output),'stderrBytes':errbytes,'stderrSha256':errsha.hexdigest()});out['errors'].append(meta)
 return output.decode('utf8','replace')
out['dfBytes']=run(['df','-B1','-P','/','/opt','/var','/tmp'])
out['dfInodes']=run(['df','-Pi','/','/opt','/var','/tmp'])
out['memory']=run(['free','-b'])
out['directoryAllocation']=[]
for root in ['/opt','/var','/root','/tmp']:
 if not pathlib.Path(root).exists():continue
 raw=run(['du','-x','-B1','--max-depth=1',root],18)
 rows=[]
 for line in raw.splitlines():
  try:size,path=line.split('\t',1);rows.append({'bytesAllocated':int(size),'path':path})
  except ValueError:continue
 out['directoryAllocation']+=sorted(rows,key=lambda x:x['bytesAllocated'],reverse=True)[:15]
out['logAllocation']=[]
for root in ['/var/log','/root/.pm2/logs','/usr/local/share/aliyun-assist']:
 if not pathlib.Path(root).exists():continue
 raw=run(['du','-x','-B1','--max-depth=1',root],8)
 rows=[]
 for line in raw.splitlines():
  try:size,path=line.split('\t',1);rows.append({'bytesAllocated':int(size),'path':path})
  except ValueError:continue
 out['logAllocation']+=sorted(rows,key=lambda x:x['bytesAllocated'],reverse=True)[:8]
out['processes']=[]
for p in pathlib.Path('/proc').iterdir():
 if not p.name.isdigit():continue
 try:
  s={line.split(':',1)[0]:line.split(':',1)[1].strip() for line in (p/'status').read_text().splitlines() if ':' in line}
  rss=int(s.get('VmRSS','0 kB').split()[0])*1024
  if rss<16*1024*1024:continue
  out['processes'].append({'pid':int(p.name),'name':s.get('Name'),'rssBytes':rss,'cwd':os.readlink(p/'cwd'),'exe':os.readlink(p/'exe')})
 except (FileNotFoundError,ProcessLookupError,PermissionError):continue
out['processes']=sorted(out['processes'],key=lambda x:x['rssBytes'],reverse=True)[:18]
out['pm2']=[]
out['pm2Read']={'queried':False,'reason':'PM2 CLI may auto-start a daemon; use the deployment owner verified sanitized process snapshot if needed'}
unitRaw=run(['systemctl','show','pm2-root.service','--property=ActiveState,SubState,UnitFileState,User,ExecStart,Environment'],8)
unit={line.split('=',1)[0]:line.split('=',1)[1] for line in unitRaw.splitlines() if '=' in line}
unitExec=unit.get('ExecStart','');unitEnv=unit.get('Environment','')
out['pm2BootUnit']={k:unit.get(k) for k in ['ActiveState','SubState','UnitFileState','User']}
out['pm2BootUnit'].update({'execHasResurrect':'resurrect' in unitExec,'execSha256':hashlib.sha256(unitExec.encode()).hexdigest(),'environmentHasNode22Path':'/opt/node22/bin' in unitEnv,'environmentHasRootPm2Home':'PM2_HOME=/root/.pm2' in unitEnv,'environmentSha256':hashlib.sha256(unitEnv.encode()).hexdigest()})
if shutil.which('docker'):
 out['dockerSummary']=run(['docker','system','df'],10)
 out['dockerContainers']=run(['docker','ps','-a','--format','{{.ID}} {{.Image}} {{.Names}} {{.Status}}'],10)
else:out['dockerSummary']='not installed'
print('JF_RELEASE_RESULT='+json.dumps(out,separators=(',',':')))
PY
