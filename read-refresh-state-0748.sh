#!/bin/sh
set -eu
python3 - <<'PY'
import datetime, hashlib, json, os, re, stat, subprocess
from pathlib import Path
PM2_HOME=Path('/root/.pm2')
PM2_BIN='/usr/lib/node_modules/pm2/bin/pm2'
NODE='/opt/node22/bin/node'
RELEASE=Path('/opt/jobfinder-candidates/release-94333cf79435d0e4a350aada')
ROLES={'jobfinder-web-delta-964be0f':'web-main','jobfinder-web-delta-3c29c07':'compatible-fallback'}
ENV={'PATH':'/opt/node22/bin:/usr/local/bin:/usr/bin:/bin','HOME':'/root','PM2_HOME':str(PM2_HOME),'LC_ALL':'C','NO_COLOR':'1'}
TAIL_BYTES=65536
class Refusal(Exception): pass
def require(ok,code):
 if not ok: raise Refusal(code)
def secure_fd(path,directory=False):
 # Open each component relative to its already-open parent; no symlink traversal.
 parts=Path(path).parts
 require(parts and parts[0]=='/' and '..' not in parts,'UNSUPPORTED_ABSOLUTE_PATH')
 fd=os.open('/',os.O_RDONLY|os.O_DIRECTORY|os.O_CLOEXEC)
 try:
  for i,part in enumerate(parts[1:]):
   last=i==len(parts)-2
   flags=os.O_RDONLY|os.O_CLOEXEC|os.O_NOFOLLOW|(os.O_DIRECTORY if not last or directory else os.O_NONBLOCK)
   nxt=os.open(part,flags,dir_fd=fd);os.close(fd);fd=nxt
   st=os.fstat(fd)
   require(st.st_uid==0,'NON_ROOT_OWNER')
   require(not st.st_mode&0o022,'WRITABLE_COMPONENT')
   if not last or directory: require(stat.S_ISDIR(st.st_mode),'NON_DIRECTORY_COMPONENT')
  return fd
 except BaseException:
  os.close(fd);raise
def daemon_binding():
 fd=secure_fd(PM2_HOME/'pm2.pid')
 try:
  st=os.fstat(fd);require(stat.S_ISREG(st.st_mode) and st.st_size<=32,'INVALID_DAEMON_PID_FILE')
  value=os.read(fd,33).decode('ascii').strip()
 finally:os.close(fd)
 require(value.isdigit() and int(value)>0,'INVALID_DAEMON_PID')
 p=Path('/proc')/value
 data=(p/'stat').read_text()
 ticks=data.rsplit(')',1)[1].split()[19]
 require(ticks.isdigit(),'INVALID_DAEMON_START')
 directory=secure_fd(PM2_HOME,directory=True)
 try:
  for name in ('rpc.sock','pub.sock'):
   st=os.stat(name,dir_fd=directory,follow_symlinks=False)
   require(stat.S_ISSOCK(st.st_mode) and st.st_uid==0,'DAEMON_SOCKET_MISSING')
 finally:os.close(directory)
 return (int(value),ticks)
