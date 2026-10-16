"""Render the current canonical module for offline real-process regression tests."""
from pathlib import Path
import importlib.util,sys,types
sys.dont_write_bytecode=True
HOST=Path(__file__).resolve().parents[1]
EVIDENCE=HOST.parents[2]/'evidence/lifecycle'
CASES=EVIDENCE/'lifecycle-cases';CASES.mkdir(mode=0o700,parents=True,exist_ok=True)
spec=importlib.util.spec_from_file_location('test_lifecycle_renderer',HOST/'scripts/build-lifecycle-artifacts.py')
build=importlib.util.module_from_spec(spec);spec.loader.exec_module(build)
module=types.ModuleType('current_lifecycle_test_module');module.__file__=str(HOST/'lifecycle/lifecycle_lock.py');sys.modules[module.__name__]=module
exec(compile(build.render_offline_module(Path(module.__file__).read_text(),CASES),module.__file__,'exec'),module.__dict__)
for name in ('Domain','Hold','OwnedRoundJournal','OrderedLocks','check_complete_disabled','identity','provision_for_installer','require_mutation_idle'):globals()[name]=getattr(module,name)
