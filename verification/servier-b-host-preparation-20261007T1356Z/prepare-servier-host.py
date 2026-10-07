"""Native Servier B C51 static infrastructure only; no input acquisition or activation."""
from pathlib import Path
import json,hashlib,re,subprocess,argparse
R=Path(__file__).resolve().parents[2];P=Path(__file__).resolve().parent
parser=argparse.ArgumentParser();parser.add_argument('--output-root',type=Path);args=parser.parse_args()
T=args.output_root.resolve() if args.output_root else R
F=P/'baseline'
plan=json.loads((P/'baseline-source-plan.json').read_text());sha=lambda b:hashlib.sha256(b).hexdigest()
assert sha((P/'baseline-source-plan.json').read_bytes())=='1faa446e97942e0a18c3e28a7ad3af42cbea1aad7f139ae490ac8d223ba600f8'
H=T/'hosts/servier';assert not H.exists(),'NEW_HOST_REQUIRED'
source='source-servier-china-social';sourceHash='3c87c89d3bdc74275a0b66a9a27a9eaf76f99da8ee7aa3af835eb87e2b028e17'
origins=[]
for row in plan['files']:
 if not row['path'].startswith(('hosts/gsk/host/','hosts/gsk/supervision/')):continue
 rel=row['path'].split('hosts/gsk/',1)[1].replace('gsk','servier')
 if rel in ['host/context-read.sql.template','host/context-template-proof.json','host/source-config-reference.json']:continue
 p=Path(row['sourcePath']);assert sha(p.read_bytes())==row['sha256']
 text=p.read_text().replace('source-gsk-china-social',source).replace('aa9bf82308c3b818a8c33b80561712b932389186c160ae83583a8c869eb54d74',sourceHash).replace('gsk','servier').replace('TRUE_A','TRUE_B')
 if rel in ['host/runtime/prepare-owner-binding.mts','host/runtime/inspect-host-binding.mts']:
  text=text.replace("import { REQUIRED_A_GRADE_COMPLETENESS_CERTIFICATES } from '../../../../producer/src/crawler/completenessCertificate.ts';","import { isServierTraversalPlan } from '../../../../producer/src/crawler/servierMokaScope.ts';")
  text=text.replace('!sourcePlan||REQUIRED_A_GRADE_COMPLETENESS_CERTIFICATES[cfg.sourceId]!==sourcePlan.company.id||requiresBGradeTraversalCertificate(sourcePlan)','!sourcePlan||!isServierTraversalPlan(sourcePlan)||!requiresBGradeTraversalCertificate(sourcePlan)')
 target=H/rel;target.parent.mkdir(parents=True,exist_ok=True);target.write_text(text)
 origins.append({'path':rel,'sourcePath':str(p),'sourceSha256':row['sha256'],'sha256':sha(target.read_bytes())})
# Native B overlays retain the independent input and B/ledger review contracts.
for origin in (P/'b-native-overlays').rglob('*'):
 if not origin.is_file():continue
 rel=str(origin.relative_to(P/'b-native-overlays'));target=H/rel;target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(origin.read_bytes())
 record=next((x for x in origins if x['path']==rel),None)
 if record:record.update({'nativeBOverlaySourcePath':str(origin),'nativeBOverlaySha256':sha(origin.read_bytes()),'sha256':sha(target.read_bytes())})
 else:origins.append({'path':rel,'sourcePath':str(origin),'sourceSha256':sha(origin.read_bytes()),'sha256':sha(target.read_bytes())})
pin_inputs=[('supervision/sample_process_tree.py',H/'supervision/sample_process_tree.py'),('supervision/supervise-cancel.mjs',H/'supervision/supervise-cancel.mjs'),(None,R/'producer/scripts/run-with-http-diagnostics.mjs'),('supervision/inspect-launch-identity.mjs',H/'supervision/inspect-launch-identity.mjs')]
expected_pins='\n'.join(sha(p.read_bytes())+'  '+str(R/'hosts/servier'/rel if rel else p) for rel,p in pin_inputs)
for rel in ['supervision/start-monitor-servier51-combined.js','supervision/start-monitor-servier51-combined.unbound.template.js']:
 p=H/rel;text=p.read_text();pattern=r'(combinedHashes\.output\.trim\(\)!==)("(?:[^"\\]|\\.)*")'
 text,n=re.subn(pattern,lambda m:m[1]+json.dumps(expected_pins),text);assert n==1;p.write_text(text)
 for origin in origins:
  if origin['path']==rel:origin['sha256']=sha(p.read_bytes())
(H/'verification').mkdir();(H/'verification/SAFE_SOURCE_ORIGINS.json').write_text(json.dumps(origins,indent=2)+'\n')
reference=json.loads((P/'static-servier-source-route.json').read_text());assert reference['route']=='TRUE_B' and reference['sourceConfigSha256']==sourceHash
(H/'host/source-config-reference.json').write_text(json.dumps(reference,ensure_ascii=False,indent=2)+'\n')
O=T/'owner-adaptations/servier-b-20261007T1356Z';assert not O.exists();O.mkdir(parents=True)
base=F/'owner-adaptations/true-a-cttq-gsk-20261007T1348Z'
for rel in ['publish-and-monitor-owner.js','build-fragments.py','tests/owner.test.mjs','tests/generate-full-chain-tests.py','tests/key-and-preload.test.mjs','tests/real-apply-patch-terminal-fixture.json']:
 text=(base/rel).read_text()
 if rel.startswith('tests/'):
  text=text.replace("['cttq','gsk']","['servier']").replace('(cttq|gsk)','(servier)').replace("('source-cttq-social' if key=='cttq' else 'source-gsk-china-social')","'source-servier-china-social'")
  text=text.replace('exactly ten fixed mappings for the two A hosts','exactly five fixed mappings for the Servier B host').replace('Object.keys(manifest.files).length,10','Object.keys(manifest.files).length,5')
 target=O/rel;target.parent.mkdir(parents=True,exist_ok=True);target.write_text(text)
deps={}
for rel in ['host-helper-functions.js','host-stage-functions.js','relay-files.mjs','runtime/continuous-relay-v3-durable-monitor.js','runtime/review-packet-envelope.mts']:
 p=H/'host'/rel;deps[str(R/'hosts/servier/host'/rel)]={'sha256':sha(p.read_bytes()),'bytes':p.stat().st_size}
(O/'baseline-manifest.json').write_text(json.dumps({'producerCommit':'28402a299bb04cbf5873da66c2fe8ca76827c0d1','runtimeRoot':str(R),'files':deps},indent=2)+'\n')
subprocess.run(['python3',str(O/'build-fragments.py')],check=True);subprocess.run(['python3',str(O/'tests/generate-full-chain-tests.py')],check=True)
if T!=R:
 for rel in ['preload-owner.exec.js','publish-reviewed-and-monitor.exec.js']:
  p=O/rel;p.write_text(p.read_text().replace(str(T),str(R)))
print(json.dumps({'status':'UNBOUND_TRUE_B_STATIC_PREPARATION','host':str(H),'owner':str(O)}))
