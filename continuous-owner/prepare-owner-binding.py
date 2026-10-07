#!/usr/bin/env python3
"""Verify parent input/readback and render private owner code. No activation, SQL or network."""
from pathlib import Path
import hashlib,json,re,shutil,subprocess,sys,os
base=Path(__file__).resolve().parent
root=base.parent
if len(sys.argv)!=4:raise ValueError('Usage: prepare-owner-binding.py <owner-input> <registration-readback> <new-output>')
op,rp,out=map(lambda x:Path(x).resolve(),sys.argv[1:]);owner=json.loads(op.read_bytes());readback=json.loads(rp.read_bytes());row=readback.get('candidateRow',readback.get('row'));build=json.loads((root/'NEW_LOCAL_BUILD_IDENTITY.json').read_bytes());projection=json.loads((root/'REGISTRATION_EXPECTED_PROJECTION.json').read_bytes())
assert set(owner)=={'schemaVersion','build','candidate','databaseIdentity','minimumCandidateVersion','sourceId','sourceConfigSha256'}
assert owner['schemaVersion']==1 and owner['build']==build and owner['sourceId']=='source-kelun-social' and owner['sourceConfigSha256']=='9fe0cb0d7c308567f6010aa6181f36c595b97df739ecd528cab97070f47572cb'
c=owner['candidate'];db=owner['databaseIdentity'];assert isinstance(c,dict) and set(c)=={'id','goalId','version'} and re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._-]{0,99}',c['id']) and c['goalId']=='jobfinder-portable-required-40' and type(c['version']) is int and c['version']>=owner['minimumCandidateVersion']==52
assert isinstance(db,dict) and set(db)=={'migrationVersion','schemaHash','dbSnapshotHash'} and db['migrationVersion']=='20261006172300_job_projection_delta_contract' and all(re.fullmatch(r'[a-f0-9]{64}',db[k]) for k in ['schemaHash','dbSnapshotHash'])
expected={**c,**db,'commitSha':build['commitSha'],'sourceTreeHash':build['sourceTreeSha256'],'runtimeTreeHash':build['runtimeTreeSha256'],'rosterHash':projection['rosterSha256'],'sourcePlanHash':projection['sourcePlanSha256'],'sourceConfigHash':projection['sourceConfigSha256'],'adapterBundleHash':projection['adapterBundleSha256'],'minimumStableCompanyCount':41,'oracleVersion':'staged-official-source-v1','status':'BUILDING'}
assert isinstance(row,dict) and all(row.get(k)==v for k,v in expected.items()),'REGISTRATION_READBACK_MISMATCH'
assert not out.exists() and out!=base and not str(out).startswith(str(root/'producer')+'/')
source=(base/'publish-and-monitor-owner.unbound.template.js').read_text();marker='const expectedCandidate = null; // OWNER_CANDIDATE_BINDING';assert source.count(marker)==1
source=source.replace(marker,'const expectedCandidate = '+json.dumps(c,separators=(',',':'))+'; // OWNER_CANDIDATE_BINDING')
manifest=json.loads((base/'baseline-manifest.unbound.template.json').read_bytes());assert manifest['expectedCandidate'] is None and manifest['build']==build
sha=lambda b:hashlib.sha256(b).hexdigest()
for p,m in manifest['files'].items():assert sha(Path(p).read_bytes())==m['sha256']
manifest['expectedCandidate']=c;manifest['actualCandidatePersistedInManifest']=True;manifest['candidateAuthority']={'ownerInputSha256':sha(op.read_bytes()),'normalizedReadbackSha256':sha(rp.read_bytes()),'checkedAt':readback.get('checkedAt'),'classification':'OWNER_VERIFIED_ACTUAL_BINDING_PRIVATE'}
out.mkdir(mode=0o700);(out/'publish-and-monitor-owner.js').write_text(source);(out/'baseline-manifest.json').write_text(json.dumps(manifest,indent=2)+'\n');shutil.copyfile(base/'build-fragments.py',out/'build-fragments.py')
subprocess.run(['python3',str(out/'build-fragments.py')],check=True,env={**os.environ,'OWNER_FINAL_ROOT':str(base)})
files=['publish-and-monitor-owner.js','baseline-manifest.json','preload-owner.exec.js','publish-reviewed-and-monitor.exec.js']
result={'classification':'PRIVATE_OWNER_PREPARED_NOT_ACTIVATED','targetRoot':str(base),'output':str(out),'build':build,'candidate':c,'databaseIdentity':db,'files':[{'path':f,'bytes':(out/f).stat().st_size,'sha256':sha((out/f).read_bytes())} for f in files],'registrationPerformed':False,'sqlExecuted':False,'activated':False}
(out/'PREPARED-OWNER-MANIFEST.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result))
