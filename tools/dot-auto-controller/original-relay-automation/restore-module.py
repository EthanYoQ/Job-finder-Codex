"""Restore this module beside an existing original project; --root can be an isolated read-only test root."""
import argparse,pathlib
p=argparse.ArgumentParser();p.add_argument('--root',required=True);a=p.parse_args()
source=pathlib.Path(__file__).resolve().parent;root=pathlib.Path(a.root).resolve();old='/workspace/scratch/5e9614251709'
d=root/'original-relay-automation-20261017T0609Z';r=root/'takeda-original-recovery-20261017T0417Z'
for f in source.rglob('*'):
 if not f.is_file() or f.name=='task-prompt-transcribed.txt':continue
 rel=f.relative_to(source);target=(r/pathlib.Path(*rel.parts[1:])) if rel.parts[0]=='support' else d/rel
 target.parent.mkdir(parents=True,exist_ok=True);target.write_text(f.read_text().replace(old,str(root)))
print(d/'run-original-functions.js')
