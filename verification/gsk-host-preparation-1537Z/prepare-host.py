"""Rebuild unbound GSK host and owner from frozen safe GSK inputs only."""
from pathlib import Path
import argparse,json,hashlib,re,subprocess
R=Path('/workspace/scratch/5e9614251709/jb-incremental-proxy-runtime-20261007T0057Z')
N=R/'gsk-producer-runtime-1529Z';P=Path(__file__).resolve().parent;F=P/'baseline'
a=argparse.ArgumentParser();a.add_argument('--output-root',type=Path);args=a.parse_args();T=args.output_root.resolve() if args.output_root else N
sha=lambda b:hashlib.sha256(b).hexdigest()
manifest=json.loads((P/'BASELINE_SOURCE_MANIFEST.json').read_text())
for row in manifest['files']:assert sha((F/row['path']).read_bytes())==row['sha256'],row['path']
build=json.loads((N/'NEW_LOCAL_BUILD_IDENTITY.json').read_text());assert build['commitSha']=='58aa0e413eec27813483996f5dea6c708a7757c4'
old=json.loads((F/'hosts/gsk/host/control-base.template.json').read_text())['build']
host=T/'hosts/gsk';assert not host.exists(),'NEW_UNBOUND_HOST_REQUIRED'
origins=[]
for row in manifest['files']:
 if not row['path'].startswith('hosts/gsk/'):continue
 rel=row['path'].removeprefix('hosts/gsk/');text=(F/row['path']).read_text()
 text=text.replace(str(R),str(N)).replace(str(N)+'/runtime/node-v22.23.3-linux-x64',str(R)+'/runtime/node-v22.23.3-linux-x64').replace(str(N)+'/PUBLISHER-ACTIVE-STATE.json',str(R)+'/PUBLISHER-ACTIVE-STATE.json')
 for k,v in old.items():
  if isinstance(v,str):text=text.replace(v,build[k])
 text=text.replace('start-monitor-gsk51-combined','start-monitor-gsk-next-combined')
 text=text.replace('binding.candidate.version!==51||binding.candidate.id!=="dot-cloud-delta-proxy-28402a29-20261007"','binding.candidate.version<52')
 text=text.replace("control.candidate.version!==51||control.candidate.id!=='dot-cloud-delta-proxy-28402a29-20261007'","control.candidate.version<52")
 text=text.replace("id:z.literal('dot-cloud-delta-proxy-28402a29-20261007')","id:z.string().regex(/^[-A-Za-z0-9._]{1,100}$/).refine(id=>id!=='dot-cloud-delta-proxy-28402a29-20261007')")
 text=text.replace('version:z.literal(51)','version:z.number().int().min(52)').replace('minimumCandidateVersion:z.literal(51)','minimumCandidateVersion:z.literal(52)').replace('"minimumCandidateVersion": 51','"minimumCandidateVersion": 52')
 if rel=='host/runtime/preflight/preflight-launch.mjs':
  text=text.replace('--max-old-space-size=256','--max-old-space-size=384')
  text=text.replace("'--import', './node_modules/tsx/dist/loader.mjs'","'--import', join(repo, 'node_modules/tsx/dist/loader.mjs')")
  text=text.replace("reviewedSha256, artifacts, relay];","reviewedSha256, artifacts, relay, '--db-started-control', controlFile.path];")
 if rel=='host/runtime/preflight/runtime-check.mjs':
  text="import { getHeapStatistics } from 'node:v8';\n"+text
  text=text.replace("const fromRepo = path =>", "if (!process.execArgv.includes('--max-old-space-size=384')) throw Error('PREFLIGHT_HEAP_384_REQUIRED');\nconst heapProof={execArgv:process.execArgv,heapSizeLimitBytes:getHeapStatistics().heap_size_limit,requiredOldSpaceMiB:384};\nconst fromRepo = path =>")
  text=text.replace('JSON.stringify({ build, nodeRuntime, sourceConfigSha256:', 'JSON.stringify({ build, nodeRuntime, heapProof, sourceConfigSha256:')
 rel=rel.replace('start-monitor-gsk51-combined','start-monitor-gsk-next-combined')
 target=host/rel;target.parent.mkdir(parents=True,exist_ok=True);target.write_text(text);target.chmod(0o600)
 origins.append({'path':rel,'sourcePath':row['sourcePath'],'sourceSha256':row['sha256'],'sha256':sha(target.read_bytes())})
# Compute all four pins from relocated bytes. Never carry the prior supervisor pin.
inputs=[('supervision/sample_process_tree.py',host/'supervision/sample_process_tree.py'),('supervision/supervise-cancel.mjs',host/'supervision/supervise-cancel.mjs'),(None,N/'producer/scripts/run-with-http-diagnostics.mjs'),('supervision/inspect-launch-identity.mjs',host/'supervision/inspect-launch-identity.mjs')]
pins='\n'.join(sha(path.read_bytes())+'  '+str(N/'hosts/gsk'/rel if rel else path) for rel,path in inputs)
for rel in ['supervision/start-monitor-gsk-next-combined.js','supervision/start-monitor-gsk-next-combined.unbound.template.js']:
 target=host/rel;text=target.read_text();text,n=re.subn(r'(combinedHashes\.output\.trim\(\)!==)("(?:[^"\\]|\\.)*")',lambda m:m[1]+json.dumps(pins),text);assert n==1;target.write_text(text)
 for row in origins:
  if row['path']==rel:row['sha256']=sha(target.read_bytes())
