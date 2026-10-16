"""TEST_ONLY: real new source/native identity, synthetic DB/candidate input.
Only CLI fixed-root rendering is mapped to a new owned offline target.
"""
import hashlib,json,pathlib,subprocess,types,sys
sha=lambda b:hashlib.sha256(b).hexdigest()
def derive(pins,target):
 target=pathlib.Path(target).absolute()
 assert target.name=='installed-disabled' and target.parent.name.startswith('case-') and target.parent.parent.name=='lifecycle-cases'
 assert 'job-finder-fixed-live-controller-v1' not in target.parts
 vendor=pathlib.Path(pins['builtRoot']);package=vendor.parents[1]
 manifest=json.loads(pathlib.Path(pins['sourceManifestPath']).read_bytes());assert sha(pathlib.Path(pins['sourceManifestPath']).read_bytes())==pins['sourceManifestSha256'];entries={e['path']:e for e in manifest['entries']}
 path=package/'fixed-host/sequence/build-functions-entry.py';raw=path.read_bytes();assert sha(raw)==entries['tools/dot-auto-controller/fixed-host/sequence/build-functions-entry.py']['sha256']
 builder=types.ModuleType('test_original_bound_builder');builder.__file__=str(path);sys.modules[builder.__name__]=builder;exec(compile(raw,str(path),'exec'),builder.__dict__)
 inputs=builder.load_source_inputs();assert builder.render_entry(inputs)==(package/'fixed-host/sequence/functions-entry.js').read_bytes()
 # Verify the original generated default before mapping only the test root.
 builder.LIVE_ROOT=str(target)
 code="import {register} from "+json.dumps((vendor/'node_modules/tsx/dist/esm/api/index.mjs').as_uri())+";register({tsconfig:"+json.dumps(str(vendor/'tsconfig.json'))+"});const m=await import("+json.dumps((vendor/'src/crawler/stagedScheduleAuthority.ts').as_uri())+");const e=m.deriveCurrentStagedScheduleExpectation("+json.dumps(pins['buildIdentity'])+");console.log(JSON.stringify({rosterHash:e.rosterSha256,sourcePlanHash:e.sourcePlanSha256,sourceConfigHash:e.sourceConfigSha256,adapterBundleHash:e.adapterBundleSha256,oracleVersion:m.STAGED_SCHEDULE_ORACLE_VERSION,minimumStableCompanyCount:e.minimumStableCompanyCount}));"
 native=json.loads(subprocess.check_output([pins['nodePath'],'--require',str(package/'test/no-network.cjs'),'--input-type=module','-e',code],cwd=vendor,env={'PATH':'/usr/bin:/bin','TSX_DISABLE_CACHE':'1'}))
 candidate={'id':'install-offline-review-'+pins['commitSha'][:12],'goalId':'jobfinder-portable-required-40','version':900002}
 db={'migrationVersion':'20261014141000_v75_retired_candidate_fence','schemaHash':'6709fcde7b1953fd1d817d61d3239023fb29ec0ae4fc481efc69ffddbfa13af7','dbSnapshotHash':sha(b'EXPLICIT SYNTHETIC OFFLINE INSTALL DATABASE SNAPSHOT')}
 expected={**candidate,'commitSha':pins['commitSha'],**db,**native,'sourceTreeHash':pins['buildIdentity']['sourceTreeSha256'],'runtimeTreeHash':pins['buildIdentity']['runtimeTreeSha256'],'status':'BUILDING'};assert len(expected)==16
 profiles={};artifacts={}
 for name in builder.ORDER:
  profile=builder.PROFILES[name];cli=builder.render_cli(inputs,name)
  profiles[name]={'schemaVersion':1,'kind':'LIVE_DEPLOYMENT','projectId':'yiopvxysxrtrnvqxwgbx','sourceId':profile['sourceId'],'sourceConfigSha256':profile['sourceConfigSha256'],'candidate':candidate,'databaseIdentity':db,'build':pins['buildIdentity'],'expectedRow':expected,'lockSha256':pins['lockSha256'],'packageManifestSha256':pins['sourceManifestSha256'],'preflightSha256':sha(cli['fixed-'+name+'-preflight.mjs']),'recoveryHelperSha256':sha(cli['fixed-'+name+'-recovery-helper.mts']),'fixturePreloadSha256':None}
  artifacts[name]={**{key:sha(raw) for key,raw in cli.items()},'stableCliSha256':sha(builder.render_stable_cli(inputs,name))}
 deployment={'schemaVersion':1,'kind':'CLOSED_FOUR_SOURCE_RELEASE','projectId':'yiopvxysxrtrnvqxwgbx','order':list(builder.ORDER),'profiles':profiles,'artifacts':artifacts}
 builder.validate_release(inputs,deployment)
 return {'kind':'TEST_ONLY_REAL_NATIVE_SYNTHETIC_DATABASE_DEPLOYMENT','deploymentBytes':json.dumps(deployment,separators=(',',':')),'expectedRow':expected,'mappedTarget':str(target),'nativeDerived':True,'productionQualified':False}
if __name__=='__main__':
 assert len(sys.argv)==3;print(json.dumps(derive(json.load(open(sys.argv[1])),sys.argv[2])))
