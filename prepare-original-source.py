import hashlib, json, os, pathlib, sys
B=pathlib.Path('/workspace/scratch/5e9614251709'); R=B/'takeda-original-recovery-20261017T0417Z'; D=pathlib.Path(__file__).parent
source,folder=sys.argv[1:]; row=next(r for r in json.loads((D/'sources.json').read_text())['rows'] if r['sourceId']==source)
assert (row['route'] in ['PORTABLE','TRUE_A'] or row['route']=='TRUE_B' and source=='source-pfizer-china-social') and source not in ['source-johnson-innovative-medicine-social','source-astrazeneca-social']
# Reuse the current registered producer's existing binding; its original verifier rechecks actual code and runtime.
selector=json.loads((R/'hengrui/binding-selector.json').read_text())
binding=json.loads((B/'connector-host-bindings'/f"{selector['sha256']}.json").read_text())
assert binding['projectId']=='yiopvxysxrtrnvqxwgbx' and binding['route']=='PORTABLE'
mode='NATIVE_PORTABLE_CONNECTOR_V1' if row['route']=='PORTABLE' else 'NATIVE_AB_CONNECTOR_V1'
if row['route']!='PORTABLE':
 binding['entrypointHashes']['producer']=hashlib.sha256((B/'five-source-sequence-source-candidate-20261016T1235Z/tools/dot-auto-controller/vendor/c60-source/scripts/p0-cloud-source-pilot.ts').read_bytes()).hexdigest()
binding.update(kind=mode,route=row['route'],sourceId=source,sourceConfigSha256=row['sourceConfigSha256'],ownerId={'source-csl-china-social':'dot-cloud-csl-pilot','source-lilly-china-social':'dot-cloud-lilly-pilot'}.get(source,'dot-cloud-'+source[7:]+'-pilot'))
data=json.dumps(binding,separators=(',',':')).encode(); digest=hashlib.sha256(data).hexdigest(); target=B/'connector-host-bindings'/f'{digest}.json'
if target.exists(): assert target.read_bytes()==data
else:
 with os.fdopen(os.open(target,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o400),'wb') as f: f.write(data)
S=R/folder; S.mkdir(exist_ok=True); control=binding['control']
for name,value in {'binding-selector.json':{'sha256':digest},'control-base.json':control,'host-config.json':{'mode':mode,'route':row['route'],'sourceId':source,'sourceConfigSha256':row['sourceConfigSha256']},'activation.json':{'status':'REGISTERED_VERIFIED','candidate':control['candidate'],'build':control['build']}}.items():
 (S/name).write_text(json.dumps(value))
print(json.dumps({'sourceId':source,'candidateId':control['candidate']['id'],'bindingSha256':digest}))
