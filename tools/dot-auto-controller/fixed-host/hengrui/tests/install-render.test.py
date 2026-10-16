"""Pure Hengrui installer rendering. No rendered installer/holder is executed."""
from pathlib import Path
import hashlib,json,runpy,copy,ast
P=Path(__file__).resolve().parents[1];HOST=P.parent;PKG=HOST.parent
m=runpy.run_path(str(P/'render-install.py'));b=runpy.run_path(str(P/'build-functions-entry.py'))
reports=[]
def case(name,check):
 assert check(),name;reports.append(name)
def rejected(call):
 try:call()
 except Exception:return True
 return False
sha=lambda raw:hashlib.sha256(raw).hexdigest()
commit='c'*40;candidate={'id':'local-render-unit-only','goalId':'jobfinder-portable-required-40','version':900003}
db={'migrationVersion':'20261014141000_v75_retired_candidate_fence','schemaHash':'6709fcde7b1953fd1d817d61d3239023fb29ec0ae4fc481efc69ffddbfa13af7','dbSnapshotHash':'d'*64}
build={'schemaVersion':2,'commitSha':commit,'sourceTreeSha256':'a'*64,'runtimeTreeSha256':'b'*64};build['contentSha256']=sha(json.dumps(build,separators=(',',':')).encode())
row={**candidate,**db,'commitSha':commit,'rosterHash':'a'*64,'sourcePlanHash':'a'*64,'sourceConfigHash':'a'*64,'adapterBundleHash':'a'*64,'sourceTreeHash':build['sourceTreeSha256'],'runtimeTreeHash':build['runtimeTreeSha256'],'oracleVersion':'staged-official-source-v1','minimumStableCompanyCount':41,'status':'BUILDING'}
assert set(row)==b['ROW_KEYS']
r=runpy.run_path(str(P/'render-hengrui-source.py'));cli=r['render_bytes'](r['load_templates']())
d={'schemaVersion':1,'kind':'LIVE_DEPLOYMENT','projectId':'yiopvxysxrtrnvqxwgbx','sourceId':'source-hengrui-social','sourceConfigSha256':'93dcadb4a572da022694b3ab3040fad541fe674107e3dc66fd2323709e374b4e','candidate':candidate,'databaseIdentity':db,'build':build,'expectedRow':row,'lockSha256':'a'*64,'packageManifestSha256':'a'*64,'preflightSha256':sha(cli['fixed-preflight.mjs']),'recoveryHelperSha256':sha(cli['fixed-recovery-helper.mts']),'fixturePreloadSha256':None}
b['validate_deployment'](d,cli)
for field,value in [('sourceId','source-biogen-china-social'),('sourceConfigSha256','b'*64),('fixturePreloadSha256','a'*64)]:
 bad=copy.deepcopy(d);bad[field]=value;case('fixed deployment rejects '+field,lambda:rejected(lambda:b['validate_deployment'](bad,cli)))
native=json.loads((PKG/'config/reader-pins.json').read_text());api=json.loads((PKG/'config/reader-api-pins.json').read_text())
readers={}
for role in ('main','fallback'):
 hashes={**native[role]['readerFileHashes'],'src/server/portablePublicationApi.ts':api[role]['apiSha256'],'src/server/publicApi.ts':api[role]['handlerSha256'],'src/domain/jobLocation.ts':api[role]['locationSha256']}
 readers[role]={'role':role,'readerFileHashes':hashes,'build':{key:'a'*64 for key in ('manifestSha256','entrypointSha256','proofModuleSha256')}}
control={'repo':'EthanYoQ/Job-finder-Codex','projectId':'yiopvxysxrtrnvqxwgbx','commitSha':commit,'treeSha':'b'*40,'retiredCandidate':json.loads((HOST/'install/retired-candidate.json').read_text()),'expectedRow':row,'readerExpected':{'schemaVersion':1,'readers':readers},'deploymentBytes':json.dumps(d,separators=(',',':'))}
pins={'commitSha':commit,'buildIdentity':build}
live=Path(m['PARENT'])/'job-finder-fixed-live-controller-v1';before=live.exists()
rendered=m['build'](pins,control);holder=m['render_holder'](pins,control)
embedded={n.targets[0].id:ast.literal_eval(n.value) for n in ast.parse(holder).body if isinstance(n,ast.Assign) and len(n.targets)==1 and isinstance(n.targets[0],ast.Name) and n.targets[0].id.endswith('_SOURCE')}
case('installer renders deterministically',lambda:rendered==m['build'](pins,control))
case('unbound installer remains separate',lambda:rendered!=m['render']())
case('original EX holder and staging remain embedded',lambda:'EX' in holder and 'FIXED_PRODUCTION' in holder and 'install_original_owner_renderer' in holder)
case('Hengrui bound renderer uses actual profile',lambda:'fixed-host/hengrui/build-functions-entry.py' in holder and 'fixed-host/hengrui/local-activation.py.in' in holder and 'fixed-host/hengrui/lifecycle-activation.template.js' in holder)
case('disabled-only target invariant retained',lambda:'BOUND_DISABLED_ONLY' in embedded['BOUND_ARTIFACTS_SOURCE'] and "'candidate/functions-entry.enabled.js' not in target" in embedded['BOUND_ARTIFACTS_SOURCE'])
case('source-scoped native wrapper retained',lambda:b'hengrui-run-with-owned-publication-pipe.mjs' in cli['fixed-preimport-launch.py'])
case('request readiness remains required',lambda:b'request_ready' in cli['fixed-preimport-launch.py'] and b'assertRelayRequestReady' in cli['fixed-recovery-helper.mts'])
case('rendering did not create LIVE root',lambda:live.exists()==before)
wrong=copy.deepcopy(control);bad=copy.deepcopy(d);bad['sourceId']='source-biogen-china-social';wrong['deploymentBytes']=json.dumps(bad)
case('installer rejects another source before emission',lambda:rejected(lambda:m['build'](pins,wrong)))
print(json.dumps({'kind':'HENGRUI_PURE_INSTALL_RENDER_TESTS','passed':True,'cases':len(reports),'tests':reports,'installerSha256':sha(rendered),'holderSha256':sha(holder.encode()),'renderedBytes':len(rendered),'installerExecuted':False,'holderExecuted':False,'productionQualified':False,'activation':False},indent=2))
