#!/usr/bin/python3
"""TEST_ONLY synthetic helper and DB binding, real exclusive owner protocol."""
from pathlib import Path
import hashlib,importlib.util,json,sys
sys.dont_write_bytecode=True
H=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('activation_fixture_renderer',H/'scripts/build-lifecycle-artifacts.py')
b=importlib.util.module_from_spec(spec);spec.loader.exec_module(b)
p=Path(sys.argv[1]);root=H.parents[2]/'evidence/lifecycle/lifecycle-cases'
assert p.name=='fixture.json' and p.parent.parent.parent==root
f=json.loads(p.read_text());stable=Path(f['stable']);sha=lambda x:hashlib.sha256(x).hexdigest()
keys=['id','goalId','version','commitSha','migrationVersion','schemaHash','dbSnapshotHash','rosterHash','sourcePlanHash','sourceConfigHash','adapterBundleHash','sourceTreeHash','runtimeTreeHash','oracleVersion','minimumStableCompanyCount','status']
row={k:'SYNTHETIC_'+k for k in keys};row['commitSha']='a'*40
binding={'schemaVersion':1,'deployment':{'kind':'LIVE_DEPLOYMENT','fixturePreloadSha256':None,'projectId':'yiopvxysxrtrnvqxwgbx','sourceId':'source-takeda-china-social','build':{'commitSha':row['commitSha']},'expectedRow':row},'remoteCommit':{'kind':'OFFICIAL_GITHUB_COMMIT_READ','commitSha':row['commitSha'],'testOnlySynthetic':True},'disabledEntryBytes':f['entryBytes']+1,'enabledEntryBytes':f['entryBytes']}
for k in ['sourceManifestSha256','canonicalDefaultSha256','builderSha256','deploymentSha256','cliSha256','disabledEntrySha256','enabledEntrySha256']:binding[k]='d'*64
binding['enabledEntrySha256']=f['entrySha256'];binding['bindingSha256']=sha(json.dumps(binding,sort_keys=True,separators=(',',':')).encode())
helper_source='''import json,os,pathlib,sys
BINDING=%r
ENTRY=%r
def main():
 lease=globals()['LIFECYCLE_LEASE'];lease.check();assert lease.mode=='EX'
 if sys.argv[1]=='qualify':
  print(json.dumps({'kind':'FIXED_ACTIVATION_QUALIFIED','bindingSha256':BINDING['bindingSha256'],'disabledSha256':BINDING['disabledEntrySha256'],'enabledSha256':BINDING['enabledEntrySha256'],'enabledBytes':BINDING['enabledEntryBytes']}))
 else:
  payload=json.load(sys.stdin)
  # Synthetic put writes the already pinned enabled bytes and fsyncs them.
  p=pathlib.Path(ENTRY);raw=p.read_bytes();p.chmod(0o600)
  with p.open('wb') as out:out.write(raw);out.flush();os.fsync(out.fileno())
  p.chmod(0o400)
  print(json.dumps({'kind':'FIXED_DEPLOYMENT_ACTIVATED','disabledSha256':BINDING['disabledEntrySha256'],'enabledSha256':BINDING['enabledEntrySha256'],'enabledBytes':BINDING['enabledEntryBytes'],'rawSha256':payload['rawSha256'],'checkedAt':payload['checkedAt'],'onlyActivationBooleanChanged':True}))
'''%(binding,f['entry'])
helper=stable/'synthetic-activation-helper.py';helper.write_text(helper_source);helper.chmod(0o600)
holder_binding={k:f[k] for k in ('modulePath','moduleSha256','domain')};holder_binding.update(helperPath=str(helper),helperSha256=sha(helper_source.encode()))
holder=stable/'exclusive-holder.py';raw=b.render_holder((H/'lifecycle/exclusive-holder.py.in').read_text(),holder_binding);holder.write_bytes(raw);holder.chmod(0o600)
wrapper_binding={'holderPath':str(holder),'holderSha256':sha(raw),'stableDirectory':str(stable),'registrationSql':'SYNTHETIC OFFLINE REGISTRATION ONLY','deploymentBinding':binding}
rows=next(x for x in (H/'functions/host-helper.js').read_text().splitlines() if x.startswith('function rows('))
wrapper=stable/'activate.js';wrapper.write_bytes(b.render_activation((H/'functions/lifecycle-activation.template.js').read_text(),(H/'functions/sha256.js').read_text(),rows,wrapper_binding));wrapper.chmod(0o600)
print(json.dumps({'wrapper':str(wrapper),'binding':binding,'holder':str(holder)}))
