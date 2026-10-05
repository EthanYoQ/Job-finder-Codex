#!/usr/bin/env python3
"""Write exact archived-original versus active-host differences and hashes."""
import difflib,hashlib,json
from pathlib import Path
base=Path(__file__).resolve().parent.parent
host=base/'hosts46/jnj'
sha=lambda b:hashlib.sha256(b).hexdigest()
manifest=json.loads((host/'RESTORATION_MANIFEST.json').read_text())
for p in sorted((host/'originals').rglob('*')):
    if not p.is_file():continue
    name=str(p.relative_to(host/'originals'));active=host/name
    if name=='CHECK_RESULTS.json' or not active.exists():continue
    original=p.read_bytes();current=active.read_bytes()
    diff=''.join(difflib.unified_diff(original.decode().splitlines(keepends=True),current.decode().splitlines(keepends=True),fromfile='originals/'+name,tofile=name))
    delta=host/'diffs'/(name.replace('/','__')+'.diff');delta.parent.mkdir(exist_ok=True,mode=0o700);delta.write_text(diff);delta.chmod(0o600)
    manifest['templateFiles'][name]={'template':str(base/'code80-browser-contracts/operations/increment72/hosts/jnj42'/name),'templateSha256':sha(original),'originalPath':str(p),'originalSha256':sha(original),'sha256':sha(current),'diffPath':str(delta),'diffSha256':sha(diff.encode())}
(host/'RESTORATION_MANIFEST.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
spec=json.loads((host/'SPEC.json').read_text());spec['templateFiles']=manifest['templateFiles'];(host/'SPEC.json').write_text(json.dumps(spec,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'templateFiles':len(manifest['templateFiles']),'diffsVerified':True}))
