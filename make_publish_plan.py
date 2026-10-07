"""Generate the closed source publication plan; never read a live runtime path."""
import json
from pathlib import Path
import safe_source as safe

RECIPE_FILES = ('README.md', 'DEPENDENCIES.json', 'source-allowlist.json', 'safe_source.py', 'test_safe_source.py', 'make_publish_plan.py')
manifest = safe.load_allowlist()
blobs = safe.stage_blobs(safe.HERE / 'sources', manifest)
files = [(name, safe.HERE / name) for name in RECIPE_FILES]
files += [('sources/' + entry['path'], safe.HERE / 'sources' / entry['path']) for entry in manifest['entries']]
entries = []
for name, path in sorted(files):
    safe.safe_name(name)
    safe.no_symlink_components(path)
    safe.require(path.is_file() and not path.is_symlink(), 'PUBLICATION_REGULAR_FILE_REQUIRED')
    raw = path.read_bytes()
    entries.append({'path': name, 'sourcePath': str(path), 'sha256': safe.sha(raw), 'bytes': len(raw), 'mode': '100644'})
safe.require(len(entries) == 136 and len({e['path'] for e in entries}) == 136, 'PUBLICATION_CLOSED_COUNT')
path = safe.HERE / 'source-plan.json'
path.write_text(json.dumps(entries, indent=2) + '\n')
print(json.dumps({'files': len(entries), 'bytes': sum(e['bytes'] for e in entries), 'planSha256': safe.sha(path.read_bytes())}))
