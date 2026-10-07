"""Verify an exact existing source baseline; apply only with explicit --apply.

Use a fresh isolated checkout. This changes source only; no install, build,
registration, SQL, network request, owner activation or producer run occurs.
"""
from pathlib import Path
import argparse, hashlib, json, subprocess

parser = argparse.ArgumentParser()
parser.add_argument('--repository', required=True)
parser.add_argument('--apply', action='store_true')
args = parser.parse_args()
root = Path(__file__).resolve().parent
repo = Path(args.repository).resolve()
contract = json.loads((root / 'BASE_AND_PATCH.json').read_text())
subprocess.run(['python3', str(root / 'verify-snapshot.py')], check=True)
def git(*argv):
    return subprocess.check_output(['git', '-C', str(repo), *argv]).decode().strip()
def verify(path, row):
    assert path.is_file() and not path.is_symlink(), path
    data = path.read_bytes()
    assert len(data) == row['bytes'] and hashlib.sha256(data).hexdigest() == row['sha256'], path
assert git('rev-parse', 'HEAD') == contract['baseCommit'], 'Exact baseline HEAD is required.'
assert git('rev-parse', 'HEAD^{tree}') == contract['baseGitTree'], 'Baseline Git tree mismatch.'
assert not git('status', '--porcelain', '--untracked-files=no'), 'Tracked source must be clean.'
for row in contract['files']:
    path = repo / row['path']
    if row['before'] is None:
        assert not path.exists(), path
    else:
        verify(path, row['before'])
for row in contract['unchangedContracts'] + contract['baselineFixtures']:
    verify(repo / row['path'], row)
patch = root / 'TIMEOUT-CANDIDATE.patch'
assert hashlib.sha256(patch.read_bytes()).hexdigest() == contract['patchSha256']
subprocess.run(['git', '-C', str(repo), 'apply', '--check', str(patch)], check=True)
if args.apply:
    subprocess.run(['git', '-C', str(repo), 'apply', str(patch)], check=True)
    for row in contract['files']:
        verify(repo / row['path'], row)
print(json.dumps({'status': 'EXACT_SOURCE_DELTA_APPLIED' if args.apply else 'EXACT_SOURCE_DELTA_APPLIES',
                  'changedFiles': len(contract['files']), 'operationalRestore': False}))