(host/'verification').mkdir()
# Source-only metadata derives from this build. No candidate, database, or activation tuple.
reference=json.loads((host/'host/source-config-reference.json').read_text())
reference['mainImplementation']['role']='gsk-custom-location-58aa0e4'
reference['qualityImplementation']['role']='gsk-custom-location-58aa0e4'
for key in ['mainImplementation','qualityImplementation']:reference[key]['sha256']=sha((N/'producer'/reference[key]['path']).read_bytes())
(host/'host/source-config-reference.json').write_text(json.dumps(reference,ensure_ascii=False,indent=2)+'\n')
for row in origins:row['sha256']=sha((host/row['path']).read_bytes())
(host/'verification/SAFE_SOURCE_ORIGINS.json').write_text(json.dumps(origins,indent=2)+'\n')
owner=T/'owner-adaptations/gsk-true-a-1537Z';assert not owner.exists();owner.mkdir(parents=True)
for rel in ['publish-and-monitor-owner.js','build-fragments.py','tests/owner.test.mjs','tests/generate-full-chain-tests.py','tests/key-and-preload.test.mjs','tests/real-apply-patch-terminal-fixture.json']:
 text=(F/'owner'/rel).read_text()
 if rel=='publish-and-monitor-owner.js':
  text=text.replace('28402a299bb04cbf5873da66c2fe8ca76827c0d1',build['commitSha'])
  text=text.replace("binding.candidate?.version !== 51", "!Number.isSafeInteger(binding.candidate?.version) || binding.candidate.version < 52 || binding.candidate.id === 'dot-cloud-delta-proxy-28402a29-20261007'")
  text=text.replace("const r = clone(suppliedRequest), cfg = h.cfg;", "const r = clone(suppliedRequest), cfg = h.cfg;\n  if (sourceKey !== 'gsk' || cfg.sourceId !== 'source-gsk-china-social') fail('OWNER_SOURCE_SCOPE');")
 if rel.startswith('tests/'):
  text=text.replace("['cttq','gsk']","['gsk']").replace('(cttq|gsk)','(gsk)').replace("('source-cttq-social' if key=='cttq' else 'source-gsk-china-social')","'source-gsk-china-social'")
  text=text.replace('exactly ten fixed mappings for the two A hosts','exactly five fixed mappings for the GSK host').replace('Object.keys(manifest.files).length,10','Object.keys(manifest.files).length,5')
  text=text.replace("candidate:{version:51,id:'synthetic-C51'}","candidate:{version:999,id:'synthetic-gsk-new-build'}")
  text=text.replace('source-abbvie-china-social','source-gsk-china-social').replace('abbvie','gsk')
 if rel=='tests/owner.test.mjs':
  text+="\nfor(const kind of ['old-build','old-version','old-id'])test('new GSK owner rejects '+kind+' before SQL',async()=>{const f=await fixture(),key=f.ns+'registeredCandidateBinding',binding=structuredClone(f.state.get(key));if(kind==='old-build')binding.build.commitSha='28402a299bb04cbf5873da66c2fe8ca76827c0d1';if(kind==='old-version')binding.candidate.version=51;if(kind==='old-id')binding.candidate.id='dot-cloud-delta-proxy-28402a29-20261007';f.state.set(key,binding);await assert.rejects(f.owner(f.input),/OWNER_REVIEW_BINDING/);assert.equal(f.publishCalls,0);assert.equal(f.pollCalls,0);});\n"
 target=owner/rel;target.parent.mkdir(parents=True,exist_ok=True);target.write_text(text)
# Generator's original seam becomes GSK after the direct suite is specialized above.
p=owner/'tests/generate-full-chain-tests.py';text=p.read_text().replace(".replace('gsk',key)",".replace('gsk',key)").replace('Generated two full-chain source suites','Generated one GSK full-chain source suite');p.write_text(text)
deps={}
for rel in ['host-helper-functions.js','host-stage-functions.js','relay-files.mjs','runtime/continuous-relay-v3-durable-monitor.js','runtime/review-packet-envelope.mts']:
 path=host/'host'/rel;deps[str(N/'hosts/gsk/host'/rel)]={'sha256':sha(path.read_bytes()),'bytes':path.stat().st_size}
(owner/'baseline-manifest.json').write_text(json.dumps({'producerCommit':build['commitSha'],'runtimeRoot':str(N),'files':deps},indent=2)+'\n')
subprocess.run(['python3',str(owner/'build-fragments.py')],check=True)
subprocess.run(['python3',str(owner/'tests/generate-full-chain-tests.py')],check=True)
if T!=N:
 for rel in ['preload-owner.exec.js','publish-reviewed-and-monitor.exec.js']:
  p=owner/rel;p.write_text(p.read_text().replace(str(T),str(N)))
print(json.dumps({'status':'UNBOUND_NOT_LAUNCHED','host':str(host),'owner':str(owner),'globalStatePath':str(R/'PUBLISHER-ACTIVE-STATE.json'),'candidate':None,'databaseIdentity':None,'minimumCandidateVersion':52}))
