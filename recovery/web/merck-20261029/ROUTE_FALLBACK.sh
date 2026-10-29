set -eu
python3 - <<'PY'
from pathlib import Path
import hashlib,subprocess,urllib.request,json
p=Path('/etc/nginx/conf.d/job.conf');backup=Path('/opt/jobfinder-candidates/release-f9f05a9eefc32e5095de4c9b/.merck-stage-20261029T1804Z')/'rollback'/'nginx.job.conf'
assert urllib.request.urlopen('http://127.0.0.1:3031/readyz',timeout=5).status==200
if False:
 old=backup.read_bytes();assert hashlib.sha256(old).hexdigest()=='6e15ffaeaf4e8571585ad2a84bd59d04d883009ea6298cb133a93c9997ea1af8'
 assert old.count(b'127.0.0.1:3036')==1
 assert p.read_bytes()==old.replace(b'127.0.0.1:3036',b'127.0.0.1:3031')
 new=old
else:
 old=p.read_bytes();assert hashlib.sha256(old).hexdigest()=='6e15ffaeaf4e8571585ad2a84bd59d04d883009ea6298cb133a93c9997ea1af8'
 assert old.count(b'127.0.0.1:3036')==1
 with backup.open('xb') as f:f.write(old)
 new=old.replace(b'127.0.0.1:3036',b'127.0.0.1:3031')
p.write_bytes(new)
r=subprocess.run(['nginx','-t'],stdout=subprocess.PIPE,stderr=subprocess.PIPE)
if r.returncode:
 p.write_bytes(old);raise RuntimeError('NGINX_CONFIG_TEST_FAILED_ORIGINAL_PRE_ACTION_BYTES_FalseD_NO_RELOAD')
subprocess.run(['nginx','-s','reload'],check=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
print(json.dumps({'restoredOriginal':False,'nginxSha256':hashlib.sha256(p.read_bytes()).hexdigest(),'readyPort':3031}))
PY
