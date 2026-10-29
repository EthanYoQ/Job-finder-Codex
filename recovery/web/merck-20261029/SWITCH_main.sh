set -eu
python3 - <<'PY'
from pathlib import Path
import json,hashlib,shutil,subprocess,urllib.request,time
p=Path('/opt/jobfinder-candidates/release-f9f05a9eefc32e5095de4c9b/.merck-stage-20261029T1804Z');rows=[r for r in json.loads((p/'manifest.json').read_text()) if r['role']=='main']
assert urllib.request.urlopen('http://127.0.0.1:3031/readyz',timeout=5).status==200
assert '127.0.0.1:3031' in Path('/etc/nginx/conf.d/job.conf').read_text()
for r in rows:
 assert hashlib.sha256(Path(r['absoluteTarget']).read_bytes()).hexdigest()==r['oldSha256']
 assert hashlib.sha256((p/'new'/'main'/r['relativePath']).read_bytes()).hexdigest()==r['newSha256']
 assert hashlib.sha256((p/'rollback'/'main'/r['relativePath']).read_bytes()).hexdigest()==r['oldSha256']
subprocess.check_call(['/usr/bin/pm2','stop','56'],stdout=subprocess.DEVNULL)
try:
 for r in rows:shutil.copyfile(p/'new'/'main'/r['relativePath'],r['absoluteTarget'])
 subprocess.check_call(['/usr/bin/pm2','restart','56'],stdout=subprocess.DEVNULL)
 end=time.monotonic()+90
 while True:
  try:
   if urllib.request.urlopen('http://127.0.0.1:3036/readyz',timeout=5).status==200:break
  except Exception:pass
  if time.monotonic()>end:raise RuntimeError('READY_TIMEOUT')
  time.sleep(1)
except Exception:
 subprocess.call(['/usr/bin/pm2','stop','56'],stdout=subprocess.DEVNULL)
 for r in rows:shutil.copyfile(p/'rollback'/'main'/r['relativePath'],r['absoluteTarget'])
 subprocess.check_call(['/usr/bin/pm2','restart','56'],stdout=subprocess.DEVNULL)
 raise
print(json.dumps({'role':'main','ready':200,'filesInstalled':len(rows),'otherSideKeptServing':True}))
PY
