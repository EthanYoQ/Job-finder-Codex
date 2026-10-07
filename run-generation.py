"""New fixture generation only. Empty environment, denied network, ephemeral PGlite."""
from pathlib import Path
import subprocess,json,hashlib,sys,re
S=Path(__file__).resolve().parent
(S/'runtime-evidence').mkdir(exist_ok=True,mode=0o700)
R=Path('/workspace/scratch/5e9614251709/jb-incremental-proxy-runtime-20261007T0057Z')
name=sys.argv[1];assert re.fullmatch(r'[a-z][a-z0-9-]*',name)
keys=sys.argv[2:] or ['astra','amgen'];assert all(x in ['astra','amgen'] for x in keys)
run=S/name;run.mkdir(mode=0o700)
for folder in ['payload','work','tmp']:(run/folder).mkdir(mode=0o700)
node=R/'runtime/node-v22.23.3-linux-x64/bin/node'
base_env={'PATH':str(node.parent)+':/usr/bin:/bin','TZ':'UTC','TMPDIR':str(run/'tmp'),'FIXTURE_WORK_ROOT':str(run/'work'),'FIXTURE_PAYLOAD_ROOT':str(run/'payload'),'PGLITE_MODULE':'/workspace/scratch/5e9614251709/jb-workspace-recovery-20261006T1136Z/implementation/incremental-sync-20261006T1717Z/test-tools/pglite-0.3.14/dist/index.js','NODE_OPTIONS':'--require '+str(S/'src/network-deny.cjs'),'TSX_DISABLE_CACHE':'1','NODE_DISABLE_COMPILE_CACHE':'1'}
for key in keys:
    source='source-astrazeneca-social' if key=='astra' else 'source-amgen-china-social'
    env=dict(base_env,JOBFINDER_CLOUD_SOURCE_ID=source)
    with (S/'runtime-evidence'/(name+'-'+key+'.log')).open('w') as out:
        result=subprocess.run([str(node),str(R/'producer/node_modules/vitest/vitest.mjs'),'run','generate.test.ts','--config','vitest.config.mjs','--reporter=verbose'],cwd=S/'src',env=env,stdout=out,stderr=subprocess.STDOUT)
    if result.returncode:raise SystemExit('FAILED '+key+'; inspect runtime-evidence/'+name+'-'+key+'.log')
manifest=[]
for file in sorted((run/'payload').rglob('*')):
    if file.is_file():
        assert not file.is_symlink();raw=file.read_bytes();manifest.append({'path':file.relative_to(run/'payload').as_posix(),'bytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest()})
(run/'payload-manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
print(json.dumps({'run':name,'fixtureFiles':len(manifest),'payloadManifestSha256':hashlib.sha256((run/'payload-manifest.json').read_bytes()).hexdigest()}))
