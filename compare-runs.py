"""Compare complete newly generated payload trees, including actual bytes, not just manifests."""
from pathlib import Path
import hashlib,json,re,sys
root=Path(__file__).resolve().parent
names=sys.argv[1:];assert len(names)==2 and all(re.fullmatch(r'[a-z][a-z0-9-]*',x) for x in names)
trees=[root/name/'payload' for name in names]
sets=[sorted(p.relative_to(t).as_posix() for p in t.rglob('*') if p.is_file()) for t in trees]
assert sets[0]==sets[1] and len(sets[0])==8
result=[]
for rel in sets[0]:
 paths=[t/rel for t in trees];assert all(not p.is_symlink() for p in paths)
 values=[p.read_bytes() for p in paths];assert values[0]==values[1],rel
 result.append({'path':rel,'bytes':len(values[0]),'sha256':hashlib.sha256(values[0]).hexdigest()})
print(json.dumps({'sameCompleteFileSet':True,'allRawBytesEqual':True,'fileCount':len(result),'files':result},indent=2))
