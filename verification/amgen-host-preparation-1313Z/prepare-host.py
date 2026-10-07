"""Static Amgen new-build host/owner; no HTTP/SQL/binding/activation/launch."""
from pathlib import Path
import json,hashlib,re,subprocess,argparse
R=Path('/workspace/scratch/5e9614251709/jb-incremental-proxy-runtime-20261007T0057Z')
N=Path(__file__).resolve().parents[2]
P=Path(__file__).resolve().parent
parser=argparse.ArgumentParser();parser.add_argument('--output-root',type=Path);args=parser.parse_args()
T=args.output_root.resolve() if args.output_root else N
F=P/'baseline'
planPath=P/'baseline-source-plan.json'
sha=lambda b:hashlib.sha256(b).hexdigest()
assert sha(planPath.read_bytes())=='bcc891afcb7caa130a3b472cdd2bbeeb0d937fa2a15184728e8d4a8fa082bc3d'
plan=json.loads(planPath.read_text())
build=json.loads((N/'NEW_LOCAL_BUILD_IDENTITY.json').read_text())
assert build['commitSha']=='629294b49212e4fb3fceb14f88cdf37fca17b451'
oldBuild=json.loads((F/'hosts/csl/host/control-base.template.json').read_text())['build']
source='source-amgen-china-social';sourceHash='1854166be2d563e3e9cc075df017d3f04e1f65e3b06186bb64c95a3c8676f6a6'
host=T/'hosts/amgen';assert not host.exists(),'NEW_HOST_REQUIRED'
origins=[]
for row in plan['files']:
 if not row['path'].startswith(('hosts/csl/host/','hosts/csl/supervision/')):continue
 rel=row['path'].split('hosts/csl/',1)[1]
 if rel in ['host/source-config-reference.json','host/context-read.sql.template','host/context-template-proof.json']:continue
 p=Path(row['sourcePath']);assert sha(p.read_bytes())==row['sha256']
 text=p.read_text().replace('source-csl-china-social',source).replace('eb4583bc629171783b293f162837776c6f68e63b7e81cc40540b83aed6e06694',sourceHash).replace('start-monitor-csl51-combined','start-monitor-amgen-next-combined').replace('csl','amgen')
 text=text.replace(str(R),str(N)).replace(str(N)+'/runtime/node-v22.23.3-linux-x64',str(R)+'/runtime/node-v22.23.3-linux-x64').replace(str(N)+'/PUBLISHER-ACTIVE-STATE.json',str(R)+'/PUBLISHER-ACTIVE-STATE.json')
 for k,v in oldBuild.items():
  if isinstance(v,str):text=text.replace(v,build[k])
 text=text.replace('binding.candidate.version!==51||binding.candidate.id!=="dot-cloud-delta-proxy-28402a29-20261007"','binding.candidate.version!==56||binding.candidate.id!=="dot-cloud-amgen-get-retry-629294b4-20261007"')
 text=text.replace("control.candidate.version!==51||control.candidate.id!=='dot-cloud-delta-proxy-28402a29-20261007'","control.candidate.version!==56||control.candidate.id!=='dot-cloud-amgen-get-retry-629294b4-20261007'")
 text=text.replace("id:z.literal('dot-cloud-delta-proxy-28402a29-20261007')","id:z.literal('dot-cloud-amgen-get-retry-629294b4-20261007')")
 text=text.replace('version:z.literal(51)','version:z.literal(56)').replace('minimumCandidateVersion:z.literal(51)','minimumCandidateVersion:z.literal(56)').replace('"minimumCandidateVersion": 51','"minimumCandidateVersion": 56')
 rel=rel.replace('start-monitor-csl51-combined','start-monitor-amgen-next-combined').replace('csl','amgen')
 target=host/rel;target.parent.mkdir(parents=True,exist_ok=True);target.write_text(text);target.chmod(0o600)
 origins.append({'path':rel,'sourcePath':str(p),'sourceSha256':row['sha256'],'sha256':sha(target.read_bytes())})
