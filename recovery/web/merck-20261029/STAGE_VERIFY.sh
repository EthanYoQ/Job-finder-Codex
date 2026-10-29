set -eu
python3 - <<'PY'
from pathlib import Path
import base64,gzip,json,hashlib,shutil
p=Path('/opt/jobfinder-candidates/release-f9f05a9eefc32e5095de4c9b/.merck-stage-20261029T1804Z')
b=base64.b64decode(''.join((p/('part%02d'%i)).read_text() for i in range(7)))
assert hashlib.sha256(b).hexdigest()=='512996f29332e9373bca2ae546770ca6288ab3be3abba47c5c8872a7a56119e4'
rows=json.loads(gzip.decompress(b).decode())
for r in rows:
 t=Path(r['absoluteTarget']);assert hashlib.sha256(t.read_bytes()).hexdigest()==r['oldSha256']
 n=p/'new'/r['role']/r['relativePath'];n.parent.mkdir(parents=True,exist_ok=True);n.write_text(r['content'])
 assert hashlib.sha256(n.read_bytes()).hexdigest()==r['newSha256']
 bk=p/'rollback'/r['role']/r['relativePath'];bk.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(t,bk)
 assert hashlib.sha256(bk.read_bytes()).hexdigest()==r['oldSha256']
(p/'manifest.json').write_text(json.dumps([{k:v for k,v in r.items() if k!='content'} for r in rows]))
print(json.dumps({'staged':len(rows),'liveUnchanged':True,'rollbackExact':True}))
PY
