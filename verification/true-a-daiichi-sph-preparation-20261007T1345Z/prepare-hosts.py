"""Rebuild static, unbound Daiichi/Shanghai Pharma C51 hosts; local writes only, no live state."""
from pathlib import Path
import json, hashlib, re, subprocess, argparse

R=Path(__file__).resolve().parents[2]
P=Path(__file__).resolve().parent
parser=argparse.ArgumentParser();parser.add_argument('--output-root',type=Path);args=parser.parse_args()
T=args.output_root.resolve() if args.output_root else R
OWNER=T/'owner-adaptations/true-a-daiichi-sph-20261007T1345Z'
PLAN=P/'baseline-source-plan.json'
PIN='40ca0839fb3354b326756914a465512b0662dbbc1ecd643066beab1c28ee00d4'
sha=lambda b:hashlib.sha256(b).hexdigest()
assert sha(PLAN.read_bytes())==PIN
plan=json.loads(PLAN.read_text())
SOURCES={'daiichi':('source-daiichi-sankyo-china-social','4cfbb43973c55db406d1e10ab9aed53bc72b8ccfbb7ed9a66745fd3cbf459e03'),'sph':('source-shanghai-pharma-social','bc8041ef07df70a7c07a6a14487ee84e230a2b0d6efe1e095aded1a3f7dc7df9')}
old_hash='1854166be2d563e3e9cc075df017d3f04e1f65e3b06186bb64c95a3c8676f6a6'
routes=json.loads((P/'static-true-a-source-routes.json').read_text())
assert routes['artifactKind']=='STATIC_TRUE_A_ROUTE_PROJECTION'
fixed=[x for x in plan['files'] if x['path'].startswith(('hosts/amgen/host/','hosts/amgen/supervision/'))]
for key,(sid,source_hash) in SOURCES.items():
 dest=T/'hosts'/key
 assert not dest.exists(), 'NEW_HOST_DIRECTORY_REQUIRED'
 origins=[]
 for row in fixed:
  source=Path(row['sourcePath']);assert sha(source.read_bytes())==row['sha256']
  rel=row['path'].split('hosts/amgen/',1)[1].replace('amgen',key)
  if rel in ['host/context-read.sql.template','host/source-config-reference.json']:continue
  text=source.read_text().replace('source-amgen-china-social',sid).replace(old_hash,source_hash).replace('amgen',key)
  if rel=='host/control-base.template.json':
   data=json.loads(text);data['candidate']=None;data['databaseIdentity']=None;text=json.dumps(data,indent=2)+'\n'
  if rel=='host/runtime/load-host-state.js':
   text=re.sub(r'const expectedDatabaseIdentity=(?:\{[^\n]+\}|null);', 'const expectedDatabaseIdentity=null; // OWNER_DATABASE_BINDING\nconst expectedCandidate=null; // OWNER_CANDIDATE_BINDING',text)
   seam='const command="python3 - "'
   text=text.replace(seam,"if(expectedCandidate===null||expectedDatabaseIdentity===null)throw Error('HOST_OWNER_BINDING_REQUIRED');\nif(candidateId!==expectedCandidate.id)throw Error('HOST_CANDIDATE_ID_MISMATCH');\n"+seam)
   # Bind expected identities before any filesystem or tool access.
   marker=text[text.index('const expectedDatabaseIdentity='):text.index("if(binding.contextReadSha256")]
   text=text.replace(marker,'')
   pos=text.index('const expectedSourceId=')
   text=text[:pos]+marker+text[pos:]
   text=text.replace("if(binding.contextReadSha256", "if(!exact(binding.candidate,expectedCandidate)||!exact(control.candidate,expectedCandidate))throw Error('HOST_CANDIDATE_IDENTITY_MISMATCH');\nif(binding.contextReadSha256")
   target=dest/'host/runtime/load-host-state.unbound.template.js';target.parent.mkdir(parents=True,exist_ok=True);target.write_text(text)
  if rel==f'supervision/start-monitor-{key}51-combined.js':
   text='const expectedCandidate=null; // OWNER_CANDIDATE_BINDING\nif(expectedCandidate===null)throw Error("HOST_OWNER_BINDING_REQUIRED");\n'+text
   text=text.replace('const query=`', 'if(binding.candidate.id!==expectedCandidate.id||binding.candidate.version!==expectedCandidate.version||binding.candidate.goalId!==expectedCandidate.goalId)throw Error("HOST_CANDIDATE_IDENTITY_MISMATCH");\nconst query=`')
   target=dest/f'supervision/start-monitor-{key}51-combined.unbound.template.js';target.parent.mkdir(parents=True,exist_ok=True);target.write_text(text)
  if rel=='host/runtime/load-source-runtime.js':
   text=text.replace('import json,sys\\n','import json,sys,hashlib\\n')
   text=text.replace("print(json.dumps({n:(p/n).read_text()", "print(json.dumps({'__loaderSha256':hashlib.sha256((p/'load-host-state.js').read_bytes()).hexdigest(),'__starterSha256':hashlib.sha256((p/'../../supervision/start-monitor-"+key+"51-combined.js').read_bytes()).hexdigest(),**{n:(p/n).read_text()")
   text=text.replace("'../activation.json']}))", "'../activation.json']}}))")
   text=text.replace('const loaded=await', 'if(binding.loaderSha256!==files.__loaderSha256)throw Error("HOST_LOADER_PIN_MISMATCH");\nif(binding.starterSha256!==files.__starterSha256)throw Error("HOST_STARTER_PIN_MISMATCH");\nconst loaded=await')
  if rel=='host/runtime/prepare-registered-control.mts':
   text='// Offline compatibility entry; requires explicit owner tuple and official readback.\nimport "./prepare-owner-binding.mts";\n'
  target=dest/rel;target.parent.mkdir(parents=True,exist_ok=True);target.write_text(text);target.chmod(0o600)
  origins.append({'path':rel,'sourcePath':str(source),'sourceSha256':row['sha256'],'sha256':sha(target.read_bytes())})
 # Bind the four actual generated/producer files, including relocation-sensitive bytes.
 pin_inputs=[('supervision/sample_process_tree.py',dest/'supervision/sample_process_tree.py'),('supervision/supervise-cancel.mjs',dest/'supervision/supervise-cancel.mjs'),(None,R/'producer/scripts/run-with-http-diagnostics.mjs'),('supervision/inspect-launch-identity.mjs',dest/'supervision/inspect-launch-identity.mjs')]
 expected_pins='\n'.join(sha(p.read_bytes())+'  '+str(R/'hosts'/key/rel if rel else p) for rel,p in pin_inputs)
 for rel in [f'supervision/start-monitor-{key}51-combined.js',f'supervision/start-monitor-{key}51-combined.unbound.template.js']:
  p=dest/rel;text=p.read_text();pattern=r'(combinedHashes\.output\.trim\(\)!==)("(?:[^"\\]|\\.)*")'
  text,n=re.subn(pattern,lambda m:m[1]+json.dumps(expected_pins),text);assert n==1,'COMBINED_PIN_MARKER_REQUIRED';p.write_text(text)
  for origin in origins:
   if origin['path']==rel:origin['sha256']=sha(p.read_bytes())
 reference=next(x for x in routes['rows'] if x['sourceId']==sid)
 assert reference['sourceConfigSha256']==source_hash and reference['route']=='TRUE_A'
 (dest/'host/source-config-reference.json').write_text(json.dumps(reference,ensure_ascii=False,indent=2)+'\n')
 (dest/'verification').mkdir(exist_ok=True)
 (dest/'verification/SAFE_SOURCE_ORIGINS.json').write_text(json.dumps(origins,indent=2)+'\n')
 # Reuse the existing unbound-owner renderer; restore C51/native-A constraints.
 ref=P/'prepare-owner-binding.base.mts'
 text=ref.read_text().replace('source-kelun-social',sid).replace('9fe0cb0d7c308567f6010aa6181f36c595b97df739ecd528cab97070f47572cb',source_hash).replace('239def3a29c9270d706425c810eb4a85d452fa1c','28402a299bb04cbf5873da66c2fe8ca76827c0d1').replace('z.number().int().min(52).max(2147483647)','z.literal(51)').replace('minimumCandidateVersion:z.literal(52)','minimumCandidateVersion:z.literal(51)').replace("id:z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/)","id:z.literal('dot-cloud-delta-proxy-28402a29-20261007')").replace("compileCloudPilotPublicationContextSql(control,'PLAN_BOUND_SOURCE_QUALITY_V1')","compileCloudPilotPublicationContextSql(control)").replace('start-monitor-kelun-next-combined',f'start-monitor-{key}51-combined')
 text=text.replace('const host=resolve',"import { REQUIRED_A_GRADE_COMPLETENESS_CERTIFICATES } from '../../../../producer/src/crawler/completenessCertificate.ts';\nimport { requiresBGradeTraversalCertificate } from '../../../../producer/src/crawler/traversalCertificate.ts';\nconst host=resolve")
 text=text.replace('const context=compileCloudPilotPublicationContextSql(control);',"const sourcePlan=e.plans.find(plan=>plan.source.id===cfg.sourceId);\nif(!sourcePlan||REQUIRED_A_GRADE_COMPLETENESS_CERTIFICATES[cfg.sourceId]!==sourcePlan.company.id||requiresBGradeTraversalCertificate(sourcePlan))throw Error('HOST_ORIGINAL_TRUE_A_ROUTE_REQUIRED');\nconst context=compileCloudPilotPublicationContextSql(control);")
 text=text.replace("const activation={status:'PREPARED_NOT_ACTIVATED',contextReadSha256,","const activation={status:'PREPARED_NOT_ACTIVATED',starterSha256:sha(starter),loaderSha256:sha(loader),contextReadSha256,")
 (dest/'host/runtime/prepare-owner-binding.mts').write_text(text)
 control=json.loads((dest/'host/control-base.template.json').read_text())
 owner={'schemaVersion':1,'build':control['build'],'candidate':None,'databaseIdentity':None,'minimumCandidateVersion':51,'sourceId':sid,'sourceConfigSha256':source_hash}
 (dest/'host/owner-binding-input.template.json').write_text(json.dumps(owner,indent=2)+'\n')

