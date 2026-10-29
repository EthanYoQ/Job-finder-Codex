python3 - <<'REMOTE'
from pathlib import Path
import hashlib,json
p=Path('/opt/jobfinder-candidates/release-f9f05a9eefc32e5095de4c9b/.merck-stage-20261029T1804Z')
print(json.dumps([{'name':f.name,'size':f.stat().st_size,'sha256':hashlib.sha256(f.read_bytes()).hexdigest()} for f in sorted(p.glob('part*'))]))
REMOTE
