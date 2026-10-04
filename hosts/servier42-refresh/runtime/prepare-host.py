from pathlib import Path
import json,hashlib
base=Path('/workspace/scratch/5e9614251709/job-finder-runtime-restore-20261004T0834Z')
host=base/'hosts/servier42-refresh'; old=base/'hosts/servier'; template=base/'hosts/jnj42'
sha=lambda b:hashlib.sha256(b).hexdigest()
baseline={}; provenance={}
def copy(src,dest,transform=lambda s:s):
    raw=src.read_bytes();baseline[str(src)]=sha(raw);text=transform(raw.decode())
    (host/dest).write_text(text);provenance[dest]={'template':str(src),'templateSha256':sha(raw)}
cfg=json.loads((old/'host-config.json').read_text());cfg['root']=str(host)
(host/'host-config.json').write_text(json.dumps(cfg,indent=2)+'\n')
control=json.loads((old/'control-base.json').read_text());control.pop('expiresAt',None)
(host/'control-base.json').write_text(json.dumps(control,indent=2)+'\n')
oldcfg=json.loads((template/'host-config.json').read_text())
def transform(text):
    return text.replace(str(template),str(host)).replace('jnj42:','servier42:').replace(oldcfg['sourceId'],cfg['sourceId']).replace(oldcfg['sourceConfigSha256'],cfg['sourceConfigSha256'])
for name in ['host-helper-functions.js','host-stage-functions.js','host-files.mts','relay-files.mjs','archive-transfer.mjs']:
    copy(template/name,name,transform)
for name in ['load-host-state.js','continuous-relay-v3-durable-monitor.js']:
    copy(template/'runtime'/name,'runtime/'+name,transform)
for name in ['preflight-launch.mjs','runtime-check.mjs']:
    copy(template/'runtime/preflight'/name,'runtime/preflight/'+name)
copy(base/'host-runtime/compact-json-review.inc.py','runtime/compact-json-review.inc.py')
copy(base/'hosts/pfizer42/runtime/describe-inputs.mjs','runtime/describe-inputs.mjs')
copy(base/'hosts/pfizer42/runtime/load-pfizer42-runtime.js','runtime/load-servier42-runtime.js',lambda s:s.replace(str(base/'hosts/pfizer42'),str(host)).replace('pfizer42','servier42').replace('source-pfizer-china-social',cfg['sourceId']))
(host/'PREPARATION_BASELINE.json').write_text(json.dumps(baseline,indent=2)+'\n')
(host/'TEMPLATE_PROVENANCE.json').write_text(json.dumps(provenance,indent=2)+'\n')
