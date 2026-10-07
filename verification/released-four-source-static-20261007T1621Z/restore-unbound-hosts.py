import sys
sys.dont_write_bytecode=True
"""Verify and restore exact static source bytes into a new isolated directory.

No production host, current state, historical reference or actual binding is read.
This is source restoration, not activation and not a new source transformation.
"""
from pathlib import Path
import argparse, hashlib, json, subprocess, importlib.util

P=Path(__file__).resolve().parent
PINS={'static-source-routes.json': 'b28dab245fef258bf73f44f816a459f304f148cf3c15b7221953b798e78edc3b', 'seed-manifest.json': '70dae89e19b268e6a963fac402ef70954605b6611a03e9d53ef3ce42ce7f69da', 'static_schema.py': '1e694ee049f82bb1aabad1bba13fb747ac83632122c33c84980e89a3a59a07d4', 'verify-static-plans.mts': '47fe7f079bae5b93deffbc47ca7f06b91c3264fd770ac84df621e6618348379e', 'offline.cjs': 'eb3fb9fc5fbb04d68f5735830343750d884f1d0a093ef4aa1668891ed4d402b7'}
sha=lambda b:hashlib.sha256(b).hexdigest()

def pinned(relative):
    path=P/relative
    if path.is_symlink() or not path.is_file(): raise ValueError('RESTORE_PINNED_FILE_REQUIRED:'+relative)
    value=path.read_bytes()
    if sha(value)!=PINS[relative]: raise ValueError('RESTORE_INPUT_PIN:'+relative)
    return value

def safe_relative(value):
    path=Path(value)
    if not isinstance(value,str) or path.is_absolute() or '..' in path.parts or str(path)!=value:
        raise ValueError('RESTORE_RELATIVE_PATH')
    return path

def no_links(path):
    for part in [path,*path.parents]:
        if part.is_symlink(): raise ValueError('RESTORE_SYMLINK')

def prepare(output):
    # Validate every input and dependency before writing the output directory.
    for relative in PINS:pinned(relative)
    spec=importlib.util.spec_from_file_location('pinned_static_schema',P/'static_schema.py');module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    validate_inputs,exact,no_history=module.validate_inputs,module.exact,module.no_history
    data=validate_inputs(json.loads(pinned('static-source-routes.json')))
    manifest=json.loads(pinned('seed-manifest.json'))
    exact(manifest,{'schemaVersion','artifactKind','files'},'seed-manifest')
    assert manifest['schemaVersion']==1 and manifest['artifactKind']=='EXACT_UNBOUND_SOURCE_SEEDS','RESTORE_SEED_KIND'
    runtime=Path(data['runtimeRoot']);original=Path(output).absolute();no_links(original);target=original.resolve(strict=False)
    no_links(target)
    if target.exists() or target==runtime or target==P or P in target.parents or any(target==runtime/name or runtime/name in target.parents for name in ['hosts','producer','owner-adaptations','runtime']):
        raise ValueError('RESTORE_NEW_ISOLATED_OUTPUT_REQUIRED')
    payload={}
    for row in manifest['files']:
        exact(row,{'path','seedPath','sha256','bytes','mode'},'seed')
        rel=safe_relative(row['path']);seed=safe_relative(row['seedPath'])
        assert seed==Path('seed')/rel and row['mode']=='100644' and str(rel) not in payload,'RESTORE_SEED_PATH'
        assert rel.parts[0] in ['hosts','owner-adaptations'],'RESTORE_TARGET_SCOPE'
        path=P/seed;no_links(path)
        b=path.read_bytes()
        assert len(b)==row['bytes'] and sha(b)==row['sha256'],'RESTORE_SEED_BYTE_PIN:'+str(rel)
        assert rel.name not in ['activation.json','control-base.json','context-read.sql','owner-binding-input.json'],'RESTORE_OPERATIONAL_FILE_FORBIDDEN'
        payload[str(rel)]=b
    for row in data['sources']:
        base='hosts/'+row['sourceKey']+'/host/'
        config=json.loads(payload[base+'host-config.json'])
        assert config==json.loads(payload[base+'host-config.template.json']),'RESTORE_CONFIG_TEMPLATES'
        assert config['sourceId']==row['sourceId'] and config['sourceConfigSha256']==row['sourceConfigSha256'],'RESTORE_SOURCE_BINDING'
        assert json.loads(payload[base+'source-config-reference.json'])==row,'RESTORE_STATIC_REFERENCE'
        for name in ['control-base.template.json','owner-binding-input.template.json']:
            item=json.loads(payload[base+name]);assert item['candidate'] is None and item['databaseIdentity'] is None,'RESTORE_UNBOUND_TEMPLATE'
        proof=json.loads(payload[base+'context-template-proof.json']);no_history(proof)
        assert proof['originalSourcePlan']==row['currentSourcePlan'] and proof['candidate'] is None and proof['databaseIdentity'] is None,'RESTORE_STATIC_CONTEXT_PROOF'
        assert sha(payload[base+'context-read.sql.template'])==proof['contextSha256'],'RESTORE_CONTEXT_BYTES'
        assert b'const expectedCandidate=null;' in payload[base+'runtime/load-host-state.js'],'RESTORE_UNBOUND_LOADER'
        assert b'const expectedDatabaseIdentity=null;' in payload[base+'runtime/load-host-state.js'],'RESTORE_UNBOUND_DATABASE'
        starter='hosts/'+row['sourceKey']+'/supervision/start-monitor-'+row['sourceKey']+'51-combined.js'
        assert payload[starter].startswith(b'const expectedCandidate=null;'),'RESTORE_UNBOUND_STARTER'
    repo=runtime/'producer';node=runtime/'runtime/node-v22.23.3-linux-x64/bin/node'
    subprocess.run([str(node),'--require',str(P/'offline.cjs'),'--import',str(repo/'node_modules/tsx/dist/loader.mjs'),str(P/'verify-static-plans.mts')],cwd=repo,check=True)
    target.mkdir(mode=0o700,parents=False)
    for rel,b in payload.items():
        path=target/rel;path.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
        with path.open('xb') as f:f.write(b)
        assert path.read_bytes()==b,'RESTORE_OUTPUT_BYTES'
    print(json.dumps({'sourceOnlyRestore':True,'files':len(payload),'output':str(target),'activated':False}))

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--output-root',required=True,type=Path)
    prepare(parser.parse_args().output_root)
