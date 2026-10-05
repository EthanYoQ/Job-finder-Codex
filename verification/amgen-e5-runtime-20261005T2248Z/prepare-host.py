import pathlib,json,hashlib,difflib
r=pathlib.Path('/workspace/scratch/5e9614251709/jb-workspace-recovery-20261005T2019Z');v=r/'verification/amgen-e5-runtime-20261005T2248Z';src=r/'hosts46/amgen';dest=r/'hosts-amgen-e5/amgen';repo=r/'amgen-two-chain-offline-20261005T2226Z'
assert not dest.exists();dest.mkdir(parents=True)
old=json.loads((src/'SPEC.json').read_text());control=json.loads((v/'registration-input.template.json').read_text());identity=json.loads((v/'identity-verification.json').read_text());sha=lambda b:hashlib.sha256(b).hexdigest()
replacements=[(str(src),str(dest)),(str(r/'producer42'),str(repo)),('dot-cloud-restored-fb0b8e3-20261005T2028Z',control['candidate']['id']),('fb0b8e3b708d4f57cae09b465fb1c9ceddf7ad8d',control['build']['commitSha']),('restored46:amgen:','amgen-e5:amgen:')]
files={}
for name in old['templateFiles']:
 original=(src/name).read_bytes();text=original.decode()
 for a,b in replacements:text=text.replace(a,b)
 target=dest/name;target.parent.mkdir(parents=True,exist_ok=True);target.write_text(text)
 originalPath=dest/'originals'/name;originalPath.parent.mkdir(parents=True,exist_ok=True);originalPath.write_bytes(original)
 diff=v/'host-diffs'/str(name.replace('/','__')+'.diff');diff.parent.mkdir(parents=True,exist_ok=True);diff.write_text(''.join(difflib.unified_diff(original.decode().splitlines(keepends=True),text.splitlines(keepends=True),fromfile=str(src/name),tofile=str(target))))
 files[name]={'origin':str(src/name),'originalPath':str(originalPath),'originalSha256':sha(original),'sha256':sha(text.encode()),'diffPath':str(diff),'allowedChangeOnly':'host/repo path, actual candidate/commit, isolated store namespace'}
def put(name,obj):
 (dest/name).write_text(json.dumps(obj,ensure_ascii=False,indent=2)+'\n')
cfg=json.loads((src/'host-config.json').read_text());cfg.update(root=str(dest),repo=str(repo));put('host-config.json',cfg);put('control-base.json',control)
(dest/'source-plan.json').write_bytes((v/'source-plan.json').read_bytes())
copyFields=['key','sourceId','sourceConfigSha256','route','heapMiB','starter','entrypoint','publicationMode','certificateSchema','sourceAdmissionPolicy','dataFreshnessMs','dataFreshnessBasis','sourceDueGateMs','bootstrapMaxAgeMs','controlDeadlineReserveMs','controlCompletionReserveMs','queueFile','queueHintNotLaunchAuthority','freshDbBootstrapAndActualObservationReadRequired','singlePublisherRequired','automaticPublication','inheritedLimitations']
spec={k:old[k] for k in copyFields};spec.update(schemaVersion=1,status='PREPARED_NOT_REGISTERED_NOT_LAUNCHED',root=str(dest),repo=str(repo),project=cfg['project'],prefix='amgen-e5:amgen:',startCodeKey='amgen-e5:amgen:restoredASourceStartCode',templateFiles=files,build=control['build'],candidate=control['candidate'],inertTemplateExpiry=None,proposedVersionBasis=identity['proposedVersionBasis'],preparedAt=identity['checkedAt'],sourceNetworkAccessed=False,databaseAccessed=False,registered=False,producerLaunched=False,producerModified=False,dependencyIdentityUnchanged=True,localBuildRun=True,repositoryTestsRun=False,requiresFreshActualObservationBootstrap=True,requiresSinglePublisher=True,archiveRetention='SEPARATE_AUTHORIZED_PARENT_STEP',historicalDatabaseIdentity={'artifactKind':'SCHEMA_ONLY_HISTORICAL_NOT_NEW_FULL_BACKUP','identity':json.loads((v/'history.json').read_text())['databaseIdentity']})
put('SPEC.json',spec)
(v/'host-transformation.json').write_text(json.dumps({'source':str(src),'destination':str(dest),'replacements':replacements,'files':files,'status':'LOCAL_ONLY_NOT_REGISTERED_NOT_LAUNCHED'},indent=2)+'\n')
print(json.dumps({'root':str(dest),'files':len(files),'candidate':control['candidate'],'status':spec['status']}))
