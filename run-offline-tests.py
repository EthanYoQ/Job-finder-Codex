"""Build an isolated, unbound, relocated test copy and run only synthetic tests.

The destination must not exist. This never installs hosts, imports producer code,
requests network access, or invokes a database tool. The source snapshot remains
unchanged. Node.js, Python 3 and Bash must already be available.
"""
from pathlib import Path
import argparse, hashlib, json, os, shutil, subprocess

parser = argparse.ArgumentParser()
parser.add_argument('--destination', required=True)
parser.add_argument('--node', default='node')
args = parser.parse_args()
root = Path(__file__).resolve().parent
subprocess.run(['python3', str(root / 'verify-snapshot.py')], check=True)
out = Path(args.destination).absolute()
assert not out.exists(), 'Destination must be fresh; no overwrite is allowed.'
out.mkdir(parents=True)
runtime = out / 'runtime'
prepared = runtime / 'verification' / 'offline-snapshot'
payload = prepared / 'payload'
synthetic = prepared / 'synthetic-runtime'
owner = 'owner-adaptations/hansoh-fosun-c51-r4-20261007T2149Z'
original = json.loads((root / 'payload' / owner / 'baseline-manifest.json').read_text())['runtimeRoot']
changes = []
for source in sorted((root / 'payload').rglob('*')):
    if not source.is_file():
        continue
    relative = source.relative_to(root / 'payload')
    text = source.read_text()
    relocated = text.replace(original, str(runtime))
    assert relocated.replace(str(runtime), original) == text, relative
    target = payload / relative
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(relocated)
    derived = relocated.replace(str(runtime), str(synthetic))
    assert derived.replace(str(synthetic), str(runtime)) == relocated, relative
    target = synthetic / relative
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(derived)
    changes.append({'path': str(relative), 'change': 'absolute test root relocation only'})
manifest_path = synthetic / owner / 'baseline-manifest.json'
manifest = json.loads(manifest_path.read_text())
for name, row in manifest['files'].items():
    data = Path(name).read_bytes()
    row.update(sha256=hashlib.sha256(data).hexdigest(), bytes=len(data))
manifest_path.write_text(json.dumps(manifest, indent=2) + '\n')
subprocess.run(['python3', str(synthetic / owner / 'build-fragments.py')], check=True)
shutil.copytree(root / 'synthetic-tests', synthetic / owner / 'tests')
shutil.copytree(root / 'tests', prepared / 'tests')
(out / 'TEST_COPY_BOUNDARY.json').write_text(json.dumps({
    'classification': 'SYNTHETIC_RELOCATED_TEST_COPY_ONLY',
    'sourceChanges': changes,
    'derivedPinsRegenerated': ['synthetic baseline-manifest.json',
                             'synthetic preload-owner.exec.js',
                             'synthetic publish-reviewed-and-monitor.exec.js'],
    'producerUsed': False, 'installed': False, 'network': False,
    'database': False, 'originalSourcesModified': False}, indent=2) + '\n')
tests = sorted((prepared / 'tests').glob('*.test.mjs'))
tests += sorted((synthetic / owner / 'tests').glob('*.test.mjs'))
environment = dict(os.environ)
environment.pop('NODE_OPTIONS', None)
with (out / 'offline-tests.tap').open('wb') as output:
    result = subprocess.run([args.node, '--test', *map(str, tests)],
                            stdout=output, stderr=subprocess.STDOUT, env=environment)
print(json.dumps({'exitCode': result.returncode, 'testOutput': str(out / 'offline-tests.tap'),
                  'expectedTests': 683, 'operationalRestore': False}))
raise SystemExit(result.returncode)