# Isolated owner closure. Do not modify existing Amgen/astra owner files.
assert not OWNER.exists(),'NEW_OWNER_DIRECTORY_REQUIRED'
OWNER.mkdir(parents=True)
base=P/'owner-base'
for rel in ['publish-and-monitor-owner.js','build-fragments.py','tests/owner.test.mjs','tests/generate-full-chain-tests.py','tests/key-and-preload.test.mjs','tests/real-apply-patch-terminal-fixture.json']:
 text=(base/rel).read_text()
 if rel.startswith('tests/'):
  text=text.replace("['astra','amgen']","['daiichi','sph']").replace("(astra|amgen)","(daiichi|sph)")
  text=text.replace("('source-astrazeneca-social' if key=='astra' else 'source-amgen-china-social')","('source-daiichi-sankyo-china-social' if key=='daiichi' else 'source-shanghai-pharma-social')")
 target=OWNER/rel;target.parent.mkdir(parents=True,exist_ok=True);target.write_text(text)
deps={}
for key in SOURCES:
 for rel in ['host-helper-functions.js','host-stage-functions.js','relay-files.mjs','runtime/continuous-relay-v3-durable-monitor.js','runtime/review-packet-envelope.mts']:
  p=T/'hosts'/key/'host'/rel;deps[str(R/'hosts'/key/'host'/rel)]={'sha256':sha(p.read_bytes()),'bytes':p.stat().st_size}
(OWNER/'baseline-manifest.json').write_text(json.dumps({'producerCommit':'28402a299bb04cbf5873da66c2fe8ca76827c0d1','runtimeRoot':str(R),'files':deps},indent=2)+'\n')
subprocess.run(['python3',str(OWNER/'build-fragments.py')],check=True)
subprocess.run(['python3',str(OWNER/'tests/generate-full-chain-tests.py')],check=True)
if T!=R:
 for rel in ['preload-owner.exec.js','publish-reviewed-and-monitor.exec.js']:
  p=OWNER/rel;p.write_text(p.read_text().replace(str(T),str(R)))
print(json.dumps({'hosts':list(SOURCES),'owner':str(OWNER),'status':'UNBOUND_NOT_LAUNCHED'}))
