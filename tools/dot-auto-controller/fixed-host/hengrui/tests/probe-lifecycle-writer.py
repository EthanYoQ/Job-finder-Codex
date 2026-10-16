#!/usr/bin/python3
"""Offline EX transaction probe. Reads/writes only the owning fixture case."""
from pathlib import Path
import json,os,sys,types
H=Path(__file__).resolve().parents[2]
path=Path(sys.argv[1]);root=Path(os.environ['HENGRUI_PROFILE_TEST_EVIDENCE']).resolve()/'lifecycle-cases';assert not root.is_relative_to(H.parents[2])
if path.parent.parent.parent!=root or path.name!='fixture.json':raise RuntimeError('OFFLINE_SCOPE')
data=json.loads(path.read_text());source=Path(data['modulePath']);m=types.ModuleType('writer_probe');m.__file__=str(source);sys.modules[m.__name__]=m
exec(compile(source.read_bytes(),str(source),'exec'),m.__dict__)
domain=m.Domain.from_json(json.dumps(data['domain']))
try:
    with m.exclusive_transaction(domain) as lease:
        # Real filesystem mutation occurs within EX, never after a permit return.
        marker=domain.parent/'writer-probe-completed'
        marker.write_text('OFFLINE EX TRANSACTION ONLY\n')
        lease.finish_mutation_from_owned_transaction()
    print(json.dumps({'status':'IDLE','activation':False}));sys.exit(0)
except (RuntimeError,OSError) as e:
    print(json.dumps({'status':'HOLD','reason':str(e),'activation':False}));sys.exit(78)
