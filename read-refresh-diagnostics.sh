#!/bin/sh
set -eu
python3 - <<'PY'
import datetime,hashlib,json,os,stat,re
from pathlib import Path
out={'status':'READ_ONLY_REFRESH_LOG_DIAGNOSTICS','at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'files':[]}
root=Path('/root/.pm2/logs')
for role in ['jobfinder-web-delta-964be0f','jobfinder-web-delta-3c29c07']:
 for kind in ['out','error']:
  p=root/(role+'-'+kind+'.log');item={'role':role,'kind':kind}
  try:
   for parent in [Path('/root'),Path('/root/.pm2'),root]:
    st=parent.lstat()
    if not stat.S_ISDIR(st.st_mode) or stat.S_ISLNK(st.st_mode):raise ValueError('UNSUPPORTED_PARENT')
   st=p.lstat()
   if not stat.S_ISREG(st.st_mode) or stat.S_ISLNK(st.st_mode):raise ValueError('UNSUPPORTED_LOG')
   with p.open('rb') as f:f.seek(max(0,st.st_size-65536));raw=f.read(65536)
   text=raw.decode('utf8','replace');lines=text.splitlines();events=[]
   for i,line in enumerate(lines):
    marker=next((m for m in ['PORTABLE_SNAPSHOT_REFRESH_COMPLETED','PORTABLE_SNAPSHOT_REFRESH_FAILED'] if m in line),None)
    if not marker:continue
    block='\n'.join(lines[i:i+14]);record={'event':marker}
    for key,pattern in [('state',r"state: ['\"](CURRENT|FAILED|UPDATING)['\"]"),('phase',r"phase: ['\"](VERSION_CHECK_OR_BUILD|POST_BUILD_VERSION_CHECK)['\"]"),('durationMs',r'durationMs: ([0-9]+)'),('failures',r'failures: ([0-9]+)'),('lastVerifiedAt',r"lastVerifiedAt: ['\"]([0-9TZ:.-]+)['\"]"),('nextRetryAt',r"nextRetryAt: ['\"]([0-9TZ:.-]+)['\"]")]:
     m=re.search(pattern,block)
     if m:record[key]=int(m.group(1)) if key in ['durationMs','failures'] else m.group(1)
    events.append(record)
   patterns={'prisma_pool_timeout':'P2024','prisma_transaction_closed':'P2028','prisma_missing_column':'P2022','prisma_connection_failed':'P1001','heap_failure':'heap out of memory','timeout_text':'timed out','out_of_memory_text':'Allocation failed'}
   item.update({'fileBytes':st.st_size,'mtimeUtc':datetime.datetime.fromtimestamp(st.st_mtime,datetime.timezone.utc).isoformat(),'tailBytes':len(raw),'tailSha256':hashlib.sha256(raw).hexdigest(),'events':events[-20:],'knownErrorCounts':{k:text.lower().count(v.lower()) for k,v in patterns.items()}})
  except Exception as e:item['errorClass']=type(e).__name__
  out['files'].append(item)
print('JF_RELEASE_RESULT='+json.dumps(out,separators=(',',':')))
PY
