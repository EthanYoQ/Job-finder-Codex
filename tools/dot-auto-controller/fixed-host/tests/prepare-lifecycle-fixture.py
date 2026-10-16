#!/usr/bin/python3
"""Create one owned synthetic lifecycle case. Input is JS bytes, never authority."""
from pathlib import Path
import importlib.util,json,os,sys,tempfile,types
H=Path(__file__).resolve().parents[1]
sys.dont_write_bytecode=True
S=H/'scripts/build-lifecycle-artifacts.py'
spec=importlib.util.spec_from_file_location('lifecycle_fixture_renderer',S)
build=importlib.util.module_from_spec(spec);spec.loader.exec_module(build)

def main():
    root=H.parents[2]/'evidence/lifecycle/lifecycle-cases';root.mkdir(mode=0o700,parents=True,exist_ok=True)
    case=Path(tempfile.mkdtemp(prefix='case-',dir=root));stable=case/'stable';stable.mkdir(mode=0o700)
    module_raw=build.render_offline_module((H/'lifecycle/lifecycle_lock.py').read_text(),root)
    module_file=stable/'lifecycle_lock.py';module_file.write_bytes(module_raw);module_file.chmod(0o600)
    module=types.ModuleType('fixture_lifecycle');module.__file__=str(module_file);sys.modules[module.__name__]=module
    exec(compile(module_raw,str(module_file),'exec'),module.__dict__)
    domain=module.provision_for_installer(case,'installed-disabled')
    with module.exclusive_transaction(domain) as lease:
        domain.target.mkdir(mode=0o700);(domain.target/'candidate').mkdir(mode=0o700)
        raw=sys.stdin.buffer.read(1024*1024);raw.decode('ascii')
        entry=domain.target/'candidate/functions-entry.enabled.js';entry.write_bytes(raw);entry.chmod(0o400)
        lease.finish_mutation_from_owned_transaction()
    binding={'modulePath':str(module_file),'moduleSha256':build.sha(module_raw),
             'domain':json.loads(domain.to_json()),'entrySha256':build.sha(raw),'entryBytes':len(raw)}
    holder=stable/'holder.py';holder_raw=build.render_holder((H/'lifecycle/holder.py.in').read_text(),binding)
    holder.write_bytes(holder_raw);holder.chmod(0o600)
    loader_binding={'holderPath':str(holder),'holderSha256':build.sha(holder_raw),
                    'stableDirectory':str(stable),'entrySha256':build.sha(raw),'entryBytes':len(raw)}
    loader=stable/'loader.js';loader.write_bytes(build.render_loader((H/'functions/lifecycle-loader.template.js').read_text(),(H/'functions/sha256.js').read_text(),loader_binding));loader.chmod(0o600)
    data={**binding,'case':str(case),'stable':str(stable),'loader':str(loader),
          'holder':str(holder),'entry':str(entry),'active':str(case/domain.active_name),'mutation':str(case/domain.mutation_name)}
    (stable/'fixture.json').write_text(json.dumps(data));(stable/'fixture.json').chmod(0o600)
    print(json.dumps(data))
if __name__=='__main__':main()
