import hashlib, json, os, pathlib, sys
B=pathlib.Path('/workspace/scratch/5e9614251709'); R=B/'takeda-original-recovery-20261017T0417Z'; D=pathlib.Path(__file__).parent
source,folder=sys.argv[1:]; row=next(r for r in json.loads((D/'sources.json').read_text())['rows'] if r['sourceId']==source)
assert row['route']=='PORTABLE'
# Reuse the current registered producer's existing binding; its original verifier rechecks actual code and runtime.
selector=json.loads((R/'hengrui/binding-selector.json').read_text())
binding=json.loads((B/'connector-host-bindings'/f"{selector['sha256']}.json").read_text())
assert binding['projectId']=='yiopvxysxrtrnvqxwgbx' and binding['route']=='PORTABLE'
binding.update(sourceId=source,sourceConfigSha256=row['sourceConfigSha256'],ownerId='dot-cloud-'+folder+'-social-pilot')
data=json.dumps(binding,separators=(',',':')).encode(); digest=hashlib.sha256(data).hexdigest(); target=B/'connector-host-bindings'/f'{digest}.json'
if target.exists(): assert target.read_bytes()==data
else:
 with os.fdopen(os.open(target,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o400),'wb') as f: f.write(data)
S=R/folder; S.mkdir(exist_ok=True); control=binding['control']
for name,value in {'binding-selector.json':{'sha256':digest},'control-base.json':control,'host-config.json':{'sourceId':source,'sourceConfigSha256':row['sourceConfigSha256']},'activation.json':{'status':'REGISTERED_VERIFIED','candidate':control['candidate'],'build':control['build']}}.items():
 (S/name).write_text(json.dumps(value))
print(json.dumps({'sourceId':source,'candidateId':control['candidate']['id'],'bindingSha256':digest}))