# Recompute pins from the relocated bytes, including the changed supervisor R2.
# The wrapper remains the separately frozen producer input, never generated here.
pin_inputs=[('supervision/sample_process_tree.py',host/'supervision/sample_process_tree.py'),('supervision/supervise-cancel.mjs',host/'supervision/supervise-cancel.mjs'),(None,N/'producer/scripts/run-with-http-diagnostics.mjs'),('supervision/inspect-launch-identity.mjs',host/'supervision/inspect-launch-identity.mjs')]
expected_pins='\n'.join(sha(p.read_bytes())+'  '+str(N/'hosts/amgen'/rel if rel else p) for rel,p in pin_inputs)
for rel in ['supervision/start-monitor-amgen-next-combined.js','supervision/start-monitor-amgen-next-combined.unbound.template.js']:
 p=host/rel;text=p.read_text();pattern=r'(combinedHashes\.output\.trim\(\)!==)("(?:[^"\\]|\\.)*")'
 text,n=re.subn(pattern,lambda m:m[1]+json.dumps(expected_pins),text);assert n==1,'COMBINED_PIN_MARKER_REQUIRED';p.write_text(text)
 for origin in origins:
  if origin['path']==rel:origin['sha256']=sha(p.read_bytes())
(host/'verification').mkdir()
(host/'verification/SAFE_SOURCE_ORIGINS.json').write_text(json.dumps(origins,indent=2)+'\n')
reference=json.loads((F/'verification/true-a-due-host-preparation-20261007T1256Z/host-base/host/source-config-reference.json').read_text())
assert reference['sourceId']==source and reference['sourceConfigSha256']==sourceHash
(host/'host/source-config-reference.json').write_text(json.dumps(reference,ensure_ascii=False,indent=2)+'\n')
# New single-source owner; only new build/version/id pins differ from the factory baseline. Shared outer global state is never copied.
owner=T/'owner-adaptations/amgen-true-a-1313Z';assert not owner.exists();owner.mkdir(parents=True)
oldOwner=F/'owner-adaptations/true-a-due-20261007T1256Z'
for rel in ['publish-and-monitor-owner.js','build-fragments.py','tests/owner.test.mjs','tests/generate-full-chain-tests.py','tests/key-and-preload.test.mjs','tests/real-apply-patch-terminal-fixture.json']:
 text=(oldOwner/rel).read_text()
 if rel=='tests/owner.test.mjs':text+=(P/'owner-binding-negative-tests.mjs.fragment').read_text()
 if rel=='publish-and-monitor-owner.js':
  text=text.replace('28402a299bb04cbf5873da66c2fe8ca76827c0d1','629294b49212e4fb3fceb14f88cdf37fca17b451').replace('binding.candidate?.version !== 51',"binding.candidate?.version !== 56 || binding.candidate?.id !== 'dot-cloud-amgen-get-retry-629294b4-20261007'")
 if rel=='tests/owner.test.mjs':
  text=text.replace("candidate:{version:51,id:'synthetic-C51'}","candidate:{version:56,id:'dot-cloud-amgen-get-retry-629294b4-20261007'}")
 if rel.startswith('tests/'):
  text=text.replace("['csl','crpharma']","['amgen']").replace("(csl|crpharma)","(amgen)").replace("('source-csl-china-social' if key=='csl' else 'source-cr-pharma-social')","'source-amgen-china-social'")
  text=text.replace('exactly ten fixed mappings for the two A hosts','exactly five fixed mappings for the new Amgen A host').replace('Object.keys(manifest.files).length,10','Object.keys(manifest.files).length,5')
 target=owner/rel;target.parent.mkdir(parents=True,exist_ok=True);target.write_text(text)
deps={}
for rel in ['host-helper-functions.js','host-stage-functions.js','relay-files.mjs','runtime/continuous-relay-v3-durable-monitor.js','runtime/review-packet-envelope.mts']:
 p=host/'host'/rel;deps[str(N/'hosts/amgen/host'/rel)]={'sha256':sha(p.read_bytes()),'bytes':p.stat().st_size}
(owner/'baseline-manifest.json').write_text(json.dumps({'producerCommit':build['commitSha'],'runtimeRoot':str(N),'files':deps},indent=2)+'\n')
subprocess.run(['python3',str(owner/'build-fragments.py')],check=True)
subprocess.run(['python3',str(owner/'tests/generate-full-chain-tests.py')],check=True)
if T!=N:
 for rel in ['preload-owner.exec.js','publish-reviewed-and-monitor.exec.js']:
  p=owner/rel;p.write_text(p.read_text().replace(str(T),str(N)))
print(json.dumps({'status':'UNBOUND_NOT_LAUNCHED','host':str(host),'owner':str(owner),'globalStatePath':str(R/'PUBLISHER-ACTIVE-STATE.json')}))
