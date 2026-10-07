from pathlib import Path
import importlib.util,json,hashlib
n=Path(__file__).resolve().parent.parent
p=n/'hosts/gilead/verification/refresh-fixed-manifests.py'
spec=importlib.util.spec_from_file_location('recovery_recipe',p);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
source=(n/'hosts/gilead/host/runtime/complete-reviewed-source-readback.js').read_text()
assert hashlib.sha256(source.encode()).hexdigest()=='3eb561c5c3dc1aa4a8897d83ac9bd857830bee33e1a39702b173e63934793527'
original_root=n.parents[1]
relocated=str(n/'synthetic-recovery-root')
unsafe=source.replace(str(original_root),relocated)
try:m.require_unique_publisher_state_path(unsafe)
except ValueError:pass
else:raise AssertionError('Whole-root replacement must not silently move the global state')
fixed=m.rebase_completion_source(source,original_root,relocated)
assert m.require_unique_publisher_state_path(fixed)==str(original_root/'PUBLISHER-ACTIVE-STATE.json')
assert fixed.count('PUBLISHER-ACTIVE-STATE.json')==1
for bad in [unsafe,source+'\nconst extraState="another/PUBLISHER-ACTIVE-STATE.json";']:
 try:m.rebase_completion_source(bad,original_root,relocated)
 except ValueError:pass
 else:raise AssertionError('Invalid or second state must be rejected')
print(json.dumps({'classification':'PURE_RECOVERY_RECIPE_TEST','passed':4,'completeSha256':hashlib.sha256(source.encode()).hexdigest(),'actualStateRead':False,'stateCreated':False}))
