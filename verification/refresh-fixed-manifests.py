#!/usr/bin/env python3
"""Record explicit fixed files only. Does not bind, activate, register, launch, or write publisher state."""
from pathlib import Path
import json,hashlib
N=Path(__file__).resolve().parent.parent;H=N/'hosts/novartis-next/host';O=N/'owner';V=N/'verification'
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
unique=str(N.parent/'PUBLISHER-ACTIVE-STATE.json')
completion=(H/'runtime/complete-reviewed-source-readback.js').read_text()
assert completion.count('PUBLISHER-ACTIVE-STATE.json')==1 and 'const statePath='+json.dumps(unique)+';' in completion
assert not (N/'PUBLISHER-ACTIVE-STATE.json').exists()
control=json.loads((H/'control-base.json').read_text());activation=json.loads((H/'activation.json').read_text());build=json.loads((N/'NEW_LOCAL_BUILD_IDENTITY.json').read_text());m=json.loads((O/'baseline-manifest.json').read_text())
assert control['build']==activation['build']==m['build']==build
assert control['candidate']==activation['candidate']==m['expectedCandidate']
assert control['databaseIdentity']==activation['databaseIdentity']
if activation['status']=='UNREGISTERED_NOT_ACTIVATED':
 assert activation['candidate'] is None and activation['databaseIdentity'] is None
 phase='UNREGISTERED_TEMPLATE'
else:
 assert activation['status']=='REGISTERED_VERIFIED' and activation['candidate']['version']>=53
 phase='BOUND_PRIVATE_RUNTIME'
for path,rec in m['files'].items():assert sha(Path(path))==rec['sha256']
base='hosts/novartis-next/'
safe=[base+'host/'+p for p in [
 'archive-transfer.mjs','host-config.template.json','host-files.mts','host-helper-functions.js','host-stage-functions.js','machine-json.js','relay-files.mjs','source-config-reference.json',
 'control-base.template.json','activation.unbound.template.json','context-read.unbound.template.sql','owner-binding-input.template.json','prepare-owner-binding.command.template.txt',
 'runtime/complete-reviewed-source-readback.js','runtime/continuous-relay-v3-durable-monitor.js','runtime/inspect-host-binding.mts','runtime/load-host-state.unbound.template.js','runtime/load-source-runtime.js','runtime/machine-json.py','runtime/preflight/preflight-launch.mjs','runtime/preflight/runtime-check.mjs','runtime/prepare-owner-binding.mts','runtime/prepare-registered-control.mts','runtime/review-packet-envelope.mts','runtime/review-publication.py','runtime/update-candidate-completion-state.mjs']]
safe += [base+'supervision/'+p for p in ['sample_process_tree.py','inspect-launch-identity.mjs','supervise-cancel.mjs','start-monitor-novartis-next-combined.unbound.template.js']]
safe += ['owner/'+p for p in ['publish-and-monitor-owner.template.js','baseline-manifest.template.json','build-fragments.py','tests/owner.test.mjs','tests/run-owner-tests.sh','tests/real-apply-patch-terminal-fixture.json','tests/original-22-case-names.json']]
safe += ['host-gate-tests/'+p for p in ['verify-owner-gates.mts','verify-starter-gates.mjs','verify-completion-gates.mjs','verify-binder-restoration.mts','verify-supervisor-launch-boundary.mjs','fixtures/real-supervisor-exit42-exec-result.json','run-offline.sh']]
safe += ['NEW_LOCAL_BUILD_IDENTITY.json','REGISTRATION_EXPECTED_PROJECTION.json','verification/refresh-fixed-manifests.py','verification/verify-restoration-closure.py','SAFE_SOURCE_README.md']
private=[base+'host/'+p for p in ['host-config.json','control-base.json','activation.json','context-read.sql','runtime/load-host-state.js']]+[base+'supervision/start-monitor-novartis-next-combined.js']+['owner/'+p for p in ['publish-and-monitor-owner.js','baseline-manifest.json','preload-owner.exec.js','publish-reviewed-and-monitor.exec.js']]
restore={base+'host/runtime/load-host-state.unbound.template.js':base+'host/runtime/load-host-state.js',base+'supervision/start-monitor-novartis-next-combined.unbound.template.js':base+'supervision/start-monitor-novartis-next-combined.js',base+'host/control-base.template.json':base+'host/control-base.json',base+'host/host-config.template.json':base+'host/host-config.json',base+'host/activation.unbound.template.json':base+'host/activation.json',base+'host/context-read.unbound.template.sql':base+'host/context-read.sql','owner/publish-and-monitor-owner.template.js':'owner/publish-and-monitor-owner.js','owner/baseline-manifest.template.json':'owner/baseline-manifest.json'}
for rel in safe+private:
 p=N/rel;assert p.is_file() and not p.is_symlink(),rel
allow={'schemaVersion':1,'classification':'SAFE_UNBOUND_RECONSTRUCTION_CLOSURE','phase':phase,'safeFiles':sorted(safe),'privateBindingFiles':sorted(private),'restoreMappings':restore,'postRestoreCommands':['python3 owner/build-fragments.py','bash host-gate-tests/run-offline.sh','bash owner/tests/run-owner-tests.sh'],'requiredSeparateProducerArtifact':{'commitSha':build['commitSha'],'repo':'producer','physicalDependenciesRequired':True,'pinnedNode':str(N.parent/'runtime/node-v22.23.3-linux-x64/bin/node')},'exclusions':['registration inputs/readbacks/prepared bindings','real run artifacts','synthetic test output directories','runtime candidate/database identity values','publisher state'],'integrityIsNotRegistrationAuthority':True}
(V/'SAFE_SOURCE_ALLOWLIST.json').write_text(json.dumps(allow,indent=2)+'\n');safe.append('verification/SAFE_SOURCE_ALLOWLIST.json')
def manifest(paths):return [{'path':rel,'sha256':sha(N/rel),'bytes':(N/rel).stat().st_size} for rel in sorted(paths)]
for name,paths in [('SAFE_SOURCE_FILE_MANIFEST.json',safe),('PRIVATE_BINDING_FILE_MANIFEST.json',private),('HOST_FILE_MANIFEST.json',safe+private)]:
 (V/name).write_text(json.dumps(manifest(paths),indent=2)+'\n')
print(json.dumps({'phase':phase,'safeFiles':len(safe),'privateBindingFiles':len(private),'uniquePublisherState':unique,'manifestsRoot':str(V)}))
