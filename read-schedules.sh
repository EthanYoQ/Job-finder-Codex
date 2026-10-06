set -eu
python3 -I -B - <<'PY'
import os,re,json,hashlib,subprocess,datetime,time,stat,base64,zlib
TIMERS=['certbot-renew.timer','chrony-dnssrv@.timer','dnf-makecache.timer','fstrim.timer','fwupd-refresh.timer','geo-backup.timer','mdadm-last-resort@.timer','mdcheck_continue.timer','mdcheck_start.timer','mdmonitor-oneshot.timer','sysstat-collect.timer','sysstat-summary.timer','systemd-tmpfiles-clean.timer','unbound-anchor.timer','weekly-ranking.timer']
OLD=['1aef4f1','13c39a6','4b64b20','26d4235','9ca7f1b','b7ca7cb','afffcd4','0a1f60c']
PROPS=['Id','LoadState','ActiveState','SubState','UnitFileState','Triggers','FragmentPath','WorkingDirectory','ExecStart','ExecStartPre','ExecStartPost']
def sha(s): return hashlib.sha256(s if isinstance(s,bytes) else s.encode()).hexdigest()
def now(): return datetime.datetime.now(datetime.timezone.utc).isoformat()
def goodpath(s): return bool(re.match(r'^/[A-Za-z0-9_./+@-]{1,350}$',s)) and not re.search(r'credential|secret|\.env|id_rsa',s,re.I)
def classify(s): return [k for k,p in [('jobfinder',r'job[-_]?finder'),('collection',r'crawl|scrap|collector|harvest|p0.scheduler|producer'),('publication',r'publish'),('web',r'httpserver|web.server')] if re.search(p,s,re.I)]
def command_summary(s):
 paths=re.findall(r'(?<![:A-Za-z0-9])(/[A-Za-z0-9_./+@-]+)',s)
 return {'sha256':sha(s),'classes':classify(s),'visibleProgramOrScriptPaths':sorted(set(p for p in paths if goodpath(p) and (re.search(r'\.(sh|py|js|cjs|mjs|ts)$',p) or re.search(r'/(bin|sbin)/[^/]+$',p))))[:32]}
def clean_prop(k,v):
 if k.startswith('Exec'): return command_summary(v)
 if k in ['WorkingDirectory','FragmentPath']: return v if not v or goodpath(v) else '[withheld:'+sha(v)+']'
 if k in ['Id','Triggers']:
  return ' '.join(x if re.match(r'^[A-Za-z0-9_.@:-]+\.(timer|service)$',x) else '[withheld]' for x in v.split())
 return v if re.match(r'^[A-Za-z0-9_-]{0,80}$',v) else '[withheld:'+sha(v)+']'
def safe_error(s,names):
 allowed=set(('Failed to get properties Unit unit name is neither a valid invocation ID nor found loaded not No such file or directory Access denied Permission Invalid argument Transport endpoint connected Connection refused timed out Failed Failed: properties: Unit: name: ID: error: Error: cannot Cannot bus connect specified The has been could be does exist').split())
 out=[]
 for line in s.splitlines()[:50]:
  tokens=[]
  for word in line.split()[:80]:
   stripped=word.strip('"\x27:.,')
   tokens.append(word if word in allowed or stripped in names else '[withheld]')
  out.append(' '.join(tokens))
 return out
def result(kind,target,rc,out,err):
 props={};unparsed=[]
 for line in out.splitlines():
  k,sep,v=line.partition('=')
  if sep and k in PROPS: props[k]=clean_prop(k,v)
  elif line.strip(): unparsed.append({'sha256':sha(line),'safeState':line.strip() if re.match(r'^(enabled|disabled|static|masked|indirect|generated|transient|enabled-runtime|masked-runtime|linked|linked-runtime|alias|not-found)$',line.strip()) else '[withheld]'})
 return {'kind':kind,'target':target,'returncode':rc,'stdout':{'bytes':len(out.encode()),'sha256':sha(out),'properties':props,'otherLines':unparsed},'stderr':{'bytes':len(err.encode()),'sha256':sha(err),'sanitizedLines':safe_error(err,set(TIMERS+[target]))}}