def extract_events(text):
 lines=text.splitlines();events=[];i=0
 marker_re=re.compile(r'PORTABLE_SNAPSHOT_REFRESH_(STARTED|COMPLETED|FAILED)\s*\{')
 key_re=re.compile(r'''^\s*["']?(state|phase|durationMs|failures|lastVerifiedAt|nextRetryAt)["']?\s*:\s*(.*?)\s*,?\s*$''')
 while i<len(lines):
  match=marker_re.search(lines[i])
  if not match:i+=1;continue
  start=i;record={'event':'PORTABLE_SNAPSHOT_REFRESH_'+match.group(1)}
  prefix=lines[i][:match.start()].strip()
  # Timestamp prefixes are optional; file mtime is never an event timestamp.
  stamp=re.fullmatch(r'(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z)\s*:?',prefix)
  if stamp:record['logTimestamp']=stamp.group(1)
  block=lines[i][match.end():];i+=1;complete=False
  while i<len(lines) and i-start<=20:
   if marker_re.search(lines[i]):break
   if re.fullmatch(r'\s*}\s*',lines[i]):complete=True;i+=1;break
   block+='\n'+lines[i];i+=1
  if not complete:continue
  for line in block.splitlines():
   m=key_re.fullmatch(line)
   if not m:continue
   key,value=m.groups();value=value.rstrip(',').strip()
   if key in ('durationMs','failures'):
    if re.fullmatch(r'\d{1,12}',value):record[key]=int(value)
   elif key=='state':
    m=re.fullmatch(r'''["'](CURRENT|FAILED|UPDATING)["']''',value)
    if m:record[key]=m.group(1)
   elif key=='phase':
    m=re.fullmatch(r'''["'](VERSION_CHECK_OR_BUILD|POST_BUILD_VERSION_CHECK)["']''',value)
    if m:record[key]=m.group(1)
   elif value=='null':record[key]=None
   else:
    m=re.fullmatch(r'''["'](\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z)["']''',value)
    if m:record[key]=m.group(1)
  events.append(record)
 return events[-30:]
def error_counts(text):
 # Counts only; a tail-level count is not attributed to an individual refresh.
 codes=['P1001','P1002','P1008','P1017','P2010','P2022','P2024','P2028']
 result={code:len(re.findall(r'\b'+code+r'\b',text)) for code in codes}
 result.update({name:len(re.findall(pattern,text,re.I)) for name,pattern in {
  'heapFailure':r'heap out of memory|Allocation failed',
  'timeoutText':r'\btimed out\b|\btimeout\b',
  'transactionExpiredText':r'\bexpired transaction\b|\btransaction already closed\b'
 }.items()})
 return result
def within(path,root):
 try:path.relative_to(root);return True
 except ValueError:return False
def read_log(role,kind,value):
 require(isinstance(value,str) and len(value)<=512,'INVALID_LOG_PATH_METADATA')
 p=Path(value)
 require(p.is_absolute() and '..' not in p.parts and p.suffix=='.log','UNSUPPORTED_LOG_PATH')
 pm_root=PM2_HOME/'logs';role_root=RELEASE/ROLES[role]
 require(within(p,pm_root) or within(p,role_root),'LOG_OUTSIDE_ALLOWED_ROOTS')
 if within(p,pm_root):require(p.name.startswith(role+'-'),'PM2_LOG_ROLE_MISMATCH')
 fd=secure_fd(p)
 try:
  st=os.fstat(fd);require(stat.S_ISREG(st.st_mode) and st.st_nlink==1,'NOT_SINGLE_LINK_REGULAR_LOG')
  offset=max(0,st.st_size-TAIL_BYTES);os.lseek(fd,offset,os.SEEK_SET);raw=os.read(fd,TAIL_BYTES)
 finally:os.close(fd)
 text=raw.decode('utf8','replace')
 return {'role':role,'kind':kind,'path':str(p),'fileBytes':st.st_size,'mtimeUtc':datetime.datetime.fromtimestamp(st.st_mtime,datetime.timezone.utc).isoformat(),'tailBytes':len(raw),'tailSha256':hashlib.sha256(raw).hexdigest(),'events':extract_events(text),'tailLevelKnownErrorCounts':error_counts(text),'countsAttributedToSpecificEvent':False}
