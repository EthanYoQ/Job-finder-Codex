import sys
sys.dont_write_bytecode=True
"""Local package tests; clone only exported source and never touch a live host."""
from pathlib import Path
import argparse, copy, importlib.util, json, shutil, subprocess, tempfile, hashlib

P=Path(__file__).resolve().parent
parser=argparse.ArgumentParser();parser.add_argument('--work-dir',type=Path,required=True);args=parser.parse_args()
work=args.work_dir.resolve();work.mkdir(parents=True,exist_ok=False)
spec=importlib.util.spec_from_file_location('static_schema',P/'static_schema.py');schema=importlib.util.module_from_spec(spec);spec.loader.exec_module(schema)
data=json.loads((P/'static-source-routes.json').read_text());schema.validate_inputs(data)
manifest=json.loads((P/'seed-manifest.json').read_text());results=[]
def passed(name):results.append({'name':name,'passed':True})
for i,row in enumerate(data['sources']):
    for key in list(row):
        x=copy.deepcopy(data);del x['sources'][i][key]
        try:schema.validate_inputs(x);raise RuntimeError('MISSING_FIELD_ACCEPTED')
        except (ValueError,AssertionError):passed(row['sourceKey']+' rejects missing '+key)
    for key in list(row['source']):
        x=copy.deepcopy(data);del x['sources'][i]['source'][key]
        try:schema.validate_inputs(x);raise RuntimeError('MISSING_SOURCE_CONFIG_ACCEPTED')
        except (ValueError,AssertionError):passed(row['sourceKey']+' rejects missing source.'+key)
    for key in list(row['currentSourcePlan']):
        x=copy.deepcopy(data);del x['sources'][i]['currentSourcePlan'][key]
        try:schema.validate_inputs(x);raise RuntimeError('MISSING_PLAN_CONFIG_ACCEPTED')
        except (ValueError,AssertionError):passed(row['sourceKey']+' rejects missing plan.'+key)
    x=copy.deepcopy(data);x['sources'][i]['checkedAt']='SYNTHETIC_METADATA'
    try:schema.validate_inputs(x);raise RuntimeError('HISTORY_ACCEPTED')
    except (ValueError,AssertionError):passed(row['sourceKey']+' rejects extra historical metadata')

for name in ['changed-seed','missing-seed','changed-validator','changed-static-input','changed-manifest']:
    case=work/name;shutil.copytree(P,case/'package',ignore=shutil.ignore_patterns('__pycache__'))
    package=case/'package';output=case/'output'
    if name=='changed-seed':
        seed=package/manifest['files'][0]['seedPath'];seed.write_bytes(seed.read_bytes()+b'\nSYNTHETIC_CHANGE\n')
    elif name=='missing-seed':(package/manifest['files'][0]['seedPath']).unlink()
    elif name=='changed-validator':(package/'static_schema.py').write_text("raise RuntimeError('EXECUTED_UNPINNED_VALIDATOR')\n")
    elif name=='changed-static-input':
        x=copy.deepcopy(data);x['sources'][0]['source']['officialEntryUrl']='https://example.invalid/changed';(package/'static-source-routes.json').write_text(json.dumps(x))
    else:
        x=copy.deepcopy(manifest);x['files'][0]['path']='../outside';(package/'seed-manifest.json').write_text(json.dumps(x))
    run=subprocess.run(['python3',str(package/'restore-unbound-hosts.py'),'--output-root',str(output)],capture_output=True,text=True)
    assert run.returncode!=0 and not output.exists(),name
    if name=='changed-validator':assert 'EXECUTED_UNPINNED_VALIDATOR' not in run.stderr
    passed(name+' rejected before output')

for name,path in [('existing-output',work),('production-host',Path(data['runtimeRoot'])/'hosts'/'not-written'),('normalized-production-path',work/'..'/'..'/'..'/'hosts'/'not-written')]:
    # The first two cases are independent of the chosen test workspace topology.
    if name=='normalized-production-path':path=Path(data['runtimeRoot'])/'verification'/'..'/'hosts'/'not-written'
    run=subprocess.run(['python3',str(P/'restore-unbound-hosts.py'),'--output-root',str(path)],capture_output=True,text=True)
    assert run.returncode!=0 and 'RESTORE_NEW_ISOLATED_OUTPUT_REQUIRED' in run.stderr,name;passed(name+' rejected')
link=work/'linked-output';link.symlink_to(work/'real-output',target_is_directory=True)
run=subprocess.run(['python3',str(P/'restore-unbound-hosts.py'),'--output-root',str(link/'new')],capture_output=True,text=True)
assert run.returncode!=0 and 'RESTORE_SYMLINK' in run.stderr;passed('symlink ancestry rejected')

target=work/'valid-output'
run=subprocess.run(['python3',str(P/'restore-unbound-hosts.py'),'--output-root',str(target)],capture_output=True,text=True)
assert run.returncode==0,run.stdout+run.stderr
for row in manifest['files']:
    result=(target/row['path']).read_bytes();assert result==(P/row['seedPath']).read_bytes()
    assert hashlib.sha256(result).hexdigest()==row['sha256']
assert len([p for p in target.rglob('*') if p.is_file()])==len(manifest['files'])
passed('fixed producer static plans and exact isolated restore')
report={'classification':'LOCAL_STATIC_EXPORT_TESTS','passed':len(results),'regeneratedFiles':len(manifest['files']),'allOutputBytesEqualSeeds':True,'productionHostReadOrWritten':False,'tests':results}
(work/'RESULT.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report))
