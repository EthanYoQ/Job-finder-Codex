set -eu
python3 - <<'PY'
from pathlib import Path
import hashlib,urllib.request
p=Path('/etc/nginx/conf.d/job.conf');b=Path('/opt/jobfinder-candidates/release-f9f05a9eefc32e5095de4c9b/.compact-bayer-stage-20261029T1355Z')/'rollback'/'nginx.job.conf';old=b.read_bytes()
assert hashlib.sha256(old).hexdigest()=='6e15ffaeaf4e8571585ad2a84bd59d04d883009ea6298cb133a93c9997ea1af8'
assert old.count(b'127.0.0.1:3036')==1
assert p.read_bytes()==old.replace(b'127.0.0.1:3036',b'127.0.0.1:3031')
assert urllib.request.urlopen('http://127.0.0.1:3031/readyz',timeout=5).status==200
print('VERIFIED_PREVIOUS_ROUTE_WRITE_NO_REPEAT')
PY
nginx -t
nginx -s reload
printf 'ROUTE_3031_RELOAD_COMPLETE\n'