def main():
 out={'status':'READ_ONLY_REFRESH_RESOURCE_DIAGNOSTICS_R3','at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'pm2Home':str(PM2_HOME),'pm2Binary':PM2_BIN,'files':[],'roles':[]}
 out['memAvailableKiB']=int(re.search(r'^MemAvailable:\s+(\d+) kB$',Path('/proc/meminfo').read_text(),re.M).group(1))
 conf=Path('/etc/nginx/conf.d/job.conf');fd=secure_fd(conf)
 try:
  require(stat.S_ISREG(os.fstat(fd).st_mode) and os.fstat(fd).st_size<=65536,'NGINX_FILE_LIMIT');raw_conf=os.read(fd,65537)
 finally:os.close(fd)
 out['nginxConfigSha256']=hashlib.sha256(raw_conf).hexdigest()
 before=daemon_binding()
 binary_fd=secure_fd(PM2_BIN)
 try:require(stat.S_ISREG(os.fstat(binary_fd).st_mode),'PM2_BINARY_NOT_REGULAR')
 finally:os.close(binary_fd)
 # Execute the installed CLI's jlist only. Block child-process creation so a
 # disappearing daemon cannot make the CLI spawn a replacement daemon.
 guard="""const cp=require('node:child_process');
for(const k of ['spawn','spawnSync','fork','exec','execSync','execFile','execFileSync'])cp[k]=()=>{throw new Error('PM2_CHILD_PROCESS_DENIED');};
const entry=process.argv[1];process.argv=[process.execPath,entry,'jlist'];require(entry);
"""
 try:
  done=subprocess.run([NODE,'-e',guard,PM2_BIN],env=ENV,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=12)
 except subprocess.TimeoutExpired:
  raise Refusal('PM2_JLIST_TIMEOUT')
 require(done.returncode==0,'PM2_JLIST_FAILED')
 require(len(done.stdout)<=4*1024*1024,'PM2_JLIST_TOO_LARGE')
 require(daemon_binding()==before,'DAEMON_CHANGED_DURING_READ')
 try:rows=json.loads(done.stdout)
 except (ValueError,UnicodeError):raise Refusal('PM2_JLIST_NOT_JSON')
 require(isinstance(rows,list),'PM2_JLIST_NOT_LIST')
 for role,subdir in ROLES.items():
  found=[r for r in rows if isinstance(r,dict) and r.get('name')==role]
  require(len(found)==1,'PM2_ROLE_NOT_UNIQUE')
  e=found[0].get('pm2_env');require(isinstance(e,dict),'PM2_ROLE_METADATA_MISSING')
  require(e.get('pm_cwd')==str(RELEASE/subdir) and e.get('pm_exec_path')==NODE,'PM2_ROLE_BINDING_CHANGED')
  out['roles'].append({'role':role,'status':e.get('status'),'pid':found[0].get('pid'),'cwd':e.get('pm_cwd'),'rssBytes':found[0].get('monit',{}).get('memory'),'port':str(e.get('PORT')) if str(e.get('PORT')) in ('3031','3036') else 'UNEXPECTED','heap256':e.get('NODE_OPTIONS')=='--max-old-space-size=256','heap192':e.get('NODE_OPTIONS')=='--max-old-space-size=192'})
  for kind,key in [('out','pm_out_log_path'),('error','pm_err_log_path')]:
   try:out['files'].append(read_log(role,kind,e.get(key)))
   except Refusal as error:out['files'].append({'role':role,'kind':kind,'refusalCode':str(error)})
   except OSError as error:out['files'].append({'role':role,'kind':kind,'errorClass':type(error).__name__,'errno':error.errno})
 out['sourceEventFormat']='Node console object blocks; current FAILED event omits original exception'
 out['rawLogReturned']=False;out['pm2EnvironmentReturned']=False
 return out
try:result=main()
except Refusal as error:result={'status':'REFRESH_DIAGNOSTICS_REFUSED','refusalCode':str(error)}
except OSError as error:result={'status':'REFRESH_DIAGNOSTICS_REFUSED','errorClass':type(error).__name__,'errno':error.errno}
except Exception as error:result={'status':'REFRESH_DIAGNOSTICS_REFUSED','errorClass':type(error).__name__}
print('JF_RELEASE_RESULT='+json.dumps(result,separators=(',',':')))
PY
