#!/usr/bin/python3
"""Small TEST_ONLY lifecycle fixtures. Evidence is outside the candidate tree.
No runtime/dependency copy, deployment activation, DB or network operation.
All completed/unknown cases are intentionally retained, never repaired/deleted.
"""
import hashlib,json,os,sys,tempfile,types
from pathlib import Path
sys.dont_write_bytecode=True
EVIDENCE=Path('/workspace/scratch/5e9614251709/four-source-sequence-evidence-20261016T0812Z')
CASES=EVIDENCE/'small-tests/lifecycle-cases'
def require(ok,code):
    if not ok:raise RuntimeError(code)
def sha(raw):return hashlib.sha256(raw).hexdigest()
def put(path,raw,mode=0o600):
    fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,mode)
    try:
        with os.fdopen(os.dup(fd),'wb') as out:out.write(raw);out.flush();os.fsync(out.fileno())
    finally:os.close(fd)
def load(raw,path,name):
    module=types.ModuleType(name);module.__file__=str(path);sys.modules[name]=module
    exec(compile(raw,str(path),'exec'),module.__dict__);return module
def prepare():
    request=json.load(sys.stdin);entry=request['entry'].encode('ascii');sources=request['sources']
    require(set(sources)=={'lock','holder','loader','digest'},'FIXTURE_SOURCES')
    require(0<len(entry)<32768,'SMALL_SYNTHETIC_ENTRY_ONLY')
    CASES.mkdir(mode=0o700,parents=True,exist_ok=True)
    case=Path(tempfile.mkdtemp(prefix='case-',dir=CASES));stable=case/'stable';stable.mkdir(mode=0o700)
    lock=sources['lock'];require(lock.count('__FIXED_LIFECYCLE_SCOPE__')==1,'LOCK_SCOPE_TOKEN')
    lock=lock.replace('__FIXED_LIFECYCLE_SCOPE__',repr({'kind':'TEST_ONLY','casesRoot':str(CASES)})).encode()
    module_file=stable/'lifecycle_lock.py';put(module_file,lock)
    module=load(lock,module_file,'sequence_small_fixture');domain=module.provision_for_installer(case,'synthetic-four-source')
    with module.exclusive_transaction(domain) as lease:
        domain.target.mkdir(mode=0o700);(domain.target/'candidate').mkdir(mode=0o700)
        entry_file=domain.target/'candidate/functions-entry.enabled.js';put(entry_file,entry,0o400)
        lease.finish_mutation_from_owned_transaction()
    binding={'modulePath':str(module_file),'moduleSha256':sha(lock),'domain':json.loads(domain.to_json()),'entrySha256':sha(entry),'entryBytes':len(entry)}
    holder=sources['holder'];require(holder.count('__FIXED_LIFECYCLE_BINDING__')==1,'HOLDER_TOKEN')
    holder=holder.replace('__FIXED_LIFECYCLE_BINDING__',repr(binding)).encode();holder_file=stable/'holder.py';put(holder_file,holder)
    lb={'holderPath':str(holder_file),'holderSha256':sha(holder),'stableDirectory':str(stable),'entrySha256':sha(entry),'entryBytes':len(entry)}
    loader=sources['loader'];require(loader.count('__FIXED_LIFECYCLE_BINDING__')==1 and loader.count('__FIXED_SHA256_SOURCE__')==1,'LOADER_TOKEN')
    loader=loader.replace('__FIXED_LIFECYCLE_BINDING__',json.dumps(lb,separators=(',',':'))).replace('__FIXED_SHA256_SOURCE__',json.dumps(sources['digest'])).encode();loader_file=stable/'loader.js';put(loader_file,loader)
    data={**binding,'case':str(case),'stable':str(stable),'holder':str(holder_file),'loader':str(loader_file),'entry':str(entry_file),'active':str(case/domain.active_name),'sourceSha256':{k:sha(v.encode()) for k,v in sources.items()},'syntheticEntry':True}
    put(stable/'fixture.json',(json.dumps(data,indent=2)+'\n').encode());print(json.dumps(data))
def writer():
    fixture=Path(sys.argv[2]);require(fixture.name=='fixture.json' and fixture.parent.parent.parent==CASES,'FIXTURE_SCOPE')
    data=json.loads(fixture.read_text());p=Path(data['modulePath']);raw=p.read_bytes();require(sha(raw)==data['moduleSha256'],'MODULE_PIN')
    module=load(raw,p,'sequence_small_writer');domain=module.Domain.from_json(json.dumps(data['domain']))
    try:
        with module.exclusive_transaction(domain) as lease:
            # Exercise actual EX ownership and original mutation journal finish.
            lease.finish_mutation_from_owned_transaction()
        print(json.dumps({'status':'IDLE','productionAuthority':False}));return 0
    except (RuntimeError,OSError) as error:
        print(json.dumps({'status':'HOLD','reason':str(error),'productionAuthority':False}));return 78
if __name__=='__main__':
    require(sys.argv[1] in ('prepare','writer'),'FIXTURE_OPERATION')
    if sys.argv[1]=='prepare':require(len(sys.argv)==2,'FIXTURE_ARGS');prepare()
    else:require(len(sys.argv)==3,'FIXTURE_ARGS');sys.exit(writer())
