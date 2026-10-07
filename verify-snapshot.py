"""Read-only integrity check for the source backup; never execute runtime code."""
from pathlib import Path
import hashlib, json

root = Path(__file__).resolve().parent
manifest = json.loads((root / 'SOURCE_SNAPSHOT.json').read_text())
for row in manifest['files']:
    relative = Path(row['path'])
    assert not relative.is_absolute() and '..' not in relative.parts
    path = root / relative
    assert path.is_file() and not path.is_symlink(), relative
    data = path.read_bytes()
    assert len(data) == row['bytes'], relative
    assert hashlib.sha256(data).hexdigest() == row['sha256'], relative
print(json.dumps({'status': 'SOURCE_BYTES_VERIFIED', 'files': len(manifest['files']),
                  'operationalRestore': False}))