def main():
 deadline=time.monotonic()+50
 R={'checkedAt':now(),'readOnly':True,'timerQueries':[],'serviceQueries':[],'staticTemplateEvidence':[],'boundaries':['Only the fixed 15 timers, their directly triggered services, and fixed 8 old PM2 entries are checked.','PM2 RPC connects only to an already existing local socket; no PM2 Client, CLI, daemon start, restart or lifecycle method is called.','Full commands and environment remain server-side; command hashes and approved identity fields only are emitted.']}
 def run(kind,target,args):
  remaining=deadline-time.monotonic()
  if remaining<0.2: return result(kind,target,'budget_exhausted','','')
  try:
   p=subprocess.run(args,stdout=subprocess.PIPE,stderr=subprocess.PIPE,universal_newlines=True,timeout=min(3,remaining))
   return result(kind,target,p.returncode,p.stdout,p.stderr)
  except subprocess.TimeoutExpired as e:
   conv=lambda x:x.decode('utf-8','replace') if isinstance(x,bytes) else x or ''
   return result(kind,target,'timeout',conv(e.stdout),conv(e.stderr))
  except Exception as e: return result(kind,target,type(e).__name__,'','')
 services=set()
 for name in TIMERS:
  q=run('show',name,['systemctl','show','--no-pager']+['--property='+p for p in PROPS]+[name]);R['timerQueries'].append(q)
  for s in q['stdout']['properties'].get('Triggers','').split():
   if re.match(r'^[A-Za-z0-9_.@:-]+\.service$',s): services.add(s)
  if name.endswith('@.timer'):
   e={'name':name,'runtimeTemplate':True,'unitFileStateQuery':run('is-enabled',name,['systemctl','is-enabled',name]),'files':[]}
   for directory in ['/etc/systemd/system','/usr/lib/systemd/system','/lib/systemd/system']:
    p=directory+'/'+name
    if not os.path.isfile(p): continue
    with open(p,'rb') as f: b=f.read(65537)
    f={'path':p,'bytes':len(b),'sha256':sha(b),'limited':len(b)>65536,'serviceTemplates':[]}
    if len(b)<=65536:
     for line in b.decode('utf-8','replace').splitlines():
      if line.strip().startswith('Unit='):
       v=line.strip()[5:]
       if re.match(r'^[A-Za-z0-9_.@%:-]+\.service$',v): f['serviceTemplates'].append(v)
    e['files'].append(f)
   targets=set([name[:-6]+'.service'])
   for f in e['files']: targets.update(s.replace('%i','').replace('%I','') for s in f['serviceTemplates'])
   e['serviceTemplateFiles']=[]
   for s in sorted(targets):
    if not re.match(r'^[A-Za-z0-9_.@:-]+\.service$',s): continue
    for directory in ['/etc/systemd/system','/usr/lib/systemd/system','/lib/systemd/system']:
     p=directory+'/'+s
     if not os.path.isfile(p): continue
     with open(p,'rb') as f: b=f.read(65537)
     item={'path':p,'sha256':sha(b),'limited':len(b)>65536,'properties':{}}
     if len(b)<=65536:
      for line in b.decode('utf-8','replace').splitlines():
       k,sep,v=line.partition('=')
       if sep and k in ['WorkingDirectory','ExecStart','ExecStartPre','ExecStartPost']: item['properties'][k]=clean_prop(k,v)
     e['serviceTemplateFiles'].append(item)
   R['staticTemplateEvidence'].append(e)
 R['triggeredServiceCount']=len(services)
 for name in sorted(services)[:32]: R['serviceQueries'].append(run('show',name,['systemctl','show','--no-pager']+['--property='+p for p in PROPS]+[name]))
 dirs={h:'/opt/jobfinder-candidates/'+h for h in OLD}
 procs={h:[] for h in OLD};n=0;unreadable=0
 for pid in sorted(x for x in os.listdir('/proc') if x.isdigit())[:10000]:
  n+=1
  try:
   cwd=os.readlink('/proc/'+pid+'/cwd')
   with open('/proc/'+pid+'/cmdline','rb') as f: raw=f.read(65536)
   args=raw.decode('utf-8','replace').split('\x00')
   for h,d in dirs.items():
    if cwd==d or cwd.startswith(d+'/') or any(a==d or a.startswith(d+'/') for a in args):
     scripts=[a for a in args if re.match(r'^[A-Za-z0-9_./@+-]{1,350}\.(js|cjs|mjs|py|sh|ts)$',a)]
     procs[h].append({'pid':int(pid),'cwd':cwd if goodpath(cwd) else '[withheld]','scriptPaths':scripts[:8]})
  except (FileNotFoundError,ProcessLookupError,PermissionError): unreadable+=1
  except Exception: unreadable+=1
 R['knownOldDirectoryProcesses']=[{'name':'jobfinder-portable-'+h,'cwd':dirs[h],'processes':procs[h]} for h in OLD]
 R['procCoverage']={'entriesExamined':n,'unreadableOrExited':unreadable,'maxEntries':10000}
 daemon={'pidFile':'/root/.pm2/pm2.pid','rpcSocket':'/root/.pm2/rpc.sock','pidVerifiedAsPM2':False,'socketExists':False}
 try:
  with open(daemon['pidFile'],'rb') as f: pid=f.read(32).strip().decode()
  if pid.isdigit():
   daemon['pid']=int(pid)
   with open('/proc/'+pid+'/cmdline','rb') as f: title=f.read(4096)
   daemon['pidVerifiedAsPM2']=bool(re.search(br'PM2.*God Daemon|pm2.*/Daemon\.js',title))
  daemon['socketExists']=stat.S_ISSOCK(os.stat(daemon['rpcSocket']).st_mode)
 except Exception as e: daemon['verificationError']=type(e).__name__
 R['pm2ExistingDaemon']=daemon
 if daemon['pidVerifiedAsPM2'] and daemon['socketExists']:
  node=r'''
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const hashes=['1aef4f1','13c39a6','4b64b20','26d4235','9ca7f1b','b7ca7cb','afffcd4','0a1f60c'];
const names=new Set(hashes.map(h=>'jobfinder-portable-'+h));
let sock=null,done=false,timer;
function finish(x){if(done)return;done=true;clearTimeout(timer);try{if(sock)sock.close()}catch(e){}process.stdout.write(JSON.stringify(x)+'\n');setTimeout(()=>process.exit(0),10)}
const roots=['/opt/node22/lib/node_modules/pm2','/usr/local/lib/node_modules/pm2','/usr/lib/node_modules/pm2'];
for(const bin of ['/opt/node22/bin/pm2','/usr/local/bin/pm2','/usr/bin/pm2']){try{const p=fs.realpathSync(bin);if(p.endsWith('/pm2/bin/pm2'))roots.push(path.dirname(path.dirname(p)))}catch(e){}}
let axon,rpc,used;
for(const r of [...new Set(roots)]){for(const sub of ['modules','node_modules']){try{const a=path.join(r,sub,'pm2-axon'),b=path.join(r,sub,'pm2-axon-rpc');if(fs.existsSync(a)&&fs.existsSync(b)){axon=require(a);rpc=require(b);used=r;break}}catch(e){}}if(axon&&rpc)break}
if(!axon||!rpc){finish({state:'unavailable',reason:'existing RPC transport modules not found'});}else{
 timer=setTimeout(()=>finish({state:'unavailable',reason:'RPC timeout'}),5000);
 try{
  sock=axon.socket('req');const client=new rpc.Client(sock);
  sock.once('error',e=>finish({state:'unavailable',reason:'socket error',code:/^[A-Z0-9_]+$/.test(e.code||'')?e.code:null}));
  sock.once('reconnect attempt',()=>finish({state:'unavailable',reason:'socket unavailable; reconnect stopped'}));
  sock.once('connect',()=>client.call('getMonitorData',{},(err,list)=>{
   if(err||!Array.isArray(list)){finish({state:'unavailable',reason:'RPC returned error'});return;}
   const out=list.filter(p=>names.has((p.pm2_env||{}).name||p.name)).map(p=>{const e=p.pm2_env||{},args=JSON.stringify(e.args||[]),known=['scripts/p0-portable-worker.ts','scripts/p0-scheduler.ts','scripts/p0-portable-scheduler.ts','src/crawler/worker.ts','src/server/httpServer.ts'];return {name:e.name||p.name,pid:typeof p.pid==='number'?p.pid:null,status:['online','stopped','stopping','launching','errored','waiting restart','one-launch-status'].includes(e.status)?e.status:'[withheld]',uptimeMs:e.status==='online'&&typeof e.pm_uptime==='number'?Math.max(0,Date.now()-e.pm_uptime):0,knownCwdMatch:hashes.some(h=>e.pm_cwd==='/opt/jobfinder-candidates/'+h),knownNodePathMatch:e.pm_exec_path==='/opt/node22/bin/node',knownScriptMatches:known.filter(k=>args.includes(k)),argsSha256:crypto.createHash('sha256').update(args).digest('hex')}});
   finish({state:'success',method:'getMonitorData',transportRoot:used,entries:out,missingNames:[...names].filter(n=>!out.some(p=>p.name===n))});
  }));
  sock.connect('/root/.pm2/rpc.sock');
 }catch(e){finish({state:'unavailable',reason:'RPC transport exception'})}
}
'''
  try:
   p=subprocess.run(['/opt/node22/bin/node','-e',node],stdout=subprocess.PIPE,stderr=subprocess.PIPE,universal_newlines=True,timeout=7)
   R['pm2Live']={'returncode':p.returncode,'stderrSha256':sha(p.stderr),'stderrBytes':len(p.stderr),'result':json.loads(p.stdout)}
  except Exception as e: R['pm2Live']={'state':'unavailable','error':type(e).__name__}
 else: R['pm2Live']={'state':'unavailable','reason':'Existing PM2 daemon/socket not both verified; no start attempted'}
 R['finishedAt']=now();b=json.dumps(R,separators=(',',':'),sort_keys=True).encode();print('AUDIT_SHA256='+sha(b));print('AUDIT_ZLIB_BASE64='+base64.b64encode(zlib.compress(b,9)).decode())
if __name__=='__main__': main()

PY
